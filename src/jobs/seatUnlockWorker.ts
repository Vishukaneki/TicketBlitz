// src/jobs/seatUnlockWorker.ts
import { Worker, Job } from 'bullmq';
import { bullMqConnection } from '../config/redis';
import { releaseExpiredSeatsForBroadcast } from '../services/lock.service';
import { SeatUnlockBatchPayload } from './seatUnlockQueue';
import { broadcastToShow } from '../sockets';

export const initSeatUnlockWorker = (): Worker => {
  const worker = new Worker<SeatUnlockBatchPayload>(
    'seat-unlock-queue',
    async (job: Job<SeatUnlockBatchPayload>) => {
      const { showId, seatIds, lockToken } = job.data;

      // Redis handles key expiry via TTL; worker checks which seats are genuinely free
      // (unbooked & not re-locked by a newer session) without touching PostgreSQL.
      const unlockedSeats = await releaseExpiredSeatsForBroadcast(showId, seatIds, lockToken);

      if (unlockedSeats.length > 0) {
        broadcastToShow(showId, 'seat_unlocked', {
          seatIds: unlockedSeats,
          status: 'AVAILABLE',
        });
      }
    },
    { connection: bullMqConnection }
  );

  worker.on('completed', (job) => {
    console.log(`--Batch unlock check complete for job ${job.id}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`--Job failed for seat unlock ${job?.id}:`, err);
  });

  return worker;
};
