import { spawn } from 'node:child_process';
import process from 'node:process';

const [, , scenarioArg] = process.argv;
const scenarioName = scenarioArg ?? 'retailer-happy-path';

console.log(`Starting stack with scenario "${scenarioName}".`);

const childSpecs = [
  {
    name: 'message-queue',
    command: 'pnpm',
    args: ['-F', 'message-queue', 'dev'],
    env: { ...process.env },
  },
  {
    name: 'scenario-runner',
    command: 'pnpm',
    args: ['-F', 'scenario-runner', 'dev'],
    env: { ...process.env, SCENARIO_NAME: scenarioName },
  },
  {
    name: 'visualizer-cli',
    command: 'pnpm',
    args: ['-F', '@reatiler/visualizer-cli', 'dev'],
    env: { ...process.env, SCENARIO_NAME: scenarioName },
  },
];

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

const registerChild = (spec) => {
  const child = spawn(spec.command, spec.args, {
    stdio: 'inherit',
    env: spec.env,
  });

  childProcesses.push({ name: spec.name, child });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (code !== null) {
      if (code === 0) {
        console.log(`${spec.name} exited with code 0. Shutting down stack.`);
        shutdown({ code: 0 });
      } else {
        console.error(`${spec.name} exited with code ${code}. Shutting down stack.`);
        shutdown({ code });
      }
    } else if (signal) {
      console.log(`${spec.name} exited due to signal ${signal}. Shutting down stack.`);
      shutdown({ code: 0, signal });
    } else {
      shutdown({ code: 0 });
    }
  });

  child.on('error', (error) => {
    console.error(`${spec.name} failed to start:`, error);
    shutdown({ code: 1 });
  });
};

for (const spec of childSpecs) {
  registerChild(spec);
}

const handleSignal = (signal) => {
  console.log(`Received ${signal}. Shutting down stack...`);
  shutdown({ code: 0, signal });
};

process.on('SIGINT', handleSignal);
process.on('SIGTERM', handleSignal);
