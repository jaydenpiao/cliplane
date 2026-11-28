import { link, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AnalysisRunnerError, analyzeWithRunner } from "./analysis-client";
import type { MediaExecutor, MediaRequest } from "./media";
import { probeWithRunner } from "./probe-client";
import { RenderRunnerError, renderWithRunner } from "./render-client";

async function analyze(
  endpoint: string,
  input: Extract<MediaRequest, { operation: "analyze" }>,
  signal?: AbortSignal,
) {
  const { source, outputDir } = input;
  const parent = dirname(outputDir);
  let ownsOutput = false;
  try {
    signal?.throwIfAborted();
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const { directory, result } = await analyzeWithRunner(endpoint, source, parent, signal);
    try {
      signal?.throwIfAborted();
      await mkdir(outputDir, { mode: 0o700 });
      ownsOutput = true;
      const names = ["proxy.mp4", "poster.jpg", ...result.candidates.map(({ thumbnail }) => thumbnail)];
      for (const name of names) {
        signal?.throwIfAborted();
        await link(join(directory, name), join(outputDir, name));
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
    signal?.throwIfAborted();
    return result;
  } catch {
    if (ownsOutput) await rm(outputDir, { force: true, recursive: true }).catch(() => {});
    throw new AnalysisRunnerError();
  }
}

async function render(
  endpoint: string,
  input: Extract<MediaRequest, { operation: "render" }>,
  signal?: AbortSignal,
) {
  const { source, output, plan } = input;
  const parent = dirname(output);
  let ownsOutput = false;
  try {
    signal?.throwIfAborted();
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const { directory, metadata } = await renderWithRunner(endpoint, source, parent, plan, signal);
    try {
      signal?.throwIfAborted();
      await link(join(directory, "render.mp4"), output);
      ownsOutput = true;
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
    signal?.throwIfAborted();
    return metadata;
  } catch {
    if (ownsOutput) await rm(output, { force: true }).catch(() => {});
    throw new RenderRunnerError();
  }
}

/** Use fixed private runner endpoints and trusted, caller-owned attempt paths. */
export function createIsolatedMediaExecutor(socketRoot: string): MediaExecutor {
  const probeEndpoint = join(socketRoot, "probe.sock");
  const analysisEndpoint = join(socketRoot, "analyze.sock");
  const renderEndpoint = join(socketRoot, "render.sock");
  return async <T>(input: MediaRequest, signal?: AbortSignal): Promise<T> => {
    switch (input.operation) {
      case "probe":
        return (await probeWithRunner(probeEndpoint, input.source, signal)) as T;
      case "analyze":
        return (await analyze(analysisEndpoint, input, signal)) as T;
      case "render":
        return (await render(renderEndpoint, input, signal)) as T;
      default:
        throw new Error("Unsupported media operation");
    }
  };
}
