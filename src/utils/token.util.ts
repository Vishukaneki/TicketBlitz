// src/utils/token.util.ts
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export const generateAccessToken = (userId: string, role: string) => {
  const secret = process.env.JWT_SECRET!;
  return jwt.sign({ id: userId, role }, secret, { expiresIn: '15m' });
};

export const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString('hex');
};

export const hashToken = (token: string) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};