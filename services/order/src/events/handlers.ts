import { z } from 'zod';

import type { EventBus, EventEnvelope } from '@reatiler/shared';
import { createEventEnvelope, publishWithRetry } from '@reatiler/shared';

import type { OrderStore } from '../orders.js';
import { OrderStatus } from '../http/schemas.js';

const InventoryReservedData = z
  .object({
    reservationId: z.string().min(1),
    orderId: z.string().min(1)
  })
  .strict();

const InventoryReservationFailedData = z
  .object({
    reservationId: z.string().min(1),
    orderId: z.string().min(1),
    reason: z.string().min(1)
  })
  .strict();

const PaymentFailedData = z
  .object({
    paymentId: z.string().min(1),
    orderId: z.string().min(1),
    reservationId: z.string().min(1),
    reason: z.string().min(1)
  })
  .strict();

const PaymentCapturedData = z
  .object({
    paymentId: z.string().min(1),
    orderId: z.string().min(1),
    amount: z.number().positive()
  })
  .strict();

const InventoryReleasedData = z
  .object({
    reservationId: z.string().min(1),
    orderId: z.string().min(1)
  })
  .strict();

const PaymentRefundedData = z
  .object({
    paymentId: z.string().min(1),
    orderId: z.string().min(1),
    amount: z.number().positive(),
    reason: z.string().min(1)
  })
  .strict();

export type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  warn?: (message: unknown, ...args: unknown[]) => void;
  error?: (message: unknown, ...args: unknown[]) => void;
};

export type CreateInventoryReservedHandlerOptions = {
  store: OrderStore;
  logger: Logger;
};

export type CreateInventoryReservationFailedHandlerOptions = {
  store: OrderStore;
  bus: EventBus;
  logger: Logger;
  logQueue?: string;
};

export type CreatePaymentFailedHandlerOptions = {
  store: OrderStore;
  bus: EventBus;
  logger: Logger;
  inventoryQueue?: string;
};

export type CreatePaymentCapturedHandlerOptions = {
  store: OrderStore;
  bus: EventBus;
  logger: Logger;
  logQueue?: string;
};

export type CreateInventoryReleasedHandlerOptions = {
  store: OrderStore;
  bus: EventBus;
  logger: Logger;
  logQueue?: string;
};

export type CreatePaymentRefundedHandlerOptions = {
  store: OrderStore;
  bus: EventBus;
  logger: Logger;
  logQueue?: string;
};

const DEFAULT_LOG_QUEUE = 'orders-log';
const INVENTORY_QUEUE = 'inventory';

export function createInventoryReservedHandler({
  store,
  logger
}: CreateInventoryReservedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = InventoryReservedData.safeParse(event.data);

    if (!parsed.success) {
      logger.warn?.(
        { eventName: event.eventName, issues: parsed.error.issues },
        'invalid InventoryReserved payload received in order service'
      );
      return;
    }

    const { reservationId, orderId } = parsed.data;
    const order = store.get(orderId);

    if (!order) {
      logger.warn?.({ orderId }, 'order not found when processing InventoryReserved');
      return;
    }

    if (order.reservationId === reservationId) {
      logger.info({ orderId }, 'order already linked to reservation, skipping');
      return;
    }

    store.update(orderId, { reservationId });
    logger.info({ orderId, reservationId }, 'order linked to reservation');
  };
}

export function createInventoryReservationFailedHandler({
  store,
  bus,
  logger,
  logQueue = DEFAULT_LOG_QUEUE
}: CreateInventoryReservationFailedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = InventoryReservationFailedData.safeParse(event.data);

    if (!parsed.success) {
      logger.warn?.(
        { eventName: event.eventName, issues: parsed.error.issues },
        'invalid InventoryReservationFailed payload received in order service'
      );
      return;
    }

    const { orderId, reservationId, reason } = parsed.data;
    const order = store.get(orderId);

    if (!order) {
      logger.warn?.({ orderId }, 'order not found when processing InventoryReservationFailed');
      return;
    }

    if (order.status === 'FAILED' && order.lastFailureReason === reason) {
      logger.info({ orderId }, 'order already marked as failed, skipping');
      return;
    }

    store.update(orderId, {
      status: 'FAILED',
      reservationId,
      lastFailureReason: reason,
      cancellationLogged: true
    });

    const failureEvent = createEventEnvelope({
      eventName: 'OrderFailed',
      traceId: event.traceId,
      correlationId: orderId,
      causationId: event.eventId,
      data: {
        orderId,
        reason
      }
    });

    await publishWithRetry(bus, logQueue, failureEvent, logger);
    logger.warn?.({ orderId, reason }, 'order marked as failed due to inventory failure');
  };
}

