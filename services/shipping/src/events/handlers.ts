import { randomUUID } from 'node:crypto';

import type { EventBus, EventEnvelope, EventName } from '@reatiler/shared';
import {
  createEvent,
  logEvent,
  parseEvent,
  publishWithRetry,
  withTimeout
} from '@reatiler/shared';

import type { ShipmentStore } from '../shipments.js';

export type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  warn?: (message: unknown, ...args: unknown[]) => void;
  error?: (message: unknown, ...args: unknown[]) => void;
};

export type CreatePaymentAuthorizedHandlerOptions = {
  store: ShipmentStore;
  bus: EventBus;
  logger: Logger;
  allowPrepare: boolean;
  opTimeoutMs: number;
  nextQueue?: string;
};

const PAYMENTS_QUEUE = 'payments';

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

export function createPaymentAuthorizedHandler({
  store,
  bus,
  logger,
  allowPrepare,
  opTimeoutMs,
  nextQueue = PAYMENTS_QUEUE
}: CreatePaymentAuthorizedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = safeParse('PaymentAuthorized', event, logger, 'invalid PaymentAuthorized payload received');

    if (!parsed) {
      return;
    }

    const { envelope, data } = parsed;
    const { orderId, address, paymentId, reservationId } = data;
    const existing = store.findByOrderId(orderId);

    if (existing) {
      if (existing.status === 'PREPARED' && allowPrepare) {
        logEvent(logger, envelope, 'shipment already prepared, skipping duplicate PaymentAuthorized', {
          context: { orderId }
        });
        return;
      }

      if (existing.status === 'FAILED' && !allowPrepare) {
        logEvent(logger, envelope, 'shipment already failed, skipping duplicate PaymentAuthorized', {
          level: 'warn',
          context: { orderId }
        });
        return;
      }
    }

    const shipmentId = existing?.shipmentId ?? randomUUID();

    const prepare = async () => {
      if (!allowPrepare) {
        throw new Error('shipment preparation disabled by ALLOW_PREPARE toggle');
      }

      if (existing) {
        store.updateStatus(orderId, 'PREPARED');
        return;
      }

      store.create({
        shipmentId,
        orderId,
        address,
        status: 'PREPARED'
      });
    };

    try {
      await withTimeout(Promise.resolve().then(prepare), opTimeoutMs);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';

      if (existing) {
        store.updateStatus(orderId, 'FAILED');
      } else {
        store.create({
          shipmentId,
          orderId,
          address,
          status: 'FAILED'
        });
      }

      const failureEvent = createEvent(
        'ShipmentFailed',
        {
          shipmentId,
          orderId,
          reason
        },
        {
          traceId: envelope.traceId,
          correlationId: orderId,
          causationId: envelope.eventId
        }
      );

      const refundEvent = createEvent(
        'RefundPayment',
        {
          paymentId,
          orderId,
          reason
        },
        {
          traceId: envelope.traceId,
          correlationId: orderId,
          causationId: envelope.eventId
        }
      );

      await publishWithRetry(bus, nextQueue, failureEvent, logger);
      await publishWithRetry(bus, nextQueue, refundEvent, logger);

      logEvent(logger, envelope, 'shipment preparation failed', {
        level: 'warn',
        context: { orderId, shipmentId, reason, reservationId }
      });
      return;
    }

    const preparedEvent = createEvent(
      'ShipmentPrepared',
      {
        shipmentId,
        orderId,
        address
      },
      {
        traceId: envelope.traceId,
        correlationId: orderId,
        causationId: envelope.eventId
      }
    );

    await publishWithRetry(bus, nextQueue, preparedEvent, logger);
    logEvent(logger, envelope, 'shipment prepared', {
      context: { orderId, shipmentId }
    });
  };
}
