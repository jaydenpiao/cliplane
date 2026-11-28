import { once } from "node:events";
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnalysisRunnerError } from "../apps/api/src/analysis-client";
import { createIsolatedMediaExecutor } from "../apps/api/src/isolated-media";
import { type MediaAnalysisResult, type MediaRequest, UnsupportedMediaError } from "../apps/api/src/media";
import { ProbeRunnerError } from "../apps/api/src/probe-client";
import { RenderRunnerError } from "../apps/api/src/render-client";
import { defaultEditPlan, type MediaMetadata } from "../packages/domain/src/index";

vi.mock(import("node:fs/promises"), async (importOriginal) => {
  const fs = await importOriginal();
  return { ...fs, link: vi.fn(fs.link) };
});

const sourceBytes = Buffer.from("trusted input bytes");
const metadata: MediaMetadata = {
  durationMs: 2400,
  width: 720,
  height: 1280,
  hasAudio: false,
  fps: 30,
  codec: "h264",
  audioTracks: [],
};
const plan = defaultEditPlan(400, 1800);
const renderRequest = { version: 1, operation: "render", plan };
const analysis: MediaAnalysisResult = {
  metadata,
  candidates: [
    {
      startMs: 200,
      endMs: 1800,
      score: 80,
      components: { audio: 80, scene: 70, boundary: 60 },
      reason: "Activity",
      thumbnail: "thumb-0.jpg",
    },
  ],
  signals: { audioRms: [], sceneTimes: [] },
  telemetry: { wallSeconds: 0.1, sourceHours: 0.001, transcriptionCost: 0, method: "deterministic" },
};
const analysisFiles = {
  "proxy.mp4": "synthetic proxy bytes",
  "poster.jpg": "synthetic poster bytes",
  "thumb-0.jpg": "synthetic thumbnail bytes",
};
const renderFiles = { "render.mp4": "synthetic render bytes" };

let root: string;
let outputRoot: string;
let source: string;
let stopPeer: (() => Promise<void>) | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cliplane-executor-"));
  outputRoot = join(root, "outputs");
  source = join(root, "master.mp4");
  await mkdir(outputRoot, { mode: 0o700 });
  await writeFile(source, sourceBytes);
});

afterEach(async () => {
  await stopPeer?.();
  stopPeer = undefined;
  await rm(root, { recursive: true, force: true });
});

function frame(payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

function jsonFrame(payload: unknown): Buffer {
  return frame(Buffer.from(JSON.stringify(payload)));
}

function bundle(operation: "analyze" | "render", result: unknown, files: Record<string, string>): Buffer {
  const artifacts = Object.entries(files).map(([name, contents]) => ({
    name,
    bytes: Buffer.byteLength(contents),
  }));
  return Buffer.concat([
    jsonFrame({ version: 1, operation, result, artifacts }),
    ...Object.values(files).map((contents) => Buffer.from(contents)),
  ]);
}

async function listen(
  operation: "probe" | "analyze" | "render",
  onRequest: (socket: Socket, request: Buffer) => void,
): Promise<void> {
  const connections = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    connections.add(socket);
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("error", () => {});
    socket.once("close", () => connections.delete(socket));
    socket.once("end", () => onRequest(socket, Buffer.concat(chunks)));
  });
  server.listen(join(root, `${operation}.sock`));
  await once(server, "listening");
  stopPeer = async () => {
    for (const socket of connections) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  };
}

it("returns probe metadata directly from the fixed probe socket", async () => {
  let request: Buffer | undefined;
  await listen("probe", (socket, received) => {
    request = received;
    socket.end(jsonFrame({ status: "ok", metadata }));
  });
  const execute = createIsolatedMediaExecutor(root);
  await expect(execute({ operation: "probe", source })).resolves.toEqual(metadata);
  expect(request).toEqual(frame(sourceBytes));
});

it.each([
  ["confirmed unsupported input", '{"status":"unsupported"}', UnsupportedMediaError],
  ["duplicate status", '{"status":"unavailable","status":"unsupported"}', ProbeRunnerError],
  ["unavailable peer", '{"status":"unavailable"}', ProbeRunnerError],
])("classifies probe result for %s", async (_name, response, error) => {
  await listen("probe", (socket) => socket.end(frame(Buffer.from(response))));
  const execute = createIsolatedMediaExecutor(root);
  await expect(execute({ operation: "probe", source })).rejects.toBeInstanceOf(error);
  expect(await readFile(source)).toEqual(sourceBytes);
});

it("fails closed when the probe socket is missing", async () => {
  const execute = createIsolatedMediaExecutor(root);
  await expect(execute({ operation: "probe", source })).rejects.toBeInstanceOf(ProbeRunnerError);
});

it("returns analysis results with the corresponding files at the attempt target", async () => {
  let request: Buffer | undefined;
  await listen("analyze", (socket, received) => {
    request = received;
    socket.end(bundle("analyze", analysis, analysisFiles));
  });
  const outputDir = join(outputRoot, "analysis", "job-owner");
  const execute = createIsolatedMediaExecutor(root);
  await expect(execute({ operation: "analyze", source, outputDir })).resolves.toEqual(analysis);

  expect(request).toEqual(frame(sourceBytes));
  expect((await stat(outputDir)).mode & 0o777).toBe(0o700);
  expect((await readdir(outputDir)).sort()).toEqual(["poster.jpg", "proxy.mp4", "thumb-0.jpg"]);
  for (const [name, contents] of Object.entries(analysisFiles)) {
    const file = join(outputDir, name);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, "utf8")).toBe(contents);
  }
  expect(await readdir(dirname(outputDir))).toEqual(["job-owner"]);
  expect(await readFile(source)).toEqual(sourceBytes);
});

