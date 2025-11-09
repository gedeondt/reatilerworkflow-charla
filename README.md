# Reatiler Workflow Monorepo

Monorepo orientado a la simulación de orquestaciones retail siguiendo la filosofía **Spec-as-Source**. Todo el comportamiento del sistema parte de escenarios declarativos escritos en JSON: el *scenario-runner* los ejecuta sobre una cola HTTP, el *visualizer-api* reconstruye las trazas en un almacén clave-valor y el *visualizer-web* o el CLI muestran el flujo vivo. Además, el servicio *scenario-designer* usa OpenAI para asistir en la creación de nuevos escenarios.

## Arquitectura de alto nivel

```mermaid
flowchart LR
    subgraph Spec[Fuentes declarativas]
      A[business/*.json]
      B[scenario-designer]
    end
    subgraph Runtime[Runtime]
      R1[scenario-runner]
      MQ[message-queue]
    end
    subgraph Observabilidad
      VAPI[visualizer-api]
      VS[state-store]
      VCLI[@reatiler/visualizer-cli]
      VWEB[visualizer-web]
    end

    A -- carga inicial --> R1
    B -- escenarios aprobados --> VAPI
    R1 -- publica eventos --> MQ
    MQ -- cola visualizer --> VAPI
    VAPI -- persiste trazas --> VS
    VS --> VWEB
    VAPI --> VWEB
    VAPI --> VCLI
```

