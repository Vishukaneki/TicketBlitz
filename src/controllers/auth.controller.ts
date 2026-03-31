// src/controllers/auth.controller.ts
import { Request, Response } from 'express'; // these are the ts types 
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { signupSchema, loginSchema } from '../validators/auth.validator'; // zod validators
import { generateAccessToken, generateRefreshToken, hashToken } from '../utils/token.util';

const prisma = new PrismaClient();

export const signup = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Validate Input (Fail fast)
    const parsedData = signupSchema.safeParse(req.body);
    if (!parsedData.success) {
      res.status(400).json({ success: false, errors: parsedData.error.issues });
      return;
    }

    const { email, phone, password } = parsedData.data;

    // 2. Check if user already exists

    const orConditions: { email?: string; phone?: string }[] = [];
    if (email) orConditions.push({ email });
    if (phone) orConditions.push({ phone });

    // removed the code as zod was there to validate this part 
    const existingUser = await prisma.user.findFirst({
      where: { OR: orConditions },
    });

    if (existingUser) {
      res.status(409).json({ 
        success: false,
        message: 'Email or Phone already registered',
      });
      return;
    }

    // 3. Hash Password

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 4. Create User
    await prisma.user.create({
      data: {
        email,
        phone,
        passwordHash,
        role: 'USER',
      },
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully. Please login.',
    });
  } catch (error) {
    console.error('Signup Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Validate Input
    const parsedData = loginSchema.safeParse(req.body);
    if (!parsedData.success) {
      res.status(400).json({ success: false, errors: parsedData.error.issues });
      return;
    }

    const { email, password } = parsedData.data;

    // 2. Find User
    const user = await prisma.user.findUnique({ where: { email } });

    // SECURITY: Return the SAME error message whether email is wrong

    if (!user || !user.passwordHash) {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    // 3. Compare Password
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    // 4. DB Housekeeping — clean up stale tokens on login
    await prisma.refreshToken.deleteMany({
      where: {
        userId: user.id,
        OR: [
          { isRevoked: true },
          { expiresAt: { lt: new Date() } },
        ],
      },
    });

    // 5. Generate Tokens
    const accessToken = generateAccessToken(user.id, user.role);
    const refreshToken = generateRefreshToken(); // this a random hex string

    // 6. Save Refresh Token in DB — store the HASH, not the raw token.
    // If the DB is ever leaked, the hashes are useless to an attacker
    // because they can't reverse a hash back to the original token.
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    await prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        userId: user.id,
        expiresAt,
      },
    });

    // 7. Send Response -- changes made here 30 march 2026 
    res
  .status(200)
  .cookie('refreshToken', refreshToken, {
    httpOnly: true,   // JS cannot access this cookie at all
    secure: process.env.NODE_ENV === 'production',     // only sent over HTTPS
    sameSite: 'strict', // not sent on cross-site requests
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in ms
  })
  .json({
    success: true,
    data: {
      user: { id: user.id, email: user.email, role: user.role },
      accessToken  // short lived 15m — ok in body
    }
  });
  // -- till here 
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};


export const refreshAccessToken = async (req: Request, res: Response): Promise<void> => {
  try {
    // read from cookie not body
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      res.status(401).json({ success: false, message: 'Refresh token is required' });
      return;
    }

    const hashedToken = hashToken(refreshToken);

    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashedToken },
      include: { user: true },
    });

    if (!tokenRecord) {
      res.status(403).json({ success: false, message: 'Invalid refresh token.' });
      return;
    }

    if (tokenRecord.isRevoked) {
      console.warn(`SECURITY ALERT: Revoked token reuse attempt for user ${tokenRecord.userId}`);

      await prisma.refreshToken.deleteMany({
        where: { userId: tokenRecord.userId },
      });

      // clear cookie too — nuke everything
      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      });

      res.status(403).json({
        success: false,
        message: 'Security breach detected. All sessions terminated. Please login again.',
      });
      return;
    }

    if (tokenRecord.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });

      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      });

      res.status(403).json({
        success: false,
        message: 'Refresh token expired. Please login again.',
      });
      return;
    }

    if (!tokenRecord.user) {
      res.status(403).json({ success: false, message: 'Invalid refresh token.' });
      return;
    }

    // token rotation
    await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });

    const newAccessToken = generateAccessToken(tokenRecord.user.id, tokenRecord.user.role);
    const newRefreshToken = generateRefreshToken();

    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(newRefreshToken),
        userId: tokenRecord.user.id,
        expiresAt: newExpiresAt,
      },
    });

    res
      .status(200)
      .cookie('refreshToken', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .json({
        success: true,
        message: 'Tokens refreshed successfully',
        data: {
          accessToken: newAccessToken,
        },
      });
  } catch (error) {
    console.error('Refresh Token Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};


export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    // read from cookie not body
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      res.status(400).json({ success: false, message: 'Refresh token is required' });
      return;
    }

    const hashedToken = hashToken(refreshToken);

    try {
      await prisma.refreshToken.update({
        where: { tokenHash: hashedToken },
        data: { isRevoked: true },
      });
    } catch (e: any) {
      if (e.code === 'P2025') {
        // already logged out — clear cookie anyway and return 200
        res.clearCookie('refreshToken', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
        });
        res.status(200).json({ success: true, message: 'Already logged out.' });
        return;
      }
      throw e;
    }

    // clear the cookie from client
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully. Token revoked.',
    });
  } catch (error) {
    console.error('Logout Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};