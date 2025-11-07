# @reatiler/visualizer-cli

CLI ligero para observar las colas del message-queue de Reatiler en modo `peek`.

## Requisitos

Asegúrate de tener el monorepo instalado y los servicios necesarios levantados (por ejemplo, `pnpm dev`).

## Uso

```bash
pnpm -F visualizer-cli dev
```

El comando iniciará un polling cada segundo contra las colas `orders`, `inventory`, `payments` y `shipping` usando `peek=true`. Los eventos detectados se muestran por consola sin consumirlos, por lo que pueden repetirse en las siguientes lecturas.

Puedes sobreescribir la URL del message queue definiendo la variable `MESSAGE_QUEUE_URL`. Si no se establece, se utilizará `http://localhost:3005`.
