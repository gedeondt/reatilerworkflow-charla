# Message Queue Service

Servicio mínimo in-memory responsable de enrutar eventos entre los dominios Order, Inventory, Payments y Shipping. Sirve como punto de coordinación para la SAGA definida en `docs/scenario.md`.

## Alcance inicial
- API HTTP para publicar y consumir eventos (por definir).
- Almacenamiento temporal en memoria.
- Métricas básicas para trazabilidad (`traceId`, `correlationId`).

## Pendientes
- Definir contratos de publicación y consumo.
- Implementar reenrutamiento basado en destino.
- Preparar hooks para pruebas end-to-end del Evaluator.
