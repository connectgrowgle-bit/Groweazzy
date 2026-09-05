import { z } from 'zod';

// Single shared schema for the contact form — validated identically on the
// client (for instant feedback) and the server (the only validation that
// actually matters; client-side is UX only).
export const contactFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: z.string().trim().email('Enter a valid email'),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  message: z.string().trim().min(10, 'Tell us a bit more (10+ characters)').max(5000),
});

export type ContactFormInput = z.infer<typeof contactFormSchema>;
