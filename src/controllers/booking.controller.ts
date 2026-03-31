// src/controllers/booking.controller.ts
import { Request, Response } from 'express';
import { confirmBookingTransaction } from '../services/booking.service';
import { addTicketEmailJob } from '../jobs/notificationQueue';
import { confirmBookingSchema } from '../validators/booking.validator';

export const confirmBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Auth check first — fail fast
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const userId = req.user.id;

    // 2. Zod validation
    const parsedData = confirmBookingSchema.safeParse(req.body);
    if (!parsedData.success) {
      res.status(400).json({ success: false, errors: parsedData.error.issues });
      return;
    }

    const { showId, seatIds, paymentRefId } = parsedData.data;

    // 3. All DB logic lives in service — returns everything we need
    const result = await confirmBookingTransaction(userId, showId, seatIds, paymentRefId);

    if (!result.success) {
      res.status(400).json({ success: false, message: result.message });
      return;
    }

    // 4. Email notification — failure here must never affect booking response
    try {
      if (!result.userEmail) {
        console.warn(`User ${userId} has no email — skipping email notification`);
      } else {
        await addTicketEmailJob({
          to: result.userEmail,
          bookingDetails: {
            movieTitle: result.movieTitle,  // comes from service, not hardcoded
            bookingId: result.booking?.id,
            seats: seatIds,
            amount: result.totalAmount      // calculated server side
          }
        });
        console.log(`Email job dispatched for: ${result.userEmail}`);
      }
    } catch (queueErr) {
      console.error('Queue error — booking is safe:', queueErr);
    }

    // 5. Response
    res.status(200).json({
      success: true,
      message: 'Booking confirmed successfully!',
      data: {
        bookingId: result.booking?.id,
        totalAmount: result.totalAmount
      }
    });

  } catch (error) {
    console.error('Booking Controller Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};