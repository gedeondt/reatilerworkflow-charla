import { randomUUID } from 'node:crypto';

import type { EventBus, EventEnvelope, EventName } from '@reatiler/shared';
import {
  createEvent,
  logEvent,
  parseEvent,
  publishWithRetry,
  withTimeout
} from '@reatiler/shared';

import type { PaymentStore } from '../payments.js';

export type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  warn?: (message: unknown, ...args: unknown[]) => void;
  error?: (message: unknown, ...args: unknown[]) => void;
};

export type CreateInventoryReservedHandlerOptions = {
  store: PaymentStore;
  bus: EventBus;
  logger: Logger;
  allowAuth: boolean;
  opTimeoutMs: number;
  nextQueue?: string;
  failureQueues?: string[];
};

export type CreateShipmentPreparedHandlerOptions = {
  store: PaymentStore;
  bus: EventBus;
  logger: Logger;
  opTimeoutMs: number;
  nextQueue?: string;
};

export type CreateRefundPaymentHandlerOptions = {
  store: PaymentStore;
  bus: EventBus;
  logger: Logger;
  nextQueue?: string;
};

const SHIPPING_QUEUE = 'shipping';
const ORDERS_QUEUE = 'orders';
const FAILURE_QUEUES = ['orders', 'inventory'];

function safeParse<N extends EventName>(
  eventName: N,
  event: EventEnvelope,
  logger: Logger,
  message: string
) {
  try {
    return parseEvent(eventName, event);
  } catch (error) {
    logEvent(logger, event, message, {
      level: 'warn',
      context: { error: error instanceof Error ? error.message : error }
    });
    return null;
  }
}

export function createInventoryReservedHandler({
  store,
  bus,
  logger,
  allowAuth,
  opTimeoutMs,
  nextQueue = SHIPPING_QUEUE,
  failureQueues = FAILURE_QUEUES
}: CreateInventoryReservedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = safeParse('InventoryReserved', event, logger, 'invalid InventoryReserved payload received');

    if (!parsed) {
      return;
    }

    const { envelope, data } = parsed;
    const { orderId, amount, address, reservationId } = data;

    if (store.findByOrderId(orderId)) {
      logEvent(logger, envelope, 'payment already exists, skipping duplicate InventoryReserved', {
        context: { orderId }
      });
      return;
    }

    const paymentId = randomUUID();

    const authorize = async () => {
      if (!allowAuth) {
        throw new Error('payments disabled by ALLOW_AUTH toggle');
      }

      store.create({
        paymentId,
        orderId,
        reservationId,
        amount,
        address,
        status: 'AUTHORIZED'
      });
    };

    try {
      await withTimeout(Promise.resolve().then(authorize), opTimeoutMs);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';

      store.create({
        paymentId,
        orderId,
        reservationId,
        amount,
        address,
        status: 'FAILED'
      });

      const failedEvent = createEvent(
        'PaymentFailed',
        {
          paymentId,
          orderId,
          reservationId,
          reason
        },
        {
          traceId: envelope.traceId,
          correlationId: orderId,
          causationId: envelope.eventId
        }
      );

      await Promise.all(
        failureQueues.map((queue) => publishWithRetry(bus, queue, failedEvent, logger))
      );

      logEvent(logger, envelope, 'payment authorization failed', {
        level: 'warn',
        context: { orderId, paymentId, reason }
      });
      return;
    }

    const authorizedEvent = createEvent(
      'PaymentAuthorized',
      {
        paymentId,
        orderId,
        reservationId,
        amount,
        address
      },
      {
        traceId: envelope.traceId,
        correlationId: orderId,
        causationId: envelope.eventId
      }
    );

    await publishWithRetry(bus, nextQueue, authorizedEvent, logger);
    logEvent(logger, envelope, 'payment authorized', {
      context: { orderId, paymentId }
    });
  };
}

export function createShipmentPreparedHandler({
  store,
  bus,
  logger,
  opTimeoutMs,
  nextQueue = ORDERS_QUEUE
}: CreateShipmentPreparedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = safeParse('ShipmentPrepared', event, logger, 'invalid ShipmentPrepared payload received');

    if (!parsed) {
      return;
    }

    const { envelope, data } = parsed;
    const { orderId } = data;
    const payment = store.findByOrderId(orderId);

    if (!payment) {
      logEvent(logger, envelope, 'payment not found when processing ShipmentPrepared', {
        level: 'warn',
        context: { orderId }
      });
      return;
    }

    if (payment.status === 'CAPTURED' || payment.status === 'REFUNDED') {
      logEvent(logger, envelope, 'payment already captured, skipping duplicate ShipmentPrepared', {
        context: { orderId }
      });
      return;
    }

    const capture = async () => {
      store.updateStatus(orderId, 'CAPTURED');
    };

    await withTimeout(Promise.resolve().then(capture), opTimeoutMs);

    const capturedEvent = createEvent(
      'PaymentCaptured',
      {
        paymentId: payment.paymentId,
        orderId,
        amount: payment.amount
      },
      {
        traceId: envelope.traceId,
        correlationId: orderId,
        causationId: envelope.eventId
      }
    );

    await publishWithRetry(bus, nextQueue, capturedEvent, logger);
    logEvent(logger, envelope, 'payment captured', {
      context: { orderId, paymentId: payment.paymentId }
    });
  };
}

export function createRefundPaymentHandler({
  store,
  bus,
  logger,
  nextQueue = ORDERS_QUEUE
}: CreateRefundPaymentHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = safeParse('RefundPayment', event, logger, 'invalid RefundPayment payload received');

    if (!parsed) {
      return;
    }

    const { envelope, data } = parsed;
    const { paymentId, orderId, reason } = data;
    const payment = store.findByOrderId(orderId);

    if (!payment || payment.paymentId !== paymentId) {
      logEvent(logger, envelope, 'payment not found when processing RefundPayment', {
        level: 'warn',
        context: { orderId, paymentId }
      });
      return;
    }

    if (payment.status === 'REFUNDED') {
      logEvent(logger, envelope, 'payment already refunded, skipping', {
        context: { orderId, paymentId }
      });
      return;
    }

    if (payment.status !== 'CAPTURED') {
      logEvent(logger, envelope, 'payment not captured, cannot refund', {
        level: 'warn',
        context: { orderId, paymentId, status: payment.status }
      });
      return;
    }

    store.updateStatus(orderId, 'REFUNDED');

    const refundedEvent = createEvent(
      'PaymentRefunded',
      {
        paymentId,
        orderId,
        amount: payment.amount,
        reason
      },
      {
        traceId: envelope.traceId,
        correlationId: orderId,
        causationId: envelope.eventId
      }
    );

    await publishWithRetry(bus, nextQueue, refundedEvent, logger);
    logEvent(logger, envelope, 'payment refunded', {
      context: { orderId, paymentId }
    });
  };
}
