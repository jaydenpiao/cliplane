import { constants } from "node:fs";
import { chmod, mkdtemp, open, rm } from "node:fs/promises";
import type { Socket } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import { type EditPlan, editPlanSchema, type MediaMetadata } from "../../../packages/domain/src/index";
import { mediaMetadataSchema } from "./media";
import { exchangeRunner } from "./runner-exchange";

const LENGTH_BYTES = 4;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const MAX_JSON_DEPTH = 32;
const RENDER_ARTIFACT = "render.mp4";

const manifestSchema = z.strictObject({
  version: z.literal(1),
  operation: z.literal("render"),
  result: mediaMetadataSchema.extend({
    codec: mediaMetadataSchema.shape.codec.regex(/^[A-Za-z0-9_-]+$/),
  }),
  artifacts: z.tuple([
    z.strictObject({
      name: z.literal(RENDER_ARTIFACT),
      bytes: z.number().int().min(1).max(MAX_ARTIFACT_BYTES),
    }),
  ]),
});

export class RenderRunnerError extends Error {
  constructor() {
    super("Media render runner unavailable");
    this.name = "RenderRunnerError";
  }
}

function decodeManifest(payload: Buffer): unknown {
  // Keep a BOM visible so JSON.parse rejects it as the decoder's JSON reader does.
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload);
  // Pass JSON syntax to JSON.parse, checking depth and repeated keys before it builds objects.
  const token = /[ \t\r\n]*("[^"\\]*(?:\\[\s\S][^"\\]*)*"|[{}[\],:]|[^ \t\r\n{}[\],:"]+)/y;
  let current = token.exec(text)?.[1];

  function take(): string {
    if (current === undefined) throw new RenderRunnerError();
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
    if (!consume(end)) throw new RenderRunnerError();
  }

  function scanValue(depth: number, key?: string): void {
    if (depth > MAX_JSON_DEPTH) throw new RenderRunnerError();
    // These declarations are integers in the decoder protocol, including their wire tokens.
    if (key === "version" || key === "bytes") {
      if (!/^-?(?:0|[1-9][0-9]*)$/.test(take())) throw new RenderRunnerError();
    } else if (consume("{")) {
      const keys = new Set<string>();
      scanEntries("}", () => {
        const rawKey = take();
        if (!rawKey.startsWith('"')) throw new RenderRunnerError();
        const name: string = JSON.parse(rawKey);
        if (keys.has(name) || !consume(":")) throw new RenderRunnerError();
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
        if (next.done) throw new RenderRunnerError();
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
    if (pending.length || !(await iterator.next()).done) throw new RenderRunnerError();
  }

  return { take, read, requireEnd };
}

async function receiveRender(socket: Socket, directory: string, signal: AbortSignal): Promise<MediaMetadata> {
  const stream = socketReader(socket);
  const length = (await stream.read(LENGTH_BYTES)).readUInt32BE();
  if (length < 1 || length > MAX_MANIFEST_BYTES) throw new RenderRunnerError();
  const manifest = manifestSchema.parse(decodeManifest(await stream.read(length)));
  signal.throwIfAborted();
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
  const artifact = await open(join(directory, RENDER_ARTIFACT), flags, 0o600);
  try {
    await artifact.chmod(0o600);
    for await (const bytes of stream.take(manifest.artifacts[0].bytes)) {
      signal.throwIfAborted();
      await artifact.writeFile(bytes);
    }
  } finally {
    await artifact.close();
  }
  await stream.requireEnd();
  return manifest.result;
}

function renderPrefix(plan: EditPlan): Buffer {
  const request = Buffer.from(
    JSON.stringify({ version: 1, operation: "render", plan: editPlanSchema.parse(plan) }),
  );
  if (request.length > MAX_MANIFEST_BYTES) throw new RenderRunnerError();
  const header = Buffer.alloc(LENGTH_BYTES);
  header.writeUInt32BE(request.length);
  return Buffer.concat([header, request]);
}

/** Stage one render under a caller-owned private root. The caller owns a successful return directory. */
export async function renderWithRunner(
  socketPath: string,
  source: string,
  stagingRoot: string,
  plan: EditPlan,
  signal?: AbortSignal,
  timeoutMs = 120_000,
): Promise<{ directory: string; metadata: MediaMetadata }> {
  if (signal?.aborted || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new RenderRunnerError();

  const deadline = performance.now() + timeoutMs;
  const timeout = new AbortController();
  const exchangeSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  let directory: string | undefined;
  try {
    const prefix = renderPrefix(plan);
    exchangeSignal.throwIfAborted();
    const attempt = await mkdtemp(join(stagingRoot, "render-"));
    directory = attempt;
    await chmod(attempt, 0o700);
    const metadata = await exchangeRunner(
      socketPath,
      source,
      exchangeSignal,
      deadline,
      (socket) => receiveRender(socket, attempt, exchangeSignal),
      prefix,
    );
    if (exchangeSignal.aborted || performance.now() >= deadline) throw new RenderRunnerError();
    return { directory: attempt, metadata };
  } catch {
    // The exchange settles its streams and file operations before rejecting.
    if (directory) await rm(directory, { force: true, recursive: true }).catch(() => {});
    throw new RenderRunnerError();
  } finally {
    clearTimeout(timer);
  }
}
