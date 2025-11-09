# Scenario Runner

El servicio **scenario-runner** carga un escenario descrito en `business/*.json`, lo valida con `@reatiler/saga-kernel` y lo ejecuta usando el runtime puro sobre la cola HTTP expuesta por `message-queue`. Además, sincroniza el escenario activo con `visualizer-api` para garantizar que la web y el CLI vean la misma definición.【F:services/scenario-runner/src/index.ts†L400-L520】

## Dependencias en tiempo de ejecución
- `message-queue` (publicación de eventos en las colas declaradas).
- `visualizer-api` (aplicación remota de escenarios y espejado de eventos hacia la cola `visualizer`).

## Demo local

```bash
# en una terminal
pnpm -F message-queue dev
pnpm -F @reatiler/state-store dev
pnpm -F @reatiler/visualizer-api dev

# en otra terminal
pnpm -F scenario-runner dev
```

El runner detectará el escenario configurado en `SCENARIO_NAME` (por defecto `retailer-happy-path`) y empezará a publicar eventos según los listeners declarados. Puedes cambiar de escenario vía `POST /scenario` o desde `visualizer-web` / `visualizer-cli`, que delegan en este endpoint.【F:services/scenario-runner/src/index.ts†L400-L520】【F:services/visualizer-api/src/index.ts†L544-L720】
