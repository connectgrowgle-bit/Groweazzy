import { z } from 'zod';

// Shared between client-side (instant feedback) and server-side (the only
// validation that actually matters) validation, same pattern as
// src/lib/contact-schema.ts.
export const registerSchema = z.object({
  fullName: z.string().trim().min(1, 'Name is required').max(200),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required').max(200),
});
