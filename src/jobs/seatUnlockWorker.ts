// src/jobs/seatUnlockWorker.ts
import { Worker, Job } from 'bullmq';
import { bullMqConnection } from '../config/redis';
import { unlockSeat } from '../services/seat.service';
import { getIO } from '../sockets';

export const initSeatUnlockWorker = () => {
  const worker = new Worker(
    'seat-unlock-queue',
    async (job: Job) => {
      const { showId, seatId } = job.data;

      await unlockSeat(showId, seatId);

      try {
        const io = getIO();
        io.to(`show_${showId}`).emit('seat_unlocked', {
          seatId,
          status: 'AVAILABLE',
        });
      } catch (error) {
        console.error('--Socket error during auto-unlock:', error);
      }
    },
    { connection: bullMqConnection }
  );

  worker.on('completed', (job) => {
    console.log(`--Auto-unlock complete for seat ${job.data.seatId}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`--Job failed for seat unlock ${job?.id}:`, err);
  });
};