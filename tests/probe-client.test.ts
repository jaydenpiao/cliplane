import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { renameSync, truncateSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UnsupportedMediaError } from "../apps/api/src/media";
import { ProbeRunnerError, probeWithRunner } from "../apps/api/src/probe-client";

const metadata = {
  durationMs: 2400,
  width: 1280,
  height: 720,
  hasAudio: true,
  fps: 60,
  codec: "h264",
  audioTracks: [{ index: 1, role: "mixed" }],
};
const ok = { status: "ok", metadata };
const sourceBytes = Buffer.alloc(256 * 1024 + 17, 0xad);
let directory: string;
let socketPath: string;
let source: string;
let closeServer: (() => Promise<void>) | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "cliplane-probe-"));
  socketPath = join(directory, "runner.sock");
  source = join(directory, "opaque-source");
  await writeFile(source, sourceBytes);
});

afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
  await rm(directory, { recursive: true, force: true });
});

function frame(payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

function jsonFrame(response: unknown): Buffer {
  return frame(Buffer.from(JSON.stringify(response)));
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

it("sends only the length and source bytes, half-closes, and receives fragmented metadata", async () => {
  const response = jsonFrame(ok);
  let request: Buffer | undefined;
  await listen((socket) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => {
      request = Buffer.concat(chunks);
      socket.write(response.subarray(0, 2));
      setImmediate(() => {
        socket.write(response.subarray(2, 19));
        setImmediate(() => socket.end(response.subarray(19)));
      });
    });
  });

  await expect(probeWithRunner(socketPath, source, undefined, 2000)).resolves.toEqual(metadata);
  expect(request?.readUInt32BE()).toBe(sourceBytes.length);
  expect(request?.subarray(4)).toEqual(sourceBytes);
});

it("streams from the opened file when the source path is replaced", async () => {
  let request: Buffer | undefined;
  await listen((socket) => {
    renameSync(source, join(directory, "original"));
    writeFileSync(source, "replacement");
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => {
      request = Buffer.concat(chunks);
      socket.end(jsonFrame(ok));
    });
  });

  await expect(probeWithRunner(socketPath, source, undefined, 2000)).resolves.toEqual(metadata);
  expect(request?.subarray(4)).toEqual(sourceBytes);
});

it("rejects a source truncated during transmission", async () => {
  await listen((socket) => {
    truncateSync(source, 1);
    socket.resume();
    socket.once("end", () => socket.end(jsonFrame(ok)));
  });
  await expect(probeWithRunner(socketPath, source)).rejects.toBeInstanceOf(ProbeRunnerError);
});

it("recognizes a confirmed unsupported input", async () => {
  await reply(jsonFrame({ status: "unsupported" }));
  await expect(probeWithRunner(socketPath, source)).rejects.toBeInstanceOf(UnsupportedMediaError);
});

it.each([
  '{"status":"unavailable","status":"unsupported"}',
  '{"status": "unsupported"}',
  '\ufeff{"status":"unsupported"}',
])("requires the exact unsupported payload %#", async (response) => {
  await reply(frame(Buffer.from(response)));
  await expect(probeWithRunner(socketPath, source)).rejects.toBeInstanceOf(ProbeRunnerError);
});

it.each([
  ["an invalid request status", { status: "invalid_request" }],
  ["an unavailable status", { status: "unavailable" }],
  ["an unknown status", { status: "private-backend-detail" }],
  ["an extra unsupported field", { status: "unsupported", detail: "private-backend-detail" }],
  ["an extra success field", { ...ok, detail: "private-backend-detail" }],
  ["missing metadata", { status: "ok" }],
  ["invalid dimensions", { ...ok, metadata: { ...metadata, width: 15 } }],
  ["an invalid codec token", { ...ok, metadata: { ...metadata, codec: "private detail" } }],
  ["an extra metadata field", { ...ok, metadata: { ...metadata, detail: "private-backend-detail" } }],
  [
    "an extra audio track field",
    { ...ok, metadata: { ...metadata, audioTracks: [{ index: 1, role: "mixed", extra: true }] } },
  ],
  ["an array response", [{ status: "unsupported" }]],
])("fails closed on %s", async (_label, response) => {
  await reply(jsonFrame(response));
  const probe = probeWithRunner(socketPath, source);
  await expect(probe).rejects.toBeInstanceOf(ProbeRunnerError);
  await expect(probe).rejects.toThrow(/^Media probe runner unavailable$/);
});

