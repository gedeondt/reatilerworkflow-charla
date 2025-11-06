import { z } from 'zod';

export const PaymentStatus = z.enum(['PENDING', 'AUTHORIZED', 'CAPTURED', 'REFUNDED', 'FAILED']);

export const Payment = z.object({
  paymentId: z.string(),
  orderId: z.string(),
  amount: z.number().positive(),
  status: PaymentStatus
}).strict();

export const AuthorizePaymentRequest = z.object({
  orderId: z.string(),
  amount: z.number().positive()
}).strict();

export const PaymentActionRequest = z.object({
  paymentId: z.string()
}).strict();

export const PaymentActionResponse = z.object({
  paymentId: z.string(),
  status: PaymentStatus
}).strict();

export const PaymentIdParams = z.object({
  id: z.string().min(1)
}).strict();
