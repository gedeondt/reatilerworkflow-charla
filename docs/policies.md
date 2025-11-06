# Políticas y guardrails

Estas políticas aseguran consistencia y gobernanza dentro del monorepo.

## Naming y estructura
- Los paquetes comparten el prefijo `@reatiler/` seguido del nombre del dominio o utilidad.
- Los archivos de cada servicio se organizan en capas mínimas: `app/`, `domain/`, `infra/`.
- Los eventos se nombran en `PascalCase` y los campos en `camelCase`.

## Límites de importación
- Un servicio solo puede importar desde `packages/shared` o desde su propio árbol.
- Está prohibido importar directamente código de otro servicio.
- Las dependencias externas deben declararse en el `package.json` del servicio o paquete correspondiente.

## Políticas de dependencias
- Se permiten licencias MIT, Apache-2.0, BSD-2-Clause y BSD-3-Clause.
- Cualquier dependencia nueva requiere validación del equipo de plataforma.
- Está prohibido incluir librerías que recopilen datos sensibles (DLP básica).

## Reglas de seguridad y datos
- Todos los logs deben omitir datos personales o financieros.
- Los identificadores (orderId, reservationId, paymentId, shipmentId) deben ser UUID v4.
- Las claves API y secretos se gestionan mediante variables de entorno, nunca en el repositorio.

## Puertos reservados
- Order Service: `3001`
- Inventory Service: `3002`
- Payments Service: `3003`
- Shipping Service: `3004`
- Message Queue Service: `3005`

## Cumplimiento
- Las pipelines verifican estas políticas en cada Pull Request.
- Cualquier excepción debe documentarse mediante un ADR temporal.
