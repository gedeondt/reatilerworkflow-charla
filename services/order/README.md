# Order Service

Servicio encargado de gestionar el ciclo de vida de los pedidos.

## API mínima
- `POST /orders`
- `POST /orders/{id}/cancel`
- `GET /orders/{id}`

## Responsabilidades
- Registrar órdenes nuevas y emitir **OrderPlaced**.
- Reaccionar a **PaymentCaptured** para confirmar pedidos.
- Ejecutar compensaciones en caso de fallas (`OrderCancelled`, `OrderFailed`).

## Pendientes
- Definir modelo de dominio y estados.
- Implementar almacenamiento in-memory idempotente.
- Integrar con la Message Queue según los contratos establecidos.
