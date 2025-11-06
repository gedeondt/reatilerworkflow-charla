# @reatiler/shared

Paquete de utilidades compartidas entre los servicios del monorepo. Sirve para exponer contratos comunes (DTOs, esquemas Zod y
utilidades de infraestructura) que evitan duplicidad entre dominios.

## Eventos y bus de mensajes

El módulo `event-bus` expone la interfaz `EventBus` junto con dos implementaciones listas para usar:

- `createHttpEventBus(baseUrl)`: cliente HTTP para la message-queue utilizado en producción o tests de integración.
- `createEnvEventBus()`: envoltorio que lee `MESSAGE_QUEUE_URL` (vía `packages/shared/src/env.ts`) y crea el cliente HTTP.
- `FakeEventBus`: implementación en memoria ideal para pruebas unitarias o de integración.

Todos los eventos deben generarse con `createEvent`, que aplica un sobre homogéneo (eventId, timestamps, trazas) y valida el payload
contra los esquemas definidos en `events-schemas.ts` basados en `specs/asyncapi.yaml`:

```ts
import { createEvent, createEnvEventBus, publishWithRetry } from '@reatiler/shared';

const bus = createEnvEventBus();

const event = createEvent(
  'PaymentAuthorized',
  {
    paymentId: 'pay-123',
    orderId: 'ord-1',
    reservationId: 'rsv-9',
    amount: 199.99,
    address: {
      line1: 'Main St 123',
      city: 'Metropolis',
      zip: '12345',
      country: 'AR'
    }
  },
  {
    traceId: 'trace-1',
    correlationId: 'ord-1',
    causationId: 'evt-incoming'
  }
);

await publishWithRetry(bus, 'shipping', event, logger);
```

Al consumir eventos, `parseEvent` aplica la misma validación y devuelve el envelope tipado junto con el payload parseado:

```ts
import { parseEvent } from '@reatiler/shared';

export async function handleShipmentPrepared(event: EventEnvelope) {
  const { envelope, data } = parseEvent('ShipmentPrepared', event);
  // envelope incluye metadata validada, data tiene el tipo inferido según el schema Zod
}
```

Los eventos `ReleaseStock` y `RefundPayment` se incluyen como comandos internos: comparten el mismo sobre y cuentan con el mínimo
de datos para disparar las acciones compensatorias correspondientes.

## Propagación de trazas

`createEvent` obliga a indicar `traceId` y `correlationId`, y opcionalmente `causationId`. Todas las factorías de handlers deben
forwardear:

- `traceId`: idéntico al evento entrante.
- `correlationId`: el identificador de la saga (`orderId` en este caso).
- `causationId`: el `eventId` del evento que originó la acción.

Las pruebas unitarias de cada servicio cubren este contrato para evitar regresiones.

## Logging estructurado

El helper `logEvent(logger, envelope, message, options?)` registra mensajes estructurados con los campos clave del envelope:
`eventName`, `traceId`, `correlationId`, `causationId` y el `service` (si el logger es un child de Pino). Se puede indicar `level`
(`info`, `warn`, `error` o `debug`) y `context` adicional:

```ts
logEvent(logger, envelope, 'payment authorization failed', {
  level: 'warn',
  context: { orderId, paymentId, reason }
});
```

## Workers y health-checks

`startWorker` expone los métodos `start`, `stop`, `isRunning` y `getStatus`. Este último devuelve un objeto con el estado en vivo
de la ejecución:

```ts
const worker = startWorker({
  queueName: 'orders',
  bus: createEnvEventBus(),
  dispatch,
  isProcessed,
  markProcessed,
  pollIntervalMs: 250,
  logger
});

const status = worker.getStatus();
// { running: true, queueName: 'orders', processedCount: 42, lastEventAt: '2024-05-01T10:00:00.000Z' }
```

Los endpoints `/health` de los servicios exponen esta información:

```json
{
  "status": "ok",
  "service": "payments",
  "worker": "up",
  "queueName": "payments",
  "processedCount": 12,
  "lastEventAt": "2024-05-01T10:00:00.000Z"
}
```

De esta manera se evita ruido innecesario en logs (el polling es silencioso con `LOG_LEVEL=warn`) y se cuenta con visibilidad
básica del consumidor de eventos.
