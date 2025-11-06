import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { EventBus, EventEnvelope } from '@reatiler/shared';
import { createEventEnvelope, publishWithRetry, withTimeout } from '@reatiler/shared';

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
    reservationId: z.string().min(1),
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
  allowPrepare: boolean;
  opTimeoutMs: number;
  nextQueue?: string;
};

const PAYMENTS_QUEUE = 'payments';

export function createPaymentAuthorizedHandler({
  store,
  bus,
  logger,
  allowPrepare,
  opTimeoutMs,
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

    const { orderId, address, paymentId } = parsed.data;
    const existing = store.findByOrderId(orderId);

    if (existing) {
      if (existing.status === 'PREPARED' && allowPrepare) {
        logger.info({ orderId }, 'shipment already prepared, skipping duplicate PaymentAuthorized');
        return;
      }

      if (existing.status === 'FAILED' && !allowPrepare) {
        logger.warn?.({ orderId }, 'shipment already failed, skipping duplicate PaymentAuthorized');
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

      const failureEvent = createEventEnvelope({
        eventName: 'ShipmentFailed',
        traceId: event.traceId,
        correlationId: orderId,
        causationId: event.eventId,
        data: {
          shipmentId,
          orderId,
          reason
        }
      });

      const refundEvent = createEventEnvelope({
        eventName: 'RefundPayment',
        traceId: event.traceId,
        correlationId: orderId,
        causationId: event.eventId,
        data: {
          paymentId,
          orderId,
          reason
        }
      });

      await publishWithRetry(bus, nextQueue, failureEvent, logger);
      await publishWithRetry(bus, nextQueue, refundEvent, logger);
      logger.warn?.({ orderId, shipmentId, reason }, 'shipment preparation failed');
      return;
    }

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

    await publishWithRetry(bus, nextQueue, preparedEvent, logger);
    logger.info({ orderId, shipmentId }, 'shipment prepared');
  };
}
