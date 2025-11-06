import { buildServer } from './server';

const app = buildServer();
const port = Number(process.env.PORT ?? 3005);
let shuttingDown = false;

async function start() {
  try {
    await app.listen({ port, host: '0.0.0.0' });
    app.log.info(`listening on ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  app.log.info({ signal }, 'received shutdown signal');
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => {
    void shutdown(signal as NodeJS.Signals);
  });
});

void start();
