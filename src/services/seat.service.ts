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

  const acquired = await redisClient.setnx(lockKey, userId);

  if (acquired === 0) {
    return { success: false };
  }


  await redisClient.expire(lockKey, LOCK_DURATION_SECONDS);

  try {
    await prisma.showSeat.update({
      where: {
        showId_seatId: { showId, seatId },
      },
      data: {
        status: 'LOCKED',
        lockedBy: userId,
        lockedUntil: new Date(Date.now() + LOCK_DURATION_SECONDS * 1000),
        version: { increment: 1 },
      },
    });
  } catch (error) {
    await redisClient.del(lockKey);
    throw new Error('Failed to update seat status in database');
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
    console.log(`--Seat ${seatId} is BOOKED — Redis cleaned, DB untouched`);
    return;
  }

  await redisClient.del(lockKey);

  await prisma.showSeat.update({
    where: { showId_seatId: { showId, seatId } },
    data: {
      status: 'AVAILABLE',
      lockedBy: null,
      lockedUntil: null,
    },
  });

  console.log(`--Seat ${seatId} unlocked — now AVAILABLE`);
};