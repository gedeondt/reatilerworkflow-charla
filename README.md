# Reatiler Workflow Monorepo

Este monorepo establece la semántica base para un ecosistema de microservicios orientado a órdenes dentro de un retailer. Siguiendo la filosofía **Spec-as-Source**, toda la documentación de contexto y decisiones arquitectónicas viven junto al código para garantizar trazabilidad y consistencia.

## Mapa del repositorio

```
.
├── adr/               # Architecture Decision Records
├── docs/              # Escenarios, agentes y políticas globales
├── packages/
│   └── shared/        # Código compartido entre servicios
├── services/
│   ├── inventory/
│   ├── message-queue/
│   ├── order/
│   ├── payments/
│   └── shipping/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

## Instalación

```bash
pnpm install
```

## Arranque local

El entorno local levanta cinco procesos (cola de mensajes más cuatro dominios) mediante Turborepo.

```bash
pnpm i
pnpm dev
curl :3001/health
curl :3005/health
```

Cada servicio expone `/health` devolviendo `{"status":"ok","service":"<nombre>"}` y escucha en los puertos 3001 al 3005.

## Puesta en marcha

Cada servicio contará con scripts de desarrollo orquestados mediante Turborepo. Por ahora, los comandos son placeholders hasta que se implemente la lógica de cada dominio.

```bash
pnpm dev
```

## Filosofía Spec-as-Source

Las especificaciones son la fuente de verdad para implementación, pruebas y operación. Las ADR, políticas y escenarios documentados en este repositorio definen los contratos que los equipos deben respetar. Los agentes automatizados (Generator, Linter y Evaluator) se apoyarán en estas especificaciones para asegurar consistencia y gobernanza.

## Especificaciones

El directorio [`/specs`](./specs/README.md) concentra los contratos OpenAPI, AsyncAPI y JSON Schema. Todo el código de los servicios deberá derivarse exclusivamente de estos archivos, sin endpoints ni mensajes adicionales a los definidos allí.

## SAGA principal

```mermaid
sequenceDiagram
    autonumber
    participant C as Cliente
    participant O as Order Service
    participant MQ as Message Queue
    participant I as Inventory Service
    participant P as Payments Service
    participant S as Shipping Service

    C->>O: POST /orders
    O-->>MQ: OrderPlaced
    MQ-->>I: OrderPlaced
    I-->>MQ: InventoryReserved
    MQ-->>P: InventoryReserved
    P-->>MQ: PaymentAuthorized
    MQ-->>S: PaymentAuthorized
    S-->>MQ: ShipmentPrepared
    MQ-->>P: ShipmentPrepared
    P-->>MQ: PaymentCaptured
    MQ-->>O: PaymentCaptured
    O-->>C: OrderConfirmed
```

## Probar contratos

```bash
pnpm -F order test
pnpm -F inventory test
pnpm -F payments test
pnpm -F shipping test
pnpm -F message-queue test
```

## Smoke manual

```bash
pnpm -F message-queue dev
curl http://localhost:3005/health
curl -X POST http://localhost:3005/queues/test/messages -H 'content-type: application/json' -d '{"eventName":"Ping","version":1,"eventId":"e1","traceId":"t1","correlationId":"c1","occurredAt":"2025-01-01T00:00:00Z","data":{}}'
curl -X POST http://localhost:3005/queues/test:pop -H 'content-type: application/json' --data-raw ''
```
