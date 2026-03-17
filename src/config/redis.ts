// src/config/redis.ts
import { Redis } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// 1. General client for locks, caching, etc.
export const redisClient = new Redis(redisUrl);

// 2. Dedicated strict connection for BullMQ (Queue & Worker)
export const bullMqConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // Strictly required by BullMQ
});

redisClient.on('connect', () => console.log('General Redis connected'));
bullMqConnection.on('connect', () => console.log('BullMQ Redis connected'));