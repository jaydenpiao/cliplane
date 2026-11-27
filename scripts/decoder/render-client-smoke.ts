import { basename } from "node:path";
import { renderWithRunner } from "../../apps/api/src/render-client";
import { editPlanSchema } from "../../packages/domain/src/index";

const [, , socketPath, source, stagingRoot, planJson] = process.argv;
if (!socketPath || !source || !stagingRoot || !planJson || process.argv.length !== 6)
  throw new Error("Expected a socket, source, staging root and render plan");

const plan = editPlanSchema.parse(JSON.parse(planJson));
const rendered = await renderWithRunner(socketPath, source, stagingRoot, plan);
console.log(JSON.stringify({ attempt: basename(rendered.directory), metadata: rendered.metadata }));
