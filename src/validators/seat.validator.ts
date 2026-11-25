// src/validators/seat.validator.ts
import { z } from 'zod';

export const MAX_SEATS_PER_BOOKING = 10;

export const lockSeatsSchema = z.object({
  showId: z.string().cuid({ message: 'Invalid show ID' }),
  seatIds: z
    .array(z.string().cuid({ message: 'Invalid seat ID' }))
    .min(1, { message: 'At least one seat must be selected' })
    .max(MAX_SEATS_PER_BOOKING, {
      message: `Cannot lock more than ${MAX_SEATS_PER_BOOKING} seats in a single request`,
    })
    .transform((ids) => Array.from(new Set(ids))), // Deduplicate to prevent self-sabotage
});

export const releaseSeatsSchema = z.object({
  showId: z.string().cuid({ message: 'Invalid show ID' }),
  seatIds: z
    .array(z.string().cuid({ message: 'Invalid seat ID' }))
    .min(1, { message: 'At least one seat must be provided' })
    .max(MAX_SEATS_PER_BOOKING)
    .transform((ids) => Array.from(new Set(ids))),
  lockToken: z.string().min(1, { message: 'Lock token is required' }),
});
