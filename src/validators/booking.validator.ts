// src/validators/booking.validator.ts
import { z } from 'zod';
import { MAX_SEATS_PER_BOOKING } from './seat.validator';

export const confirmBookingSchema = z.object({
  showId: z.string().cuid({ message: 'Invalid show ID' }),
  seatIds: z
    .array(z.string().cuid({ message: 'Invalid seat ID' }))
    .min(1, { message: 'At least one seat required' })
    .max(MAX_SEATS_PER_BOOKING, {
      message: `Cannot confirm more than ${MAX_SEATS_PER_BOOKING} seats in a single booking`,
    })
    .transform((ids) => Array.from(new Set(ids))),
  paymentRefId: z.string().min(1, { message: 'Payment reference required' }),
  lockToken: z.string().min(1).optional(),
  // totalAmount removed — calculated server side
});
