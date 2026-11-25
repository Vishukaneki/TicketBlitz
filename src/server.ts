// src/server.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

dotenv.config();

// --- Imports: Routes ---
import authRoutes from './routes/auth.routes';
import bookingRoutes from './routes/booking.routes';
import seatRoutes from './routes/seat.routes';
import searchRoutes from './routes/search.routes';

// --- Imports: Config & Sockets ---
import { prisma } from './config/prisma';
import { redisClient } from './config/redis';
import { esClient, checkElasticsearchConnection } from './config/elasticsearch';
import { initSockets } from './sockets';

const requiredEnvVars = ['JWT_SECRET', 'DATABASE_URL', 'REDIS_URL'];
requiredEnvVars.forEach((key) => {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
});

const app: Express = express();
const httpServer = createServer(app);

// State tracking for cloud lifecycle
let isShuttingDown = false;

// Middlewares
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/seats', seatRoutes);
app.use('/api/v1/bookings', bookingRoutes);
app.use('/api/v1/search', searchRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// CLOUD-NATIVE HEALTH & READINESS PROBES
// ─────────────────────────────────────────────────────────────────────────────

// Liveness probe: Is the process event loop responsive?
app.get('/health/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

// Backward-compatible health check
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    message: 'TicketBlitz Backend API is up and running',
    timestamp: new Date().toISOString(),
  });
});

// Readiness cache to avoid hammering DB with frequent probe polls (e.g. 50 pods x every 2s = 25 QPS of pure dummy probes)
interface ReadinessCache {
  timestamp: number;
  statusCode: number;
  body: any;
}
let readinessCache: ReadinessCache | null = null;
const READINESS_CACHE_TTL_MS = 2000;

// Readiness probe: Are critical path dependencies (Postgres, Redis) ready for traffic?
app.get('/health/ready', async (_req: Request, res: Response) => {
  // If pod is terminating, immediately fail readiness so load balancer stops sending traffic
  if (isShuttingDown) {
    res.status(503).json({
      status: 'TERMINATING',
      message: 'Pod is shutting down. Draining traffic.',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const now = Date.now();
  if (readinessCache && now - readinessCache.timestamp < READINESS_CACHE_TTL_MS) {
    res.status(readinessCache.statusCode).json(readinessCache.body);
    return;
  }

  const checks: Record<string, string> = {
    postgres: 'UNKNOWN',
    redis: 'UNKNOWN',
    elasticsearch: 'UNKNOWN',
  };

  let isCriticalHealthy = true;

  // 1. Critical: Postgres Ping (via PgBouncer/Prisma)
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = 'UP';
  } catch (err: any) {
    checks.postgres = `DOWN (${err.message || 'connection failed'})`;
    isCriticalHealthy = false;
  }

  // 2. Critical: Redis Ping
  try {
    const ping = await redisClient.ping();
    checks.redis = ping === 'PONG' ? 'UP' : 'DOWN';
  } catch (err: any) {
    checks.redis = `DOWN (${err.message || 'connection failed'})`;
    isCriticalHealthy = false;
  }

  // 3. Non-critical / Auxiliary: Elasticsearch Ping
  // Search degradation MUST NOT bring down the entire booking API.
  try {
    const esHealth = await esClient.cluster.health({});
    checks.elasticsearch = `UP (cluster: ${esHealth.status})`;
  } catch (err: any) {
    checks.elasticsearch = `DEGRADED (${err.message || 'connection failed'})`;
  }

  const statusCode = isCriticalHealthy ? 200 : 503;
  const body = {
    status: isCriticalHealthy ? 'READY' : 'UNHEALTHY',
    timestamp: new Date().toISOString(),
    checks,
  };

  readinessCache = { timestamp: now, statusCode, body };
  res.status(statusCode).json(body);
});

// Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled Error:', err.stack || err.message);
  res.status(500).json({
    success: false,
    message: 'Something went wrong. Please try again.',
  });
});

// Initialize Socket.IO with Redis Adapter
try {
  initSockets(httpServer);
  console.log('✅ WebSockets Initialized with Redis Adapter');
} catch (err) {
  console.error('FATAL: Error initializing sockets:', err);
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

// Server Bootstrap
const bootstrap = async () => {
  await checkElasticsearchConnection();
};

httpServer.listen(PORT, () => {
  console.log(`🚀 TicketBlitz API Server running on port ${PORT}`);
  bootstrap().catch((err) => {
    console.error('FATAL: Server bootstrap failed:', err);
    process.exit(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLOUD-NATIVE GRACEFUL SHUTDOWN ORDER
// ─────────────────────────────────────────────────────────────────────────────
// 1. On SIGTERM: Flag isShuttingDown = true (readiness probe immediately fails 503).
// 2. Wait 5s grace period: Allows Ingress / AWS ALB / Kubernetes EndpointSlice to stop routing new traffic.
// 3. Close httpServer: Drain ongoing in-flight HTTP requests.
// 4. Disconnect pools: Close Prisma and Redis cleanly.
// ─────────────────────────────────────────────────────────────────────────────

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🛑 Received ${signal}. Step 1: Failing readiness probe immediately.`);

  // 5-second buffer for Cloud Load Balancer / Kubernetes kube-proxy to de-register pod
  const LB_DEREGISTRATION_DELAY_MS = 5000;
  console.log(`⏳ Step 2: Waiting ${LB_DEREGISTRATION_DELAY_MS}ms for load balancer to stop routing new traffic...`);
  await new Promise((resolve) => setTimeout(resolve, LB_DEREGISTRATION_DELAY_MS));

  console.log('⏳ Step 3: Draining active in-flight HTTP requests and closing server...');

  const forceExit = setTimeout(() => {
    console.error('⚠️ Graceful shutdown timed out (15s). Forcing process exit.');
    process.exit(1);
  }, 15000);
  forceExit.unref();

  httpServer.close(async () => {
    console.log('✅ HTTP server stopped accepting connections.');
    try {
      console.log('⏳ Step 4: Disconnecting database and Redis connection pools...');
      await Promise.all([
        prisma.$disconnect(),
        redisClient.quit().catch(() => {}),
      ]);
      console.log('✅ Database and Redis connections closed cleanly.');
      console.log('👋 API Server shutdown complete. Exiting.');
      process.exit(0);
    } catch (err) {
      console.error('❌ Error during server shutdown:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { app, httpServer };
