# Políticas y guardrails

Estas políticas aseguran consistencia y gobernanza dentro del monorepo.

## Naming y estructura
- Todos los paquetes internos usan el prefijo `@reatiler/`.
- Los servicios viven bajo `services/<nombre>` con código de aplicación en `src/` y scripts en el `package.json` del servicio correspondiente.【F:services/message-queue/package.json†L1-L26】【F:services/scenario-runner/package.json†L1-L26】
- Los escenarios se describen en archivos JSON bajo `business/` y deben seguir el esquema de `@reatiler/saga-kernel`.【F:business/README.md†L1-L34】【F:packages/saga-kernel/src/schema.ts†L1-L104】
- Los eventos se nombran en `PascalCase` y los campos en `camelCase`.

## Límites de importación
- Un servicio solo puede importar desde `packages/shared`, `packages/saga-kernel` o desde su propio árbol.
- Está prohibido importar directamente código de otro servicio.
- Las dependencias externas deben declararse en el `package.json` del servicio o paquete correspondiente.【F:services/visualizer-api/package.json†L1-L26】

## Políticas de dependencias
- Se permiten licencias MIT, Apache-2.0, BSD-2-Clause y BSD-3-Clause.
- Cualquier dependencia nueva requiere validación del equipo de plataforma.
- Está prohibido incluir librerías que recopilen datos sensibles (DLP básica).

## Seguridad y datos
- Los logs estructurados no deben contener datos personales ni financieros. Usa identificadores sintéticos (`orderId`, `reservationId`, etc.) generados como UUID v4.
- Las claves API y secretos se gestionan mediante variables de entorno (`.env` local), nunca se versionan.【F:services/scenario-designer/src/openaiClient.ts†L1-L61】

## Puertos reservados
- message-queue: `3005`
- scenario-runner: `3100`
- state-store: `3200`
- scenario-designer: `3201`
- visualizer-api: `3300`
- visualizer-web (Vite dev server): `5173`

## Cumplimiento
- Las pipelines ejecutan `pnpm lint`, `pnpm test:unit` y `pnpm test:e2e` para validar estilo, contratos y recorridos end-to-end.【F:package.json†L8-L16】
- Cualquier excepción debe documentarse mediante un ADR temporal.
