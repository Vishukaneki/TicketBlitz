// src/jobs/notificationWorker.ts
import { Worker } from 'bullmq';
import { bullMqConnection } from '../config/redis'; 
import { sendTicketEmail } from '../config/mail';

export const initNotificationWorker = () => {
  const worker = new Worker(
    'email-queue',
    async (job) => {
      console.log(`--Processing Email Job: ${job.id}`);

      await sendTicketEmail(job.data.to, job.data.bookingDetails);
    },
    { connection: bullMqConnection } 
  );

  worker.on('completed', (job) => {
    console.log(`--Email Job ${job.id} completed successfully!`);
  });

  worker.on('failed', (job, err) => {
    console.error(`--Email Job ${job?.id} failed:`, err.message);
  });
};