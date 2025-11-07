import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus, createEvent } from '@reatiler/shared';

import { createReservationStore } from '../../inventory/src/reservations.js';
import { createOrderPlacedHandler, createReleaseStockHandler } from '../../inventory/src/events/handlers.js';
import { createPaymentStore } from '../../payments/src/payments.js';
import {
  createInventoryReservedHandler as createPaymentsInventoryReservedHandler,
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

type FlowToggles = {
  allowReservation: boolean;
  allowAuth: boolean;
};

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

const runE2E = process.env.RUN_E2E === 'true';

const createOrderPlacedEvent = () =>
  createEvent(
    'OrderPlaced',
    {
      orderId: 'order-1',
      lines: baseOrderData.lines,
      amount: baseOrderData.amount,
      address: baseOrderData.address
    },
    { traceId: 'trace-1', correlationId: 'order-1' }
  );

function seedOrder(store: ReturnType<typeof createOrderStore>) {
  store.create({
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
}

function buildContext({ allowReservation, allowAuth }: FlowToggles) {
  const bus = new FakeEventBus();
  const inventoryStore = createReservationStore();
  const paymentStore = createPaymentStore();
  const shipmentStore = createShipmentStore();
  const orderStore = createOrderStore();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  seedOrder(orderStore);

  const handlers = {
    inventory: {
      orderPlaced: createOrderPlacedHandler({
        store: inventoryStore,
        bus,
        logger,
        allowReservation,
        opTimeoutMs: 100
      }),
      releaseStock: createReleaseStockHandler({ store: inventoryStore, bus, logger })
    },
    payments: {
      inventoryReserved: createPaymentsInventoryReservedHandler({
        store: paymentStore,
        bus,
        logger,
        allowAuth,
        opTimeoutMs: 100
      }),
      shipmentPrepared: createShipmentPreparedHandler({ store: paymentStore, bus, logger, opTimeoutMs: 100 }),
      refundPayment: createRefundPaymentHandler({ store: paymentStore, bus, logger })
    },
    shipping: {
      success: createPaymentAuthorizedHandler({
        store: shipmentStore,
        bus,
        logger,
        allowPrepare: true,
        opTimeoutMs: 100
      }),
      failure: createPaymentAuthorizedHandler({
        store: shipmentStore,
        bus,
        logger,
        allowPrepare: false,
        opTimeoutMs: 100
      })
    },
    order: {
      inventoryReserved: createOrderInventoryReservedHandler({ store: orderStore, logger }),
      inventoryReservationFailed: createInventoryReservationFailedHandler({ store: orderStore, bus, logger }),
      paymentFailed: createPaymentFailedHandler({ store: orderStore, bus, logger }),
      paymentCaptured: createPaymentCapturedHandler({ store: orderStore, bus, logger }),
      inventoryReleased: createInventoryReleasedHandler({ store: orderStore, bus, logger }),
      paymentRefunded: createPaymentRefundedHandler({ store: orderStore, bus, logger })
    }
  };

  return {
    bus,
    stores: { inventoryStore, paymentStore, shipmentStore, orderStore },
    handlers
  };
}

describe.skipIf(!runE2E)('order saga e2e (fake bus)', () => {
  it('completes the happy path and confirms the order', async () => {
    const ctx = buildContext({ allowReservation: true, allowAuth: true });
    const placed = createOrderPlacedEvent();

    await ctx.handlers.inventory.orderPlaced(placed);

    const inventoryReserved = await ctx.bus.pop('payments');
    expect(inventoryReserved?.eventName).toBe('InventoryReserved');

    await ctx.handlers.payments.inventoryReserved(inventoryReserved!);
    await ctx.handlers.order.inventoryReserved(inventoryReserved!);

    const paymentAuthorized = await ctx.bus.pop('shipping');
    expect(paymentAuthorized?.eventName).toBe('PaymentAuthorized');

    await ctx.handlers.shipping.success(paymentAuthorized!);

    const shipmentPrepared = await ctx.bus.pop('payments');
    expect(shipmentPrepared?.eventName).toBe('ShipmentPrepared');

    await ctx.handlers.payments.shipmentPrepared(shipmentPrepared!);

    const paymentCaptured = await ctx.bus.pop('orders');
    expect(paymentCaptured?.eventName).toBe('PaymentCaptured');

    await ctx.handlers.order.paymentCaptured(paymentCaptured!);

    const confirmation = await ctx.bus.pop('orders');
    expect(confirmation?.eventName).toBe('OrderConfirmed');

    expect(ctx.stores.orderStore.get('order-1')?.status).toBe('CONFIRMED');
  });

  it('smoke: marks the order as failed when inventory cannot reserve stock', async () => {
    const ctx = buildContext({ allowReservation: false, allowAuth: true });
    const placed = createOrderPlacedEvent();

    await ctx.handlers.inventory.orderPlaced(placed);

    const failureForOrders = await ctx.bus.pop('orders');
    const failureForPayments = await ctx.bus.pop('payments');

    expect(failureForOrders?.eventName).toBe('InventoryReservationFailed');
    expect(failureForPayments?.eventName).toBe('InventoryReservationFailed');

    await ctx.handlers.order.inventoryReservationFailed(failureForOrders!);

    expect(ctx.stores.orderStore.get('order-1')?.status).toBe('FAILED');
  });

  it('smoke: cancels the order when payment authorization fails', async () => {
    const ctx = buildContext({ allowReservation: true, allowAuth: false });
    const placed = createOrderPlacedEvent();

    await ctx.handlers.inventory.orderPlaced(placed);

    const inventoryReserved = await ctx.bus.pop('payments');
    await ctx.handlers.payments.inventoryReserved(inventoryReserved!);
    await ctx.handlers.order.inventoryReserved(inventoryReserved!);

    const paymentFailedForOrders = await ctx.bus.pop('orders');
    const paymentFailedForInventory = await ctx.bus.pop('inventory');

    expect(paymentFailedForOrders?.eventName).toBe('PaymentFailed');
    expect(paymentFailedForInventory?.eventName).toBe('PaymentFailed');

    await ctx.handlers.order.paymentFailed(paymentFailedForOrders!);

    const releaseCommand = await ctx.bus.pop('inventory');
    expect(releaseCommand?.eventName).toBe('ReleaseStock');

    await ctx.handlers.inventory.releaseStock(releaseCommand!);

    const releasedEvent = await ctx.bus.pop('orders');
    expect(releasedEvent?.eventName).toBe('InventoryReleased');

    await ctx.handlers.order.inventoryReleased(releasedEvent!);

    expect(ctx.stores.orderStore.get('order-1')?.status).toBe('CANCELLED');
  });

  it('smoke: cancels the order and refunds payment when shipping fails', async () => {
    const ctx = buildContext({ allowReservation: true, allowAuth: true });
    const placed = createOrderPlacedEvent();

    await ctx.handlers.inventory.orderPlaced(placed);

    const inventoryReserved = await ctx.bus.pop('payments');
    await ctx.handlers.payments.inventoryReserved(inventoryReserved!);
    await ctx.handlers.order.inventoryReserved(inventoryReserved!);

    const paymentAuthorized = await ctx.bus.pop('shipping');
    await ctx.handlers.shipping.success(paymentAuthorized!);

    const shipmentPrepared = await ctx.bus.pop('payments');
    expect(shipmentPrepared?.eventName).toBe('ShipmentPrepared');

    await ctx.handlers.payments.shipmentPrepared(shipmentPrepared!);

    const paymentCaptured = await ctx.bus.pop('orders');
    expect(paymentCaptured?.eventName).toBe('PaymentCaptured');

    await ctx.handlers.order.paymentCaptured(paymentCaptured!);
    await ctx.bus.pop('orders');

    await ctx.handlers.shipping.failure(paymentAuthorized!);

    const shipmentFailed = await ctx.bus.pop('payments');
    const refundCommand = await ctx.bus.pop('payments');

    expect(shipmentFailed?.eventName).toBe('ShipmentFailed');
    expect(refundCommand?.eventName).toBe('RefundPayment');

    await ctx.handlers.payments.refundPayment(refundCommand!);

    const paymentRefunded = await ctx.bus.pop('orders');
    expect(paymentRefunded?.eventName).toBe('PaymentRefunded');

    await ctx.handlers.order.paymentRefunded(paymentRefunded!);

    const cancellationLogged = await ctx.bus.pop('orders-log');
    expect(cancellationLogged?.eventName).toBe('OrderCancelled');

    expect(ctx.stores.orderStore.get('order-1')?.status).toBe('CANCELLED');
  });
});
