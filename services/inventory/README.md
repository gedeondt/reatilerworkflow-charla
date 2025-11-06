# Inventory Service

Servicio encargado de la gestión de inventario.

## Puerto

- `PORT`: 3002 por defecto.

## Variables de entorno

- `PORT`: Puerto HTTP de escucha.
- `MESSAGE_QUEUE_URL`: URL del servicio de colas (por defecto `http://localhost:3005`).
- `LOG_LEVEL`: Nivel de logging opcional.

## Ejemplo de verificación

```bash
curl http://localhost:3002/health
```

Respuesta esperada:

```json
{"status":"ok","service":"inventory"}
```
