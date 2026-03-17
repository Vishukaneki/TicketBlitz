// src/sockets/index.ts
import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: Server;

export const initSockets = (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: '*', // Allow requests from any origin but change it to allow req from your own server during production yeah cool
      methods: ['GET', 'POST']
    }
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

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};