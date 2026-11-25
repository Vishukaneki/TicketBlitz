// src/services/lock.service.ts
import crypto from 'crypto';
import { prisma } from '../config/prisma';
import { redisClient } from '../config/redis';

export const LOCK_DURATION_SECONDS = 600; // 10 minutes
const HYDRATION_TTL_SECONDS = 86400; // 24 hours

// Redis Cluster Hash Tags `{showId}` ensure all keys for a show land on the same shard,
// preventing CROSSSLOT errors in multi-key Lua scripts.
export const getValidSeatsKey = (showId: string) => `show_valid_seats:{${showId}}`;
export const getBookedSeatsKey = (showId: string) => `show_booked:{${showId}}`;
export const getHydratedFlagKey = (showId: string) => `show_hydrated:{${showId}}`;
export const getSeatLockKey = (showId: string, seatId: string) =>
  `seat_lock:{${showId}}:${seatId}`;

// In-process single-flight map to prevent cache stampede on cold show hydration
const hydrationInFlight = new Map<string, Promise<boolean>>();

// ─────────────────────────────────────────────────────────────────────────────
// REDIS LUA SCRIPTS (Registered once via ioredis defineCommand for EVALSHA)
// ─────────────────────────────────────────────────────────────────────────────

const ACQUIRE_MULTI_SEAT_LOCK_LUA = `
local validSetKey = KEYS[1]
local bookedSetKey = KEYS[2]
local lockOwnerPrefix = ARGV[1]
local newLockToken = ARGV[2]
local ttl = tonumber(ARGV[3])

-- Pass 1: All-or-Nothing Verification
for i = 3, #KEYS do
  local lockKey = KEYS[i]
  local seatId = ARGV[i + 1]

  if redis.call("SISMEMBER", validSetKey, seatId) == 0 then
    return {0, "INVALID_SEAT", seatId}
  end

  if redis.call("SISMEMBER", bookedSetKey, seatId) == 1 then
    return {0, "BOOKED", seatId}
  end

  local currentOwner = redis.call("GET", lockKey)
  if currentOwner ~= false then
    if string.sub(currentOwner, 1, string.len(lockOwnerPrefix)) ~= lockOwnerPrefix then
      return {0, "LOCKED", seatId}
    end
  end
end

-- Pass 2: Atomic Acquisition (Every seat verified free or already held by same user)
for i = 3, #KEYS do
  redis.call("SET", KEYS[i], newLockToken, "EX", ttl)
end

return {1, "OK"}
`;

const VERIFY_LOCKS_FOR_CONFIRM_LUA = `
local validSetKey = KEYS[1]
local bookedSetKey = KEYS[2]
local userPrefix = ARGV[1]
local expectedToken = ARGV[2]
local heldTokens = {}

for i = 3, #KEYS do
  local lockKey = KEYS[i]
  local seatId = ARGV[i]

  if redis.call("SISMEMBER", validSetKey, seatId) == 0 then
    return {0, "INVALID_SEAT", seatId}
  end

  if redis.call("SISMEMBER", bookedSetKey, seatId) == 1 then
    return {0, "BOOKED", seatId}
  end

  local currentOwner = redis.call("GET", lockKey)
  if currentOwner == false then
    return {0, "NOT_LOCKED", seatId}
  end

  if expectedToken ~= "" then
    if currentOwner ~= expectedToken then
      return {0, "LOCKED_BY_OTHER", seatId}
    end
  else
    if string.sub(currentOwner, 1, string.len(userPrefix)) ~= userPrefix then
      return {0, "LOCKED_BY_OTHER", seatId}
    end
  end

  table.insert(heldTokens, currentOwner)
end

return {1, "OK", unpack(heldTokens)}
`;

const RELEASE_MULTI_SEAT_LOCK_LUA = `
local expectedToken = ARGV[1]
local releasedCount = 0

for i = 1, #KEYS do
  if redis.call("GET", KEYS[i]) == expectedToken then
    redis.call("DEL", KEYS[i])
    releasedCount = releasedCount + 1
  end
end

return releasedCount
`;

const MARK_BOOKED_AND_RELEASE_LUA = `
local bookedSetKey = KEYS[1]
local hydratedKey = KEYS[2]
local seatCount = (#KEYS - 2)
local shouldUpdateBookedSet = redis.call("EXISTS", hydratedKey) == 1

for i = 1, seatCount do
  local lockKey = KEYS[2 + i]
  local seatId = ARGV[i]
  local expectedToken = ARGV[seatCount + i]

  if shouldUpdateBookedSet then
    redis.call("SADD", bookedSetKey, seatId)
  end

  if expectedToken ~= "" and redis.call("GET", lockKey) == expectedToken then
    redis.call("DEL", lockKey)
  end
end

return 1
`;

