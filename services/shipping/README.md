# Shipping Service

Servicio responsable de preparar envíos.

## Puerto

- `PORT`: 3004 por defecto.

## Variables de entorno

- `PORT`: Puerto HTTP expuesto.
- `ALLOW_PREPARE`: Habilita la preparación de envíos.
- `WORKER_POLL_MS`: Intervalo (ms) entre polls del worker.
- `OP_TIMEOUT_MS`: Timeout (ms) para operaciones de envío.
- `LOG_LEVEL`: Nivel de logging opcional.

## Ejemplo de verificación

```bash
curl http://localhost:3004/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "service": "shipping",
  "worker": "up",
  "queueName": "shipping",
  "processedCount": 0,
  "lastEventAt": null
}
```
