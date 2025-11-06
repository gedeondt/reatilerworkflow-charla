# Agentes y mandatos

El monorepo define tres agentes automatizados con responsabilidades complementarias. Cada agente debe acatar las especificaciones y políticas vigentes sin desviarse.

## Generator
- Genera código a partir de especificaciones, plantillas y contratos formales.
- Debe respetar estrictamente los endpoints y eventos definidos en las fuentes de verdad.
- Tiene prohibido inventar endpoints, eventos o campos fuera de la especificación.

## Linter
- Ejecuta ESLint y Prettier para asegurar consistencia de estilo.
- Verifica que se cumplan las fronteras entre servicios y se eviten importaciones cruzadas indebidas.
- Controla la política de dependencias aprobadas y rechaza cualquier paquete no autorizado.

## Evaluator
- Ejecuta suites de pruebas unitarias, de contrato y end-to-end.
- Mantiene golden tests que validan la orquestación completa de la SAGA descrita en `docs/scenario.md`.
- Reporta métricas de calidad y resiliencia para decisiones de despliegue.

## Reglas globales

- Lenguaje principal: TypeScript sobre Node.js 20.
- Framework HTTP: Fastify.
- Validación: Zod.
- Pruebas: Vitest + Supertest.
- Gestor de paquetes: pnpm.
- Monorepo administrado con Turborepo.
- Arquitectura: hexagonal mínima con adaptadores y puertos explícitos.
- Idempotencia garantizada mediante `requestId` y `eventId`.
- Spec-as-Source como filosofía central.