it("passes the approved render plan and installs only the validated render", async () => {
  let request: Buffer | undefined;
  await listen("render", (socket, received) => {
    request = received;
    socket.end(bundle("render", metadata, renderFiles));
  });
  const output = join(outputRoot, "job-owner.mp4");
  const execute = createIsolatedMediaExecutor(root);
  await expect(execute({ operation: "render", source, output, plan })).resolves.toEqual(metadata);

  if (!request) throw new Error("missing render request");
  const envelopeEnd = 4 + request.readUInt32BE();
  expect(JSON.parse(request.subarray(4, envelopeEnd).toString("utf8"))).toEqual(renderRequest);
  expect(request.subarray(envelopeEnd)).toEqual(frame(sourceBytes));
  expect((await stat(output)).mode & 0o777).toBe(0o600);
  expect(await readFile(output, "utf8")).toBe(renderFiles["render.mp4"]);
  expect(await readdir(outputRoot)).toEqual(["job-owner.mp4"]);
  expect(await readFile(source)).toEqual(sourceBytes);
});

it("preserves a preexisting analysis directory when the target collides", async () => {
  await listen("analyze", (socket) => socket.end(bundle("analyze", analysis, analysisFiles)));
  const outputDir = join(outputRoot, "occupied");
  await mkdir(outputDir);
  const sibling = join(outputDir, "proxy.mp4");
  await writeFile(sibling, "preserve existing proxy");
  const execute = createIsolatedMediaExecutor(root);

  await expect(execute({ operation: "analyze", source, outputDir })).rejects.toBeInstanceOf(
    AnalysisRunnerError,
  );
  expect(await readdir(outputDir)).toEqual(["proxy.mp4"]);
  expect(await readdir(outputRoot)).toEqual(["occupied"]);
  expect(await readFile(sibling, "utf8")).toBe("preserve existing proxy");
});

it("refuses a render target symlink without replacing it or its master", async () => {
  await listen("render", (socket) => socket.end(bundle("render", metadata, renderFiles)));
  const output = join(outputRoot, "source-alias.mp4");
  await symlink(source, output);
  const execute = createIsolatedMediaExecutor(root);

  await expect(execute({ operation: "render", source, output, plan })).rejects.toBeInstanceOf(
    RenderRunnerError,
  );
  expect(await readdir(outputRoot)).toEqual(["source-alias.mp4"]);
  expect(await readlink(output)).toBe(source);
  expect(await readFile(source)).toEqual(sourceBytes);
});

it("does not install a truncated analysis bundle", async () => {
  await listen("analyze", (socket) => socket.end(bundle("analyze", analysis, analysisFiles).subarray(0, -1)));
  const execute = createIsolatedMediaExecutor(root);
  const outputDir = join(outputRoot, "job-owner");
  await expect(execute({ operation: "analyze", source, outputDir })).rejects.toBeInstanceOf(
    AnalysisRunnerError,
  );
  expect(await readdir(outputRoot)).toEqual([]);
});

it("removes its partially installed analysis after a filesystem error", async () => {
  await listen("analyze", (socket) => socket.end(bundle("analyze", analysis, analysisFiles)));
  const outputDir = join(outputRoot, "job-owner");
  const preserved = join(outputRoot, "existing.mp4");
  await writeFile(preserved, "existing output");
  const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  let firstArtifact: string | undefined;
  const install = vi.mocked(link);
  install
    .mockImplementationOnce(async (existing, target) => {
      await fs.link(existing, target);
      firstArtifact = await readFile(target, "utf8");
    })
    .mockRejectedValueOnce(Object.assign(new Error("private disk detail"), { code: "ENOSPC" }));
  const execute = createIsolatedMediaExecutor(root);
  try {
    await expect(execute({ operation: "analyze", source, outputDir })).rejects.toBeInstanceOf(
      AnalysisRunnerError,
    );
  } finally {
    install.mockReset();
  }
  expect(Object.values(analysisFiles)).toContain(firstArtifact);
  expect(await readdir(outputRoot)).toEqual(["existing.mp4"]);
  expect(await readFile(preserved, "utf8")).toBe("existing output");
});

it.each([
  ["probe", ProbeRunnerError],
  ["analyze", AnalysisRunnerError],
  ["render", RenderRunnerError],
] as const)("forwards a %s abort after intake", { timeout: 5000 }, async (operation, error) => {
  let accept!: (request: Buffer) => void;
  const accepted = new Promise<Buffer>((resolve) => {
    accept = resolve;
  });
  await listen(operation, (_socket, request) => accept(request));
  const preserved = join(outputRoot, "existing.mp4");
  await writeFile(preserved, "existing output");
  const output = join(outputRoot, "job-owner.mp4");
  const input: MediaRequest =
    operation === "render"
      ? { operation, source, output, plan }
      : operation === "analyze"
        ? { operation, source, outputDir: join(outputRoot, "job-owner") }
        : { operation, source };
  const controller = new AbortController();
  const execute = createIsolatedMediaExecutor(root);
  const rejected = expect(execute(input, controller.signal)).rejects.toBeInstanceOf(error);

  const request = await accepted;
  const frameOffset = operation === "render" ? 4 + request.readUInt32BE() : 0;
  expect(request.subarray(frameOffset)).toEqual(frame(sourceBytes));
  controller.abort(new Error("private cancellation detail"));
  await rejected;
  expect(await readdir(outputRoot)).toEqual(["existing.mp4"]);
  expect(await readFile(preserved, "utf8")).toBe("existing output");
  expect(await readFile(source)).toEqual(sourceBytes);
});
