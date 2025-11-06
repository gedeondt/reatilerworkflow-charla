# Order Service

Servicio HTTP encargado de coordinar órdenes de compra.

## Puerto

- `PORT`: 3001 por defecto.

## Variables de entorno

- `PORT`: Puerto HTTP para exponer la API.
- `WORKER_POLL_MS`: Intervalo (ms) entre polls del worker.
- `OP_TIMEOUT_MS`: Timeout (ms) para operaciones de la saga.
- `LOG_LEVEL`: Nivel de logs de Pino (opcional, `info` por defecto).

## Ejemplo de verificación

```bash
curl http://localhost:3001/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "service": "order",
  "worker": "up",
  "queueName": "orders",
  "processedCount": 0,
  "lastEventAt": null
}
```
