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

    // Edge case: if somehow neither email nor phone is provided
    if (orConditions.length === 0) {
      res.status(400).json({ success: false, message: 'Email or phone is required' });
      return;
    }

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
    const refreshToken = generateRefreshToken();

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

    // 7. Send Response
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: { id: user.id, email: user.email, role: user.role },
        accessToken,
        refreshToken, // raw token sent to client — they store it, we only store the hash
      },
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};


export const refreshAccessToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(401).json({ success: false, message: 'Refresh token is required' });
      return;
    }

    // 1. Hash the incoming token to look it up in DB
    const hashedToken = hashToken(refreshToken);

    // 2. Find the token record + join user data in one query
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashedToken },
      include: { user: true },
    });

    // 3. Token doesn't exist at all — invalid or already deleted
    if (!tokenRecord) {
      res.status(403).json({ success: false, message: 'Invalid refresh token.' });
      return;
    }

    // 4. HACKER ALERT — Token Theft Detection

    if (tokenRecord.isRevoked) {
      console.warn(
        `SECURITY ALERT: Revoked token reuse attempt for user ${tokenRecord.userId}`
      );

      await prisma.refreshToken.deleteMany({
        where: { userId: tokenRecord.userId },
      });

      res.status(403).json({
        success: false,
        message: 'Security breach detected. All sessions terminated. Please login again.',
      });
      return;
    }

    // 5. Expiry Check — token exists and is not revoked but has expired
    if (tokenRecord.expiresAt < new Date()) {
      // Hard delete expired token — no point keeping it
      await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
      res.status(403).json({
        success: false,
        message: 'Refresh token expired. Please login again.',
      });
      return;
    }

    // FIX: Verify the user still exists and is in good standing.

    if (!tokenRecord.user) {
      res.status(403).json({ success: false, message: 'User account not found.' });
      return;
    }
    // i wont be needing this part system gets complex by a lot but it can be included if your data is good i m just lazy

    // if (!tokenRecord.user.isVerified) {
    //   res.status(403).json({
    //     success: false,
    //     message: 'Account is not verified. Please verify your account.',
    //   });
    //   return;
    // }

    // 6. FIX: Refresh Token Rotation


    // Step A: Delete the old refresh token
    await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });

    // Step B: Generate fresh tokens
    const newAccessToken = generateAccessToken(
      tokenRecord.user.id,
      tokenRecord.user.role
    );
    const newRefreshToken = generateRefreshToken();

    // Step C: Save the new refresh token hash in DB
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(newRefreshToken),
        userId: tokenRecord.user.id,
        expiresAt: newExpiresAt,
      },
    });

    // 7. Return BOTH new tokens — client must replace their stored refresh token
    res.status(200).json({
      success: true,
      message: 'Tokens refreshed successfully',
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken, // client MUST update this in storage
      },
    });
  } catch (error) {
    console.error('Refresh Token Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};


export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;
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
        // Token not found — already logged out or invalid token.
        // Return 200 anyway — idempotent logout is correct behavior.
        res.status(200).json({
          success: true,
          message: 'Already logged out.',
        });
        return;
      }
      // Any other DB error — rethrow so outer catch handles it
      throw e;
    }

    res.status(200).json({
      success: true,
      message: 'Logged out successfully. Token revoked.',
    });
  } catch (error) {
    console.error('Logout Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};