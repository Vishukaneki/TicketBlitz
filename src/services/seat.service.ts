// src/services/seat.service.ts
import { PrismaClient } from '@prisma/client';
import { redisClient } from '../config/redis';

const prisma = new PrismaClient();

const LOCK_DURATION_SECONDS = 600; // 10 minutes

export const lockSeat = async (
  showId: string,
  seatId: string,
  userId: string
) => {
  const lockKey = `seat_lock:${showId}:${seatId}`;

  // 1. DB first — if this fails, Redis never gets set, clean state
  try {
    await prisma.showSeat.update({
      where: {
        showId_seatId: { showId, seatId },
        status: 'AVAILABLE', // only lock if currently available — optimistic check
      },
      data: {
        status: 'LOCKED',
        lockedBy: userId,
        lockedUntil: new Date(Date.now() + LOCK_DURATION_SECONDS * 1000),
        version: { increment: 1 },
      },
    });
  } catch (error: any) {
    // P2025 — record not found, means seat is not AVAILABLE
    if (error.code === 'P2025') {
      return { success: false };
    }
    throw new Error('Failed to update seat status in database');
  }

  // 2. Redis after DB succeeds — atomic set with expiry
  const acquired = await redisClient.set(lockKey, userId, 'EX', LOCK_DURATION_SECONDS, 'NX');

  if (!acquired) {
    // Redis already has lock but DB just succeeded
    // means same seat locked by someone else in Redis but DB was AVAILABLE — inconsistency
    // roll back DB
    await prisma.showSeat.update({
      where: { showId_seatId: { showId, seatId } },
      data: {
        status: 'AVAILABLE',
        lockedBy: null,
        lockedUntil: null,
      },
    });
    return { success: false };
  }

  return { success: true };
};

export const unlockSeat = async (showId: string, seatId: string) => {
  const lockKey = `seat_lock:${showId}:${seatId}`;

  const showSeat = await prisma.showSeat.findUnique({
    where: { showId_seatId: { showId, seatId } },
    select: { status: true },
  });

  if (!showSeat) {
    console.warn(`Seat ${seatId} not found — skipping unlock`);
    return;
  }

  if (showSeat.status === 'BOOKED') {
    await redisClient.del(lockKey);
    console.log(`Seat ${seatId} is BOOKED — Redis cleaned, DB untouched`);
    return;
  }

  // DB first, then Redis — same principle
  await prisma.showSeat.update({
    where: { showId_seatId: { showId, seatId } },
    data: {
      status: 'AVAILABLE',
      lockedBy: null,
      lockedUntil: null,
    },
  });

  await redisClient.del(lockKey);

  console.log(`Seat ${seatId} unlocked — now AVAILABLE`);
};