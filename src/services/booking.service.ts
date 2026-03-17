// src/services/booking.service.ts
import { prisma } from '../config/prisma'; 
import { redisClient } from '../config/redis';
import { seatUnlockQueue } from '../jobs/seatUnlockQueue';
import { getIO } from '../sockets';

export const confirmBookingTransaction = async (
  userId: string,
  showId: string,
  seatIds: string[],
  totalAmount: number,
  paymentRefId: string
) => {
  try {
    const transactionResult = await prisma.$transaction(async (tx) => {

      const showSeats = await tx.showSeat.findMany({
        where: { showId, seatId: { in: seatIds } },
        include: { seat: true }
      });

      if (showSeats.length !== seatIds.length) {
        throw new Error('Some seats are invalid or not found.');
      }

      const invalidSeats = showSeats.filter(
        ss => ss.status !== 'LOCKED' || ss.lockedBy !== userId
      );
      if (invalidSeats.length > 0) {
        throw new Error('One or more seats are not locked by you.');
      }

      const booking = await tx.booking.create({
        data: {
          userId,
          showId,
          status: 'CONFIRMED',
          totalAmount,
          idempotencyKey: paymentRefId,
          expiresAt: null, 
        }
      });

      for (const ss of showSeats) {
        await tx.showSeat.update({
          where: { id: ss.id },
          data: { status: 'BOOKED', lockedBy: null, lockedUntil: null }
        });

        await tx.bookedSeat.create({
          data: {
            bookingId: booking.id,
            showSeatId: ss.id,
            priceAtBooking: ss.seat.basePrice
          }
        });
      }

      await tx.payment.create({
        data: {
          bookingId: booking.id,
          provider: 'MOCK_GATEWAY',
          providerRef: paymentRefId,
          status: 'SUCCESS',
          amount: totalAmount
        }
      });

      return booking;
    });

    for (const seatId of seatIds) {
      const lockKey = `seat_lock:${showId}:${seatId}`;
      await redisClient.del(lockKey);

      const jobId = `unlock:${showId}:${seatId}`;
      const job = await seatUnlockQueue.getJob(jobId);
      if (job) {
        await job.remove();
        console.log(`--Cancelled auto-unlock timer for seat ${seatId}`);
      }
    }

    const io = getIO();
    io.to(`show_${showId}`).emit('seats_booked_permanently', { seatIds, status: 'BOOKED' });

    return { success: true, booking: transactionResult };

  } catch (error: any) {
    console.error('--Transaction Failed:', error);
    if (error.code === 'P2002' && error.meta?.target?.includes('idempotencyKey')) {
      return { success: false, message: 'This payment was already processed. Booking exists.' };
    }
    return { success: false, message: error.message || 'Booking failed during database transaction.' };
  }
};