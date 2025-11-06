import type { EventBus, EventEnvelope, EventName } from '@reatiler/shared';
import { createEvent, logEvent, parseEvent, publishWithRetry } from '@reatiler/shared';

import type { OrderStore } from '../orders.js';
import { OrderStatus } from '../http/schemas.js';

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
  logger
}: CreateInventoryReservedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = safeParse('InventoryReserved', event, logger, 'invalid InventoryReserved payload received in order service');

    if (!parsed) {
      return;
    }

    const { envelope, data } = parsed;
    const { reservationId, orderId } = data;
    const order = store.get(orderId);

    if (!order) {
      logEvent(logger, envelope, 'order not found when processing InventoryReserved', {
        level: 'warn',
        context: { orderId }
      });
      return;
    }

    if (order.reservationId === reservationId) {
      logEvent(logger, envelope, 'order already linked to reservation, skipping', {
        context: { orderId }
      });
      return;
    }

    store.update(orderId, { reservationId });
    logEvent(logger, envelope, 'order linked to reservation', {
      context: { orderId, reservationId }
    });
  };
}

export function createInventoryReservationFailedHandler({
  store,
  bus,
  logger,
  logQueue = DEFAULT_LOG_QUEUE
}: CreateInventoryReservationFailedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = safeParse(
      'InventoryReservationFailed',
      event,
      logger,
      'invalid InventoryReservationFailed payload received in order service'
    );

    if (!parsed) {
      return;
    }

    const { envelope, data } = parsed;
    const { orderId, reservationId, reason } = data;
    const order = store.get(orderId);

    if (!order) {
      logEvent(logger, envelope, 'order not found when processing InventoryReservationFailed', {
        level: 'warn',
        context: { orderId }
      });
      return;
    }

    if (order.status === 'FAILED' && order.lastFailureReason === reason) {
      logEvent(logger, envelope, 'order already marked as failed, skipping', {
        context: { orderId }
      });
      return;
    }

    store.update(orderId, {
      status: 'FAILED',
      reservationId,
      lastFailureReason: reason,
      cancellationLogged: true
    });

    const failureEvent = createEvent(
      'OrderFailed',
      {
        orderId,
        reason
      },
      {
        traceId: envelope.traceId,
        correlationId: orderId,
        causationId: envelope.eventId
      }
    );

    await publishWithRetry(bus, logQueue, failureEvent, logger);
    logEvent(logger, envelope, 'order marked as failed due to inventory failure', {
      level: 'warn',
      context: { orderId, reservationId, reason }
    });
  };
}

export function createPaymentFailedHandler({
  store,
  bus,
  logger,
  inventoryQueue = INVENTORY_QUEUE
}: CreatePaymentFailedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = safeParse('PaymentFailed', event, logger, 'invalid PaymentFailed payload received in order service');

    if (!parsed) {
      return;
    }

    const { envelope, data } = parsed;
    const { orderId, paymentId, reservationId, reason } = data;
    const order = store.get(orderId);

    if (!order) {
      logEvent(logger, envelope, 'order not found when processing PaymentFailed', {
        level: 'warn',
        context: { orderId }
      });
      return;
    }

    if (
      order.status === 'CANCELLED' &&
      order.paymentId === paymentId &&
      order.reservationId === reservationId &&
      order.lastFailureReason === reason
    ) {
      logEvent(logger, envelope, 'order already cancelled due to payment failure, skipping', {
        context: { orderId }
      });
      return;
    }

    if (!order.reservationId) {
      logEvent(logger, envelope, 'reservation id missing when processing PaymentFailed; stock release command might fail', {
        level: 'warn',
        context: { orderId }
      });
    }

    store.update(orderId, {
      status: 'CANCELLED',
      paymentId,
      reservationId,
      lastFailureReason: reason,
      cancellationLogged: false
    });

    const releaseEvent = createEvent(
      'ReleaseStock',
      {
        reservationId,
        orderId
      },
      {
        traceId: envelope.traceId,
        correlationId: orderId,
        causationId: envelope.eventId
      }
    );

    await publishWithRetry(bus, inventoryQueue, releaseEvent, logger);
    logEvent(logger, envelope, 'order cancelled due to payment failure', {
      level: 'warn',
      context: { orderId, paymentId, reservationId, reason }
    });
  };
}

