# Escenario principal: Reatiler Workflow Monorepo

Este monorepo cubre cuatro dominios fundamentales para la orquestación de pedidos: **Order**, **Inventory**, **Payments** y **Shipping**. Cada servicio expone una API HTTP mínima y se integra mediante eventos publicados en una cola de mensajes.

## APIs mínimas por dominio

### Order Service
- `POST /orders`
- `POST /orders/{id}/cancel`
- `GET /orders/{id}`

### Inventory Service
- `POST /reservations`
- `POST /reservations/{id}/commit`
- `POST /reservations/{id}/release`
- `GET /reservations/{id}`

### Payments Service
- `POST /payments/authorize`
- `POST /payments/capture`
- `POST /payments/refund`
- `GET /payments/{id}`

### Shipping Service
- `POST /shipments`
- `POST /shipments/{id}/dispatch`
- `GET /shipments/{id}`

## Flujo SAGA (happy path)

1. `POST /orders` → evento **OrderPlaced** enviado a la cola de *inventory*.
2. Inventory crea la reserva → evento **InventoryReserved** enviado a la cola de *payments*.
3. Payments autoriza el pago → evento **PaymentAuthorized** enviado a la cola de *shipping*.
4. Shipping prepara el envío → evento **ShipmentPrepared** enviado a la cola de *payments*.
5. Payments captura el pago → evento **PaymentCaptured** enviado a la cola de *orders*.
6. Order marca el pedido como confirmado → evento **OrderConfirmed** (solo log interno).

## Compensaciones controladas por banderas de entorno

- `ALLOW_RESERVATION=false` ⇒ evento **InventoryReservationFailed** → Order cancela el pedido (**OrderCancelled**).
- `ALLOW_AUTH=false` ⇒ evento **PaymentFailed** → Inventory libera la reserva (**InventoryReleased**) → Order cancela el pedido (**OrderCancelled**).
- `ALLOW_PREPARE=false` ⇒ evento **ShipmentFailed**; si ya hubo captura de pago, generar **PaymentRefunded**; Order finaliza como **OrderFailed** o **OrderCancelled** según corresponda.

## Formato de eventos

Todos los eventos deben seguir el formato JSON:

```json
{
  "eventName": "string",
  "version": 1,
  "eventId": "uuid",
  "traceId": "uuid",
  "correlationId": "orderId",
  "occurredAt": "ISO-8601",
  "causationId": "uuid opcional",
  "data": { /* payload específico del evento */ }
}
```

## No objetivos

- No se modelan catálogos, impuestos ni clientes.
- No se implementan mecanismos de reintentos automáticos.
- Los almacenamientos serán in-memory durante esta fase inicial.
