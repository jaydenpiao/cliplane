import { addAbortListener } from "node:events";
import type { Socket } from "node:net";
import { z } from "zod";
import type { MediaMetadata } from "../../../packages/domain/src/index";
import { mediaMetadataSchema, UnsupportedMediaError } from "./media";
import { exchangeRunner } from "./runner-exchange";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const LENGTH_BYTES = 4;
const UNSUPPORTED_RESPONSE = Buffer.from('{"status":"unsupported"}');

const responseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    metadata: mediaMetadataSchema.extend({
      codec: mediaMetadataSchema.shape.codec.regex(/^[A-Za-z0-9_-]+$/),
    }),
  }),
  z.strictObject({ status: z.enum(["invalid_request", "unsupported", "unavailable"]) }),
]);

export class ProbeRunnerError extends Error {
  constructor() {
    super("Media probe runner unavailable");
    this.name = "ProbeRunnerError";
  }
}

async function readResponse(socket: Socket): Promise<Buffer> {
  const header = Buffer.alloc(LENGTH_BYTES);
  let headerBytes = 0;
  let payload: Buffer | undefined;
  let payloadBytes = 0;
  for await (const value of socket) {
    const chunk: Buffer = value;
    let consumed = 0;
    if (!payload) {
      consumed = chunk.copy(header, headerBytes);
      headerBytes += consumed;
      if (headerBytes < header.length) continue;
      const length = header.readUInt32BE();
      if (length === 0 || length > MAX_RESPONSE_BYTES) throw new ProbeRunnerError();
      payload = Buffer.allocUnsafe(length);
    }
    if (chunk.length - consumed > payload.length - payloadBytes) throw new ProbeRunnerError();
    payloadBytes += chunk.copy(payload, payloadBytes, consumed);
  }
  if (!payload || payloadBytes !== payload.length) throw new ProbeRunnerError();
  return payload;
}

export async function probeWithRunner(
  socketPath: string,
  source: string,
  signal?: AbortSignal,
  timeoutMs = 120_000,
): Promise<MediaMetadata> {
  if (signal?.aborted || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new ProbeRunnerError();
  const deadline = performance.now() + timeoutMs;
  const timeout = new AbortController();
  const exchangeSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  let abortListener: ReturnType<typeof addAbortListener> | undefined;
  let response: z.infer<typeof responseSchema>;
  try {
    const cancelled = new Promise<never>((_, reject) => {
      abortListener = addAbortListener(exchangeSignal, () => reject(new ProbeRunnerError()));
    });
    const payload = await Promise.race([
      exchangeRunner(socketPath, source, exchangeSignal, deadline, readResponse),
      cancelled,
    ]);
    response = responseSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)));
    // Only the runner's fixed payload confirms rejection, including when JSON keys are repeated.
    if (response.status === "unsupported" && !payload.equals(UNSUPPORTED_RESPONSE))
      throw new ProbeRunnerError();
    if (exchangeSignal.aborted || performance.now() >= deadline) throw new ProbeRunnerError();
  } catch {
    throw new ProbeRunnerError();
  } finally {
    clearTimeout(timer);
    abortListener?.[Symbol.dispose]();
  }
  if (response.status === "ok") return response.metadata;
  if (response.status === "unsupported") throw new UnsupportedMediaError();
  throw new ProbeRunnerError();
}
