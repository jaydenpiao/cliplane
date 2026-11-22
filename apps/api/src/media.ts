import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { EditPlan, MediaMetadata } from "../../../packages/domain/src/index";
import { runJsonProcess, WorkerProcessExitError } from "./worker-process";

export type MediaRequest = { source: string } & (
  | { operation: "probe" }
  | { operation: "analyze"; outputDir: string }
  | { operation: "render"; output: string; plan: EditPlan }
);
export type MediaExecutor = <T = unknown>(input: MediaRequest, signal?: AbortSignal) => Promise<T>;

export type MediaAnalysisResult = {
  metadata: MediaMetadata;
  candidates: {
    startMs: number;
    endMs: number;
    score: number;
    components: { audio: number; scene: number; boundary: number };
    reason: string;
    thumbnail: string;
  }[];
  signals: { audioRms: number[]; sceneTimes: number[] };
  telemetry: { wallSeconds: number; sourceHours: number; transcriptionCost: number; method: string };
};

export const mediaMetadataSchema = z.strictObject({
  durationMs: z.number().int().min(100).max(43_200_000),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  hasAudio: z.boolean(),
  fps: z.number().finite().min(0),
  codec: z.string().min(1),
  audioTracks: z.array(
    z.strictObject({ index: z.number().int().nonnegative(), role: z.enum(["mixed", "microphone", "game"]) }),
  ),
}) satisfies z.ZodType<MediaMetadata>;

export class UnsupportedMediaError extends Error {
  constructor(message = "Unsupported media input") {
    super(message);
    this.name = "UnsupportedMediaError";
  }
}

const worker = fileURLToPath(new URL("../../../workers/media/pipeline.py", import.meta.url));
// The native CLI reserves EX_DATAERR for probe input rejection. CPython also uses exit 2.
const PROBE_INPUT_REJECTED = 65;

export const media: MediaExecutor = async <T>(input: MediaRequest, signal?: AbortSignal) => {
  try {
    return await runJsonProcess<T>(
      process.env.PYTHON_BIN || "python3",
      [worker],
      input,
      undefined,
      undefined,
      signal,
    );
  } catch (error) {
    if (
      input.operation === "probe" &&
      error instanceof WorkerProcessExitError &&
      error.exitCode === PROBE_INPUT_REJECTED
    ) {
      throw new UnsupportedMediaError();
    }
    throw error;
  }
};
export async function checksum(filename: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}
