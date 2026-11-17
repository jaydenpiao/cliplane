import { getEventListeners } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runPreflightCli } from "../scripts/decoder/preflight-cli";
import {
  type DockerCommandRunner,
  type DockerResult,
  runDecoderPreflight,
  runDockerCommand,
} from "../scripts/decoder/runtime-preflight";

const image = `sha256:${"a".repeat(64)}`;
const containerId = "b".repeat(64);
const controllers = "67108864\n50000 100000\n16\n0\n";

// Docker is external and mutates resources. This fake models its argv protocol,
// including identity/ownership, without claiming real controller enforcement.
function engine(
  options: {
    info?: unknown;
    imageInfo?: unknown;
    readback?: string;
    fault?: string;
    cleanupFault?: boolean;
    absenceFault?: boolean;
    ownershipInfo?: unknown;
    collision?: boolean;
    hook?: (stage: string) => void;
  } = {},
) {
  const calls: string[][] = [];
  let label = "";
  let removed = false;
  const runner: DockerCommandRunner = async (args, limits) => {
    const argv = [...args];
    calls.push(argv);
    const stage = args[0] === "container" ? args[1] : args[0];
    options.hook?.(stage);
    if (limits.signal.aborted) throw new Error("private aborted endpoint");
    if (stage === "info")
      return ok(
        JSON.stringify(
          options.info ?? { cgroupVersion: "2", cgroupDriver: "systemd", serverVersion: "29.9.2" },
        ),
      );
    if (stage === "image") return ok(JSON.stringify(options.imageInfo ?? { id: image, volumes: null }));
    if (stage === "create") {
      label = args[args.indexOf("--label") + 1].split("=")[1];
      if (options.fault === "create") return { code: 1, stdout: "" };
      if (options.fault === "oversized") return ok("s".repeat(16385));
      if (options.fault === "bad-id") return ok("private-host-name");
      return ok(`${containerId}\n`);
    }
    if (stage === "start") {
      if (options.fault === "start") throw new Error("private-context token=secret");
      return ok(options.readback ?? controllers);
    }
    if (stage === "inspect") {
      if (removed) return { code: 1, stdout: "", notFound: !options.absenceFault };
      return ok(
        JSON.stringify(
          options.ownershipInfo ?? { id: containerId, owner: options.collision ? "unrelated" : label },
        ),
      );
    }
    if (stage === "rm") {
      if (options.cleanupFault) return { code: 1, stdout: "" };
      removed = true;
      return ok(containerId);
    }
    throw new Error(`unexpected Docker stage ${stage}`);
  };
  return { runner, calls };
}

function ok(stdout: string): DockerResult {
  return { code: 0, stdout };
}

