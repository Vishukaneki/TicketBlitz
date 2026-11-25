// src/jobs/seatUnlockWorker.ts
import { Worker, Job } from 'bullmq';
import { bullMqConnection } from '../config/redis';
import { unlockSeat } from '../services/seat.service';
import { broadcastToShow } from '../sockets';

export const initSeatUnlockWorker = (): Worker => {
  const worker = new Worker(
    'seat-unlock-queue',
    async (job: Job) => {
      const { showId, seatId } = job.data;

      await unlockSeat(showId, seatId);

      // Broadcast across all pods via Redis
      broadcastToShow(showId, 'seat_unlocked', {
        seatId,
        status: 'AVAILABLE',
      });
    },
    { connection: bullMqConnection }
  );

  worker.on('completed', (job) => {
    console.log(`--Auto-unlock complete for seat ${job.data.seatId}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`--Job failed for seat unlock ${job?.id}:`, err);
  });

  return worker;
};
