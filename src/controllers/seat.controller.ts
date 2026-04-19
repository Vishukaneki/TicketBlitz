// src/controllers/seat.controller.ts
import { Request, Response } from 'express';
import { lockSeat, unlockSeat } from '../services/seat.service';
import { scheduleSeatUnlock } from '../jobs/seatUnlockQueue';
import { getIO } from '../sockets';

export const selectSeat = async (req: Request, res: Response): Promise<void> => {
  try {
    const { showId, seatIds } = req.body;

    // Input validation
    if (!showId || !Array.isArray(seatIds) || seatIds.length === 0) {
      res.status(400).json({
        success: false,
        message: 'showId and seatIds (non-empty array) are required',
      });
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const lockedSeatIds: string[] = [];

    for (const seatId of seatIds) {
      const lockResult = await lockSeat(showId, seatId, userId);

      if (lockResult.success) {
        lockedSeatIds.push(seatId);
      } else {
        // Roll back any seats already locked in this request
        for (const alreadyLocked of lockedSeatIds) {
          try {
            await unlockSeat(showId, alreadyLocked);
          } catch (rollbackErr) {
            console.error(`Rollback failed for seat ${alreadyLocked}:`, rollbackErr);
          }
        }

        res.status(409).json({
          success: false,
          message: `Seat ${seatId} is already taken. No seats were locked.`,
        });
        return;
      }
    }

    const io = getIO();
    io.to(`show_${showId}`).emit('seat_locked', {
      seatIds: lockedSeatIds,
      status: 'LOCKED',
    });

    for (const seatId of lockedSeatIds) {
      await scheduleSeatUnlock(showId, seatId, userId);
    }

    res.status(200).json({
      success: true,
      message: 'Seats locked for 10 minutes. Please complete payment.',
    });
  } catch (error) {
    console.error('Seat Lock Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};