describe("decoder controller preflight (fake engine protocol evidence)", () => {
  it.each([controllers, "67108864\n100000 200000\n16\n0\n"])(
    "passes exact and equivalent CPU readbacks only after owned removal",
    async (readback) => {
      const fake = engine({ readback });
      const report = await runDecoderPreflight({ image, runner: fake.runner });
      expect(report).toMatchObject({
        verdict: "preflight_passed",
        decoderIsolationQualified: false,
        cleanup: "removed",
        observed: { controllers: { memoryMax: "67108864", pidsMax: "16", memorySwapMax: "0" } },
      });
      const create = fake.calls.find((args) => args[1] === "create");
      for (const flag of [
        "--pull=never",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--ipc=none",
        "--log-driver=none",
        "--cgroupns=private",
        "--memory=67108864",
        "--memory-swap=67108864",
        "--cpus=0.5",
        "--pids-limit=16",
        "--user=65534:65534",
        "--ulimit=core=0:0",
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=1048576",
        "--entrypoint=/bin/sh",
        "--workdir=/tmp",
        "--no-healthcheck",
      ])
        expect(create).toContain(flag);
      expect(create).not.toContain("--env");
      expect(create).not.toContain("--volume");
      expect(create).toContain(image);
      expect(fake.calls.at(-2)).toEqual(["container", "rm", "--force", "--", containerId]);
      expect(fake.calls.at(-1)?.slice(-2)).toEqual(["--", containerId]);
    },
  );

  it.each([
    "max\n50000 100000\n16\n0\n",
    "8589934592\n50000 100000\n16\n0\n",
    "67108864\nmax 100000\n16\n0\n",
    "67108864\n200000 100000\n16\n0\n",
    "67108864\n0 100000\n16\n0\n",
    "67108864\n50000 0\n16\n0\n",
    "67108864\n50000 100000\nmax\n0\n",
    "67108864\n50000 100000\n17\n0\n",
    "67108864\n50000 100000\n16\nmax\n",
    "67108864\n50000 100000\n16\n1\n",
    "67108864\n50000 100000\n16\n",
    "67108864\n50000 100000\n16\n0\nextra\n",
    "67108864\n50000 100000\n16\n0 \n",
    "67108864\n50000 100000\n16\n0\n\n",
  ])("rejects missing, unlimited, shared/weaker or malformed readbacks", async (readback) => {
    const fake = engine({ readback });
    const report = await runDecoderPreflight({ image, runner: fake.runner });
    expect(report).toMatchObject({
      verdict: "unsupported",
      reasonCodes: ["controller_mismatch"],
      cleanup: "removed",
    });
  });

  it.each([
    { cgroupVersion: "2", cgroupDriver: "none", serverVersion: "29.9.2" },
    { cgroupVersion: "1", cgroupDriver: "systemd" },
    {},
    { cgroupVersion: "2", cgroupDriver: "unknown" },
  ])("rejects unsupported daemon before image lookup or creation", async (info) => {
    const fake = engine({ info });
    expect(await runDecoderPreflight({ image, runner: fake.runner })).toMatchObject({
      verdict: "unsupported",
      cleanup: "not_needed",
      reasonCodes: ["daemon_unsupported"],
    });
    expect(fake.calls).toHaveLength(1);
  });

  it.each([
    { id: image, volumes: { "/data": {} } },
    { id: `sha256:${"c".repeat(64)}`, volumes: null },
    { id: image },
    { id: image, volumes: [] },
  ])("rejects images with volumes, missing metadata or ID mismatch", async (imageInfo) => {
    const fake = engine({ imageInfo });
    expect(await runDecoderPreflight({ image, runner: fake.runner })).toMatchObject({
      verdict: "unsupported",
      reasonCodes: ["image_unsupported"],
      cleanup: "not_needed",
    });
    expect(fake.calls.some((args) => args[1] === "create")).toBe(false);
  });

  it.each(["ubuntu:latest", "sha256:123", `sha256:${"A".repeat(64)}`, "", `${image};echo secret`])(
    "rejects mutable or malformed images before Docker",
    async (invalidImage) => {
      const fake = engine();
      expect(await runDecoderPreflight({ image: invalidImage, runner: fake.runner })).toMatchObject({
        verdict: "unsupported",
        reasonCodes: ["invalid_arguments"],
      });
      expect(fake.calls).toEqual([]);
    },
  );

  it.each(["create", "start", "oversized", "bad-id"])(
    "cleans an owned identity after %s faults without exposing details",
    async (fault) => {
      const fake = engine({ fault });
      const report = await runDecoderPreflight({ image, runner: fake.runner });
      expect(report.verdict).toBe("unsupported");
      expect(report.cleanup).toBe("removed");
      expect(JSON.stringify(report)).not.toMatch(/private|secret|ssss/);
      const removal = fake.calls.find((args) => args[1] === "rm");
      expect(removal?.at(-1)).toBe(containerId);
      const ownershipLookup = fake.calls.find((args) => args[0] === "container" && args[1] === "inspect");
      if (fault !== "start")
        expect(ownershipLookup?.at(-1)).toMatch(/^cliplane-decoder-preflight-[a-f0-9]{32}$/);
    },
  );

  it("never deletes an unrelated name collision", async () => {
    const fake = engine({ fault: "create", collision: true });
    const report = await runDecoderPreflight({ image, runner: fake.runner });
    expect(report.cleanup).toBe("ownership_unverified");
    expect(fake.calls.some((args) => args[1] === "rm")).toBe(false);
  });

  it.each([{ id: "short", owner: "unrelated" }, { id: "c".repeat(64), owner: "unrelated" }, {}])(
    "never removes an unverified or malformed cleanup identity",
    async (ownershipInfo) => {
      const fake = engine({ ownershipInfo });
      expect(await runDecoderPreflight({ image, runner: fake.runner })).toMatchObject({
        verdict: "unsupported",
        cleanup: "ownership_unverified",
        reasonCodes: ["cleanup_failed"],
      });
      expect(fake.calls.some((args) => args[1] === "rm")).toBe(false);
    },
  );

  it("uses the recovered immutable owned ID even if the generated name is rebound", async () => {
    const fake = engine({ fault: "create" });
    const report = await runDecoderPreflight({ image, runner: fake.runner });
    expect(report.cleanup).toBe("removed");
    const lookup = fake.calls.find((args) => args[0] === "container" && args[1] === "inspect");
    expect(lookup?.at(-1)).toMatch(/^cliplane-decoder-preflight-[a-f0-9]{32}$/);
    expect(fake.calls.filter((args) => args[1] === "rm")).toEqual([
      ["container", "rm", "--force", "--", containerId],
    ]);
    expect(fake.calls.at(-1)?.at(-1)).toBe(containerId);
  });

  it("cannot pass when cleanup fails", async () => {
    const fake = engine({ cleanupFault: true });
    expect(await runDecoderPreflight({ image, runner: fake.runner })).toMatchObject({
      verdict: "unsupported",
      cleanup: "failed",
      reasonCodes: ["cleanup_failed"],
    });
  });

  it("cannot pass when removal cannot be verified by immutable ID", async () => {
    const fake = engine({ absenceFault: true });
    expect(await runDecoderPreflight({ image, runner: fake.runner })).toMatchObject({
      verdict: "unsupported",
      cleanup: "failed",
      reasonCodes: ["cleanup_failed"],
    });
  });

  it("honors cancellation during cleanup while finishing owned removal", async () => {
    const controller = new AbortController();
    const fake = engine({
      hook(stage) {
        if (stage === "rm") controller.abort();
      },
    });
    expect(
      await runDecoderPreflight({ image, runner: fake.runner, signal: controller.signal }),
    ).toMatchObject({ verdict: "unsupported", reasonCodes: ["cancelled"], cleanup: "removed" });
  });

  it("times out active work and gives cleanup a separate bounded attempt", async () => {
    vi.useFakeTimers();
    try {
      const fake = engine();
      const runner: DockerCommandRunner = (args, limits) =>
        args[1] === "start"
          ? new Promise((_resolve, reject) =>
              limits.signal.addEventListener("abort", () => reject(new Error("private timeout")), {
                once: true,
              }),
            )
          : fake.runner(args, limits);
      const pending = runDecoderPreflight({ image, runner });
      await vi.advanceTimersByTimeAsync(30_001);
      expect(await pending).toMatchObject({
        verdict: "unsupported",
        reasonCodes: ["timed_out"],
        cleanup: "removed",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a hung cleanup without passing", async () => {
    vi.useFakeTimers();
    try {
      const fake = engine();
      const runner: DockerCommandRunner = (args, limits) =>
        args[1] === "rm"
          ? new Promise((_resolve, reject) =>
              limits.signal.addEventListener("abort", () => reject(new Error("private cleanup timeout")), {
                once: true,
              }),
            )
          : fake.runner(args, limits);
      const pending = runDecoderPreflight({ image, runner });
      await vi.advanceTimersByTimeAsync(5_001);
      expect(await pending).toMatchObject({
        verdict: "unsupported",
        reasonCodes: ["cleanup_failed"],
        cleanup: "failed",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does no Docker work for pre-abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = engine();
    expect(
      await runDecoderPreflight({ image, runner: fake.runner, signal: controller.signal }),
    ).toMatchObject({ verdict: "unsupported", reasonCodes: ["cancelled"], cleanup: "not_needed" });
    expect(fake.calls).toEqual([]);
  });

  it("cleans after active abort using a fresh bounded signal", async () => {
    const controller = new AbortController();
    const fake = engine({
      hook(stage) {
        if (stage === "start") controller.abort();
      },
    });
    expect(
      await runDecoderPreflight({ image, runner: fake.runner, signal: controller.signal }),
    ).toMatchObject({ verdict: "unsupported", reasonCodes: ["cancelled"], cleanup: "removed" });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("rejects malformed daemon output without leaking unknown fields", async () => {
    const report = await runDecoderPreflight({ image, runner: async () => ok('{"private":"secret"}') });
    expect(report.verdict).toBe("unsupported");
    expect(JSON.stringify(report)).not.toMatch(/private|secret/);
  });

  it("accepts rootless-capable daemon data without leaking unknown fields", async () => {
    const fake = engine({
      info: {
        cgroupVersion: "2",
        cgroupDriver: "cgroupfs",
        serverVersion: "29.9.2-private-account",
        securityOptions: ["name=rootless"],
        private: "secret",
      },
    });
    const report = await runDecoderPreflight({ image, runner: fake.runner });
    expect(report.verdict).toBe("preflight_passed");
    expect(report.observed.daemon).toEqual({ cgroupVersion: "2", cgroupDriver: "cgroupfs" });
    expect(JSON.stringify(report)).not.toMatch(/private|account|secret|rootless/);
  });

  it.each(["not JSON", "x".repeat(16385)])(
    "rejects malformed/oversized info before creating resources",
    async (stdout) => {
      let count = 0;
      const report = await runDecoderPreflight({
        image,
        runner: async () => {
          count++;
          return ok(stdout);
        },
      });
      expect(report).toMatchObject({ verdict: "unsupported", cleanup: "not_needed" });
      expect(count).toBe(1);
      expect(JSON.stringify(report)).not.toContain("not JSON");
    },
  );

  it.each(
    [
      [],
      ["--image", "ubuntu:latest"],
      ["--image", image, "--anything"],
      ["--image", image, "--image", image],
      ["--help", "--image", image],
    ].map((argv) => ({ argv })),
  )("rejects invalid CLI arguments before Docker", async ({ argv }) => {
    const fake = engine();
    const output: string[] = [];
    expect(await runPreflightCli(argv, (line) => output.push(line), fake.runner)).toBe(2);
    expect(JSON.parse(output[0])).toMatchObject({
      reasonCodes: ["invalid_arguments"],
      decoderIsolationQualified: false,
    });
    expect(fake.calls).toEqual([]);
  });

  it("shows help without Docker and emits a single safe report for a valid invocation", async () => {
    const fake = engine();
    const output: string[] = [];
    expect(await runPreflightCli(["--help"], (line) => output.push(line), fake.runner)).toBe(0);
    expect(fake.calls).toEqual([]);
    output.length = 0;
    expect(await runPreflightCli(["--image", image], (line) => output.push(line), fake.runner)).toBe(0);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0]).decoderIsolationQualified).toBe(false);
  });
});

async function withDockerScript(body: string, use: () => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cliplane-docker-protocol-"));
  const priorPath = process.env.PATH;
  try {
    await writeFile(path.join(root, "docker"), `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
    process.env.PATH = `${root}${path.delimiter}${priorPath ?? ""}`;
    await use();
  } finally {
    process.env.PATH = priorPath;
    await rm(root, { recursive: true, force: true });
  }
}

describe("real Docker argv subprocess bounds (local fake executable)", () => {
  it.each(["stdout", "stderr"])("kills excessive %s and returns only a stable failure", async (stream) => {
    await withDockerScript(
      `process.${stream}.write('private-secret'.repeat(2000)); setInterval(() => {}, 1000);`,
      async () => {
        const controller = new AbortController();
        await expect(
          runDockerCommand(["info"], { signal: controller.signal, timeoutMs: 2000, maxOutputBytes: 16384 }),
        ).rejects.toThrow(/^output_limit$/);
        expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      },
    );
  });

  it("kills a hung Docker CLI at the deadline", async () => {
    await withDockerScript("setInterval(() => {}, 1000);", async () => {
      const controller = new AbortController();
      await expect(
        runDockerCommand(["info"], { signal: controller.signal, timeoutMs: 100, maxOutputBytes: 16384 }),
      ).rejects.toThrow(/^timed_out$/);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    });
  });

  it("kills active CLI work on abort and detaches the listener", async () => {
    await withDockerScript("setInterval(() => {}, 1000);", async () => {
      const controller = new AbortController();
      const pending = runDockerCommand(["info"], {
        signal: controller.signal,
        timeoutMs: 2000,
        maxOutputBytes: 16384,
      });
      const rejected = expect(pending).rejects.toThrow(/^cancelled$/);
      controller.abort(new Error("private account detail"));
      await rejected;
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    });
  });

  it.each([true, false])(
    "distinguishes exact immutable-ID absence from private daemon errors: %s",
    async (absent) => {
      const stderr = absent
        ? `Error response from daemon: No such container: ${containerId}\n`
        : "Error response from private endpoint token=secret\n";
      await withDockerScript(
        `process.stdout.write('\\n'); process.stderr.write(${JSON.stringify(stderr)}); process.exitCode = 1;`,
        async () => {
          const controller = new AbortController();
          const result = await runDockerCommand(
            ["container", "inspect", "--format", "{{.Id}}", "--", containerId],
            { signal: controller.signal, timeoutMs: 2000, maxOutputBytes: 16384 },
          );
          expect(result).toEqual({ code: 1, stdout: "\n", notFound: absent });
          expect(JSON.stringify(result)).not.toMatch(/private|secret|endpoint/);
          expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
        },
      );
    },
  );

  it("does not spawn an already aborted Docker invocation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runDockerCommand(["info"], { signal: controller.signal, timeoutMs: 2000, maxOutputBytes: 16384 }),
    ).rejects.toThrow(/^cancelled$/);
  });
});
