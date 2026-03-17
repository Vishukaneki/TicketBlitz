// src/jobs/notificationQueue.ts
import { Queue } from 'bullmq';
import { bullMqConnection } from '../config/redis'; 

export const emailQueue = new Queue('email-queue', { 
  connection: bullMqConnection 
});

export const addTicketEmailJob = async (emailData: any) => {
  await emailQueue.add('send-ticket-email', emailData, {
    attempts: 3, 
    backoff: {
      type: 'exponential',
      delay: 2000, 
    },
    removeOnComplete: true, 
  });
  console.log(`--Email Job added to Queue for: ${emailData.to}`);
};