export function createPaymentCapturedHandler({
  store,
  bus,
  logger,
  logQueue = DEFAULT_LOG_QUEUE
}: CreatePaymentCapturedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = safeParse('PaymentCaptured', event, logger, 'invalid PaymentCaptured payload received');

    if (!parsed) {
      return;
    }

    const { envelope, data } = parsed;
    const { orderId, paymentId } = data;
    const existing = store.get(orderId);

    if (!existing) {
      logEvent(logger, envelope, 'order not found when processing PaymentCaptured', {
        level: 'warn',
        context: { orderId }
      });
      return;
    }

    if (existing.status === 'CONFIRMED') {
      logEvent(logger, envelope, 'order already confirmed, skipping', {
        context: { orderId }
      });
      return;
    }

    store.update(orderId, {
      status: 'CONFIRMED',
      paymentId,
      cancellationLogged: false
    });

    const confirmationEvent = createEvent(
      'OrderConfirmed',
      {
        orderId,
        status: OrderStatus.enum.CONFIRMED
      },
      {
        traceId: envelope.traceId,
        correlationId: orderId,
        causationId: envelope.eventId
      }
    );

    await publishWithRetry(bus, logQueue, confirmationEvent, logger);
    logEvent(logger, envelope, 'order confirmed', {
      context: { orderId, paymentId }
    });
  };
}

export function createInventoryReleasedHandler({
  store,
  bus,
  logger,
  logQueue = DEFAULT_LOG_QUEUE
}: CreateInventoryReleasedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = safeParse('InventoryReleased', event, logger, 'invalid InventoryReleased payload received in order service');

    if (!parsed) {
      return;
    }

    const { envelope, data } = parsed;
    const { orderId } = data;
    const order = store.get(orderId);

    if (!order) {
      logEvent(logger, envelope, 'order not found when processing InventoryReleased', {
        level: 'warn',
        context: { orderId }
      });
      return;
    }

    if (order.status !== 'CANCELLED') {
      logEvent(logger, envelope, 'order not cancelled, ignoring InventoryReleased', {
        context: { orderId }
      });
      return;
    }

    if (order.cancellationLogged) {
      logEvent(logger, envelope, 'order cancellation already logged, skipping', {
        context: { orderId }
      });
      return;
    }

    store.update(orderId, { cancellationLogged: true });

    const cancelledEvent = createEvent(
      'OrderCancelled',
      {
        orderId,
        reason: order.lastFailureReason ?? 'payment_failed'
      },
      {
        traceId: envelope.traceId,
        correlationId: orderId,
        causationId: envelope.eventId
      }
    );

    await publishWithRetry(bus, logQueue, cancelledEvent, logger);
    logEvent(logger, envelope, 'order cancellation logged after inventory release', {
      context: { orderId }
    });
  };
}

export function createPaymentRefundedHandler({
  store,
  bus,
  logger,
  logQueue = DEFAULT_LOG_QUEUE
}: CreatePaymentRefundedHandlerOptions) {
  return async (event: EventEnvelope) => {
    const parsed = safeParse('PaymentRefunded', event, logger, 'invalid PaymentRefunded payload received in order service');

    if (!parsed) {
      return;
    }

    const { envelope, data } = parsed;
    const { orderId, paymentId, reason } = data;
    const order = store.get(orderId);

    if (!order) {
      logEvent(logger, envelope, 'order not found when processing PaymentRefunded', {
        level: 'warn',
        context: { orderId }
      });
      return;
    }

    if (order.cancellationLogged && order.status === 'CANCELLED') {
      logEvent(logger, envelope, 'order cancellation already processed, skipping PaymentRefunded', {
        context: { orderId }
      });
      return;
    }

    store.update(orderId, {
      status: 'CANCELLED',
      paymentId,
      lastFailureReason: reason,
      cancellationLogged: true
    });

    const cancelledEvent = createEvent(
      'OrderCancelled',
      {
        orderId,
        reason
      },
      {
        traceId: envelope.traceId,
        correlationId: orderId,
        causationId: envelope.eventId
      }
    );

    await publishWithRetry(bus, logQueue, cancelledEvent, logger);
    logEvent(logger, envelope, 'order cancelled after payment refund', {
      level: 'warn',
      context: { orderId, paymentId, reason }
    });
  };
}
