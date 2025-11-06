import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus } from '@reatiler/shared/event-bus';
import type { EventEnvelope } from '@reatiler/shared';

import { createPaymentStore } from '../src/payments.js';
import {
  createInventoryReservedHandler,
  createShipmentPreparedHandler
} from '../src/events/handlers.js';

const inventoryReservedEvent = (): EventEnvelope => ({
  eventName: 'InventoryReserved',
  version: 1,
  eventId: 'evt-2',
  traceId: 'trace-1',
  correlationId: 'order-1',
  occurredAt: new Date().toISOString(),
  data: {
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
  }
});

const shipmentPreparedEvent = (): EventEnvelope => ({
  eventName: 'ShipmentPrepared',
  version: 1,
  eventId: 'evt-3',
  traceId: 'trace-1',
  correlationId: 'order-1',
  occurredAt: new Date().toISOString(),
  data: {
    shipmentId: 'shp-1',
    orderId: 'order-1',
    address: {
      line1: 'Main St 123',
      city: 'Metropolis',
      zip: '12345',
      country: 'AR'
    }
  }
});

describe('payments event handlers', () => {
  it('authorizes a payment and publishes PaymentAuthorized', async () => {
    const store = createPaymentStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createInventoryReservedHandler({ store, bus, logger });

    await handler(inventoryReservedEvent());

    const payment = store.findByOrderId('order-1');
    expect(payment).not.toBeNull();
    expect(payment?.status).toBe('AUTHORIZED');
    expect(payment?.address.city).toBe('Metropolis');

    const published = await bus.pop('shipping');
    expect(published).not.toBeNull();
    expect(published?.eventName).toBe('PaymentAuthorized');
    expect(published?.data).toMatchObject({
      paymentId: expect.any(String),
      amount: 199.99,
      address: { city: 'Metropolis' }
    });
  });

  it('does not duplicate PaymentAuthorized for the same event', async () => {
    const store = createPaymentStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handler = createInventoryReservedHandler({ store, bus, logger });
    const event = inventoryReservedEvent();

    await handler(event);
    await handler(event);

    const first = await bus.pop('shipping');
    const second = await bus.pop('shipping');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('captures a payment after shipment prepared and publishes PaymentCaptured', async () => {
    const store = createPaymentStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const paymentId = 'pay-1';
    store.create({
      paymentId,
      orderId: 'order-1',
      amount: 199.99,
      address: {
        line1: 'Main St 123',
        city: 'Metropolis',
        zip: '12345',
        country: 'AR'
      },
      status: 'AUTHORIZED'
    });

    const handler = createShipmentPreparedHandler({ store, bus, logger });

    await handler(shipmentPreparedEvent());

    const payment = store.findByOrderId('order-1');
    expect(payment?.status).toBe('CAPTURED');

    const published = await bus.pop('orders');
    expect(published).not.toBeNull();
    expect(published?.eventName).toBe('PaymentCaptured');
    expect(published?.data).toMatchObject({
      paymentId,
      orderId: 'order-1',
      amount: 199.99
    });
  });

  it('is idempotent when capturing the same shipment', async () => {
    const store = createPaymentStore();
    const bus = new FakeEventBus();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    store.create({
      paymentId: 'pay-2',
      orderId: 'order-2',
      amount: 120,
      address: {
        line1: 'Side St 45',
        city: 'Smallville',
        zip: '67890',
        country: 'AR'
      },
      status: 'AUTHORIZED'
    });

    const handler = createShipmentPreparedHandler({ store, bus, logger });
    const event: EventEnvelope = {
      ...shipmentPreparedEvent(),
      eventId: 'evt-4',
      correlationId: 'order-2',
      data: {
        shipmentId: 'shp-2',
        orderId: 'order-2',
        address: {
          line1: 'Side St 45',
          city: 'Smallville',
          zip: '67890',
          country: 'AR'
        }
      }
    };

    await handler(event);
    await handler(event);

    const first = await bus.pop('orders');
    const second = await bus.pop('orders');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
