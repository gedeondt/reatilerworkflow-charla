# Inventory Service

Servicio encargado de la gestión de inventario.

## Puerto

- `PORT`: 3002 por defecto.

## Variables de entorno

- `PORT`: Puerto HTTP de escucha.
- `ALLOW_RESERVATION`: Habilita o deshabilita la reserva de stock.
- `WORKER_POLL_MS`: Intervalo (ms) entre polls a la cola.
- `OP_TIMEOUT_MS`: Timeout (ms) para operaciones críticas.
- `LOG_LEVEL`: Nivel de logging opcional.

## Ejemplo de verificación

```bash
curl http://localhost:3002/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "service": "inventory",
  "worker": "up",
  "queueName": "inventory",
  "processedCount": 0,
  "lastEventAt": null
}
```
