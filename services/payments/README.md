# Payments Service

Orquesta la autorización, captura y reembolsos de pagos asociados a órdenes.

## API mínima
- `POST /payments/authorize`
- `POST /payments/capture`
- `POST /payments/refund`
- `GET /payments/{id}`

## Responsabilidades
- Autorizar pagos cuando Inventory confirma la reserva (**InventoryReserved**).
- Capturar pagos tras la preparación del envío (**ShipmentPrepared**).
- Emitir reembolsos cuando Shipping falle después de capturar (**PaymentRefunded**).

## Pendientes
- Gestionar un store in-memory para transacciones.
- Implementar lógica de compensación según flags de entorno.
- Instrumentar trazas para seguimiento de `traceId` y `correlationId`.
