import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const NORMAL_MS = 30_000;
const CLEANUP_MS = 5_000;
const OUTPUT_BYTES = 16_384;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const CONTAINER_ID = /^[a-f0-9]{64}$/;
const OWNER_LABEL = "io.cliplane.decoder-preflight";
const INFO_FORMAT =
  '{"cgroupVersion":{{json .CgroupVersion}},"cgroupDriver":{{json .CgroupDriver}},"serverVersion":{{json .ServerVersion}}}';
const IMAGE_FORMAT = '{"id":{{json .Id}},"volumes":{{json .Config.Volumes}}}';
const OWNERSHIP_FORMAT = `{"id":{{json .Id}},"owner":{{json (index .Config.Labels "${OWNER_LABEL}")}}}`;
const PROBE =
  "set -eu; cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/cpu.max /sys/fs/cgroup/pids.max /sys/fs/cgroup/memory.swap.max";

export interface DockerResult {
  code: number;
  stdout: string;
  notFound?: boolean;
}
export interface DockerLimits {
  signal: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
}
export type DockerCommandRunner = (args: readonly string[], limits: DockerLimits) => Promise<DockerResult>;
type Reason =
  | "invalid_arguments"
  | "cancelled"
  | "timed_out"
  | "output_limit"
  | "command_failed"
  | "invalid_response"
  | "daemon_unsupported"
  | "image_unsupported"
  | "controller_mismatch"
  | "cleanup_failed";
type Cleanup = "not_needed" | "removed" | "failed" | "ownership_unverified";
interface Controllers {
  memoryMax: string;
  cpuMax: string;
  pidsMax: string;
  memorySwapMax: string;
}
export interface PreflightReport {
  schemaVersion: 1;
  phase: "controller-preflight";
  verdict: "preflight_passed" | "unsupported";
  decoderIsolationQualified: false;
  requested: { memoryBytes: 67108864; cpuCount: 0.5; pids: 16; swapBytes: 0; tmpfsBytes: 1048576 };
  observed: {
    daemon?: {
      cgroupVersion?: "1" | "2";
      cgroupDriver?: "systemd" | "cgroupfs" | "none";
      serverVersion?: string;
    };
    controllers?: Controllers;
  };
  reasonCodes: Reason[];
  cleanup: Cleanup;
}

class PreflightError extends Error {
  constructor(readonly reason: Reason) {
    super(reason);
  }
}

function report(): PreflightReport {
  return {
    schemaVersion: 1,
    phase: "controller-preflight",
    verdict: "unsupported",
    decoderIsolationQualified: false,
    requested: { memoryBytes: 67108864, cpuCount: 0.5, pids: 16, swapBytes: 0, tmpfsBytes: 1048576 },
    observed: {},
    reasonCodes: [],
    cleanup: "not_needed",
  };
}

function object(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {}
  throw new PreflightError("invalid_response");
}

function controllerValues(text: string): Controllers {
  const rows = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
  if (rows.length !== 4 || rows[0] !== "67108864" || rows[2] !== "16" || rows[3] !== "0")
    throw new PreflightError("controller_mismatch");
  const cpu = /^([1-9][0-9]{0,9}) ([1-9][0-9]{0,9})$/.exec(rows[1]);
  if (!cpu || BigInt(cpu[1]) * 2n !== BigInt(cpu[2])) throw new PreflightError("controller_mismatch");
  return { memoryMax: rows[0], cpuMax: rows[1], pidsMax: rows[2], memorySwapMax: rows[3] };
}

/** Bounded Docker argv execution. Docker connection/context environment remains local;
 * no host environment is forwarded into the helper container. Never return stderr. */
export const runDockerCommand: DockerCommandRunner = (args, limits) =>
  new Promise((resolve, reject) => {
    if (limits.signal.aborted) {
      reject(new PreflightError("cancelled"));
      return;
    }
    const child = spawn("docker", [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let failure: PreflightError | undefined;
    const stop = (reason: Reason) => {
      failure ??= new PreflightError(reason);
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const onAbort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timed_out"), limits.timeoutMs);
    limits.signal.addEventListener("abort", onAbort, { once: true });
    if (limits.signal.aborted) onAbort();
    for (const [stream, capture] of [
      [child.stdout, true],
      [child.stderr, false],
    ] as const) {
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > limits.maxOutputBytes) stop("output_limit");
        else if (capture) stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      });
    }
    const dispose = () => {
      clearTimeout(timer);
      limits.signal.removeEventListener("abort", onAbort);
    };
    child.once("error", () => {
      dispose();
      reject(new PreflightError("command_failed"));
    });
    child.once("close", (code) => {
      dispose();
      if (failure) reject(failure);
      else {
        const target = args.at(-1) ?? "";
        // Exact absence classification only for a requested full immutable ID.
        // Generic inspect failures (including connection/context errors) stay errors.
        const notFound =
          args[0] === "container" &&
          args[1] === "inspect" &&
          CONTAINER_ID.test(target) &&
          code === 1 &&
          stdout.trim() === "" &&
          (stderr === `Error: No such container: ${target}\n` ||
            stderr === `Error response from daemon: No such container: ${target}\n`);
        resolve({ code: code ?? -1, stdout, notFound });
      }
    });
  });