const RELEASE_EXPIRED_SEATS_LUA = `
local bookedSetKey = KEYS[1]
local expectedToken = ARGV[1]
local unlockedSeats = {}

for i = 2, #KEYS do
  local lockKey = KEYS[i]
  local seatId = ARGV[i]

  if redis.call("SISMEMBER", bookedSetKey, seatId) == 0 then
    local currentOwner = redis.call("GET", lockKey)
    if currentOwner == false then
      -- TTL expired naturally; seat is available for broadcast
      table.insert(unlockedSeats, seatId)
    elseif currentOwner == expectedToken then
      -- Still held by this exact expired token due to timer skew; remove & unlock
      redis.call("DEL", lockKey)
      table.insert(unlockedSeats, seatId)
    end
    -- If currentOwner is a DIFFERENT token, another session re-locked it; ignore
  end
end

return unlockedSeats
`;

type RedisWithLua = typeof redisClient & {
  acquireMultiSeatLock: (...args: (string | number)[]) => Promise<[number, string, string?]>;
  verifyLocksForConfirm: (...args: (string | number)[]) => Promise<(string | number)[]>;
  releaseMultiSeatLock: (...args: (string | number)[]) => Promise<number>;
  markBookedAndRelease: (...args: (string | number)[]) => Promise<number>;
  releaseExpiredSeats: (...args: (string | number)[]) => Promise<string[]>;
};

const redisLua = redisClient as RedisWithLua;

redisLua.defineCommand('acquireMultiSeatLock', {
  lua: ACQUIRE_MULTI_SEAT_LOCK_LUA,
});
redisLua.defineCommand('verifyLocksForConfirm', {
  lua: VERIFY_LOCKS_FOR_CONFIRM_LUA,
});
redisLua.defineCommand('releaseMultiSeatLock', {
  lua: RELEASE_MULTI_SEAT_LOCK_LUA,
});
redisLua.defineCommand('markBookedAndRelease', {
  lua: MARK_BOOKED_AND_RELEASE_LUA,
});
redisLua.defineCommand('releaseExpiredSeats', {
  lua: RELEASE_EXPIRED_SEATS_LUA,
});

// ─────────────────────────────────────────────────────────────────────────────
// CACHE HYDRATION (Lazy Population + Single-Flight Dogpile Guard)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensures Redis has the valid seat set and permanently booked seat set for a show.
 * Uses an in-flight promise map so concurrent cold requests trigger only 1 DB read.
 * Returns false if the show has no seats / does not exist.
 */
