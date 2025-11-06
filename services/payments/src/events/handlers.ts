import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { EventBus, EventEnvelope } from '@reatiler/shared';
import { createEventEnvelope, publishWithRetry, withTimeout } from '@reatiler/shared';

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

const RefundPaymentData = z
  .object({
    paymentId: z.string().min(1),
    orderId: z.string().min(1),
    reason: z.string().min(1)
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
    const parsed = InventoryReservedData.safeParse(event.data);

    if (!parsed.success) {
      logger.warn?.(
        { eventName: event.eventName, issues: parsed.error.issues },
        'invalid InventoryReserved payload received'
      );
      return;
    }

    const { orderId, amount, address, reservationId } = parsed.data;

    if (store.findByOrderId(orderId)) {
      logger.info({ orderId }, 'payment already exists, skipping duplicate InventoryReserved');
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

      const failedEvent = createEventEnvelope({
        eventName: 'PaymentFailed',
        traceId: event.traceId,
        correlationId: orderId,
        causationId: event.eventId,
        data: {
          paymentId,
          orderId,
          reservationId,
          reason
        }
      });

      await Promise.all(
        failureQueues.map((queue) => publishWithRetry(bus, queue, failedEvent, logger))
      );
      logger.warn?.({ orderId, paymentId, reason }, 'payment authorization failed');
      return;
    }

    const authorizedEvent = createEventEnvelope({
      eventName: 'PaymentAuthorized',
      traceId: event.traceId,
      correlationId: orderId,
      causationId: event.eventId,
      data: {
        paymentId,
        orderId,
        reservationId,
        amount,
        address
      }
    });

    await publishWithRetry(bus, nextQueue, authorizedEvent, logger);
    logger.info({ orderId, paymentId }, 'payment authorized');
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

    if (payment.status === 'CAPTURED' || payment.status === 'REFUNDED') {
      logger.info({ orderId }, 'payment already captured, skipping duplicate ShipmentPrepared');
      return;
    }

    const capture = async () => {
      store.updateStatus(orderId, 'CAPTURED');
    };

    await withTimeout(Promise.resolve().then(capture), opTimeoutMs);

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

    await publishWithRetry(bus, nextQueue, capturedEvent, logger);
    logger.info({ orderId, paymentId: payment.paymentId }, 'payment captured');
  };
}

export function createRefundPaymentHandler({
  store,
  bus,
  logger,
  nextQueue = ORDERS_QUEUE
}: CreateRefundPaymentHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = RefundPaymentData.safeParse(event.data);

    if (!parsed.success) {
      logger.warn?.(
        { eventName: event.eventName, issues: parsed.error.issues },
        'invalid RefundPayment payload received'
      );
      return;
    }

    const { paymentId, orderId, reason } = parsed.data;
    const payment = store.findByOrderId(orderId);

    if (!payment || payment.paymentId !== paymentId) {
      logger.warn?.({ orderId, paymentId }, 'payment not found when processing RefundPayment');
      return;
    }

    if (payment.status === 'REFUNDED') {
      logger.info({ orderId, paymentId }, 'payment already refunded, skipping');
      return;
    }

    if (payment.status !== 'CAPTURED') {
      logger.warn?.({ orderId, paymentId, status: payment.status }, 'payment not captured, cannot refund');
      return;
    }

    store.updateStatus(orderId, 'REFUNDED');

    const refundedEvent = createEventEnvelope({
      eventName: 'PaymentRefunded',
      traceId: event.traceId,
      correlationId: orderId,
      causationId: event.eventId,
      data: {
        paymentId,
        orderId,
        amount: payment.amount,
        reason
      }
    });

    await publishWithRetry(bus, nextQueue, refundedEvent, logger);
    logger.info({ orderId, paymentId }, 'payment refunded');
  };
}
