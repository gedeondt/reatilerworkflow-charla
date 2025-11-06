# Shipping Service

Servicio responsable de preparar envíos.

## Puerto

- `PORT`: 3004 por defecto.

## Variables de entorno

- `PORT`: Puerto HTTP expuesto.
- `MESSAGE_QUEUE_URL`: URL del servicio de colas (por defecto `http://localhost:3005`).
- `LOG_LEVEL`: Nivel de logging opcional.

## Ejemplo de verificación

```bash
curl http://localhost:3004/health
```

Respuesta esperada:

```json
{"status":"ok","service":"shipping"}
```
