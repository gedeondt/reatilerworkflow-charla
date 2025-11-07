# Scenario Runner

El servicio **scenario-runner** carga un escenario descrito en `business/*.json` y lo ejecuta usando `@reatiler/saga-kernel` sobre la cola HTTP proporcionada por `message-queue`. No implementa lógica de dominios; simplemente interpreta lo definido en el escenario.

## Demo local

```bash
# en una terminal
pnpm -F message-queue dev

# en otra
pnpm -F scenario-runner dev
```

En este modo, los eventos se generan únicamente según el flujo definido en `business/retailer-happy-path.json`.
