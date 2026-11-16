import { spawn } from "node:child_process";

const commands = [
  ["run", "dev:api"],
  ["run", "dev:web"],
];
const children = commands.map((args) => spawn("npm", args, { stdio: "inherit", detached: true }));
let stopped = false;
function stop(code = 0) {
  if (stopped) return;
  stopped = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  setTimeout(() => process.exit(code), 500);
}
for (const child of children) child.on("exit", (code) => stop(code || 0));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
