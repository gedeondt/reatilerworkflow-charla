import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { EventBus, EventEnvelope } from '@reatiler/shared';
import { createEventEnvelope } from '@reatiler/shared';

import type { ShipmentStore } from '../shipments.js';

const AddressSchema = z
  .object({
    line1: z.string().min(1),
    city: z.string().min(1),
    zip: z.string().min(1),
    country: z.string().min(1)
  })
  .strict();

const PaymentAuthorizedData = z
  .object({
    paymentId: z.string().min(1),
    orderId: z.string().min(1),
    amount: z.number().positive(),
    address: AddressSchema
  })
  .strict();

export type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  warn?: (message: unknown, ...args: unknown[]) => void;
  error?: (message: unknown, ...args: unknown[]) => void;
};

export type CreatePaymentAuthorizedHandlerOptions = {
  store: ShipmentStore;
  bus: EventBus;
  logger: Logger;
  nextQueue?: string;
};

const PAYMENTS_QUEUE = 'payments';

export function createPaymentAuthorizedHandler({
  store,
  bus,
  logger,
  nextQueue = PAYMENTS_QUEUE
}: CreatePaymentAuthorizedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = PaymentAuthorizedData.safeParse(event.data);

    if (!parsed.success) {
      logger.warn?.(
        { eventName: event.eventName, issues: parsed.error.issues },
        'invalid PaymentAuthorized payload received'
      );
      return;
    }

    const { orderId, address } = parsed.data;

    if (store.findByOrderId(orderId)) {
      logger.info({ orderId }, 'shipment already prepared, skipping duplicate PaymentAuthorized');
      return;
    }

    const shipmentId = randomUUID();

    store.create({
      shipmentId,
      orderId,
      address,
      status: 'PREPARED'
    });

    const preparedEvent = createEventEnvelope({
      eventName: 'ShipmentPrepared',
      traceId: event.traceId,
      correlationId: orderId,
      causationId: event.eventId,
      data: {
        shipmentId,
        orderId,
        address
      }
    });

    await bus.push(nextQueue, preparedEvent);
    logger.info({ orderId, shipmentId }, 'shipment prepared');
  };
}
