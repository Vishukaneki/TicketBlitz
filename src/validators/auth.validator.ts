// src/validators/auth.validator.ts
import { z } from 'zod';

export const signupSchema = z
  .object({
    email: z.email({ error: 'Invalid email address' }).optional(),

    phone: z
      .string()
      .min(10, { error: 'Phone number must be at least 10 digits' })
      .max(15, { error: 'Phone number must be at most 15 digits' })
      .regex(/^\+?[0-9]+$/, { error: 'Phone number must contain only digits' })
      .optional(),

    password: z
      .string()
      .min(8, { error: 'Password must be at least 8 characters long' })
      .max(72, { error: 'Password must be at most 72 characters' })
      // bcrypt silently truncates at 72 chars — cap it here to avoid confusion
      .regex(/[A-Z]/, { error: 'Password must contain at least one uppercase letter' })
      .regex(/[0-9]/, { error: 'Password must contain at least one number' })
      .regex(/[^A-Za-z0-9]/, { error: 'Password must contain at least one special character' }),
  })
  .refine((data) => data.email || data.phone, {
    error: 'At least one of email or phone is required',
    path: ['email'], // which field the error is attached to in the response
  });

export const loginSchema = z.object({
  email: z.email({ error: 'Invalid email address' }),
  password: z.string().min(1, { error: 'Password is required' }),
});