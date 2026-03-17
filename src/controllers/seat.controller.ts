// src/controllers/seat.controller.ts
import { Request, Response } from 'express';
import { lockSeat } from '../services/seat.service';
import { scheduleSeatUnlock } from '../jobs/seatUnlockQueue';
import { getIO } from '../sockets';

export const selectSeat = async (req: Request, res: Response): Promise<void> => {
  try {
    const { showId, seatId } = req.body;

    // Input validation
    if (!showId || !seatId) {
      res.status(400).json({
        success: false,
        message: 'showId and seatId are required',
      });
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    const lockResult = await lockSeat(showId, seatId, userId);

    if (lockResult.success) {
      const io = getIO();
      io.to(`show_${showId}`).emit('seat_locked', {
        seatId,
        status: 'LOCKED',
      });

      await scheduleSeatUnlock(showId, seatId, userId);

      res.status(200).json({
        success: true,
        message: 'Seat locked for 10 minutes. Please complete payment.',
      });
    } else {
      res.status(409).json({
        success: false,
        message: 'Seat already taken. Please select another seat.',
      });
    }
  } catch (error) {
    console.error('Seat Lock Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};