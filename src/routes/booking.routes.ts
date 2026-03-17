// src/routes/booking.routes.ts
import { Router } from 'express';
import { confirmBooking } from '../controllers/booking.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Endpoint: POST /api/v1/bookings/confirm
router.post('/confirm', requireAuth, confirmBooking);

export default router;