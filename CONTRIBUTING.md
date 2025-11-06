# Guía de contribución

Gracias por contribuir al monorepo de Reatiler Workflow. Este repositorio se rige por la filosofía Spec-as-Source, por lo que cualquier cambio debe mantener la alineación entre especificaciones, código y pruebas.

## Requisitos previos

- Node.js 20
- pnpm 8+
- Comprensión de los escenarios documentados en `docs/`
- Revisión de las decisiones vigentes en `adr/`

## Flujo de trabajo general

1. Crea una rama a partir de `main`.
2. Actualiza la documentación o la especificación antes o en paralelo al código.
3. Implementa los cambios respetando las políticas descritas en `docs/policies.md`.
4. Ejecuta `pnpm lint`, `pnpm test` y cualquier verificación adicional definida por Turborepo.
5. Abre un Pull Request enlazando cualquier ADR relevante.

## Estándares

- Mantener la idempotencia de endpoints y eventos mediante `requestId` y `eventId`.
- Utilizar Fastify, Zod y Vitest según las guías establecidas.
- No añadir dependencias fuera de las políticas aprobadas.
- Mantener la separación hexagonal mínima entre dominio, aplicación y adaptadores.

## Revisión

Los CODEOWNERS indicados en `CODEOWNERS` deben aprobar los cambios que afecten a sus áreas. Cualquier cambio en `docs/` debe contar con la revisión del equipo de arquitectura.
