# @reatiler/visualizer-cli

CLI interactivo para inspeccionar la ejecución de escenarios del monorepo desde la terminal. Consume la cola `visualizer` de `message-queue`, pinta la evolución de cada dominio y permite cambiar de escenario sin abandonar la consola.【F:packages/visualizer-cli/src/index.ts†L1-L120】

## Requisitos
- Tener el stack local en marcha (`message-queue`, `scenario-runner`, `visualizer-api` y `state-store`). Puedes usar `pnpm stack:dev --with-web` para levantar todo.【F:scripts/dev-stack.mjs†L1-L47】
- Node.js 20 + pnpm.

## Uso

```bash
pnpm -F @reatiler/visualizer-cli dev
```

Funciones disponibles mientras el CLI está activo:

- **Visualización en vivo**: renderiza hasta `--max-traces N` ejecuciones en paralelo, mostrando estados y eventos ordenados por `occurredAt`.
- **Cambio de escenario (`s`)**: abre un menú interactivo con los escenarios registrados por `visualizer-api` (tanto los JSON en `business/` como los generados por `scenario-designer`).
- **Filtrado opcional**: define `VIS_FILTER_ORDER_ID=<id>` para centrarte en una correlación concreta.
- **Integración con scenario-runner**: al cambiar de escenario se llama automáticamente a `POST /scenario` para reiniciar el runtime con la nueva definición.【F:packages/visualizer-cli/src/index.ts†L15-L120】

Variables de entorno relevantes:

| Variable | Descripción |
| --- | --- |
| `MESSAGE_QUEUE_URL` | URL de `message-queue` (por defecto `http://localhost:3005`). |
| `SCENARIO_RUNNER_URL` | URL de `scenario-runner` (por defecto `http://localhost:3100`). |
| `VIS_FILTER_ORDER_ID` | Identificador de correlación para mostrar solo una traza. |

La CLI no consume mensajes definitivos: utiliza `peek` sobre la cola `visualizer`, por lo que los eventos permanecen disponibles para otros consumidores.【F:packages/visualizer-cli/src/index.ts†L15-L120】
