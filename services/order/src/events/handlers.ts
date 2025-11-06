import { z } from 'zod';

import type { EventBus, EventEnvelope } from '@reatiler/shared';
import { createEventEnvelope } from '@reatiler/shared';

import type { OrderStore } from '../orders.js';
import { OrderStatus } from '../http/schemas.js';

const PaymentCapturedData = z
  .object({
    paymentId: z.string().min(1),
    orderId: z.string().min(1),
    amount: z.number().positive()
  })
  .strict();

export type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  warn?: (message: unknown, ...args: unknown[]) => void;
  error?: (message: unknown, ...args: unknown[]) => void;
};

export type CreatePaymentCapturedHandlerOptions = {
  store: OrderStore;
  bus: EventBus;
  logger: Logger;
  logQueue?: string;
};

const DEFAULT_LOG_QUEUE = 'orders-log';

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

    const { orderId } = parsed.data;
    const existing = store.get(orderId);

    if (!existing) {
      logger.warn?.({ orderId }, 'order not found when processing PaymentCaptured');
      return;
    }

    if (existing.status === 'CONFIRMED') {
      logger.info({ orderId }, 'order already confirmed, skipping');
      return;
    }

    store.updateStatus(orderId, 'CONFIRMED');

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

    await bus.push(logQueue, confirmationEvent);
    logger.info({ orderId }, 'order confirmed');
  };
}