export const ensureShowHydrated = async (showId: string): Promise<boolean> => {
  const hydratedKey = getHydratedFlagKey(showId);
  const alreadyHydrated = await redisClient.exists(hydratedKey);
  if (alreadyHydrated === 1) {
    return true;
  }

  const existingPromise = hydrationInFlight.get(showId);
  if (existingPromise) {
    return existingPromise;
  }

  const hydratePromise = (async (): Promise<boolean> => {
    try {
      const showSeats = await prisma.showSeat.findMany({
        where: { showId },
        select: { seatId: true, status: true },
      });

      if (showSeats.length === 0) {
        return false;
      }

      const validSeatsKey = getValidSeatsKey(showId);
      const bookedSeatsKey = getBookedSeatsKey(showId);
      const allSeatIds = showSeats.map((ss) => ss.seatId);
      const bookedSeatIds = showSeats
        .filter((ss) => ss.status === 'BOOKED')
        .map((ss) => ss.seatId);

      const pipeline = redisClient.pipeline();
      pipeline.del(validSeatsKey, bookedSeatsKey);
      pipeline.sadd(validSeatsKey, ...allSeatIds);
      pipeline.expire(validSeatsKey, HYDRATION_TTL_SECONDS);

      if (bookedSeatIds.length > 0) {
        pipeline.sadd(bookedSeatsKey, ...bookedSeatIds);
        pipeline.expire(bookedSeatsKey, HYDRATION_TTL_SECONDS);
      }

      pipeline.set(hydratedKey, '1', 'EX', HYDRATION_TTL_SECONDS);
      await pipeline.exec();

      return true;
    } finally {
      hydrationInFlight.delete(showId);
    }
  })();

  hydrationInFlight.set(showId, hydratePromise);
  return hydratePromise;
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTED LOCK OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface AcquireLockResult {
  success: boolean;
  lockToken?: string;
  lockUuid?: string;
  expiresInSeconds?: number;
  conflictReason?: 'SHOW_NOT_FOUND' | 'INVALID_SEAT' | 'BOOKED' | 'LOCKED';
  conflictingSeatId?: string;
}

/**
 * Atomically acquires locks for all requested seats in Redis with zero DB writes.
 */
export const acquireMultiSeatLock = async (
  showId: string,
  seatIds: string[],
  userId: string
): Promise<AcquireLockResult> => {
  const showExists = await ensureShowHydrated(showId);
  if (!showExists) {
    return { success: false, conflictReason: 'SHOW_NOT_FOUND' };
  }

  const lockUuid = crypto.randomUUID();
  const lockOwnerPrefix = `${userId}:`;
  const newLockToken = `${lockOwnerPrefix}${lockUuid}`;

  const validSeatsKey = getValidSeatsKey(showId);
  const bookedSeatsKey = getBookedSeatsKey(showId);
  const lockKeys = seatIds.map((seatId) => getSeatLockKey(showId, seatId));

  const keys = [validSeatsKey, bookedSeatsKey, ...lockKeys];
  const args = [lockOwnerPrefix, newLockToken, String(LOCK_DURATION_SECONDS), ...seatIds];

  const [statusCode, reason, conflictingSeatId] = await redisLua.acquireMultiSeatLock(
    keys.length,
    ...keys,
    ...args
  );

  if (statusCode === 1) {
    return {
      success: true,
      lockToken: newLockToken,
      lockUuid,
      expiresInSeconds: LOCK_DURATION_SECONDS,
    };
  }

  return {
    success: false,
    conflictReason: reason as AcquireLockResult['conflictReason'],
    conflictingSeatId,
  };
};

export interface VerifyLockResult {
  valid: boolean;
  reason?: 'SHOW_NOT_FOUND' | 'INVALID_SEAT' | 'BOOKED' | 'NOT_LOCKED' | 'LOCKED_BY_OTHER';
  conflictingSeatId?: string;
  heldTokens?: string[];
}

/**
 * Verifies in 1 atomic Redis call that all seats exist, are unbooked, and are locked by this user.
 */
export const verifyLocksForConfirmation = async (
  showId: string,
  seatIds: string[],
  userId: string,
  expectedLockToken?: string
): Promise<VerifyLockResult> => {
  const showExists = await ensureShowHydrated(showId);
  if (!showExists) {
    return { valid: false, reason: 'SHOW_NOT_FOUND' };
  }

  const validSeatsKey = getValidSeatsKey(showId);
  const bookedSeatsKey = getBookedSeatsKey(showId);
  const lockKeys = seatIds.map((seatId) => getSeatLockKey(showId, seatId));

  const keys = [validSeatsKey, bookedSeatsKey, ...lockKeys];
  const args = [`${userId}:`, expectedLockToken || '', ...seatIds];

  const response = await redisLua.verifyLocksForConfirm(keys.length, ...keys, ...args);
  const statusCode = Number(response[0]);
  const code = String(response[1]);

  if (statusCode === 1) {
    const heldTokens = response.slice(2).map(String);
    return { valid: true, heldTokens };
  }

  return {
    valid: false,
    reason: code as VerifyLockResult['reason'],
    conflictingSeatId: response[2] ? String(response[2]) : undefined,
  };
};

/**
 * Safely releases temporary seat locks ONLY if they still match the provided lockToken.
 */
export const releaseMultiSeatLock = async (
  showId: string,
  seatIds: string[],
  lockToken: string
): Promise<number> => {
  if (seatIds.length === 0) return 0;
  const lockKeys = seatIds.map((seatId) => getSeatLockKey(showId, seatId));
  return redisLua.releaseMultiSeatLock(lockKeys.length, ...lockKeys, lockToken);
};

/**
 * Marks seats permanently BOOKED in Redis cache and owner-checked deletes their temp locks.
 */
export const markSeatsBookedAndReleaseLocks = async (
  showId: string,
  seatIds: string[],
  heldTokens?: string[]
): Promise<void> => {
  if (seatIds.length === 0) return;

  const bookedSeatsKey = getBookedSeatsKey(showId);
  const hydratedKey = getHydratedFlagKey(showId);
  const lockKeys = seatIds.map((seatId) => getSeatLockKey(showId, seatId));
  const tokens = seatIds.map((_, idx) => heldTokens?.[idx] || '');

  const keys = [bookedSeatsKey, hydratedKey, ...lockKeys];
  const args = [...seatIds, ...tokens];

  await redisLua.markBookedAndRelease(keys.length, ...keys, ...args);
};

/**
 * Self-heals Redis cache when PostgreSQL reveals booked seats missed by Redis.
 */
export const syncBookedSeatsToRedisCache = async (
  showId: string,
  bookedSeatIds: string[]
): Promise<void> => {
  if (bookedSeatIds.length === 0) return;

  const hydrated = await redisClient.exists(getHydratedFlagKey(showId));
  if (hydrated === 1) {
    const bookedSeatsKey = getBookedSeatsKey(showId);
    const pipeline = redisClient.pipeline();
    pipeline.sadd(bookedSeatsKey, ...bookedSeatIds);
    for (const seatId of bookedSeatIds) {
      pipeline.del(getSeatLockKey(showId, seatId));
    }
    await pipeline.exec();
  }
};

/**
 * Used by BullMQ expiry worker: checks which seats from an expired batch are truly available
 * (not booked, not re-locked by another session) so UI clients can receive seat_unlocked.
 */
export const releaseExpiredSeatsForBroadcast = async (
  showId: string,
  seatIds: string[],
  lockToken: string
): Promise<string[]> => {
  if (seatIds.length === 0) return [];

  const bookedSeatsKey = getBookedSeatsKey(showId);
  const lockKeys = seatIds.map((seatId) => getSeatLockKey(showId, seatId));

  const keys = [bookedSeatsKey, ...lockKeys];
  const args = [lockToken, ...seatIds];

  return redisLua.releaseExpiredSeats(keys.length, ...keys, ...args);
};
