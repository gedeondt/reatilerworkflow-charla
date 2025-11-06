import type { z } from 'zod';

import { Order, OrderStatus } from './http/schemas.js';

export type OrderStatusValue = z.infer<typeof OrderStatus>;
export type StoredOrder = z.infer<typeof Order> & {
  traceId: string;
  requestId: string;
};

export type OrderStore = {
  create: (order: StoredOrder) => StoredOrder;
  get: (orderId: string) => StoredOrder | null;
  updateStatus: (orderId: string, status: OrderStatusValue) => StoredOrder | null;
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

    const updated: StoredOrder = { ...current, status };
    orders.set(orderId, updated);
    return updated;
  };

  return {
    create,
    get,
    updateStatus
  };
}