it.each([
  Buffer.alloc(0),
  Buffer.alloc(3),
  Buffer.alloc(4),
  jsonFrame(ok).subarray(0, -1),
  frame(Buffer.from("{")),
  frame(Buffer.from([0x22, 0xff, 0x22])),
])("rejects invalid response framing or encoding %#", async (response) => {
  await reply(response);
  await expect(probeWithRunner(socketPath, source)).rejects.toBeInstanceOf(ProbeRunnerError);
});

it("rejects an otherwise valid response with delayed trailing bytes", async () => {
  await listen((socket) => {
    socket.resume();
    socket.once("end", () => {
      socket.write(jsonFrame(ok));
      setImmediate(() => socket.end("x"));
    });
  });
  await expect(probeWithRunner(socketPath, source)).rejects.toBeInstanceOf(ProbeRunnerError);
});

it.each([
  [1024 * 1024, true],
  [1024 * 1024 + 1, false],
])("applies the response ceiling to a valid JSON payload of %i bytes", async (length, accepted) => {
  const payload = Buffer.alloc(length, 0x20);
  payload.write(JSON.stringify(ok));
  await reply(frame(payload));
  const probe = probeWithRunner(socketPath, source);
  if (accepted) await expect(probe).resolves.toEqual(metadata);
  else await expect(probe).rejects.toBeInstanceOf(ProbeRunnerError);
});

it("sanitizes a connection failure without launching the native worker", async () => {
  const fallback = join(directory, "fallback");
  await writeFile(fallback, '#!/bin/sh\ntouch "$0.called"\nexit 1\n', { mode: 0o700 });
  vi.stubEnv("PYTHON_BIN", fallback);
  try {
    const probe = probeWithRunner(socketPath, source);
    await expect(probe).rejects.toBeInstanceOf(ProbeRunnerError);
    await expect(probe).rejects.toThrow(/^Media probe runner unavailable$/);
    await expect(readFile(`${fallback}.called`)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    vi.unstubAllEnvs();
  }
});

it("rejects missing, empty, oversized, symlinked and nonregular sources before dialing", async () => {
  let connected = 0;
  await listen(() => {
    connected++;
  });
  const missing = join(directory, "missing");
  const empty = join(directory, "empty");
  const oversized = join(directory, "oversized");
  const link = join(directory, "symlink");
  const fifo = join(directory, "fifo");
  await writeFile(empty, "");
  await writeFile(oversized, "");
  await truncate(oversized, 64 * 1024 * 1024 + 1);
  await symlink(source, link);
  execFileSync("mkfifo", [fifo]);
  for (const invalid of [missing, empty, oversized, link, fifo, directory]) {
    await expect(probeWithRunner(socketPath, invalid, undefined, 1000)).rejects.toBeInstanceOf(
      ProbeRunnerError,
    );
  }
  expect(connected).toBe(0);
});

it("does not dial if the caller already cancelled", async () => {
  let connected = false;
  await listen(() => {
    connected = true;
  });
  const signal = AbortSignal.abort(new Error("private cancellation reason"));
  await expect(probeWithRunner(socketPath, source, signal)).rejects.toThrow(
    /^Media probe runner unavailable$/,
  );
  expect(connected).toBe(false);
});

it("closes an active connection and sanitizes cancellation", async () => {
  const length = 64 * 1024 * 1024;
  await truncate(source, length);
  const controller = new AbortController();
  let connection: Socket | undefined;
  let received = 0;
  await listen((socket) => {
    connection = socket;
    socket.on("data", (chunk: Buffer) => {
      received += chunk.length;
      controller.abort(new Error("private cancellation reason"));
    });
    socket.once("end", () => socket.end());
  });
  const probe = probeWithRunner(socketPath, source, controller.signal, 2000);
  await expect(probe).rejects.toThrow(/^Media probe runner unavailable$/);
  await expect.poll(() => connection?.destroyed).toBe(true);
  expect(received).toBeGreaterThan(0);
  expect(received).toBeLessThan(length + 4);
});

it("enforces an absolute deadline while the peer keeps writing", async () => {
  await listen((socket) => {
    socket.resume();
    socket.once("end", () => {
      const response = jsonFrame(ok);
      let offset = 0;
      const timer = setInterval(() => {
        socket.write(response.subarray(offset, ++offset));
        if (offset === response.length) {
          clearInterval(timer);
          socket.end();
        }
      }, 10);
      socket.once("close", () => clearInterval(timer));
    });
  });
  await expect(probeWithRunner(socketPath, source, undefined, 150)).rejects.toBeInstanceOf(ProbeRunnerError);
});
