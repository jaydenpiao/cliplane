import { rejects } from "node:assert/strict";
import { createIsolatedMediaExecutor } from "../../apps/api/src/isolated-media";
import { type MediaAnalysisResult, UnsupportedMediaError } from "../../apps/api/src/media";
import { editPlanSchema, type MediaMetadata } from "../../packages/domain/src/index";

const [, , socketRoot, source, invalidSource, outputDir, output, planJson] = process.argv;
if (
  !socketRoot ||
  !source ||
  !invalidSource ||
  !outputDir ||
  !output ||
  !planJson ||
  process.argv.length !== 8
)
  throw new Error("Expected socket root, two sources, two output paths and a render plan");

const plan = editPlanSchema.parse(JSON.parse(planJson));
const executeMedia = createIsolatedMediaExecutor(socketRoot);
const metadata = await executeMedia<MediaMetadata>({ operation: "probe", source });
await rejects(() => executeMedia({ operation: "probe", source: invalidSource }), UnsupportedMediaError);
const analysis = await executeMedia<MediaAnalysisResult>({ operation: "analyze", source, outputDir });
const render = await executeMedia<MediaMetadata>({ operation: "render", source, output, plan });
console.log(JSON.stringify({ metadata, analysis, render }));
