import { z } from "zod";
import { type EditPlan, editPlanSchema, type MediaMetadata } from "../../../packages/domain/src/index";
import { artifactDeclarationSchema, receiveRunnerArtifacts, runnerMetadataSchema } from "./artifact-receiver";

const LENGTH_BYTES = 4;
const MAX_REQUEST_BYTES = 1024 * 1024;

const manifestSchema = z.strictObject({
  version: z.literal(1),
  operation: z.literal("render"),
  result: runnerMetadataSchema,
  artifacts: z.tuple([artifactDeclarationSchema.extend({ name: z.literal("render.mp4") })]),
});

export class RenderRunnerError extends Error {
  constructor() {
    super("Media render runner unavailable");
    this.name = "RenderRunnerError";
  }
}

function renderPrefix(plan: EditPlan): Buffer {
  const request = Buffer.from(
    JSON.stringify({ version: 1, operation: "render", plan: editPlanSchema.parse(plan) }),
  );
  if (request.length > MAX_REQUEST_BYTES) throw new RenderRunnerError();
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
  try {
    signal?.throwIfAborted();
    const { directory, result } = await receiveRunnerArtifacts(
      socketPath,
      source,
      stagingRoot,
      "render",
      (raw) => manifestSchema.parse(raw),
      signal,
      timeoutMs,
      renderPrefix(plan),
    );
    return { directory, metadata: result };
  } catch {
    throw new RenderRunnerError();
  }
}
