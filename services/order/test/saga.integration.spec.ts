import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus } from '@reatiler/shared/event-bus';
import type { EventEnvelope } from '@reatiler/shared';

import { createReservationStore } from '../../inventory/src/reservations.js';
import { createOrderPlacedHandler, createReleaseStockHandler } from '../../inventory/src/events/handlers.js';
import { createPaymentStore } from '../../payments/src/payments.js';
import {
  createInventoryReservedHandler,
  createShipmentPreparedHandler,
  createRefundPaymentHandler
} from '../../payments/src/events/handlers.js';
import { createShipmentStore } from '../../shipping/src/shipments.js';
import { createPaymentAuthorizedHandler } from '../../shipping/src/events/handlers.js';
import { createOrderStore } from '../src/orders.js';
import {
  createInventoryReservedHandler as createOrderInventoryReservedHandler,
  createInventoryReservationFailedHandler,
  createPaymentFailedHandler,
  createPaymentCapturedHandler,
  createInventoryReleasedHandler,
  createPaymentRefundedHandler
} from '../src/events/handlers.js';

const baseOrderData = {
  lines: [
    {
      sku: 'SKU-1',
      qty: 1
    }
  ],
  amount: 100,
  address: {
    line1: 'Main St 123',
    city: 'Metropolis',
    zip: '12345',
    country: 'AR'
  }
};

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const createOrderPlacedEvent = (overrides?: Partial<EventEnvelope['data']>): EventEnvelope => ({
  eventName: 'OrderPlaced',
  version: 1,
  eventId: 'evt-order-1',
  traceId: 'trace-1',
  correlationId: 'order-1',
  occurredAt: new Date().toISOString(),
  data: {
    orderId: 'order-1',
    lines: baseOrderData.lines,
    amount: baseOrderData.amount,
    address: baseOrderData.address,
    ...(overrides as Record<string, unknown> | undefined)
  }
});

