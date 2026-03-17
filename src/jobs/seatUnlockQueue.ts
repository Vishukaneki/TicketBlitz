// src/jobs/seatUnlockQueue.ts
import { Queue } from 'bullmq';
import { bullMqConnection } from '../config/redis';

export const seatUnlockQueue = new Queue('seat-unlock-queue', {
  connection: bullMqConnection,
});

export const scheduleSeatUnlock = async (
  showId: string,
  seatId: string,
  userId: string
) => {
  const DELAY_MS = 10 * 60 * 1000; // 10 minutes

  await seatUnlockQueue.add(
    'unlock-seat',
    { showId, seatId, userId },
    {
      delay: DELAY_MS,
      jobId: `unlock:${showId}:${seatId}`,
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  console.log(`--Scheduled unlock for seat ${seatId} in show ${showId}`);
};