# Especificaciones de Servicios y Eventos

Este directorio concentra las fuentes de verdad para los contratos entre servicios.

- Los archivos OpenAPI definen los contratos HTTP expuestos por cada microservicio.
- El archivo AsyncAPI describe los eventos publicados y consumidos en la plataforma.
- Los JSON Schema se utilizan para validación (a partir de derivaciones Zod) y para pruebas de contrato automatizadas.

### Puertos reservados

- Order Service: 3001
- Inventory Service: 3002
- Payments Service: 3003
- Shipping Service: 3004
- Message Queue: 3005

No se aceptan endpoints distintos a los listados en estas especificaciones. Todo el código de los servicios deberá generarse a partir de estos contratos.
