// src/middlewares/auth.middleware.ts
import { Request, Response, NextFunction } from 'express'; // types for req , res ,next 
import jwt from 'jsonwebtoken';
import {Role} from '@prisma/client'; // import only the enum yeah !

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // 1. Check if Authorization header exists and is in correct format
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        code: 'NO_TOKEN',
        message: 'Access Denied. No token provided.',
      });
      return;
    }

    // 2. Extract the token (Format: "Bearer <token>")
    const token = authHeader.split(' ')[1];

    // 3. Verify JWT_SECRET exists at runtime
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is not defined in environment');
    }

    // 4. Verify the token
    // We cast role to Prisma's Role enum so the type flows correctly
    // into req.user and downstream into Prisma queries without 'string' mismatches.
    const decoded = jwt.verify(token, secret) as { id: string; role: Role };

    // ok i did make the access token with jwt.sign and i used role and id to do so, so yeah once decoded i think they can be extracted
    // and then pass to next middleware
    // 5. Attach user to request object
    req.user = {
      id: decoded.id,
      role: decoded.role,
    };

    // 6. Pass control to the next middleware / controller
    next();

  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      // Token was valid but has expired (past the 15min window).
      // Frontend should: call POST /auth/refresh → get new accessToken → retry.
      res.status(401).json({
        success: false,
        code: 'TOKEN_EXPIRED',
        message: 'Token expired. Please refresh.',
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      // Token is malformed, has wrong signature, or was tampered with.
      // Frontend should: clear tokens and redirect to login.
      res.status(401).json({
        success: false,
        code: 'TOKEN_INVALID',
        message: 'Invalid token. Please login again.',
      });
      return;
    }

    // Anything else (e.g. JWT_SECRET missing) is a server-side problem — 500.
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ROLE-BASED ACCESS CONTROL
// ─────────────────────────────────────────────────────────────────────────────
// Usage on a route:
//   router.delete('/movie/:id', requireAuth, requireRole([Role.ADMIN]), deleteMovie)
//
// Using Role.ADMIN instead of the string 'ADMIN' means TypeScript will
// catch typos like Role.ADMINN at compile time instead of silently failing
// at runtime with a 403 that's hard to debug.
// ─────────────────────────────────────────────────────────────────────────────

// kind of useless as we are more user focused i havent implemnted the admin side of things so if i 
// do post it on github make sure u fork it and do your stuff contribute in its creating yeah that would be cool 
// opensource help for me and u too. :)
export const requireRole = (roles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(500).json({
        success: false,
        message: 'requireRole used without requireAuth. Check route setup.',
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to perform this action.',
      });
      return;
    }

    next();
  };
};