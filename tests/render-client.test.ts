import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RenderRunnerError, renderWithRunner } from "../apps/api/src/render-client";
import type { EditPlan } from "../packages/domain/src/index";

const fullFrame = { x: 0, y: 0, width: 1, height: 1 };
const plan: EditPlan = {
  version: 1,
  startMs: 1000,
  endMs: 3400,
  layout: "crop",
  crop: fullFrame,
  facecam: fullFrame,
  muteAudio: true,
  captions: [{ startMs: 400, endMs: 1800, text: 'Café "{race}"' }],
  profile: "standard",
};
const metadata = {
  durationMs: 2400,
  width: 720,
  height: 1280,
  hasAudio: false,
  fps: 30,
  codec: "h264",
  audioTracks: [],
};
const sourceBytes = Buffer.alloc(196_621, 0xfe);
const artifact = Buffer.alloc(262_151, 0xaf);
const manifest = {
  version: 1,
  operation: "render",
  result: metadata,
  artifacts: [{ name: "render.mp4", bytes: artifact.length }],
};
let root: string;
let socketPath: string;
let source: string;
let staging: string;
let closeServer: (() => Promise<void>) | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cliplane-render-"));
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

function bundle(result: unknown = manifest, body = artifact): Buffer {
  return Buffer.concat([frame(Buffer.from(JSON.stringify(result))), body]);
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

async function expectUnavailable(result: Promise<unknown>): Promise<void> {
  await expect(result).rejects.toBeInstanceOf(RenderRunnerError);
  await expect(result).rejects.toThrow(/^Media render runner unavailable$/);
  expect(await readdir(staging)).toEqual([]);
}

it("exchanges the validated plan, exact source, and a fragmented private render bundle", async () => {
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

  const rendered = await renderWithRunner(socketPath, source, staging, plan, undefined, 2000);
  expect(rendered.metadata).toEqual(metadata);
  expect(rendered.directory.startsWith(join(staging, "render-"))).toBe(true);
  expect((await stat(rendered.directory)).mode & 0o777).toBe(0o700);
  expect(await readdir(rendered.directory)).toEqual(["render.mp4"]);
  const output = join(rendered.directory, "render.mp4");
  expect((await stat(output)).mode & 0o777).toBe(0o600);
  expect(await readFile(output)).toEqual(artifact);
  expect(await readFile(source)).toEqual(sourceBytes);

  if (!request) throw new Error("missing render request");
  const envelopeLength = request.readUInt32BE();
  const sourceHeader = 4 + envelopeLength;
  expect(JSON.parse(request.subarray(4, sourceHeader).toString("utf8"))).toEqual({
    version: 1,
    operation: "render",
    plan,
  });
  expect(request.readUInt32BE(sourceHeader)).toBe(sourceBytes.length);
  expect(request.subarray(sourceHeader + 4)).toEqual(sourceBytes);
});

it("rejects an invalid edit plan before connecting", async () => {
  let connected = false;
  await listen(() => {
    connected = true;
  });
  await expectUnavailable(renderWithRunner(socketPath, source, staging, { ...plan, endMs: 1020 }));
  expect(connected).toBe(false);
});

it.each([
  ["wrong operation", { ...manifest, operation: "analyze" }],
  ["wrong version", { ...manifest, version: 2 }],
  ["extra artifact", { ...manifest, artifacts: [...manifest.artifacts, ...manifest.artifacts] }],
  ["unsafe name", { ...manifest, artifacts: [{ name: "../render.mp4", bytes: 1 }] }],
  ["empty artifact", { ...manifest, artifacts: [{ name: "render.mp4", bytes: 0 }] }],
  ["nonintegral size", { ...manifest, artifacts: [{ name: "render.mp4", bytes: 2.5 }] }],
  ["oversized artifact", { ...manifest, artifacts: [{ name: "render.mp4", bytes: 64 * 1024 * 1024 + 1 }] }],
  ["extra private field", { ...manifest, result: { ...metadata, detail: "/private/staging" } }],
  ["invalid codec", { ...manifest, result: { ...metadata, codec: "private /tmp" } }],
])("cleans staging after %s", async (_label, response) => {
  await reply(bundle(response));
  await expectUnavailable(renderWithRunner(socketPath, source, staging, plan));
});

it.each([
  ["duplicate escaped manifest keys", `{"oper\\u0061tion":"analyze",${JSON.stringify(manifest).slice(1)}`],
  [
    "duplicate nested metadata keys",
    JSON.stringify(manifest).replace('"result":{', '"result":{"width":1280,'),
  ],
  ["non-integer version token", JSON.stringify(manifest).replace('"version":1', '"version":1.0')],
  ["non-integer byte count token", JSON.stringify(manifest).replace('"bytes":262151', '"bytes":262151.0')],
  [
    "nested manifest beyond the decoder bound",
    `{"extra":${"[".repeat(40)}0${"]".repeat(40)},${JSON.stringify(manifest).slice(1)}`,
  ],
  ["UTF-8 BOM", `\ufeff${JSON.stringify(manifest)}`],
])("rejects %s", async (_label, text) => {
  await reply(Buffer.concat([frame(Buffer.from(text)), artifact]));
  await expectUnavailable(renderWithRunner(socketPath, source, staging, plan));
});

it.each([
  Buffer.alloc(0),
  Buffer.alloc(3),
  Buffer.alloc(4),
  Buffer.from([0, 16, 0, 1]),
  frame(Buffer.from([0x22, 0xff, 0x22])),
  frame(Buffer.from("{")),
  frame(Buffer.from(JSON.stringify(manifest))).subarray(0, -1),
  bundle().subarray(0, -1),
])("removes partial files after malformed or truncated transfer %#", async (response) => {
  await reply(response);
  await expectUnavailable(renderWithRunner(socketPath, source, staging, plan));
});

it("discards a complete artifact if delayed bytes follow it", async () => {
  await listen((socket) => {
    socket.resume();
    socket.once("end", () => {
      socket.write(bundle());
      setImmediate(() => socket.end("x"));
    });
  });
  await expectUnavailable(renderWithRunner(socketPath, source, staging, plan));
});

it("discards a complete artifact if the runner never closes the reply", async () => {
  await listen((socket) => {
    socket.resume();
    socket.once("end", () => socket.write(bundle()));
  });
  await expectUnavailable(renderWithRunner(socketPath, source, staging, plan, undefined, 350));
});

it("removes only its own staging after cancellation during artifact intake", async () => {
  const sentinel = join(staging, "existing");
  await writeFile(sentinel, "preserve");
  await listen((socket) => {
    socket.resume();
    socket.once("end", () => socket.write(bundle().subarray(0, -1)));
  });

  const controller = new AbortController();
  const received = renderWithRunner(socketPath, source, staging, plan, controller.signal, 3000);
  const rejected = expect(received).rejects.toBeInstanceOf(RenderRunnerError);
  await vi.waitFor(async () => {
    const attempt = (await readdir(staging)).find((name) => name.startsWith("render-"));
    if (!attempt) throw new Error("missing attempt");
    expect((await stat(join(staging, attempt, "render.mp4"))).size).toBeGreaterThan(0);
  });
  controller.abort(new Error("private caller diagnostic"));
  await rejected;
  expect(await readdir(staging)).toEqual(["existing"]);
  expect(await readFile(sentinel, "utf8")).toBe("preserve");
});
