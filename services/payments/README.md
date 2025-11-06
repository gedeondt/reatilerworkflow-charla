# Payments Service

Servicio responsable de la orquestación de pagos.

## Puerto

- `PORT`: 3003 por defecto.

## Variables de entorno

- `PORT`: Puerto HTTP.
- `ALLOW_AUTH`: Habilita la autorización de pagos.
- `WORKER_POLL_MS`: Intervalo (ms) entre polls del worker.
- `OP_TIMEOUT_MS`: Timeout (ms) para operaciones de pagos.
- `LOG_LEVEL`: Nivel de logging opcional.

## Ejemplo de verificación

```bash
curl http://localhost:3003/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "service": "payments",
  "worker": "up",
  "queueName": "payments",
  "processedCount": 0,
  "lastEventAt": null
}
```
