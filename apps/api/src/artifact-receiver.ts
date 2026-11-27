import { constants } from "node:fs";
import { chmod, mkdtemp, open, rm } from "node:fs/promises";
import type { Socket } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import { mediaMetadataSchema } from "./media";
import { exchangeRunner } from "./runner-exchange";

const LENGTH_BYTES = 4;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 96 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const MAX_JSON_DEPTH = 32;

const artifactNames = {
  render: ["render.mp4"],
  analyze: [
    "proxy.mp4",
    "poster.jpg",
    "thumb-0.jpg",
    "thumb-1.jpg",
    "thumb-2.jpg",
    "thumb-3.jpg",
    "thumb-4.jpg",
    "thumb-5.jpg",
    "thumb-6.jpg",
    "thumb-7.jpg",
  ],
} as const;

export const runnerMetadataSchema = mediaMetadataSchema.extend({
  codec: mediaMetadataSchema.shape.codec.regex(/^[A-Za-z0-9_-]+$/),
});

export const artifactDeclarationSchema = z.strictObject({
  name: z.enum([...artifactNames.render, ...artifactNames.analyze]),
  bytes: z.number().int().min(1).max(MAX_ARTIFACT_BYTES),
});

type Operation = keyof typeof artifactNames;
type ArtifactManifest<T> = { result: T; artifacts: { name: string; bytes: number }[] };

class ArtifactReceiverError extends Error {
  constructor() {
    super("Media artifact runner unavailable");
  }
}

function decodeManifest(payload: Buffer): unknown {
  // Keep a BOM visible so JSON.parse rejects it as the decoder's JSON reader does.
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload);
  // Pass JSON syntax to JSON.parse, checking depth and repeated keys before it builds objects.
  const token = /[ \t\r\n]*("[^"\\]*(?:\\[\s\S][^"\\]*)*"|[{}[\],:]|[^ \t\r\n{}[\],:"]+)/y;
  let current = token.exec(text)?.[1];

  function take(): string {
    if (current === undefined) throw new ArtifactReceiverError();
    const value = current;
    current = token.exec(text)?.[1];
    return value;
  }

  function consume(expected: string): boolean {
    if (current !== expected) return false;
    take();
    return true;
  }

  function scanEntries(end: string, nextEntry: () => void): void {
    if (consume(end)) return;
    do {
      nextEntry();
    } while (consume(","));
    if (!consume(end)) throw new ArtifactReceiverError();
  }

  function scanValue(depth: number, key?: string): void {
    if (depth > MAX_JSON_DEPTH) throw new ArtifactReceiverError();
    // These declarations are integers in the decoder protocol, including their wire tokens.
    if (key === "version" || key === "bytes") {
      if (!/^-?(?:0|[1-9][0-9]*)$/.test(take())) throw new ArtifactReceiverError();
    } else if (consume("{")) {
      const keys = new Set<string>();
      scanEntries("}", () => {
        const rawKey = take();
        if (!rawKey.startsWith('"')) throw new ArtifactReceiverError();
        const name: string = JSON.parse(rawKey);
        if (keys.has(name) || !consume(":")) throw new ArtifactReceiverError();
        keys.add(name);
        scanValue(depth + 1, name);
      });
    } else if (consume("[")) {
      scanEntries("]", () => scanValue(depth + 1));
    } else {
      take();
    }
  }

  scanValue(0);
  return JSON.parse(text);
}

function socketReader(socket: Socket) {
  const iterator = socket[Symbol.asyncIterator]();
  let pending: Buffer = Buffer.alloc(0);

  async function* take(length: number): AsyncGenerator<Buffer> {
    while (length > 0) {
      if (!pending.length) {
        const next = await iterator.next();
        if (next.done) throw new ArtifactReceiverError();
        pending = next.value;
      }
      const bytes = pending.subarray(0, Math.min(length, CHUNK_BYTES));
      pending = pending.subarray(bytes.length);
      length -= bytes.length;
      yield bytes;
    }
  }

  async function read(length: number): Promise<Buffer> {
    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;
    for await (const bytes of take(length)) offset += bytes.copy(buffer, offset);
    return buffer;
  }

  async function requireEnd(): Promise<void> {
    if (pending.length || !(await iterator.next()).done) throw new ArtifactReceiverError();
  }

  return { take, read, requireEnd };
}

async function receiveArtifacts<T>(
  socket: Socket,
  directory: string,
  operation: Operation,
  validate: (raw: unknown) => ArtifactManifest<T>,
  signal: AbortSignal,
): Promise<T> {
  const stream = socketReader(socket);
  const length = (await stream.read(LENGTH_BYTES)).readUInt32BE();
  if (length < 1 || length > MAX_MANIFEST_BYTES) throw new ArtifactReceiverError();
  const manifest = validate(decodeManifest(await stream.read(length)));
  const allowed: readonly string[] = artifactNames[operation];
  if (manifest.artifacts.length < 1 || manifest.artifacts.length > allowed.length)
    throw new ArtifactReceiverError();
  let total = 0;
  const seen = new Set<string>();
  const artifacts = manifest.artifacts.map((declaration) => {
    const artifact = artifactDeclarationSchema.parse(declaration);
    total += artifact.bytes;
    if (!allowed.includes(artifact.name) || seen.has(artifact.name) || total > MAX_BUNDLE_BYTES)
      throw new ArtifactReceiverError();
    seen.add(artifact.name);
    return artifact;
  });

  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
  for (const { name, bytes } of artifacts) {
    signal.throwIfAborted();
    const artifact = await open(join(directory, name), flags, 0o600);
    try {
      await artifact.chmod(0o600);
      for await (const chunk of stream.take(bytes)) {
        signal.throwIfAborted();
        await artifact.writeFile(chunk);
      }
    } finally {
      await artifact.close();
    }
  }
  await stream.requireEnd();
  return manifest.result;
}

/** Stage one result under a caller-owned private root. The caller owns a successful return directory. */
export async function receiveRunnerArtifacts<T>(
  socketPath: string,
  source: string,
  stagingRoot: string,
  operation: Operation,
  validate: (raw: unknown) => ArtifactManifest<T>,
  signal?: AbortSignal,
  timeoutMs = 120_000,
  prefix?: Buffer,
): Promise<{ directory: string; result: T }> {
  if (signal?.aborted || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new ArtifactReceiverError();

  const deadline = performance.now() + timeoutMs;
  const timeout = new AbortController();
  const exchangeSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  let directory: string | undefined;
  try {
    exchangeSignal.throwIfAborted();
    const attempt = await mkdtemp(join(stagingRoot, operation === "render" ? "render-" : "analysis-"));
    directory = attempt;
    await chmod(attempt, 0o700);
    const result = await exchangeRunner(
      socketPath,
      source,
      exchangeSignal,
      deadline,
      (socket) => receiveArtifacts(socket, attempt, operation, validate, exchangeSignal),
      prefix,
    );
    if (exchangeSignal.aborted || performance.now() >= deadline) throw new ArtifactReceiverError();
    return { directory: attempt, result };
  } catch {
    // The exchange settles its streams and file operations before rejecting.
    if (directory) await rm(directory, { force: true, recursive: true }).catch(() => {});
    throw new ArtifactReceiverError();
  } finally {
    clearTimeout(timer);
  }
}