export function createPaymentFailedHandler({
  store,
  bus,
  logger,
  inventoryQueue = INVENTORY_QUEUE
}: CreatePaymentFailedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = PaymentFailedData.safeParse(event.data);

    if (!parsed.success) {
      logger.warn?.(
        { eventName: event.eventName, issues: parsed.error.issues },
        'invalid PaymentFailed payload received in order service'
      );
      return;
    }

    const { orderId, paymentId, reservationId, reason } = parsed.data;
    const order = store.get(orderId);

    if (!order) {
      logger.warn?.({ orderId }, 'order not found when processing PaymentFailed');
      return;
    }

    if (
      order.status === 'CANCELLED' &&
      order.paymentId === paymentId &&
      order.reservationId === reservationId &&
      order.lastFailureReason === reason
    ) {
      logger.info({ orderId }, 'order already cancelled due to payment failure, skipping');
      return;
    }

    if (!order.reservationId) {
      logger.warn?.(
        { orderId },
        'reservation id missing when processing PaymentFailed; stock release command might fail'
      );
    }

    store.update(orderId, {
      status: 'CANCELLED',
      paymentId,
      reservationId,
      lastFailureReason: reason,
      cancellationLogged: false
    });

    const releaseEvent = createEventEnvelope({
      eventName: 'ReleaseStock',
      traceId: event.traceId,
      correlationId: orderId,
      causationId: event.eventId,
      data: {
        reservationId,
        orderId
      }
    });

    await publishWithRetry(bus, inventoryQueue, releaseEvent, logger);
    logger.warn?.({ orderId, paymentId, reason }, 'order cancelled due to payment failure');
  };
}

export function createPaymentCapturedHandler({
  store,
  bus,
  logger,
  logQueue = DEFAULT_LOG_QUEUE
}: CreatePaymentCapturedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = PaymentCapturedData.safeParse(event.data);

    if (!parsed.success) {
      logger.warn?.(
        { eventName: event.eventName, issues: parsed.error.issues },
        'invalid PaymentCaptured payload received'
      );
      return;
    }

    const { orderId, paymentId } = parsed.data;
    const existing = store.get(orderId);

    if (!existing) {
      logger.warn?.({ orderId }, 'order not found when processing PaymentCaptured');
      return;
    }

    if (existing.status === 'CONFIRMED') {
      logger.info({ orderId }, 'order already confirmed, skipping');
      return;
    }

    store.update(orderId, {
      status: 'CONFIRMED',
      paymentId,
      cancellationLogged: false
    });

    const confirmationEvent = createEventEnvelope({
      eventName: 'OrderConfirmed',
      traceId: event.traceId,
      correlationId: orderId,
      causationId: event.eventId,
      data: {
        orderId,
        status: OrderStatus.enum.CONFIRMED
      }
    });

    await publishWithRetry(bus, logQueue, confirmationEvent, logger);
    logger.info({ orderId }, 'order confirmed');
  };
}

export function createInventoryReleasedHandler({
  store,
  bus,
  logger,
  logQueue = DEFAULT_LOG_QUEUE
}: CreateInventoryReleasedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = InventoryReleasedData.safeParse(event.data);

    if (!parsed.success) {
      logger.warn?.(
        { eventName: event.eventName, issues: parsed.error.issues },
        'invalid InventoryReleased payload received in order service'
      );
      return;
    }

    const { orderId } = parsed.data;
    const order = store.get(orderId);

    if (!order) {
      logger.warn?.({ orderId }, 'order not found when processing InventoryReleased');
      return;
    }

    if (order.status !== 'CANCELLED') {
      logger.info({ orderId }, 'order not cancelled, ignoring InventoryReleased');
      return;
    }

    if (order.cancellationLogged) {
      logger.info({ orderId }, 'order cancellation already logged, skipping');
      return;
    }

    store.update(orderId, { cancellationLogged: true });

    const cancelledEvent = createEventEnvelope({
      eventName: 'OrderCancelled',
      traceId: event.traceId,
      correlationId: orderId,
      causationId: event.eventId,
      data: {
        orderId,
        reason: order.lastFailureReason ?? 'payment_failed'
      }
    });

    await publishWithRetry(bus, logQueue, cancelledEvent, logger);
    logger.info({ orderId }, 'order cancellation logged after inventory release');
  };
}

export function createPaymentRefundedHandler({
  store,
  bus,
  logger,
  logQueue = DEFAULT_LOG_QUEUE
}: CreatePaymentRefundedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = PaymentRefundedData.safeParse(event.data);

    if (!parsed.success) {
      logger.warn?.(
        { eventName: event.eventName, issues: parsed.error.issues },
        'invalid PaymentRefunded payload received in order service'
      );
      return;
    }

    const { orderId, paymentId, reason } = parsed.data;
    const order = store.get(orderId);

    if (!order) {
      logger.warn?.({ orderId }, 'order not found when processing PaymentRefunded');
      return;
    }

    if (order.cancellationLogged && order.status === 'CANCELLED') {
      logger.info({ orderId }, 'order cancellation already processed, skipping PaymentRefunded');
      return;
    }

    store.update(orderId, {
      status: 'CANCELLED',
      paymentId,
      lastFailureReason: reason,
      cancellationLogged: true
    });

    const cancelledEvent = createEventEnvelope({
      eventName: 'OrderCancelled',
      traceId: event.traceId,
      correlationId: orderId,
      causationId: event.eventId,
      data: {
        orderId,
        reason
      }
    });

    await publishWithRetry(bus, logQueue, cancelledEvent, logger);
    logger.warn?.({ orderId, paymentId, reason }, 'order cancelled after payment refund');
  };
}