- **business/**: escenarios SAGA declarativos que definen dominios, eventos y listeners.【F:business/README.md†L1-L34】
- **services/message-queue**: cola HTTP en memoria con operaciones FIFO (`push`, `pop`, `reset`).【F:services/message-queue/README.md†L1-L23】
- **services/scenario-runner**: interpreta un escenario activo, publica eventos y sincroniza cambios con `visualizer-api`.【F:services/scenario-runner/src/index.ts†L400-L520】
- **services/state-store**: almacén clave-valor por *namespace* usado para conservar trazas históricas.【F:services/state-store/src/index.ts†L1-L83】
- **services/scenario-designer**: API sobre Fastify que genera y refina escenarios usando OpenAI, incluyendo el JSON ejecutable y un evento de arranque opcional.【F:services/scenario-designer/src/index.ts†L1-L920】
- **services/visualizer-api**: ingiere la cola `visualizer`, consolida logs, expone trazas y permite activar escenarios desde disco o desde `scenario-designer`.【F:services/visualizer-api/src/index.ts†L61-L1120】
- **services/visualizer-web**: interfaz React/Tailwind que consume `visualizer-api` y `scenario-designer` para mostrar flujos, logs y estado de drafts.【F:services/visualizer-web/src/api.ts†L1-L120】
- **packages/@reatiler/saga-kernel**: esquema Zod del DSL, cargadores de escenarios y runtime puro utilizado por el runner.【F:packages/saga-kernel/src/schema.ts†L1-L104】
- **packages/@reatiler/shared**: utilidades comunes (bus HTTP, creación/parseo de eventos, logging estructurado, helpers de workers).【F:packages/shared/README.md†L1-L82】
- **packages/@reatiler/visualizer-cli**: interfaz de terminal interactiva para ver la SAGA, cambiar de escenario y revisar trazas recientes.【F:packages/visualizer-cli/src/index.ts†L1-L120】

## Mapa del repositorio

```text
.
├── adr/                     # Architecture Decision Records
├── business/                # Escenarios declarativos por dominio
├── docs/                    # Políticas, agentes y documentación funcional
├── packages/
│   ├── saga-kernel/         # DSL y runtime puro de escenarios
│   ├── shared/              # Utilidades compartidas (eventos, logging, workers)
│   └── visualizer-cli/      # CLI para visualizar ejecuciones en terminal
├── services/
│   ├── message-queue/       # Cola HTTP en memoria
│   ├── scenario-runner/     # Ejecutor del escenario activo
│   ├── scenario-designer/   # Generador asistido de escenarios
│   ├── state-store/         # Almacén KV para trazas
│   ├── visualizer-api/      # API para trazas, logs y gestión de escenarios
│   └── visualizer-web/      # Interfaz web (React + Vite)
├── scripts/                 # Automatizaciones para iniciar la pila
├── specs/                   # Contratos formales (OpenAPI, AsyncAPI, JSON Schema)
└── turbo.json               # Configuración de Turborepo
```

## Requisitos

- Node.js 20
- pnpm 8
- (Opcional) `OPENAI_API_KEY` para utilizar `scenario-designer` y generar nuevos escenarios.【F:services/scenario-designer/src/openaiClient.ts†L1-L61】

## Instalación

```bash
pnpm install
```

## Pila local

Puedes orquestar todos los servicios necesarios para una demo completa con:

```bash
pnpm stack:dev retailer-happy-path
```

El script lanza:

- `message-queue` en `http://localhost:3005`
- `scenario-runner` en `http://localhost:3100`
- `state-store` en `http://localhost:3200`
- `scenario-designer` en `http://localhost:3201`
- `visualizer-api` en `http://localhost:3300`

Añade `--with-web` para arrancar también `visualizer-web` (Vite por defecto en `http://localhost:5173`).【F:scripts/dev-stack.mjs†L1-L47】

También es posible iniciar cada servicio manualmente en terminales independientes usando `pnpm -F <paquete> dev`.

## Escenarios declarativos

1. Elige o crea un archivo JSON en `business/` con la estructura `name`, `version`, `domains`, `events` y `listeners` (ver [business/README.md](business/README.md)).【F:business/README.md†L1-L34】
2. `scenario-runner` carga el escenario activo, arranca el runtime y publica eventos en las colas indicadas por cada dominio.【F:services/scenario-runner/src/index.ts†L400-L520】
3. Si necesitas generar un escenario nuevo, `scenario-designer` permite crear borradores, refinarlos con feedback, generar el JSON final y obtener un ejemplo de evento bootstrap para disparar la SAGA.【F:services/scenario-designer/src/index.ts†L200-L840】
4. `visualizer-api` puede aplicar escenarios desde disco (`business/*.json`) o desde un draft listo en `scenario-designer`, registrando también su procedencia.【F:services/visualizer-api/src/index.ts†L496-L720】

## Visualización y trazas

- `visualizer-api` consume la cola `visualizer` de `message-queue`, normaliza los eventos y los persiste por `traceId` en `state-store`. También expone `/logs`, `/traces`, `/scenario` y `/scenarios` para clientes.【F:services/visualizer-api/src/index.ts†L540-L1020】
- `visualizer-web` consulta esas APIs y permite aplicar escenarios, ver el historial de eventos y revisar el estado de los drafts aprobados.【F:services/visualizer-web/src/api.ts†L1-L120】
- `@reatiler/visualizer-cli` ofrece una experiencia de terminal interactiva: renderiza dominios, escucha la cola `visualizer`, muestra eventos clasificados por tipo y soporta cambio de escenario (`s`).【F:packages/visualizer-cli/src/index.ts†L15-L120】

## Variables de entorno destacadas

| Servicio | Variables |
| --- | --- |
| message-queue | `PORT` (por defecto 3005), `LOG_LEVEL` (`warn`).【F:services/message-queue/src/start.ts†L1-L34】【F:services/message-queue/src/server.ts†L1-L20】 |
| scenario-runner | `PORT`, `SCENARIO_NAME`, `MESSAGE_QUEUE_URL`, `VISUALIZER_API_URL`. Valores por defecto: `3100`, `retailer-happy-path`, `http://localhost:3005`, `http://localhost:3300`.【F:services/scenario-runner/src/env.ts†L1-L14】 |
| scenario-designer | `PORT` (3201), `OPENAI_API_KEY`, `OPENAI_MODEL` (por defecto `gpt-4o`).【F:services/scenario-designer/src/index.ts†L680-L708】【F:services/scenario-designer/src/openaiClient.ts†L1-L61】 |
| state-store | `PORT` (3200).【F:services/state-store/src/index.ts†L73-L81】 |
| visualizer-api | `PORT` (3300), `QUEUE_BASE`, `KV_BASE`, `SCENARIO_NAME`, `SCENARIO_DESIGNER_BASE`.【F:services/visualizer-api/src/index.ts†L61-L1120】 |
| visualizer-web | `VITE_VISUALIZER_API_BASE`, `VITE_SCENARIO_DESIGNER_BASE` (ambas opcionales).【F:services/visualizer-web/src/api.ts†L1-L40】 |

## Flujo principal (happy path)

1. Un evento inicial (por ejemplo, `OrderPlaced`) llega a la cola declarada en el escenario.
2. Los listeners definidos en el JSON ejecutan acciones `set-state` y `emit`, encadenando la SAGA completa.【F:business/retailer-happy-path.json†L1-L78】
3. `scenario-runner` publica cada evento en `message-queue` y espeja una versión resumida en la cola `visualizer`.
4. `visualizer-api` normaliza esos eventos, actualiza el *state-store* y emite logs consultables.
5. CLI o web consumen `/traces` y `/logs` para mostrar el progreso en tiempo real.

## Pruebas

```bash
pnpm test:unit   # ejecuta tests de cada paquete con Turborepo
pnpm test:e2e    # orquesta la suite end-to-end declarada
```

Cada servicio también expone sus propios comandos `test` / `test:unit` cuando se ejecuta con el filtro `-F` correspondiente.

## Filosofía Spec-as-Source

- Las definiciones en `business/` y `specs/` son la fuente de verdad para runtime, visualización y pruebas.【F:business/README.md†L1-L34】
- Ningún servicio implementa lógica de dominio fuera de lo declarado; todo se deriva de los listeners y acciones del DSL.【F:packages/saga-kernel/src/schema.ts†L1-L104】
- Los agentes internos (Generator, Linter, Evaluator) usan estas especificaciones para crear código, validar estilos y ejecutar pruebas automáticas.【F:docs/agents.md†L1-L32】
