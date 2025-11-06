import { z } from 'zod';

export const OrderStatus = z.enum(['PLACED', 'CANCELLED', 'CONFIRMED', 'FAILED']);

export const Address = z
  .object({
    line1: z.string().min(1),
    city: z.string().min(1),
    zip: z.string().min(1),
    country: z.string().min(1)
  })
  .strict();

export const OrderLine = z.object({
  sku: z.string(),
  qty: z.number().int().positive()
}).strict();

export const CreateOrderReq = z.object({
  requestId: z.string().min(1),
  lines: z.array(OrderLine).nonempty(),
  amount: z.number().positive(),
  address: Address
}).strict();

export const Order = z.object({
  orderId: z.string(),
  lines: z.array(OrderLine),
  amount: z.number().positive(),
  address: Address,
  status: OrderStatus
}).strict();

export const OrderIdParams = z.object({
  id: z.string().min(1)
}).strict();

export const CreateOrderResponse = z.object({
  orderId: z.string(),
  status: OrderStatus
}).strict();

export const CancelOrderResponse = z.object({
  orderId: z.string(),
  status: OrderStatus
}).strict();

export const GetOrderResponse = Order;
