import type { z } from 'zod';

import { Order, OrderStatus } from './http/schemas.js';

export type OrderStatusValue = z.infer<typeof OrderStatus>;
export type StoredOrder = z.infer<typeof Order> & {
  traceId: string;
  requestId: string;
  reservationId?: string | null;
  paymentId?: string | null;
  shipmentId?: string | null;
  lastFailureReason?: string | null;
  cancellationLogged?: boolean;
};

export type OrderStore = {
  create: (order: StoredOrder) => StoredOrder;
  get: (orderId: string) => StoredOrder | null;
  updateStatus: (orderId: string, status: OrderStatusValue) => StoredOrder | null;
  update: (orderId: string, updates: Partial<Omit<StoredOrder, 'orderId'>>) => StoredOrder | null;
};

export function createOrderStore(): OrderStore {
  const orders = new Map<string, StoredOrder>();

  const create = (order: StoredOrder): StoredOrder => {
    orders.set(order.orderId, order);
    return order;
  };

  const get = (orderId: string): StoredOrder | null => {
    return orders.get(orderId) ?? null;
  };

  const updateStatus = (orderId: string, status: OrderStatusValue): StoredOrder | null => {
    const current = orders.get(orderId);

    if (!current) {
      return null;
    }

    if (current.status === status) {
      return current;
    }

    return update(orderId, { status });
  };

  const update = (
    orderId: string,
    updates: Partial<Omit<StoredOrder, 'orderId'>>
  ): StoredOrder | null => {
    const current = orders.get(orderId);

    if (!current) {
      return null;
    }

    const { orderId: _, ...rest } = updates as Partial<StoredOrder> & { orderId?: string };
    const updated: StoredOrder = { ...current, ...rest };
    orders.set(orderId, updated);
    return updated;
  };

  return {
    create,
    get,
    updateStatus,
    update
  };
}
