// src/routes/auth.routes.ts
import { Router } from 'express';
import { signup, login ,refreshAccessToken, logout} from '../controllers/auth.controller';

const router = Router();  // the Router is a funcion and it rturns an object that is router and it has many http methods i dont know inside of that implementatin and neihter i should care due to encapsulation principal 
// so it has get put post delete use may be update also and many more

// Endpoint: POST /api/v1/auth/signup
router.post('/signup', signup);

// Endpoint: POST /api/v1/auth/login
router.post('/login', login);
router.post('/refresh', refreshAccessToken);
router.post('/logout', logout);
export default router;