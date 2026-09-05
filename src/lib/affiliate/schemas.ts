import { z } from 'zod';

// PAN format: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F) — standard
// Indian PAN structure. IFSC: 4 letters, a literal 0, 6 alphanumeric.
export const kycSubmitSchema = z.object({
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN (e.g. ABCDE1234F)'),
  bankAccountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{9,18}$/, 'Enter a valid bank account number'),
  bankIfsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code'),
});

export const kycReviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  rejectionReason: z.string().trim().max(2000).optional(),
});

export const feeConfirmSchema = z.object({
  paymentId: z.string().uuid(),
  gatewayPaymentId: z.string().min(1),
});
