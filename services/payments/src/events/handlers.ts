import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { EventBus, EventEnvelope } from '@reatiler/shared';
import { createEventEnvelope } from '@reatiler/shared';

import type { PaymentStore } from '../payments.js';

const AddressSchema = z
  .object({
    line1: z.string().min(1),
    city: z.string().min(1),
    zip: z.string().min(1),
    country: z.string().min(1)
  })
  .strict();

const InventoryReservedData = z
  .object({
    reservationId: z.string().min(1),
    orderId: z.string().min(1),
    items: z
      .array(
        z
          .object({
            sku: z.string().min(1),
            qty: z.number().int().positive()
          })
          .strict()
      )
      .nonempty(),
    amount: z.number().positive(),
    address: AddressSchema
  })
  .strict();

const ShipmentPreparedData = z
  .object({
    shipmentId: z.string().min(1),
    orderId: z.string().min(1),
    address: AddressSchema
  })
  .strict();

export type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  warn?: (message: unknown, ...args: unknown[]) => void;
  error?: (message: unknown, ...args: unknown[]) => void;
};

export type CreateInventoryReservedHandlerOptions = {
  store: PaymentStore;
  bus: EventBus;
  logger: Logger;
  nextQueue?: string;
};

export type CreateShipmentPreparedHandlerOptions = {
  store: PaymentStore;
  bus: EventBus;
  logger: Logger;
  nextQueue?: string;
};

const SHIPPING_QUEUE = 'shipping';
const ORDERS_QUEUE = 'orders';

export function createInventoryReservedHandler({
  store,
  bus,
  logger,
  nextQueue = SHIPPING_QUEUE
}: CreateInventoryReservedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = InventoryReservedData.safeParse(event.data);

    if (!parsed.success) {
      logger.warn?.(
        { eventName: event.eventName, issues: parsed.error.issues },
        'invalid InventoryReserved payload received'
      );
      return;
    }

    const { orderId, amount, address } = parsed.data;

    if (store.findByOrderId(orderId)) {
      logger.info({ orderId }, 'payment already exists, skipping duplicate InventoryReserved');
      return;
    }

    const paymentId = randomUUID();

    store.create({
      paymentId,
      orderId,
      amount,
      address,
      status: 'AUTHORIZED'
    });

    const authorizedEvent = createEventEnvelope({
      eventName: 'PaymentAuthorized',
      traceId: event.traceId,
      correlationId: orderId,
      causationId: event.eventId,
      data: {
        paymentId,
        orderId,
        amount,
        address
      }
    });

    await bus.push(nextQueue, authorizedEvent);
    logger.info({ orderId, paymentId }, 'payment authorized');
  };
}

export function createShipmentPreparedHandler({
  store,
  bus,
  logger,
  nextQueue = ORDERS_QUEUE
}: CreateShipmentPreparedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = ShipmentPreparedData.safeParse(event.data);

    if (!parsed.success) {
      logger.warn?.(
        { eventName: event.eventName, issues: parsed.error.issues },
        'invalid ShipmentPrepared payload received'
      );
      return;
    }

    const { orderId } = parsed.data;
    const payment = store.findByOrderId(orderId);

    if (!payment) {
      logger.warn?.({ orderId }, 'payment not found when processing ShipmentPrepared');
      return;
    }

    if (payment.status === 'CAPTURED') {
      logger.info({ orderId }, 'payment already captured, skipping duplicate ShipmentPrepared');
      return;
    }

    store.updateStatus(orderId, 'CAPTURED');

    const capturedEvent = createEventEnvelope({
      eventName: 'PaymentCaptured',
      traceId: event.traceId,
      correlationId: orderId,
      causationId: event.eventId,
      data: {
        paymentId: payment.paymentId,
        orderId,
        amount: payment.amount
      }
    });

    await bus.push(nextQueue, capturedEvent);
    logger.info({ orderId, paymentId: payment.paymentId }, 'payment captured');
  };
}
