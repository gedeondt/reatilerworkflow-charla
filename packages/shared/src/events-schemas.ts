import { z } from './z.js';

const addressSchema = z
  .object({
    line1: z.string().min(1),
    city: z.string().min(1),
    zip: z.string().min(1),
    country: z.string().min(1)
  })
  .strict();

const orderLineSchema = z
  .object({
    sku: z.string().min(1),
    qty: z.number().int().positive()
  })
  .strict();

const reservationItemSchema = orderLineSchema;

export const eventDataSchemas = {
  OrderPlaced: z
    .object({
      orderId: z.string().min(1),
      lines: z.array(orderLineSchema).nonempty(),
      amount: z.number().positive(),
      address: addressSchema
    })
    .strict(),
  InventoryReserved: z
    .object({
      reservationId: z.string().min(1),
      orderId: z.string().min(1),
      items: z.array(reservationItemSchema).nonempty(),
      amount: z.number().positive(),
      address: addressSchema
    })
    .strict(),
  InventoryReservationFailed: z
    .object({
      reservationId: z.string().min(1),
      orderId: z.string().min(1),
      reason: z.string().min(1)
    })
    .strict(),
  InventoryReleased: z
    .object({
      reservationId: z.string().min(1),
      orderId: z.string().min(1)
    })
    .strict(),
  PaymentAuthorized: z
    .object({
      paymentId: z.string().min(1),
      orderId: z.string().min(1),
      reservationId: z.string().min(1),
      amount: z.number().positive(),
      address: addressSchema
    })
    .strict(),
  PaymentCaptured: z
    .object({
      paymentId: z.string().min(1),
      orderId: z.string().min(1),
      amount: z.number().positive()
    })
    .strict(),
  PaymentFailed: z
    .object({
      paymentId: z.string().min(1),
      orderId: z.string().min(1),
      reservationId: z.string().min(1),
      reason: z.string().min(1)
    })
    .strict(),
  PaymentRefunded: z
    .object({
      paymentId: z.string().min(1),
      orderId: z.string().min(1),
      amount: z.number().positive(),
      reason: z.string().min(1)
    })
    .strict(),
  ShipmentPrepared: z
    .object({
      shipmentId: z.string().min(1),
      orderId: z.string().min(1),
      address: addressSchema
    })
    .strict(),
  ShipmentFailed: z
    .object({
      shipmentId: z.string().min(1),
      orderId: z.string().min(1),
      reason: z.string().min(1)
    })
    .strict(),
  OrderConfirmed: z
    .object({
      orderId: z.string().min(1),
      status: z.literal('CONFIRMED')
    })
    .strict(),
  OrderCancelled: z
    .object({
      orderId: z.string().min(1),
      reason: z.string().min(1)
    })
    .strict(),
  OrderFailed: z
    .object({
      orderId: z.string().min(1),
      reason: z.string().min(1)
    })
    .strict(),
  // Eventos-comando internos utilizados para disparar acciones compensatorias.
  ReleaseStock: z
    .object({
      reservationId: z.string().min(1),
      orderId: z.string().min(1)
    })
    .strict(),
  RefundPayment: z
    .object({
      paymentId: z.string().min(1),
      orderId: z.string().min(1),
      reason: z.string().min(1)
    })
    .strict()
} as const;

export type EventName = keyof typeof eventDataSchemas;

export type EventDataMap = {
  [K in EventName]: z.infer<(typeof eventDataSchemas)[K]>;
};

export type EventData<K extends EventName = EventName> = EventDataMap[K];

export function getEventSchema<K extends EventName>(eventName: K) {
  return eventDataSchemas[eventName];
}
