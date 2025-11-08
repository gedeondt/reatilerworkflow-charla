import { spawn } from "node:child_process";

const scenario = process.env.SCENARIO_NAME || "retailer-happy-path";

function run(name, cmd, args = [], env = {}) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  child.on("exit", (code) => {
    console.log(`\n[${name}] exited with code ${code}\n`);
  });
  return child;
}

// --- servicios base ---
run("queue", "pnpm", ["-F", "message-queue", "dev"]);
run("runner", "pnpm", ["-F", "scenario-runner", "dev"], {
  SCENARIO_NAME: scenario,
});

// --- nuevas piezas ---
run("state-store", "pnpm", ["-F", "@reatiler/state-store", "dev"]);
run("visualizer-api", "pnpm", ["-F", "@reatiler/visualizer-api", "dev"]);

// --- opcional: frontend ---
if (process.argv.includes("--with-web")) {
  run("visualizer-web", "pnpm", ["-F", "@reatiler/visualizer-web", "dev"]);
}

console.log(
  `\n✅ Stack iniciado para escenario '${scenario}'.\n` +
    `Servicios:\n` +
    `- message-queue: http://localhost:3005\n` +
    `- state-store:   http://localhost:3200\n` +
    `- visualizer-api:http://localhost:3300\n` +
    `- scenario-runner: http://localhost:3100\n` +
    `- visualizer-web: http://localhost:5173 (opcional)\n`
);
