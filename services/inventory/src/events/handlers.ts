import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { EventBus, EventEnvelope } from '@reatiler/shared';
import { createEventEnvelope } from '@reatiler/shared';

import type { ReservationStore } from '../reservations.js';

const AddressSchema = z
  .object({
    line1: z.string().min(1),
    city: z.string().min(1),
    zip: z.string().min(1),
    country: z.string().min(1)
  })
  .strict();

const OrderPlacedData = z
  .object({
    orderId: z.string().min(1),
    lines: z
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

export type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  warn?: (message: unknown, ...args: unknown[]) => void;
  error?: (message: unknown, ...args: unknown[]) => void;
};

export type CreateOrderPlacedHandlerOptions = {
  store: ReservationStore;
  bus: EventBus;
  logger: Logger;
  nextQueue?: string;
};

const PAYMENTS_QUEUE = 'payments';

export function createOrderPlacedHandler({
  store,
  bus,
  logger,
  nextQueue = PAYMENTS_QUEUE
}: CreateOrderPlacedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = OrderPlacedData.safeParse(event.data);

    if (!parsed.success) {
      logger.warn?.(
        { eventName: event.eventName, issues: parsed.error.issues },
        'invalid OrderPlaced payload received'
      );
      return;
    }

    const { orderId, lines, amount, address } = parsed.data;

    if (store.findByOrderId(orderId)) {
      logger.info({ orderId }, 'reservation already exists, skipping duplicate OrderPlaced');
      return;
    }

    const reservationId = randomUUID();

    store.create({
      reservationId,
      orderId,
      items: lines,
      amount,
      address,
      status: 'RESERVED'
    });

    // Propagate the delivery address through the InventoryReserved event so downstream services
    // can authorize payments without performing synchronous lookups.
    const reservationEvent = createEventEnvelope({
      eventName: 'InventoryReserved',
      traceId: event.traceId,
      correlationId: orderId,
      causationId: event.eventId,
      data: {
        reservationId,
        orderId,
        items: lines,
        amount,
        address
      }
    });

    await bus.push(nextQueue, reservationEvent);
    logger.info({ orderId, reservationId }, 'inventory reserved');
  };
}
