// src/routes/seat.routes.ts
import { Router } from 'express';
import { selectSeat, releaseSeat } from '../controllers/seat.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Endpoint: POST /api/v1/seats/lock
router.post('/lock', requireAuth, selectSeat);

// Endpoint: POST /api/v1/seats/release
router.post('/release', requireAuth, releaseSeat);

export default router;
