# Order Service

Servicio HTTP encargado de coordinar órdenes de compra.

## Puerto

- `PORT`: 3001 por defecto.

## Variables de entorno

- `PORT`: Puerto HTTP para exponer la API.
- `MESSAGE_QUEUE_URL`: URL base del servicio de colas (ej. `http://localhost:3005`).
- `LOG_LEVEL`: Nivel de logs de Pino (opcional, `info` por defecto).

## Ejemplo de verificación

```bash
curl http://localhost:3001/health
```

Respuesta esperada:

```json
{"status":"ok","service":"order"}
```
