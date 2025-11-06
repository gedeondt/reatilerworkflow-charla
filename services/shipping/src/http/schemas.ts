import { z } from 'zod';

export const ShipmentStatus = z.enum(['PENDING', 'PREPARED', 'DISPATCHED', 'FAILED']);

export const Address = z.object({
  line1: z.string(),
  city: z.string(),
  zip: z.string(),
  country: z.string()
}).strict();

export const Shipment = z.object({
  shipmentId: z.string(),
  orderId: z.string(),
  address: Address,
  status: ShipmentStatus
}).strict();

export const CreateShipmentRequest = z.object({
  orderId: z.string(),
  address: Address
}).strict();

export const ShipmentActionResponse = z.object({
  shipmentId: z.string(),
  status: ShipmentStatus
}).strict();

export const ShipmentIdParams = z.object({
  id: z.string().min(1)
}).strict();
