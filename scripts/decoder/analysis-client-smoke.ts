import { basename } from "node:path";
import { analyzeWithRunner } from "../../apps/api/src/analysis-client";

const [, , socketPath, source, stagingRoot] = process.argv;
if (!socketPath || !source || !stagingRoot || process.argv.length !== 5)
  throw new Error("Expected a socket, source and staging root");

const analysis = await analyzeWithRunner(socketPath, source, stagingRoot);
console.log(JSON.stringify({ attempt: basename(analysis.directory), result: analysis.result }));
