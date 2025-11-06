import { randomUUID } from 'node:crypto';

import type { EventBus, EventEnvelope } from '@reatiler/shared';
import {
  createEvent,
  logEvent,
  parseEvent,
  publishWithRetry,
  withTimeout
} from '@reatiler/shared';

import type { ReservationStore } from '../reservations.js';

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

function logParseError(logger: Logger, event: EventEnvelope, message: string, error: unknown) {
  logEvent(logger, event, message, {
    level: 'warn',
    context: {
      error: error instanceof Error ? error.message : error
    }
  });
}

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
    let parsed;

    try {
      parsed = parseEvent('OrderPlaced', event);
    } catch (error) {
      logParseError(logger, event, 'invalid OrderPlaced payload received', error);
      return;
    }

    const { envelope, data } = parsed;
    const { orderId, lines, amount, address } = data;

    if (store.findByOrderId(orderId)) {
      logEvent(logger, envelope, 'reservation already exists, skipping duplicate OrderPlaced', {
        context: { orderId }
      });
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

      const failureEvent = createEvent(
        'InventoryReservationFailed',
        {
          reservationId,
          orderId,
          reason
        },
        {
          traceId: envelope.traceId,
          correlationId: orderId,
          causationId: envelope.eventId
        }
      );

      await Promise.all(
        failureQueues.map((queue) => publishWithRetry(bus, queue, failureEvent, logger))
      );

      logEvent(logger, envelope, 'inventory reservation failed', {
        level: 'warn',
        context: { orderId, reservationId, reason }
      });
      return;
    }

    const reservationEvent = createEvent(
      'InventoryReserved',
      {
        reservationId,
        orderId,
        items: lines,
        amount,
        address
      },
      {
        traceId: envelope.traceId,
        correlationId: orderId,
        causationId: envelope.eventId
      }
    );

    await publishWithRetry(bus, nextQueue, reservationEvent, logger);
    logEvent(logger, envelope, 'inventory reserved', {
      context: { orderId, reservationId }
    });
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
    let parsed;

    try {
      parsed = parseEvent('ReleaseStock', event);
    } catch (error) {
      logParseError(logger, event, 'invalid ReleaseStock payload received', error);
      return;
    }

    const { envelope, data } = parsed;
    const { reservationId, orderId } = data;

    const reservation =
      store.findByReservationId(reservationId) ?? store.findByOrderId(orderId);

    if (!reservation) {
      logEvent(logger, envelope, 'reservation not found when processing ReleaseStock', {
        level: 'warn',
        context: { orderId, reservationId }
      });
      return;
    }

    if (reservation.status === 'RELEASED') {
      logEvent(logger, envelope, 'stock already released', {
        context: { orderId, reservationId }
      });
      return;
    }

    if (reservation.status !== 'RESERVED') {
      logEvent(logger, envelope, 'reservation in unexpected status when releasing stock', {
        level: 'warn',
        context: { orderId, reservationId, status: reservation.status }
      });
      return;
    }

    store.updateStatus(reservation.reservationId, 'RELEASED');

    const releasedEvent = createEvent(
      'InventoryReleased',
      {
        reservationId: reservation.reservationId,
        orderId
      },
      {
        traceId: envelope.traceId,
        correlationId: orderId,
        causationId: envelope.eventId
      }
    );

    await publishWithRetry(bus, nextQueue, releasedEvent, logger);
    logEvent(logger, envelope, 'stock released', {
      context: { orderId, reservationId: reservation.reservationId }
    });
  };
}
