# Modelos de escenarios de negocio

Este directorio almacena la fuente de verdad declarativa para las SAGA retail. Cada archivo JSON describe dominios, eventos y listeners que el runtime interpreta sin lógica adicional. El objetivo es poder versionar la orquestación completa desde aquí y reutilizarla en `scenario-runner`, `visualizer-api`, el CLI y la interfaz web.【F:services/scenario-runner/src/index.ts†L400-L520】【F:services/visualizer-api/src/index.ts†L496-L720】【F:packages/visualizer-cli/src/index.ts†L1-L120】

## Formato del fichero JSON

Cada escenario debe seguir el DSL validado por `@reatiler/saga-kernel`:

- `name` (`string`): nombre del escenario visible para los clientes.
- `version` (`number`): versión incremental del contrato.
- `domains` (`array`): dominios que participan en la SAGA. Cada dominio incluye:
  - `id`: identificador lógico (por ejemplo, `order`).
  - `queue`: cola de `message-queue` usada para publicar y consumir eventos.
- `events` (`array`): catálogo de eventos de negocio relevantes. Cada elemento define `name` y `payloadSchema`.
- `listeners` (`array`): reacciones a los eventos declarados.
  - `id`: identificador único del listener.
  - `on`: bloque con el `event` que lo dispara.
  - `delayMs` (opcional): tiempo simulado antes de procesar el evento.
  - `actions`: lista de acciones a ejecutar. Tipos soportados:
    - `emit`: publica `event` hacia `toDomain`.
    - `set-state`: marca `domain` con el `status` indicado.

### `payloadSchema`: contrato de datos de cada evento

Cada evento debe declarar explícitamente la forma de su payload mediante `payloadSchema`. Este contrato es obligatorio en todos los archivos `business/*.json`, ejemplos y artefactos generados automáticamente. Su propósito es documentar el intercambio de datos entre dominios, habilitar validaciones tempranas y mantener consistencia en toda la plataforma.

Reglas clave:

- Tipos primitivos permitidos: `string`, `number`, `boolean`.
- Arrays permitidos: `string[]`, `number[]`, `boolean[]` o arrays de objetos planos.
- Objetos planos: un único nivel de propiedades cuyos valores sean tipos primitivos o arrays primitivos.
- Arrays de objetos: describen un arreglo homogéneo de objetos planos. No se admiten arrays de arrays ni objetos anidados en más de un nivel.
- Eventos sin datos: deben declarar `payloadSchema: {}`.

Ejemplos:

```jsonc
{
  "name": "OrderPlaced",
  "payloadSchema": {
    "orderId": "string",
    "lines": [
      {
        "sku": "string",
        "qty": "number"
      }
    ],
    "amount": "number",
    "address": {
      "line1": "string",
      "city": "string",
      "zip": "string",
      "country": "string"
    }
  }
}
```

```jsonc
{
  "name": "InventorySynced",
  "payloadSchema": {}
}
```

La validación impide duplicados de dominios, eventos o listeners, verifica la forma de `payloadSchema` y asegura que todas las referencias sean válidas.【F:packages/saga-kernel/src/schema.ts†L1-L420】

### `mapping` en acciones `emit`

Todas las acciones `emit` deben declarar un bloque `mapping` para construir el payload del evento emitido. El DSL comprueba que cada campo del evento destino esté definido y que los orígenes existan, mientras que el runtime aplica la transformación para encadenar los datos.【F:packages/saga-kernel/src/schema.ts†L200-L420】【F:packages/saga-kernel/src/runtime.ts†L60-L180】

Reglas clave:

- Campos escalares: alias directo (`"campo": "campoOrigen"`), `{ "from": "campo" }` o constantes `{ "const": valor }`.
- Objetos planos: `{ "map": { ... } }` con opcional `objectFrom` para señalar el origen.
- Arrays de objetos planos: `{ "arrayFrom": "campoArray", "map": { ... } }`.
- Arrays de primitivos: solo admiten `from` o alias directo; no se permiten constantes.
- Las constantes solo se aplican a campos escalares, incluidos los que viven dentro de objetos o arrays de objetos.

El escenario `retailer-happy-path` muestra cómo propagar identificadores, importes y direcciones con estas reglas en cada salto de la SAGA.【F:business/retailer-happy-path.json†L94-L220】【F:packages/saga-kernel/src/mapping.ts†L1-L220】

## Ciclo de vida

1. Define o edita un archivo en `business/`.
2. `scenario-runner` puede cargarlo automáticamente si se selecciona como escenario activo.
3. `visualizer-api` lo lista en `/scenarios`, permite consultarlo en `/scenario-definition` y habilita su aplicación inmediata.
4. `visualizer-web` y el CLI muestran la información y trazas derivadas del escenario activo.

## Escenarios generados dinámicamente

El servicio `scenario-designer` permite crear borradores asistidos por IA. Una vez que el draft está marcado como `ready`, `visualizer-api` puede aplicarlo y lo registrará como escenario de origen `draft`. El JSON resultante sigue residiendo en memoria del diseñador, pero puede exportarse y versionarse en este directorio si se desea persistirlo.【F:services/scenario-designer/src/index.ts†L440-L840】【F:services/visualizer-api/src/index.ts†L544-L720】
