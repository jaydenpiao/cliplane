import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnalysisRunnerError, analyzeWithRunner } from "../apps/api/src/analysis-client";
import type { MediaAnalysisResult } from "../apps/api/src/media";

const sourceBytes = Buffer.alloc(196_621, 0xfe);
const proxy = Buffer.alloc(262_151, 0xaf);
const poster = Buffer.from("poster-image");
const thumbnail = Buffer.from("candidate-0-image");
const candidate = {
  startMs: 400,
  endMs: 1800,
  score: 70,
  components: { audio: 82, scene: 35, boundary: 60 },
  reason: "Audio and scene activity",
  thumbnail: "thumb-0.jpg",
};
const analysis = {
  metadata: {
    durationMs: 2400,
    width: 1280,
    height: 720,
    hasAudio: true,
    fps: 30,
    codec: "h264",
    audioTracks: [{ index: 1, role: "mixed" }],
  },
  candidates: [candidate],
  signals: { audioRms: [0.1, 0.2, 0], sceneTimes: [0, 1.4] },
  telemetry: {
    wallSeconds: 0.412,
    sourceHours: 0.000_666,
    transcriptionCost: 0,
    method: "deterministic-audio-scene-v1",
  },
} satisfies MediaAnalysisResult;
const manifest = {
  version: 1,
  operation: "analyze",
  result: analysis,
  artifacts: [
    { name: "proxy.mp4", bytes: proxy.length },
    { name: "poster.jpg", bytes: poster.length },
    { name: "thumb-0.jpg", bytes: thumbnail.length },
  ],
};
let root: string;
let socketPath: string;
let source: string;
let staging: string;
let closeServer: (() => Promise<void>) | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cliplane-analysis-"));
  socketPath = join(root, "runner.sock");
  source = join(root, "opaque-source");
  staging = join(root, "staging");
  await mkdir(staging, { mode: 0o700 });
  await writeFile(source, sourceBytes);
});

afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
  await rm(root, { recursive: true, force: true });
});

function frame(payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

function bundle(record: unknown = manifest, files: readonly Buffer[] = [proxy, poster, thumbnail]): Buffer {
  return Buffer.concat([frame(Buffer.from(JSON.stringify(record))), ...files]);
}

async function listen(handle: (socket: Socket) => void): Promise<void> {
  const connections = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    connections.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => connections.delete(socket));
    handle(socket);
  });
  server.listen(socketPath);
  await once(server, "listening");
  closeServer = async () => {
    for (const connection of connections) connection.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      }),
    );
  };
}

async function reply(response: Buffer): Promise<void> {
  await listen((socket) => {
    socket.resume();
    socket.once("end", () => socket.end(response));
  });
}

async function expectUnavailable(exchange: Promise<unknown>): Promise<void> {
  await expect(exchange).rejects.toBeInstanceOf(AnalysisRunnerError);
  await expect(exchange).rejects.toThrow(/^Media analysis runner unavailable$/);
  expect(await readdir(staging)).toEqual([]);
}

it("exchanges only the source frame and imports ordered artifacts with private permissions", async () => {
  const response = bundle();
  let request: Buffer | undefined;
  await listen((socket) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => {
      request = Buffer.concat(chunks);
      socket.write(response.subarray(0, 2));
      setImmediate(() => {
        socket.write(response.subarray(2, 79));
        setImmediate(() => socket.end(response.subarray(79)));
      });
    });
  });

  const imported = await analyzeWithRunner(socketPath, source, staging, undefined, 2000);
  expect(imported.result).toEqual(analysis);
  expect(imported.directory.startsWith(join(staging, "analysis-"))).toBe(true);
  expect((await stat(imported.directory)).mode & 0o777).toBe(0o700);
  expect((await readdir(imported.directory)).sort()).toEqual(["poster.jpg", "proxy.mp4", "thumb-0.jpg"]);
  for (const [name, expected] of [
    ["proxy.mp4", proxy],
    ["poster.jpg", poster],
    ["thumb-0.jpg", thumbnail],
  ] as const) {
    const path = join(imported.directory, name);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path)).toEqual(expected);
  }
  expect(request?.readUInt32BE()).toBe(sourceBytes.length);
  expect(request?.subarray(4)).toEqual(sourceBytes);
  expect(await readFile(source)).toEqual(sourceBytes);
});

it("accepts the proxy and poster when analysis returns no candidates", async () => {
  const result = { ...analysis, candidates: [] };
  const record = { ...manifest, result, artifacts: manifest.artifacts.slice(0, 2) };
  await reply(bundle(record, [proxy, poster]));

  const imported = await analyzeWithRunner(socketPath, source, staging);
  expect(imported.result).toEqual(result);
  expect((await readdir(imported.directory)).sort()).toEqual(["poster.jpg", "proxy.mp4"]);
});

