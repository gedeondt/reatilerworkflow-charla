# Inventory Service

Gestiona reservas de inventario asociadas a órdenes.

## API mínima
- `POST /reservations`
- `POST /reservations/{id}/commit`
- `POST /reservations/{id}/release`
- `GET /reservations/{id}`

## Responsabilidades
- Reservar stock cuando se recibe **OrderPlaced**.
- Confirmar reservas al recibir **PaymentCaptured**.
- Liberar stock ante fallas (**InventoryReleased**, **InventoryReservationFailed**).

## Pendientes
- Modelar inventario in-memory con control de idempotencia.
- Exponer métricas de reservas activas y liberadas.
- Alinear esquemas de eventos compartidos con `packages/shared`.
