// src/validators/booking.validator.ts
import { z } from 'zod'

export const confirmBookingSchema = z.object({
  showId: z.string().cuid({ message: 'Invalid show ID' }),
  seatIds: z.array(z.string().cuid()).min(1, { message: 'At least one seat required' }),
  paymentRefId: z.string().min(1, { message: 'Payment reference required' }),
  // totalAmount removed — calculated server side
})