# Modelos de escenarios de negocio

Este directorio almacena la fuente de verdad declarativa para las SAGA retail. Cada archivo JSON describe dominios, eventos y listeners que el runtime interpreta sin lógica adicional. El objetivo es poder versionar la orquestación completa desde aquí y reutilizarla en `scenario-runner`, `visualizer-api`, el CLI y la interfaz web.【F:services/scenario-runner/src/index.ts†L400-L520】【F:services/visualizer-api/src/index.ts†L496-L720】【F:packages/visualizer-cli/src/index.ts†L1-L120】

## Formato del fichero JSON

Cada escenario debe seguir el DSL validado por `@reatiler/saga-kernel`:

- `name` (`string`): nombre del escenario visible para los clientes.
- `version` (`number`): versión incremental del contrato.
- `domains` (`array`): dominios que participan en la SAGA. Cada dominio incluye:
  - `id`: identificador lógico (por ejemplo, `order`).
  - `queue`: cola de `message-queue` usada para publicar y consumir eventos.
- `events` (`array`): catálogo de eventos de negocio relevantes. Cada elemento define solo `name`.
- `listeners` (`array`): reacciones a los eventos declarados.
  - `id`: identificador único del listener.
  - `on`: bloque con el `event` que lo dispara.
  - `delayMs` (opcional): tiempo simulado antes de procesar el evento.
  - `actions`: lista de acciones a ejecutar. Tipos soportados:
    - `emit`: publica `event` hacia `toDomain`.
    - `set-state`: marca `domain` con el `status` indicado.

La validación impide duplicados de dominios, eventos o listeners y asegura que todas las referencias sean válidas.【F:packages/saga-kernel/src/schema.ts†L1-L104】

## Ciclo de vida

1. Define o edita un archivo en `business/`.
2. `scenario-runner` puede cargarlo automáticamente si se selecciona como escenario activo.
3. `visualizer-api` lo lista en `/scenarios`, permite consultarlo en `/scenario-definition` y habilita su aplicación inmediata.
4. `visualizer-web` y el CLI muestran la información y trazas derivadas del escenario activo.

## Escenarios generados dinámicamente

El servicio `scenario-designer` permite crear borradores asistidos por IA. Una vez que el draft está marcado como `ready`, `visualizer-api` puede aplicarlo y lo registrará como escenario de origen `draft`. El JSON resultante sigue residiendo en memoria del diseñador, pero puede exportarse y versionarse en este directorio si se desea persistirlo.【F:services/scenario-designer/src/index.ts†L440-L840】【F:services/visualizer-api/src/index.ts†L544-L720】
