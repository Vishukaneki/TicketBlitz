// src/services/booking.service.ts
import { prisma } from '../config/prisma'; 
import { redisClient } from '../config/redis';
import { seatUnlockQueue } from '../jobs/seatUnlockQueue';
import { getIO } from '../sockets';

export const confirmBookingTransaction = async (
  userId: string,
  showId: string,
  seatIds: string[],
  paymentRefId: string
) => {
  try {
    const { booking: transactionResult, totalAmount, userEmail, movieTitle } =
      await prisma.$transaction(async (tx) => {

        // Fetch user email for the notification
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { email: true },
        });

        if (!user) {
          throw new Error('User not found for booking.');
        }

        // Fetch show with movie title for the notification
        const show = await tx.show.findUnique({
          where: { id: showId },
          include: { movie: { select: { title: true } } },
        });

        if (!show) {
          throw new Error('Show not found for booking.');
        }

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

        // Calculate total amount server-side from actual seat prices
        const computedTotal = showSeats.reduce(
          (sum, ss) => sum + Number(ss.seat.basePrice),
          0
        );

        const booking = await tx.booking.create({
          data: {
            userId,
            showId,
            status: 'CONFIRMED',
            totalAmount: computedTotal,
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
            amount: computedTotal
          }
        });

        return {
          booking,
          totalAmount: computedTotal,
          userEmail: user.email ?? null,
          movieTitle: show.movie?.title ?? null,
        };
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

    return { success: true, booking: transactionResult, totalAmount, userEmail, movieTitle };

  } catch (error: any) {
    console.error('--Transaction Failed:', error);
    if (error.code === 'P2002' && error.meta?.target?.includes('idempotencyKey')) {
      return { success: false, message: 'This payment was already processed. Booking exists.' };
    }
    return { success: false, message: error.message || 'Booking failed during database transaction.' };
  }
};