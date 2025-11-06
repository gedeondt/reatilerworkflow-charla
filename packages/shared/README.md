# @reatiler/shared

Paquete de utilidades compartidas entre los servicios del monorepo. Servirá para exponer contratos comunes (DTOs, esquemas Zod,
constantes) que eviten duplicidad entre dominios.

## EventBus y workers

El módulo `event-bus` expone la interfaz `EventBus` junto con dos implementaciones:

- `createHttpEventBus(baseUrl)`: utiliza el adaptador HTTP existente para enviar y leer mensajes desde la cola en runtime.
- `FakeEventBus`: implementación en memoria ideal para pruebas unitarias o de integración.

Para mantener idempotencia cada servicio puede instanciar un `ProcessedEventStore`, que guarda los `eventId` ya procesados y permite
consultarlos o reiniciar el estado entre tests.

Finalmente, `startWorker` permite crear un loop de consumo parametrizable:

```ts
const store = new ProcessedEventStore();
const dispatcher = createDispatcher(logger);
const worker = startWorker({
  queueName: 'orders',
  bus: createHttpEventBus(process.env.MESSAGE_QUEUE_URL),
  dispatch: dispatcher.dispatch,
  isProcessed: (eventId) => store.has(eventId),
  markProcessed: (eventId) => store.add(eventId),
  pollIntervalMs: 250,
  logger,
  quietPolling: true
});

worker.start();
```

El controlador devuelve métodos `start`, `stop` e `isRunning` para coordinar el ciclo de vida del consumidor y facilitar su uso en tests. Por defecto `quietPolling` está activado para evitar logs cuando la cola está vacía, pero puede deshabilitarse si se necesita inspeccionar el polling.
