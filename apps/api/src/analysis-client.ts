import { z } from "zod";
import { artifactDeclarationSchema, receiveRunnerArtifacts, runnerMetadataSchema } from "./artifact-receiver";
import type { MediaAnalysisResult } from "./media";

const MAX_CANDIDATES = 8;
const PROXY = "proxy.mp4";
const POSTER = "poster.jpg";
const nonnegative = z.number().finite().nonnegative();
const ranking = nonnegative.max(100);
const candidateSchema = z.strictObject({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  score: ranking.int(),
  components: z.strictObject({ audio: ranking, scene: ranking, boundary: ranking }),
  reason: z.string().min(1),
  thumbnail: z.string(),
});
const resultSchema = z.strictObject({
  metadata: runnerMetadataSchema,
  candidates: z.array(candidateSchema).max(MAX_CANDIDATES),
  signals: z.strictObject({ audioRms: z.array(nonnegative), sceneTimes: z.array(nonnegative) }),
  telemetry: z.strictObject({
    wallSeconds: nonnegative,
    sourceHours: nonnegative,
    transcriptionCost: nonnegative,
    method: z.string().min(1),
  }),
}) satisfies z.ZodType<MediaAnalysisResult>;
const manifestSchema = z.strictObject({
  version: z.literal(1),
  operation: z.literal("analyze"),
  result: resultSchema,
  artifacts: z
    .array(artifactDeclarationSchema)
    .min(2)
    .max(2 + MAX_CANDIDATES),
});

export class AnalysisRunnerError extends Error {
  constructor() {
    super("Media analysis runner unavailable");
    this.name = "AnalysisRunnerError";
  }
}

function validateManifest(raw: unknown) {
  const { result, artifacts } = manifestSchema.parse(raw);
  if (
    artifacts.length !== 2 + result.candidates.length ||
    artifacts[0].name !== PROXY ||
    artifacts[1].name !== POSTER
  )
    throw new AnalysisRunnerError();

  for (const [index, candidate] of result.candidates.entries()) {
    const thumbnail = `thumb-${index}.jpg`;
    if (
      candidate.endMs <= candidate.startMs ||
      candidate.endMs > result.metadata.durationMs ||
      candidate.thumbnail !== thumbnail ||
      artifacts[2 + index].name !== thumbnail
    )
      throw new AnalysisRunnerError();
  }

  return { result, artifacts };
}

/** Stage one analysis under a caller-owned private root. The caller owns a successful return directory. */
export async function analyzeWithRunner(
  socketPath: string,
  source: string,
  stagingRoot: string,
  signal?: AbortSignal,
  timeoutMs = 120_000,
): Promise<{ directory: string; result: MediaAnalysisResult }> {
  try {
    return await receiveRunnerArtifacts(
      socketPath,
      source,
      stagingRoot,
      "analyze",
      validateManifest,
      signal,
      timeoutMs,
    );
  } catch {
    throw new AnalysisRunnerError();
  }
}
