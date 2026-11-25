// src/services/booking.service.ts
import { prisma } from '../config/prisma';
import {
  verifyLocksForConfirmation,
  markSeatsBookedAndReleaseLocks,
  syncBookedSeatsToRedisCache,
} from './lock.service';
import { cancelBatchSeatUnlockIfComplete } from '../jobs/seatUnlockQueue';
import { broadcastToShow } from '../sockets';

class BookingError extends Error {
  statusCode: number;
  driftDetected: boolean;

  constructor(message: string, statusCode = 400, driftDetected = false) {
    super(message);
    this.statusCode = statusCode;
    this.driftDetected = driftDetected;
  }
}

export interface ConfirmBookingResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  booking?: any;
  totalAmount?: number;
  userEmail?: string | null;
  movieTitle?: string | null;
}

export const confirmBookingTransaction = async (
  userId: string,
  showId: string,
  seatIds: string[],
  paymentRefId: string,
  lockToken?: string
): Promise<ConfirmBookingResult> => {
  // 1. Verify Redis lock ownership BEFORE touching PostgreSQL
  const lockVerification = await verifyLocksForConfirmation(
    showId,
    seatIds,
    userId,
    lockToken
  );

  if (!lockVerification.valid) {
    // Handle idempotent retries where the exact paymentRefId already succeeded
    if (lockVerification.reason === 'BOOKED' || lockVerification.reason === 'NOT_LOCKED') {
      const existingBooking = await prisma.booking.findUnique({
        where: { idempotencyKey: paymentRefId },
        select: { id: true },
      });
      if (existingBooking) {
        return {
          success: false,
          statusCode: 409,
          message: 'This payment was already processed. Booking exists.',
        };
      }
    }

    const statusMap: Record<string, number> = {
      SHOW_NOT_FOUND: 404,
      INVALID_SEAT: 400,
      BOOKED: 409,
      NOT_LOCKED: 409,
      LOCKED_BY_OTHER: 409,
    };

    const messageMap: Record<string, string> = {
      SHOW_NOT_FOUND: 'Show not found for booking.',
      INVALID_SEAT: `Seat ${lockVerification.conflictingSeatId} is not valid for this show.`,
      BOOKED: `Seat ${lockVerification.conflictingSeatId} is already booked.`,
      NOT_LOCKED: `Lock expired or missing for seat ${lockVerification.conflictingSeatId}. Please re-select seats.`,
      LOCKED_BY_OTHER: `Seat ${lockVerification.conflictingSeatId} is currently locked by another user.`,
    };

    const reason = lockVerification.reason ?? 'NOT_LOCKED';
    return {
      success: false,
      statusCode: statusMap[reason] ?? 409,
      message: messageMap[reason] ?? 'One or more seats are not locked by you.',
    };
  }

  // 2. Execute fast batch ACID transaction in PostgreSQL
  try {
    const { booking: transactionResult, totalAmount, userEmail, movieTitle } =
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { email: true },
        });

        if (!user) {
          throw new BookingError('User not found for booking.', 404);
        }

        const show = await tx.show.findUnique({
          where: { id: showId },
          include: { movie: { select: { title: true } } },
        });

        if (!show) {
          throw new BookingError('Show not found for booking.', 404);
        }

        const showSeats = await tx.showSeat.findMany({
          where: { showId, seatId: { in: seatIds } },
          include: { seat: { select: { basePrice: true } } },
        });

        if (showSeats.length !== seatIds.length) {
          throw new BookingError('Some seats are invalid or not found.', 400);
        }

        // Guardrail #2: Atomic conditional batch update (1 SQL UPDATE).
        // ShowSeat stays 'AVAILABLE' while temporarily held in Redis.
        // Postgres row locks guarantee 0 double-bookings even if Redis drifted or wiped.
        const updated = await tx.showSeat.updateMany({
          where: {
            showId,
            seatId: { in: seatIds },
            status: 'AVAILABLE',
          },
          data: {
            status: 'BOOKED',
            lockedBy: null,
            lockedUntil: null,
            version: { increment: 1 },
          },
        });

        if (updated.count !== seatIds.length) {
          throw new BookingError(
            'One or more seats are already booked or unavailable.',
            409,
            true // Signal cache drift so catch block self-heals Redis
          );
        }

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
          },
        });

        // Batch insert BookedSeat rows (1 SQL INSERT instead of N sequential inserts)
        // Protected by BookedSeat.showSeatId @unique constraint
        await tx.bookedSeat.createMany({
          data: showSeats.map((ss) => ({
            bookingId: booking.id,
            showSeatId: ss.id,
            priceAtBooking: ss.seat.basePrice,
          })),
        });

        await tx.payment.create({
          data: {
            bookingId: booking.id,
            provider: 'MOCK_GATEWAY',
            providerRef: paymentRefId,
            status: 'SUCCESS',
            amount: computedTotal,
          },
        });

        return {
          booking,
          totalAmount: computedTotal,
          userEmail: user.email ?? null,
          movieTitle: show.movie?.title ?? null,
        };
      });

    // 3. Post-commit Redis cache sync & owner-verified lock cleanup
    try {
      await markSeatsBookedAndReleaseLocks(showId, seatIds, lockVerification.heldTokens);
    } catch (redisErr) {
      console.error('--Non-fatal: Post-commit Redis sync failed (DB booking is committed):', redisErr);
    }

    if (lockVerification.heldTokens?.length) {
      await cancelBatchSeatUnlockIfComplete(showId, seatIds, lockVerification.heldTokens);
    }

    broadcastToShow(showId, 'seats_booked_permanently', {
      seatIds,
      status: 'BOOKED',
    });

    return {
      success: true,
      booking: transactionResult,
      totalAmount,
      userEmail,
      movieTitle,
    };
  } catch (error: any) {
    console.error('--Transaction Failed:', error);

    if (error instanceof BookingError && error.driftDetected) {
      try {
        const dbBookedSeats = await prisma.showSeat.findMany({
          where: { showId, seatId: { in: seatIds }, status: 'BOOKED' },
          select: { seatId: true },
        });
        const bookedIds = dbBookedSeats.map((s) => s.seatId);
        if (bookedIds.length > 0) {
          await syncBookedSeatsToRedisCache(showId, bookedIds);
          broadcastToShow(showId, 'seats_booked_permanently', {
            seatIds: bookedIds,
            status: 'BOOKED',
          });
        }
      } catch (healErr) {
        console.error('--Failed to self-heal Redis drift:', healErr);
      }
    }

    if (error.code === 'P2002' && error.meta?.target?.includes('idempotencyKey')) {
      return {
        success: false,
        statusCode: 409,
        message: 'This payment was already processed. Booking exists.',
      };
    }

    // P2002 on BookedSeat.showSeatId @unique fallback
    if (error.code === 'P2002' && error.meta?.target?.includes('showSeatId')) {
      return {
        success: false,
        statusCode: 409,
        message: 'One or more seats were already booked by another user.',
      };
    }

    return {
      success: false,
      statusCode: error instanceof BookingError ? error.statusCode : 500,
      message: error.message || 'Booking failed during database transaction.',
    };
  }
};
