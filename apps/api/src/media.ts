import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { runJsonProcess } from "./worker-process";

const worker = fileURLToPath(new URL("../../../workers/media/pipeline.py", import.meta.url));
export function media<T = any>(input: Record<string, unknown>): Promise<T> {
  return runJsonProcess<T>(process.env.PYTHON_BIN || "python3", [worker], input);
}
export async function checksum(filename: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}
