// src/routes/search.routes.ts
import { Router } from 'express';
import { searchMovies } from '../controllers/search.controller';

const router = Router();

// Endpoint: GET /api/v1/search/movies?q=kuch_bhi
router.get('/movies', searchMovies);

export default router;