describe('saga integration', () => {
  it('handles inventory failure and marks order as failed', async () => {
    const bus = new FakeEventBus();
    const inventoryStore = createReservationStore();
    const paymentStore = createPaymentStore();
    const orderStore = createOrderStore();

    orderStore.create({
      orderId: 'order-1',
      ...baseOrderData,
      status: 'PLACED',
      traceId: 'trace-1',
      requestId: 'trace-1',
      reservationId: null,
      paymentId: null,
      shipmentId: null,
      lastFailureReason: null,
      cancellationLogged: false
    });

    const inventoryHandler = createOrderPlacedHandler({
      store: inventoryStore,
      bus,
      logger,
      allowReservation: false,
      opTimeoutMs: 1000
    });

    await inventoryHandler(createOrderPlacedEvent());

    const failureForOrders = await bus.pop('orders');
    const failureForPayments = await bus.pop('payments');

    expect(failureForOrders?.eventName).toBe('InventoryReservationFailed');
    expect(failureForPayments?.eventName).toBe('InventoryReservationFailed');

    const orderFailureHandler = createInventoryReservationFailedHandler({ store: orderStore, bus, logger });
    await orderFailureHandler(failureForOrders!);

    expect(orderStore.get('order-1')?.status).toBe('FAILED');
    expect(paymentStore.findByOrderId('order-1')).toBeNull();
  });

  it('handles payment authorization failure and releases stock', async () => {
    const bus = new FakeEventBus();
    const inventoryStore = createReservationStore();
    const paymentStore = createPaymentStore();
    const shipmentStore = createShipmentStore();
    const orderStore = createOrderStore();

    orderStore.create({
      orderId: 'order-1',
      ...baseOrderData,
      status: 'PLACED',
      traceId: 'trace-1',
      requestId: 'trace-1',
      reservationId: null,
      paymentId: null,
      shipmentId: null,
      lastFailureReason: null,
      cancellationLogged: false
    });

    const inventoryHandler = createOrderPlacedHandler({
      store: inventoryStore,
      bus,
      logger,
      allowReservation: true,
      opTimeoutMs: 1000
    });

    const inventoryReleaseHandler = createReleaseStockHandler({ store: inventoryStore, bus, logger });

    const paymentInventoryHandler = createInventoryReservedHandler({
      store: paymentStore,
      bus,
      logger,
      allowAuth: false,
      opTimeoutMs: 1000
    });

    const orderInventoryHandler = createOrderInventoryReservedHandler({ store: orderStore, logger });
    const orderPaymentFailedHandler = createPaymentFailedHandler({ store: orderStore, bus, logger });
    const orderInventoryReleasedHandler = createInventoryReleasedHandler({ store: orderStore, bus, logger });

    await inventoryHandler(createOrderPlacedEvent());

    const inventoryReserved = await bus.pop('payments');
    await paymentInventoryHandler(inventoryReserved!);

    // Payment failure should notify order and inventory
    const paymentFailedForOrders = await bus.pop('orders');
    const paymentFailedForInventory = await bus.pop('inventory');
    expect(paymentFailedForOrders?.eventName).toBe('PaymentFailed');
    expect(paymentFailedForInventory?.eventName).toBe('PaymentFailed');

    await orderInventoryHandler(inventoryReserved!);
    await orderPaymentFailedHandler(paymentFailedForOrders!);

    const releaseCommand = await bus.pop('inventory');
    expect(releaseCommand?.eventName).toBe('ReleaseStock');

    await inventoryReleaseHandler(releaseCommand!);

    const releasedEvent = await bus.pop('orders');
    expect(releasedEvent?.eventName).toBe('InventoryReleased');

    await orderInventoryReleasedHandler(releasedEvent!);

    expect(orderStore.get('order-1')?.status).toBe('CANCELLED');
    expect(shipmentStore.findByOrderId('order-1')).toBeNull();
  });

  it('handles shipping failure by refunding payment', async () => {
    const bus = new FakeEventBus();
    const inventoryStore = createReservationStore();
    const paymentStore = createPaymentStore();
    const shipmentStore = createShipmentStore();
    const orderStore = createOrderStore();

    orderStore.create({
      orderId: 'order-1',
      ...baseOrderData,
      status: 'PLACED',
      traceId: 'trace-1',
      requestId: 'trace-1',
      reservationId: null,
      paymentId: null,
      shipmentId: null,
      lastFailureReason: null,
      cancellationLogged: false
    });

    const inventoryHandler = createOrderPlacedHandler({
      store: inventoryStore,
      bus,
      logger,
      allowReservation: true,
      opTimeoutMs: 1000
    });

    const paymentInventoryHandler = createInventoryReservedHandler({
      store: paymentStore,
      bus,
      logger,
      allowAuth: true,
      opTimeoutMs: 1000
    });

    const shippingSuccessHandler = createPaymentAuthorizedHandler({
      store: shipmentStore,
      bus,
      logger,
      allowPrepare: true,
      opTimeoutMs: 1000
    });

    const shippingFailureHandler = createPaymentAuthorizedHandler({
      store: shipmentStore,
      bus,
      logger,
      allowPrepare: false,
      opTimeoutMs: 1000
    });

    const paymentShipmentHandler = createShipmentPreparedHandler({ store: paymentStore, bus, logger, opTimeoutMs: 1000 });
    const paymentRefundHandler = createRefundPaymentHandler({ store: paymentStore, bus, logger });

    const orderInventoryHandler = createOrderInventoryReservedHandler({ store: orderStore, logger });
    const orderPaymentCapturedHandler = createPaymentCapturedHandler({ store: orderStore, bus, logger });
    const orderPaymentRefundedHandler = createPaymentRefundedHandler({ store: orderStore, bus, logger });

    await inventoryHandler(createOrderPlacedEvent());

    const inventoryReserved = await bus.pop('payments');
    await paymentInventoryHandler(inventoryReserved!);
    await orderInventoryHandler(inventoryReserved!);

    const paymentAuthorized = await bus.pop('shipping');
    await shippingSuccessHandler(paymentAuthorized!);

    const shipmentPrepared = await bus.pop('payments');
    await paymentShipmentHandler(shipmentPrepared!);

    const paymentCaptured = await bus.pop('orders');
    await orderPaymentCapturedHandler(paymentCaptured!);

    // simulate late shipping failure by toggling to false
    await shippingFailureHandler(paymentAuthorized!);

    const shipmentFailed = await bus.pop('payments');
    const refundCommand = await bus.pop('payments');
    expect(shipmentFailed?.eventName).toBe('ShipmentFailed');
    expect(refundCommand?.eventName).toBe('RefundPayment');

    await paymentRefundHandler(refundCommand!);

    const paymentRefunded = await bus.pop('orders');
    await orderPaymentRefundedHandler(paymentRefunded!);

    expect(orderStore.get('order-1')?.status).toBe('CANCELLED');
  });
});
