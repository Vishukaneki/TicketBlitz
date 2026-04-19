// src/index.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import 'dotenv/config';
import dotenv from 'dotenv';

// --- Imports: Routes ---
import authRoutes from './routes/auth.routes';
import bookingRoutes from './routes/booking.routes';
import seatRoutes from './routes/seat.routes';
import searchRoutes from './routes/search.routes';

// --- Imports: Sockets & Workers ---
import { initSockets } from './sockets';
import { initSeatUnlockWorker } from './jobs/seatUnlockWorker';
import { initNotificationWorker } from './jobs/notificationWorker';
import { checkElasticsearchConnection } from './config/elasticsearch';

dotenv.config();


const requiredEnvVars = ['JWT_SECRET', 'DATABASE_URL', 'REDIS_URL'];
requiredEnvVars.forEach((key) => {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1); // hard exit — do not start the server
  }
});

const app: Express = express();
const httpServer = createServer(app);


// helmet — sets secure HTTP headers (XSS protection, no sniff, etc.)
app.use(helmet());


app.use(cors());

// express.json — parse incoming JSON request bodies
app.use(express.json());

// cookie-parser — parse Cookie header so req.cookies is populated
app.use(cookieParser());

// morgan — HTTP request logger (dev format: method, url, status, response time)
app.use(morgan('dev'));


app.use('/api/v1/auth', authRoutes); // all checked all good bruh :)
app.use('/api/v1/seats', seatRoutes);
app.use('/api/v1/bookings', bookingRoutes);
app.use('/api/v1/search', searchRoutes);


app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    message: 'BMS Backend is up and running',
    timestamp: new Date().toISOString(),
  });
});


app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled Error:', err.stack || err.message);
  res.status(500).json({
    success: false,
    message: 'Something went wrong. Please try again.',
  });
});


try {
  initSockets(httpServer);
  console.log('WebSockets Initialized');
} catch (err) {
  console.error('FATAL: Error initializing sockets:', err);
  process.exit(1); // sockets are critical — can't run without them
}

const PORT = process.env.PORT || 3000;

const bootstrap = async () => {
  // Check external service connections
  await checkElasticsearchConnection();

  // Initialize BullMQ workers
  // Workers connect to Redis and start listening for jobs
  initSeatUnlockWorker();
  console.log('BullMQ Seat Unlock Worker Initialized');

  initNotificationWorker();
  console.log('Notification Worker Initialized');
};

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);


  bootstrap().catch((err) => {
    console.error('FATAL: Bootstrap failed:', err);
    process.exit(1); // crash hard 
  });
});