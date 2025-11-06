import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus, createEvent } from '@reatiler/shared';
import type { EventEnvelope } from '@reatiler/shared';

import { createPaymentStore } from '../src/payments.js';
import {
  createInventoryReservedHandler,
  createShipmentPreparedHandler,
  createRefundPaymentHandler
} from '../src/events/handlers.js';

const inventoryReservedEvent = (): EventEnvelope =>
  createEvent(
    'InventoryReserved',
    {
      reservationId: 'rsv-1',
      orderId: 'order-1',
      items: [
        {
          sku: 'SKU-1',
          qty: 2
        }
      ],
      amount: 199.99,
      address: {
        line1: 'Main St 123',
        city: 'Metropolis',
        zip: '12345',
        country: 'AR'
      }
    },
    { traceId: 'trace-1', correlationId: 'order-1' }
  );

const shipmentPreparedEvent = (): EventEnvelope =>
  createEvent(
    'ShipmentPrepared',
    {
      shipmentId: 'shp-1',
      orderId: 'order-1',
      address: {
        line1: 'Main St 123',
        city: 'Metropolis',
        zip: '12345',
        country: 'AR'
      }
    },
    { traceId: 'trace-1', correlationId: 'order-1', causationId: 'evt-inventory-reserved' }
  );

describe('payments event handlers', () => {
  it('authorizes a payment and publishes PaymentAuthorized with propagated metadata', async () => {
    const store = createPaymentStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createInventoryReservedHandler({
      store,
      bus,
      logger,
      allowAuth: true,
      opTimeoutMs: 1000
    });

    const incoming = inventoryReservedEvent();
    await handler(incoming);

    const payment = store.findByOrderId('order-1');
    expect(payment).not.toBeNull();
    expect(payment?.status).toBe('AUTHORIZED');

    const published = await bus.pop('shipping');
    expect(published?.eventName).toBe('PaymentAuthorized');
    expect(published?.traceId).toBe(incoming.traceId);
    expect(published?.correlationId).toBe('order-1');
    expect(published?.causationId).toBe(incoming.eventId);
    expect(published?.data).toMatchObject({
      paymentId: expect.any(String),
      reservationId: 'rsv-1'
    });
  });

  it('publishes PaymentFailed when authorization is disabled', async () => {
    const store = createPaymentStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createInventoryReservedHandler({
      store,
      bus,
      logger,
      allowAuth: false,
      opTimeoutMs: 1000
    });

    await handler(inventoryReservedEvent());

    const failureToOrders = await bus.pop('orders');
    const failureToInventory = await bus.pop('inventory');

    expect(failureToOrders?.eventName).toBe('PaymentFailed');
    expect(failureToInventory?.eventName).toBe('PaymentFailed');

    const payment = store.findByOrderId('order-1');
    expect(payment?.status).toBe('FAILED');
  });

  it('captures a payment after shipment prepared and publishes PaymentCaptured', async () => {
    const store = createPaymentStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({
      paymentId: 'pay-1',
      orderId: 'order-1',
      reservationId: 'rsv-1',
      amount: 199.99,
      address: {
        line1: 'Main St 123',
        city: 'Metropolis',
        zip: '12345',
        country: 'AR'
      },
      status: 'AUTHORIZED'
    });

    const handler = createShipmentPreparedHandler({
      store,
      bus,
      logger,
      opTimeoutMs: 1000
    });

    await handler(shipmentPreparedEvent());

    const payment = store.findByOrderId('order-1');
    expect(payment?.status).toBe('CAPTURED');

    const published = await bus.pop('orders');
    expect(published?.eventName).toBe('PaymentCaptured');
    expect(published?.data).toMatchObject({ paymentId: 'pay-1' });
  });

  it('refunds a captured payment and publishes PaymentRefunded', async () => {
    const store = createPaymentStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({
      paymentId: 'pay-2',
      orderId: 'order-2',
      reservationId: 'rsv-2',
      amount: 120,
      address: {
        line1: 'Side St 45',
        city: 'Smallville',
        zip: '67890',
        country: 'AR'
      },
      status: 'CAPTURED'
    });

    const handler = createRefundPaymentHandler({ store, bus, logger });

    const refundCommand = createEvent(
      'RefundPayment',
      {
        paymentId: 'pay-2',
        orderId: 'order-2',
        reason: 'shipment_failed'
      },
      { traceId: 'trace-2', correlationId: 'order-2' }
    );

    await handler(refundCommand);

    const payment = store.findByOrderId('order-2');
    expect(payment?.status).toBe('REFUNDED');

    const published = await bus.pop('orders');
    expect(published?.eventName).toBe('PaymentRefunded');
    expect(published?.data).toMatchObject({ paymentId: 'pay-2', reason: 'shipment_failed' });
    expect(published?.causationId).toBe(refundCommand.eventId);
  });
});
