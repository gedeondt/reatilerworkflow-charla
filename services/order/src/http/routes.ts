import { randomUUID } from 'node:crypto';

import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { EventBus } from '@reatiler/shared';
import { createEventEnvelope } from '@reatiler/shared';

import type { OrderStore } from '../orders.js';
import { CreateOrderReq, Order, OrderIdParams } from './schemas.js';

type RoutesDependencies = {
  bus: EventBus;
  store: OrderStore;
  logger: FastifyInstance['log'];
};

const INVENTORY_QUEUE = 'inventory';

export async function routes(app: FastifyInstance, { bus, store, logger }: RoutesDependencies) {
  app.post('/orders', async (req, reply) => {
    const body = CreateOrderReq.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', details: body.error.issues });
    }

    const { requestId, lines, amount, address } = body.data;
    const orderId = randomUUID();
    const traceId = requestId;

    const order = store.create({
      orderId,
      lines,
      amount,
      address,
      status: 'PLACED',
      traceId,
      requestId
    });

    const event = createEventEnvelope({
      eventName: 'OrderPlaced',
      traceId,
      correlationId: orderId,
      data: {
        orderId,
        lines,
        amount,
        address
      }
    });

    await bus.push(INVENTORY_QUEUE, event);
    logger.info({ orderId, traceId }, 'order placed');

    return reply.code(201).send({ orderId: order.orderId, status: order.status });
  });

  app.post('/orders/:id/cancel', async (req, reply) => {
    const params = OrderIdParams.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'bad_request', details: params.error.issues });
    }
    return reply.code(501).send({ error: 'not_implemented' });
  });

  app.get('/orders/:id', async (req, reply) => {
    const params = OrderIdParams.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'bad_request', details: params.error.issues });
    }

    const order = store.get(params.data.id);

    if (!order) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const payload: z.infer<typeof Order> = {
      orderId: order.orderId,
      lines: order.lines,
      amount: order.amount,
      address: order.address,
      status: order.status
    };

    return reply.code(200).send(payload);
  });
}
