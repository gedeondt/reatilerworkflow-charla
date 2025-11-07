# Business Scenario Models

Este directorio contiene descripciones declarativas de escenarios SAGA para el dominio retailer. Los modelos definen una topología de dominios, eventos y listeners que actúan como fuente de verdad independiente de la implementación.

## Formato del fichero JSON

Cada archivo describe un escenario con la siguiente estructura de primer nivel:

- `name` (`string`): nombre del escenario.
- `version` (`number`): versión del contrato.
- `domains` (`array`): dominios que participan en la SAGA. Cada elemento incluye:
  - `id`: identificador lógico del dominio.
  - `queue`: cola principal usada para publicar y consumir eventos de ese dominio.
- `events` (`array`): catálogo de eventos de negocio relevantes para el escenario. Cada elemento define el campo `name` del evento.
- `listeners` (`array`): definición de las reacciones a los eventos. Cada listener describe:
  - `id`: identificador único del listener.
  - `delayMs`: tiempo de espera simulado antes de procesar el evento.
  - `on`: bloque con el `event` que lo dispara.
  - `actions`: lista de acciones ejecutadas cuando se procesa el evento. Las acciones disponibles son:
    - `emit`: publica un nuevo evento (`event`) dirigido a un `toDomain` concreto.
    - `set-state`: actualiza el estado conceptual de un `domain` con un `status` descriptivo.

## Notas

- El campo `delayMs` permite modelar tiempos de procesamiento sin acoplarse a una implementación concreta.
- De momento, el escenario asume que el evento `OrderPlaced` se emite desde un flujo externo (por ejemplo, `POST /orders`). El runtime conectará este origen en una iteración posterior.
- En este paso no existe un runtime que consuma estos ficheros; en iteraciones posteriores se construirá un kernel genérico que interprete este formato.
