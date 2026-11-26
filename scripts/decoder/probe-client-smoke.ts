import { UnsupportedMediaError } from "../../apps/api/src/media";
import { probeWithRunner } from "../../apps/api/src/probe-client";

const [, , socketPath, source] = process.argv;
if (!socketPath || !source || process.argv.length !== 4) throw new Error("Expected a socket and source");
try {
  const metadata = await probeWithRunner(socketPath, source);
  console.log(JSON.stringify({ status: "ok", metadata }));
} catch (error) {
  console.log(
    JSON.stringify({ status: error instanceof UnsupportedMediaError ? "unsupported" : "unavailable" }),
  );
}
