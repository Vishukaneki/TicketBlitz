// src/routes/seat.routes.ts
import { Router } from 'express';
import { selectSeat } from '../controllers/seat.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Endpoint: POST /api/v1/seats/lock
// requireAuth ensure karega ki request me valid JWT ho aur req.user set ho
router.post('/lock', requireAuth, selectSeat);

export default router;