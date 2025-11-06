# ADR 0001: Spec-as-Source como principio rector

## Contexto
La organización requiere que todas las implementaciones técnicas reflejen especificaciones vivas para evitar desviaciones y deuda documental.

## Decisión
Adoptar la filosofía **Spec-as-Source** como regla del monorepo. Toda funcionalidad nueva debe partir de una especificación actualizada (documento, contrato, esquema) antes de implementarse.

## Consecuencias
- Los equipos deben versionar especificaciones junto al código.
- Las pipelines validan que el código y las pruebas estén alineados con las specs.
- Cambios sin especificación aprobada serán rechazados.
