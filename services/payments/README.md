# Payments Service

Servicio responsable de la orquestación de pagos.

## Puerto

- `PORT`: 3003 por defecto.

## Variables de entorno

- `PORT`: Puerto HTTP.
- `MESSAGE_QUEUE_URL`: URL del servicio de colas (predeterminado `http://localhost:3005`).
- `LOG_LEVEL`: Nivel de logging opcional.

## Ejemplo de verificación

```bash
curl http://localhost:3003/health
```

Respuesta esperada:

```json
{"status":"ok","service":"payments"}
```
