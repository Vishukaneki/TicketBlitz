// src/types/index.d.ts
import { Role } from '@prisma/client';

declare global {
  namespace Express {
    export interface Request {
      user?: {
        id: string;
        role: Role; 
      };
    }
  }
}