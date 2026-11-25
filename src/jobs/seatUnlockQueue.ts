// src/jobs/seatUnlockQueue.ts
import { Queue } from 'bullmq';
import { bullMqConnection } from '../config/redis';
import { LOCK_DURATION_SECONDS } from '../services/lock.service';

export const seatUnlockQueue = new Queue('seat-unlock-queue', {
  connection: bullMqConnection,
});

// BullMQ throws if custom jobId contains ':'; sanitize to '-'
export const getUnlockBatchJobId = (showId: string, lockToken: string): string => {
  const safeToken = lockToken.replace(/:/g, '-');
  return `unlock_${showId}_${safeToken}`;
};

export interface SeatUnlockBatchPayload {
  showId: string;
  seatIds: string[];
  userId: string;
  lockToken: string;
}

export const scheduleBatchSeatUnlock = async (
  showId: string,
  seatIds: string[],
  userId: string,
  lockToken: string
): Promise<void> => {
  const DELAY_MS = LOCK_DURATION_SECONDS * 1000;
  const jobId = getUnlockBatchJobId(showId, lockToken);

  await seatUnlockQueue.add(
    'unlock-seat-batch',
    { showId, seatIds, userId, lockToken } satisfies SeatUnlockBatchPayload,
    {
      delay: DELAY_MS,
      jobId,
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
};

/**
 * Cancels the scheduled unlock notification job if all seats in that batch were confirmed.
 * If only a subset of seats was booked, keeps the timer so remaining unbooked seats still broadcast expiry.
 */
export const cancelBatchSeatUnlockIfComplete = async (
  showId: string,
  confirmedSeatIds: string[],
  heldTokens: string[]
): Promise<void> => {
  const confirmedSet = new Set(confirmedSeatIds);
  const uniqueTokens = Array.from(new Set(heldTokens));

  for (const token of uniqueTokens) {
    const jobId = getUnlockBatchJobId(showId, token);
    try {
      const job = await seatUnlockQueue.getJob(jobId);
      if (!job) continue;

      const jobSeatIds: string[] = Array.isArray(job.data?.seatIds) ? job.data.seatIds : [];
      const allConfirmed = jobSeatIds.every((id) => confirmedSet.has(id));

      if (allConfirmed) {
        await job.remove();
        console.log(`--Cancelled batch auto-unlock timer ${jobId}`);
      }
    } catch (err) {
      // Non-fatal: even if job cannot be removed (e.g., already running), worker skips booked seats
      console.warn(`--Could not remove batch unlock job ${jobId}:`, err);
    }
  }
};
