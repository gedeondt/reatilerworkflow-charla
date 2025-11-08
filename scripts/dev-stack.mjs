import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import process from 'node:process';

export const waitFor = async (
  url,
  { timeoutMs = 60_000, intervalMs = 1_000 } = {},
) => {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    let finished = false;

    const ensureDone = (action) => {
      if (finished) {
        return true;
      }
      if (Date.now() > deadline) {
        finished = true;
        reject(new Error(`Timed out waiting for ${url} after ${timeoutMs}ms`));
        return true;
      }
      if (action === 'resolve') {
        finished = true;
        resolve();
        return true;
      }
      return false;
    };

    const scheduleNextAttempt = () => {
      if (ensureDone()) {
        return;
      }
      setTimeout(attempt, intervalMs);
    };

    const attempt = () => {
      if (ensureDone()) {
        return;
      }

      const request = client.get(target, (response) => {
        const { statusCode = 0 } = response;
        response.resume();

        if (statusCode >= 200 && statusCode < 500) {
          ensureDone('resolve');
          return;
        }

        scheduleNextAttempt();
      });

      request.on('error', () => {
        scheduleNextAttempt();
      });
    };

    attempt();
  });
};

const [, , scenarioArg] = process.argv;
const scenarioName = scenarioArg ?? 'retailer-happy-path';

console.log(`Starting stack with scenario "${scenarioName}".`);

const childProcesses = [];
let shuttingDown = false;

const shutdown = ({ code = 0, signal } = {}) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  const signalToSend = signal ?? 'SIGTERM';

  for (const { child, name } of childProcesses) {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill(signalToSend);
      } catch (error) {
        console.error(`Failed to send ${signalToSend} to ${name}:`, error);
      }
    }
  }

  setTimeout(() => {
    process.exit(code);
  }, 100);
};

const registerChild = (name, child) => {
  childProcesses.push({ name, child });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (name === 'visualizer-cli' && code && code !== 0) {
      console.error(
        `${name} exited with code ${code}. Terminating remaining services...`,
      );
      shutdown({ code });
      return;
    }

    if (code !== null) {
      if (code === 0) {
        console.log(`${name} exited with code 0. Shutting down stack.`);
        shutdown({ code: 0 });
      } else {
        console.error(`${name} exited with code ${code}. Shutting down stack.`);
        shutdown({ code });
      }
    } else if (signal) {
      console.log(`${name} exited due to signal ${signal}. Shutting down stack.`);
      shutdown({ code: 0, signal });
    } else {
      shutdown({ code: 0 });
    }
  });

  child.on('error', (error) => {
    console.error(`${name} failed to start:`, error);
    shutdown({ code: 1 });
  });
};

const spawnService = (name, args, env) => {
  const child = spawn('pnpm', args, {
    stdio: 'inherit',
    env,
    shell: true,
  });
  registerChild(name, child);
  return child;
};

const startStack = async () => {
  try {
    spawnService('message-queue', ['-F', 'message-queue', 'dev'], {
      ...process.env,
    });

    try {
      await waitFor('http://localhost:3005/health');
    } catch (error) {
      console.error('message-queue did not become ready:', error);
      shutdown({ code: 1 });
      return;
    }

    spawnService(
      'scenario-runner',
      ['-F', 'scenario-runner', 'dev'],
      {
        ...process.env,
        SCENARIO_NAME: scenarioName,
      },
    );

    try {
      await waitFor('http://localhost:3100/scenarios');
    } catch (error) {
      console.error('scenario-runner did not become ready:', error);
      shutdown({ code: 1 });
      return;
    }

    spawnService(
      'visualizer-cli',
      ['-F', '@reatiler/visualizer-cli', 'dev'],
      {
        ...process.env,
        SCENARIO_NAME: scenarioName,
      },
    );
  } catch (error) {
    console.error('Failed to start dev stack:', error);
    shutdown({ code: 1 });
  }
};

startStack();

const handleSignal = (signal) => {
  console.log(`Received ${signal}. Shutting down stack...`);
  shutdown({ code: 0, signal });
};

process.on('SIGINT', handleSignal);
process.on('SIGTERM', handleSignal);
