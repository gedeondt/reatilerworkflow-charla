# Message Queue Service

Servicio HTTP in-memory para administrar colas FIFO de eventos.

## Ejecutar en desarrollo

```bash
pnpm -F message-queue dev
```

## Endpoints

- `GET /health`
- `POST /queues/:name/messages`
- `POST /queues/:name/pop`
- `POST /admin/reset` _(solo para demos/local; reinicia todas las colas, incluida la de visualizer)_

## Ejemplos

```bash
curl -X POST http://localhost:3005/queues/test/messages \
  -H 'content-type: application/json' \
  -d '{"eventName":"Ping","version":1,"eventId":"e1","traceId":"t1","correlationId":"c1","occurredAt":"2025-01-01T00:00:00Z","data":{}}'

curl -X POST http://localhost:3005/queues/test/pop \
  -H 'content-type: application/json' \
  --data-raw ''
```

> En tests usamos `fastify.inject()`; no hace falta lanzar el server aparte.
