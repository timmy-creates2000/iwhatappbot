/**
 * dev.mjs — starts both api-server and app in parallel
 * Run with: npm run dev  OR  node dev.mjs
 * No extra dependencies needed — uses Node's built-in child_process.
 */
import { spawn } from "node:child_process";
import { platform } from "node:process";

const isWin = platform === "win32";
const shell = isWin ? "cmd" : "/bin/sh";
const shellFlag = isWin ? "/c" : "-c";

function run(name, color, command, env = {}) {
  const prefix = `\x1b[${color}m[${name}]\x1b[0m`;
  const child = spawn(shell, [shellFlag, command], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (d) =>
    process.stdout.write(
      d.toString().replace(/^/gm, `${prefix} `)
    )
  );
  child.stderr.on("data", (d) =>
    process.stderr.write(
      d.toString().replace(/^/gm, `${prefix} `)
    )
  );

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${prefix} exited with code ${code}`);
      process.exit(code);
    }
  });

  return child;
}

// Start API server (port 8080 from .env)
run(
  "api",
  "32", // green
  "pnpm --filter @workspace/api-server run dev"
);

// Start frontend (port 5000)
run(
  "app",
  "36", // cyan
  "pnpm --filter @workspace/app run dev",
  { PORT: "5000", BASE_PATH: "/" }
);

console.log("\x1b[33m[dev]\x1b[0m Starting api on :8080 and app on :5000 ...\n");

// Keep process alive
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