it.each<[label: string, record: unknown, files?: Buffer[]]>([
  ["wrong operation", { ...manifest, operation: "render" }],
  ["wrong version", { ...manifest, version: 2 }],
  ["unknown result key", { ...manifest, result: { ...analysis, diagnostics: "/private/run" } }],
  [
    "invalid source metadata",
    { ...manifest, result: { ...analysis, metadata: { ...analysis.metadata, codec: "/private/run" } } },
  ],
  [
    "missing poster",
    { ...manifest, artifacts: [manifest.artifacts[0], manifest.artifacts[2]] },
    [proxy, thumbnail],
  ],
  [
    "reordered proxy and poster",
    { ...manifest, artifacts: [manifest.artifacts[1], manifest.artifacts[0], manifest.artifacts[2]] },
  ],
  [
    "unsafe declaration",
    {
      ...manifest,
      artifacts: [...manifest.artifacts.slice(0, 2), { name: "../escape.jpg", bytes: thumbnail.length }],
    },
  ],
  [
    "unexpected thumbnail declaration",
    {
      ...manifest,
      artifacts: [...manifest.artifacts.slice(0, 2), { name: "thumb-1.jpg", bytes: thumbnail.length }],
    },
  ],
  [
    "additional declaration",
    { ...manifest, artifacts: [...manifest.artifacts, { name: "thumb-1.jpg", bytes: thumbnail.length }] },
    [proxy, poster, thumbnail, thumbnail],
  ],
  [
    "negative signal",
    { ...manifest, result: { ...analysis, signals: { ...analysis.signals, audioRms: [-0.1] } } },
  ],
  [
    "negative telemetry",
    { ...manifest, result: { ...analysis, telemetry: { ...analysis.telemetry, sourceHours: -1 } } },
  ],
  [
    "too many candidates",
    {
      ...manifest,
      result: {
        ...analysis,
        candidates: Array.from({ length: 9 }, (_, index) => ({
          ...candidate,
          thumbnail: `thumb-${index}.jpg`,
        })),
      },
    },
  ],
])("cleans staging after %s", async (_label, record, files) => {
  await reply(bundle(record, files));
  await expectUnavailable(analyzeWithRunner(socketPath, source, staging));
});

it.each([
  ["out-of-order thumbnail", { ...candidate, thumbnail: "thumb-1.jpg" }],
  ["interval beyond the source", { ...candidate, endMs: 2401 }],
  ["reversed interval", { ...candidate, startMs: 1801 }],
  ["negative start", { ...candidate, startMs: -1 }],
  ["out-of-range score", { ...candidate, score: 101 }],
  ["fractional rank", { ...candidate, score: 70.5 }],
  ["out-of-range component", { ...candidate, components: { ...candidate.components, scene: 101 } }],
])("rejects a candidate with %s", async (_label, rejectedCandidate) => {
  await reply(bundle({ ...manifest, result: { ...analysis, candidates: [rejectedCandidate] } }));
  await expectUnavailable(analyzeWithRunner(socketPath, source, staging));
});

const mebibyte = 1024 * 1024;
it.each([
  ["individual file exceeds 64 MiB", 64 * mebibyte + 1, poster.length, thumbnail.length],
  ["combined files exceed 96 MiB", 64 * mebibyte, 31 * mebibyte, 2 * mebibyte],
])(
  "rejects before waiting for artifact bytes when %s",
  async (_label, proxyBytes, posterBytes, thumbnailBytes) => {
    const record = {
      ...manifest,
      artifacts: [
        { name: "proxy.mp4", bytes: proxyBytes },
        { name: "poster.jpg", bytes: posterBytes },
        { name: "thumb-0.jpg", bytes: thumbnailBytes },
      ],
    };
    await listen((socket) => {
      socket.resume();
      socket.once("end", () => socket.write(frame(Buffer.from(JSON.stringify(record)))));
    });
    let rejected = false;
    const checked = expectUnavailable(analyzeWithRunner(socketPath, source, staging, undefined, 4000)).then(
      () => {
        rejected = true;
      },
    );
    await vi.waitFor(() => expect(rejected).toBe(true), { timeout: 1000 });
    await checked;
  },
);

it.each([
  ["proxy", proxy.length - 1],
  ["poster", proxy.length + poster.length - 1],
  ["thumbnail", proxy.length + poster.length + thumbnail.length - 1],
])("removes all files when the %s transfer is truncated", async (_label, length) => {
  const response = bundle();
  await reply(response.subarray(0, 4 + response.readUInt32BE() + length));
  await expectUnavailable(analyzeWithRunner(socketPath, source, staging));
});

it("removes all files when a delayed byte follows the final artifact", async () => {
  await listen((socket) => {
    socket.resume();
    socket.once("end", () => {
      socket.write(bundle());
      setImmediate(() => socket.end("x"));
    });
  });
  await expectUnavailable(analyzeWithRunner(socketPath, source, staging));
});

it("cancels during the final artifact and preserves staging owned by another attempt", async () => {
  const sentinel = join(staging, "existing");
  await writeFile(sentinel, "preserve");
  await listen((socket) => {
    socket.resume();
    socket.once("end", () => socket.write(bundle().subarray(0, -1)));
  });

  const controller = new AbortController();
  const exchange = analyzeWithRunner(socketPath, source, staging, controller.signal, 3000);
  const rejected = expect(exchange).rejects.toBeInstanceOf(AnalysisRunnerError);
  await vi.waitFor(async () => {
    const attempt = (await readdir(staging)).find((name) => name.startsWith("analysis-"));
    if (!attempt) throw new Error("missing attempt");
    expect((await stat(join(staging, attempt, "proxy.mp4"))).size).toBe(proxy.length);
    expect((await stat(join(staging, attempt, "thumb-0.jpg"))).size).toBeGreaterThan(0);
  });
  controller.abort(new Error("private caller diagnostic"));
  await rejected;
  expect(await readdir(staging)).toEqual(["existing"]);
  expect(await readFile(sentinel, "utf8")).toBe("preserve");
});
