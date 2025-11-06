import { z } from 'zod';

export const ReservationStatus = z.enum(['PENDING', 'RESERVED', 'COMMITTED', 'RELEASED', 'FAILED']);

export const ReservationItem = z.object({
  sku: z.string(),
  qty: z.number().int().positive()
}).strict();

export const CreateReservationRequest = z.object({
  orderId: z.string(),
  items: z.array(ReservationItem).nonempty()
}).strict();

export const Reservation = z.object({
  reservationId: z.string(),
  orderId: z.string(),
  items: z.array(ReservationItem),
  status: ReservationStatus
}).strict();

export const ReservationIdParams = z.object({
  id: z.string().min(1)
}).strict();

export const ReservationActionResponse = z.object({
  reservationId: z.string(),
  status: ReservationStatus
}).strict();
