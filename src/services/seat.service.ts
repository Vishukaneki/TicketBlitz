// src/services/seat.service.ts
import {
  acquireMultiSeatLock,
  releaseMultiSeatLock,
  AcquireLockResult,
} from './lock.service';
import {
  scheduleBatchSeatUnlock,
  cancelBatchSeatUnlockIfComplete,
} from '../jobs/seatUnlockQueue';
import { broadcastToShow } from '../sockets';

/**
 * Locks multiple seats atomically in Redis (zero PostgreSQL writes),
 * broadcasts real-time status via Redis-backed WebSockets, and schedules a single expiry notification job.
 */
export const lockSeats = async (
  showId: string,
  seatIds: string[],
  userId: string
): Promise<AcquireLockResult> => {
  const result = await acquireMultiSeatLock(showId, seatIds, userId);

  if (!result.success || !result.lockToken) {
    return result;
  }

  // Schedule 1 batch expiry-notification job.
  // Even if scheduling fails, Redis TTL guarantees the lock auto-expires after 600s.
  try {
    await scheduleBatchSeatUnlock(showId, seatIds, userId, result.lockToken);
  } catch (queueErr) {
    console.error(`--Non-fatal: Failed to schedule expiry notify job for show ${showId}:`, queueErr);
  }

  broadcastToShow(showId, 'seat_locked', {
    seatIds,
    status: 'LOCKED',
  });

  return result;
};

/**
 * Safely releases temporary seat locks if owned by lockToken and notifies connected clients.
 */
export const releaseSeats = async (
  showId: string,
  seatIds: string[],
  lockToken: string
): Promise<number> => {
  const releasedCount = await releaseMultiSeatLock(showId, seatIds, lockToken);

  if (releasedCount > 0) {
    await cancelBatchSeatUnlockIfComplete(showId, seatIds, [lockToken]);
    broadcastToShow(showId, 'seat_unlocked', {
      seatIds,
      status: 'AVAILABLE',
    });
  }

  return releasedCount;
};
