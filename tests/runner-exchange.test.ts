import { once } from "node:events";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import { exchangeRunner } from "../apps/api/src/runner-exchange";

let directory: string;
let socketPath: string;
let source: string;
let stop: (() => Promise<void>) | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "cliplane-runner-exchange-"));
  socketPath = join(directory, "runner.sock");
  source = join(directory, "source");
  await writeFile(source, "original");
});

afterEach(async () => {
  await stop?.();
  stop = undefined;
  await rm(directory, { recursive: true, force: true });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function listen() {
  const connections = new Set<Socket>();
  const connected = deferred();
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    connections.add(socket);
    socket.on("error", () => {});
    connected.resolve();
  });
  server.listen(socketPath);
  await once(server, "listening");
  stop = async () => {
    for (const socket of connections) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
  return { connected: connected.promise };
}

it("waits for the receiver to finish cleanup after an interrupted send", async () => {
  // Keep the send active until cancellation by leaving the peer's read side paused.
  await truncate(source, 4 * 1024 * 1024);
  const { connected } = await listen();
  const controller = new AbortController();
  const closed = deferred();
  const cleanup = deferred();
  let completed = false;
  const transfer = exchangeRunner(
    socketPath,
    source,
    controller.signal,
    performance.now() + 2000,
    async (socket) => {
      socket.once("close", () => closed.resolve());
      await cleanup.promise;
    },
  );
  const failed = transfer.catch((error: unknown) => {
    completed = true;
    return error;
  });

  try {
    await connected;
    controller.abort();
    await closed.promise;
    // The source descriptor closes asynchronously after the cancelled pipeline rejects.
    await setTimeout(50);
    expect(completed).toBe(false);
  } finally {
    cleanup.resolve();
    await expect(failed).resolves.toBeInstanceOf(Error);
  }
});

it("destroys the connection when a receiver throws synchronously", async () => {
  await listen();
  const failure = new Error("receiver setup failed");
  const closed = deferred();
  const transfer = exchangeRunner(
    socketPath,
    source,
    new AbortController().signal,
    performance.now() + 2000,
    (socket) => {
      socket.once("close", () => closed.resolve());
      throw failure;
    },
  );
  await expect(transfer).rejects.toBe(failure);
  await closed.promise;
});

it("settles the receiver when the runner socket is absent", async () => {
  let finished = false;
  const transfer = exchangeRunner(
    socketPath,
    source,
    new AbortController().signal,
    performance.now() + 2000,
    async (socket) => {
      try {
        await once(socket, "connect");
      } finally {
        finished = true;
      }
    },
  );
  await expect(transfer).rejects.toMatchObject({ code: "ENOENT" });
  expect(finished).toBe(true);
});
