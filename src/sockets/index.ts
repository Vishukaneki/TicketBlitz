// src/sockets/index.ts
import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Emitter } from '@socket.io/redis-emitter';
import { redisClient } from '../config/redis';

let io: Server | null = null;
let emitter: Emitter | null = null;

export const initSockets = (server: HttpServer): Server => {
  const pubClient = redisClient;
  const subClient = pubClient.duplicate();

  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
    adapter: createAdapter(pubClient, subClient),
    transports: ['websocket'], // Pure WebSockets avoids polling connection churn

    // High-Scale Performance & Security Tunings
    maxHttpBufferSize: 4096,   // 4 KB max incoming packet (prevents buffer bloat & memory attacks)
    perMessageDeflate: false,  // Disable compression for tiny ~40-byte seat events to save CPU
    pingInterval: 25000,       // Keep-alive heartbeat every 25s
    pingTimeout: 20000,        // Drop dead connections after 20s
  });

  io.on('connection', (socket: Socket) => {
    console.log(`--User connected: ${socket.id}`);

    socket.on('join_show', (showId: string) => {
      socket.join(`show_${showId}`);
      console.log(`--User ${socket.id} joined room: show_${showId}`);
    });

    socket.on('leave_show', (showId: string) => {
      socket.leave(`show_${showId}`);
      console.log(`--User ${socket.id} left room: show_${showId}`);
    });

    socket.on('disconnect', () => {
      console.log(`--User disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error('Socket.io not initialized on this process!');
  }
  return io;
};

export const getEmitter = (): Emitter => {
  if (!emitter) {
    emitter = new Emitter(redisClient);
  }
  return emitter;
};

/**
 * Universal broadcast function that works seamlessly from both API servers and background workers.
 * If running inside an API pod with live Socket.IO server, emits directly.
 * If running inside a standalone worker, publishes through Redis via Emitter.
 */
export const broadcastToShow = (showId: string, event: string, data: any): void => {
  try {
    if (io) {
      io.to(`show_${showId}`).emit(event, data);
    } else {
      getEmitter().to(`show_${showId}`).emit(event, data);
    }
  } catch (err) {
    console.error(`Failed to broadcast event "${event}" to show_${showId}:`, err);
  }
};
