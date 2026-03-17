// src/controllers/booking.controller.ts
import { Request, Response } from 'express';
import { confirmBookingTransaction } from '../services/booking.service';
import { addTicketEmailJob } from '../jobs/notificationQueue';
import {prisma} from '../config/prisma';

export const confirmBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const { showId, seatIds, totalAmount, paymentRefId } = req.body;

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const userId = req.user.id;

    if (!showId || !seatIds || !Array.isArray(seatIds) || seatIds.length === 0 || !totalAmount || !paymentRefId) {
      res.status(400).json({ success: false, message: 'Missing required fields' });
      return;
    }

    const result = await confirmBookingTransaction(userId, showId, seatIds, totalAmount, paymentRefId);

    if (result.success) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { email: true }
        });

        const targetEmail = user?.email ?? 'vishalnirnajan710@gmail.com';

        await addTicketEmailJob({
          to: targetEmail,
          bookingDetails: {
            movieTitle: "Batman: The Dark Knight",
            bookingId: result.booking?.id,
            seats: seatIds,
            amount: totalAmount
          }
        });
        console.log(` Email job dispatched for: ${targetEmail}`);
      } catch (queueErr) {
        console.error(' Queue error — booking is safe:', queueErr);
      }

      res.status(200).json({
        success: true,
        message: 'Booking confirmed successfully!',
        bookingId: result.booking?.id
      });
    } else {
      res.status(400).json({ success: false, message: result.message });
    }

  } catch (error) {
    console.error('Booking Controller Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};