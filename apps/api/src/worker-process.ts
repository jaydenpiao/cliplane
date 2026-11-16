import { type ChildProcess, spawn } from "node:child_process";

const active = new Set<ChildProcess>();
function killGroup(child: ChildProcess): void {
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}
export function cancelMediaProcesses(): void {
  for (const child of active) killGroup(child);
}

export function runJsonProcess<T = any>(
  command: string,
  args: string[],
  input: object,
  timeoutMs = 1900000,
  outputLimit = 5_000_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
        NODE_ENV: process.env.NODE_ENV || "development",
        MEDIA_TIMEOUT_SECONDS: process.env.MEDIA_TIMEOUT_SECONDS || "1800",
      },
    });
    active.add(child);
    let output = "",
      failure: Error | undefined;
    const fail = (message: string) => {
      failure ||= new Error(message);
      killGroup(child);
    };
    const timer = setTimeout(() => fail("Media job timed out"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure) return;
      output += chunk.toString();
      if (output.length > outputLimit) fail("Media worker exceeded output limit");
    });
    child.on("error", () => {
      clearTimeout(timer);
      active.delete(child);
      reject(new Error("Python/FFmpeg worker could not start"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      active.delete(child);
      if (failure) {
        reject(failure);
        return;
      }
      if (code !== 0) {
        killGroup(child);
        reject(new Error("Media could not be processed. Use a valid MP4, MOV, MKV or WebM recording."));
        return;
      }
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error("Invalid media worker response"));
      }
    });
    child.stdin.on("error", () => fail("Media worker input failed"));
    child.stdin.end(JSON.stringify(input));
  });
}
