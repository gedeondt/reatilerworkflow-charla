import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { EventBus, EventEnvelope } from '@reatiler/shared';
import { createEventEnvelope, publishWithRetry, withTimeout } from '@reatiler/shared';

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

const ReleaseStockData = z
  .object({
    reservationId: z.string().min(1),
    orderId: z.string().min(1)
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
  allowReservation: boolean;
  opTimeoutMs: number;
  nextQueue?: string;
  failureQueues?: string[];
};

const PAYMENTS_QUEUE = 'payments';
const FAILURE_QUEUES = ['orders', 'payments'];
const ORDERS_QUEUE = 'orders';

export function createOrderPlacedHandler({
  store,
  bus,
  logger,
  allowReservation,
  opTimeoutMs,
  nextQueue = PAYMENTS_QUEUE,
  failureQueues = FAILURE_QUEUES
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

    const performReservation = async () => {
      if (!allowReservation) {
        throw new Error('reservations disabled by ALLOW_RESERVATION toggle');
      }

      store.create({
        reservationId,
        orderId,
        items: lines,
        amount,
        address,
        status: 'RESERVED'
      });
    };

    try {
      await withTimeout(Promise.resolve().then(performReservation), opTimeoutMs);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';

      store.create({
        reservationId,
        orderId,
        items: lines,
        amount,
        address,
        status: 'FAILED'
      });

      const failureEvent = createEventEnvelope({
        eventName: 'InventoryReservationFailed',
        traceId: event.traceId,
        correlationId: orderId,
        causationId: event.eventId,
        data: {
          reservationId,
          orderId,
          reason
        }
      });

      await Promise.all(
        failureQueues.map((queue) => publishWithRetry(bus, queue, failureEvent, logger))
      );
      logger.warn?.({ orderId, reservationId, reason }, 'inventory reservation failed');
      return;
    }

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

    await publishWithRetry(bus, nextQueue, reservationEvent, logger);
    logger.info({ orderId, reservationId }, 'inventory reserved');
  };
}

export type CreateReleaseStockHandlerOptions = {
  store: ReservationStore;
  bus: EventBus;
  logger: Logger;
  nextQueue?: string;
};

export function createReleaseStockHandler({
  store,
  bus,
  logger,
  nextQueue = ORDERS_QUEUE
}: CreateReleaseStockHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = ReleaseStockData.safeParse(event.data);

    if (!parsed.success) {
      logger.warn?.(
        { eventName: event.eventName, issues: parsed.error.issues },
        'invalid ReleaseStock payload received'
      );
      return;
    }

    const { reservationId, orderId } = parsed.data;
    const reservation =
      store.findByReservationId(reservationId) ?? store.findByOrderId(orderId);

    if (!reservation) {
      logger.warn?.(
        { orderId, reservationId },
        'reservation not found when processing ReleaseStock'
      );
      return;
    }

    if (reservation.status === 'RELEASED') {
      logger.info({ orderId, reservationId }, 'stock already released');
      return;
    }

    if (reservation.status !== 'RESERVED') {
      logger.warn?.(
        { orderId, reservationId, status: reservation.status },
        'reservation in unexpected status when releasing stock'
      );
      return;
    }

    store.updateStatus(reservation.reservationId, 'RELEASED');

    const releasedEvent = createEventEnvelope({
      eventName: 'InventoryReleased',
      traceId: event.traceId,
      correlationId: orderId,
      causationId: event.eventId,
      data: {
        reservationId: reservation.reservationId,
        orderId
      }
    });

    await publishWithRetry(bus, nextQueue, releasedEvent, logger);
    logger.info({ orderId, reservationId }, 'stock released');
  };
}
