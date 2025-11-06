# Message Queue Service

Servicio in-memory responsable de enrutar eventos entre los dominios Order, Inventory, Payments y Shipping.

## Puerto

- `PORT`: 3005 por defecto.

## Variables de entorno

- `PORT`: Puerto HTTP del proceso.
- `LOG_LEVEL`: Nivel de logging de Pino (`info` por defecto).

## Endpoints disponibles

- `GET /health`: Devuelve `{"status":"ok","service":"message-queue"}`.
- `POST /queues/:name/messages`: Publica un `EventEnvelope` en la cola indicada.
- `POST /queues/:name/pop`: Obtiene el siguiente mensaje de la cola (FIFO).

## Ejemplo de verificación

```bash
curl http://localhost:3005/health
```

Respuesta esperada:

```json
{"status":"ok","service":"message-queue"}
```
