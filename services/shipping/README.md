# Shipping Service

Responsable de preparar y despachar envíos derivados de las órdenes confirmadas.

## API mínima
- `POST /shipments`
- `POST /shipments/{id}/dispatch`
- `GET /shipments/{id}`

## Responsabilidades
- Crear envíos ante **PaymentAuthorized**.
- Preparar y despachar envíos (**ShipmentPrepared**, **ShipmentDispatched**).
- Emitir **ShipmentFailed** cuando no se pueda preparar y coordinar reembolsos.

## Pendientes
- Modelar estados del envío con almacenamiento en memoria.
- Integrar con Message Queue usando los contratos definidos.
- Exponer healthchecks y métricas básicas.
