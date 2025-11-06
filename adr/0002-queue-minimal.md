# ADR 0002: Cola de mensajes mínima compartida

## Contexto
El escenario requiere coordinación entre múltiples servicios mediante eventos, pero la plataforma aún está en fase inicial.

## Decisión
Implementar un servicio de cola de mensajes mínimo, in-memory y compartido entre los dominios, responsable de enrutar eventos según el dominio objetivo.

## Consecuencias
- Simplifica las pruebas end-to-end del flujo SAGA.
- Permite evolucionar hacia una solución persistente sin cambiar contratos de eventos.
- Requiere mantener idempotencia en productores y consumidores para tolerar reenvíos manuales.