export async function runDecoderPreflight(options: {
  image: string;
  runner?: DockerCommandRunner;
  signal?: AbortSignal;
}): Promise<PreflightReport> {
  const result = report();
  if (!IMAGE_ID.test(options.image)) {
    result.reasonCodes.push("invalid_arguments");
    return result;
  }
  if (options.signal?.aborted) {
    result.reasonCodes.push("cancelled");
    return result;
  }
  const runner = options.runner ?? runDockerCommand;
  const normal = new AbortController();
  let deadlineExpired = false;
  const onAbort = () => normal.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) normal.abort();
  const deadline = Date.now() + NORMAL_MS;
  const timer = setTimeout(() => {
    deadlineExpired = true;
    normal.abort();
  }, NORMAL_MS);
  const token = randomUUID().replaceAll("-", "");
  const name = `cliplane-decoder-preflight-${token}`;
  let created = false;
  let containerId: string | undefined;

  const command = async (
    args: string[],
    signal: AbortSignal,
    end: number,
    requireAbsence = false,
  ): Promise<string> => {
    if (signal.aborted) throw new PreflightError("cancelled");
    const remaining = end - Date.now();
    if (remaining <= 0) throw new PreflightError("timed_out");
    const response = await runner(args, { signal, timeoutMs: remaining, maxOutputBytes: OUTPUT_BYTES });
    if (signal.aborted) throw new PreflightError("cancelled");
    if (Date.now() >= end) throw new PreflightError("timed_out");
    if (Buffer.byteLength(response.stdout) > OUTPUT_BYTES) throw new PreflightError("output_limit");
    if (requireAbsence) {
      if (response.code === 1 && response.notFound === true && response.stdout.trim() === "") return "";
      throw new PreflightError("cleanup_failed");
    }
    if (response.code !== 0) throw new PreflightError("command_failed");
    return response.stdout;
  };
  const run = (args: string[]) => command(args, normal.signal, deadline);
  try {
    const daemon = object(await run(["info", "--format", INFO_FORMAT]));
    result.observed.daemon = {};
    if (daemon.cgroupVersion === "1" || daemon.cgroupVersion === "2")
      result.observed.daemon.cgroupVersion = daemon.cgroupVersion;
    if (
      daemon.cgroupDriver === "systemd" ||
      daemon.cgroupDriver === "cgroupfs" ||
      daemon.cgroupDriver === "none"
    )
      result.observed.daemon.cgroupDriver = daemon.cgroupDriver;
    if (
      typeof daemon.serverVersion === "string" &&
      /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(daemon.serverVersion)
    )
      result.observed.daemon.serverVersion = daemon.serverVersion;
    if (
      daemon.cgroupVersion !== "2" ||
      (daemon.cgroupDriver !== "systemd" && daemon.cgroupDriver !== "cgroupfs")
    )
      throw new PreflightError("daemon_unsupported");
    const localImage = object(await run(["image", "inspect", "--format", IMAGE_FORMAT, options.image]));
    if (
      localImage.id !== options.image ||
      !(
        localImage.volumes === null ||
        (typeof localImage.volumes === "object" &&
          !Array.isArray(localImage.volumes) &&
          localImage.volumes !== null &&
          Object.keys(localImage.volumes).length === 0)
      )
    )
      throw new PreflightError("image_unsupported");
    // Set before awaiting: create can succeed server-side even when the CLI fails.
    created = true;
    const identity = (
      await run([
        "container",
        "create",
        "--pull=never",
        "--name",
        name,
        "--label",
        `${OWNER_LABEL}=${token}`,
        "--network=none",
        "--read-only",
        "--user=65534:65534",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--ipc=none",
        "--log-driver=none",
        "--cgroupns=private",
        "--memory=67108864",
        "--memory-swap=67108864",
        "--cpus=0.5",
        "--pids-limit=16",
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=1048576",
        "--ulimit=core=0:0",
        "--entrypoint=/bin/sh",
        "--workdir=/tmp",
        "--no-healthcheck",
        options.image,
        "-c",
        PROBE,
      ])
    ).trim();
    if (!CONTAINER_ID.test(identity)) throw new PreflightError("invalid_response");
    containerId = identity;
    result.observed.controllers = controllerValues(
      await run(["container", "start", "--attach", containerId]),
    );
  } catch (error) {
    result.reasonCodes.push(
      deadlineExpired
        ? "timed_out"
        : options.signal?.aborted
          ? "cancelled"
          : error instanceof PreflightError
            ? error.reason
            : "command_failed",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    if (created) {
      const cleanup = new AbortController();
      const cleanupTimer = setTimeout(() => cleanup.abort(), CLEANUP_MS);
      const cleanupDeadline = Date.now() + CLEANUP_MS;
      try {
        const owned = object(
          await command(
            ["container", "inspect", "--format", OWNERSHIP_FORMAT, "--", containerId ?? name],
            cleanup.signal,
            cleanupDeadline,
          ),
        );
        if (
          owned.owner !== token ||
          typeof owned.id !== "string" ||
          !CONTAINER_ID.test(owned.id) ||
          (containerId && owned.id !== containerId)
        ) {
          result.cleanup = "ownership_unverified";
        } else {
          await command(["container", "rm", "--force", "--", owned.id], cleanup.signal, cleanupDeadline);
          await command(
            ["container", "inspect", "--format", "{{.Id}}", "--", owned.id],
            cleanup.signal,
            cleanupDeadline,
            true,
          );
          result.cleanup = "removed";
        }
      } catch {
        result.cleanup = "failed";
      } finally {
        clearTimeout(cleanupTimer);
      }
      if (result.cleanup !== "removed") result.reasonCodes.push("cleanup_failed");
    }
  }
  if (options.signal?.aborted && !result.reasonCodes.includes("cancelled"))
    result.reasonCodes.push("cancelled");
  if (result.reasonCodes.length === 0 && result.cleanup === "removed") result.verdict = "preflight_passed";
  return result;
}
