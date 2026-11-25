// src/controllers/seat.controller.ts
import { Request, Response } from 'express';
import { lockSeats, releaseSeats } from '../services/seat.service';
import { lockSeatsSchema, releaseSeatsSchema } from '../validators/seat.validator';

export const selectSeat = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const parsed = lockSeatsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        errors: parsed.error.issues,
      });
      return;
    }

    const { showId, seatIds } = parsed.data;

    const lockResult = await lockSeats(showId, seatIds, userId);

    if (!lockResult.success) {
      if (lockResult.conflictReason === 'SHOW_NOT_FOUND') {
        res.status(404).json({
          success: false,
          message: 'Show not found or has no configured seats.',
        });
        return;
      }

      if (lockResult.conflictReason === 'INVALID_SEAT') {
        res.status(400).json({
          success: false,
          message: `Seat ${lockResult.conflictingSeatId} is not valid for this show.`,
        });
        return;
      }

      res.status(409).json({
        success: false,
        message: `Seat ${lockResult.conflictingSeatId} is already ${lockResult.conflictReason?.toLowerCase() ?? 'taken'}. No seats were locked.`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Seats locked for 10 minutes. Please complete payment.',
      data: {
        showId,
        seatIds,
        lockToken: lockResult.lockToken,
        expiresInSeconds: lockResult.expiresInSeconds,
      },
    });
  } catch (error) {
    console.error('Seat Lock Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const releaseSeat = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const parsed = releaseSeatsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        errors: parsed.error.issues,
      });
      return;
    }

    const { showId, seatIds, lockToken } = parsed.data;

    if (!lockToken.startsWith(`${userId}:`)) {
      res.status(403).json({
        success: false,
        message: 'Forbidden: Lock token does not belong to you.',
      });
      return;
    }

    const releasedCount = await releaseSeats(showId, seatIds, lockToken);

    res.status(200).json({
      success: true,
      message: releasedCount > 0 ? 'Seats released.' : 'No matching active locks found to release.',
      data: { releasedCount },
    });
  } catch (error) {
    console.error('Seat Release Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
