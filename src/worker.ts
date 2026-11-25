// src/worker.ts
import dotenv from 'dotenv';
dotenv.config();

import { initSeatUnlockWorker } from './jobs/seatUnlockWorker';
import { initNotificationWorker } from './jobs/notificationWorker';
import { redisClient, bullMqConnection } from './config/redis';
import { prisma } from './config/prisma';

console.log('🚀 Starting TicketBlitz Dedicated Background Worker Process...');

// Validate required environment variables
const requiredEnvVars = ['DATABASE_URL', 'REDIS_URL'];
requiredEnvVars.forEach((key) => {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable in worker: ${key}`);
    process.exit(1);
  }
});

const seatWorker = initSeatUnlockWorker();
console.log('✅ BullMQ Seat Unlock Worker Initialized');

const notificationWorker = initNotificationWorker();
console.log('✅ BullMQ Notification Worker Initialized');

// Graceful Shutdown Handler for Background Workers
let isShuttingDown = false;

const gracefulWorkerShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown of BullMQ workers...`);

  // Force exit timeout after 15 seconds if any job hangs
  const forceExit = setTimeout(() => {
    console.error('⚠️ Graceful worker shutdown timed out. Forcing process exit.');
    process.exit(1);
  }, 15000);
  forceExit.unref();

  try {
    console.log('⏳ Pausing workers and waiting for active in-flight jobs to finish...');
    await Promise.all([
      seatWorker.close(),
      notificationWorker.close(),
    ]);
    console.log('✅ BullMQ workers closed cleanly.');

    console.log('⏳ Closing database and Redis connections...');
    await Promise.all([
      prisma.$disconnect(),
      redisClient.quit().catch(() => {}),
      bullMqConnection.quit().catch(() => {}),
    ]);
    console.log('✅ All worker connections closed.');

    console.log('👋 Worker process shutdown complete. Exiting.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during worker shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulWorkerShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulWorkerShutdown('SIGINT'));
