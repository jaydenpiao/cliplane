import { pathToFileURL } from "node:url";
import { type DockerCommandRunner, runDecoderPreflight } from "./runtime-preflight";

export async function runPreflightCli(
  argv: string[],
  write: (line: string) => void,
  runner?: DockerCommandRunner,
  signal?: AbortSignal,
): Promise<0 | 2> {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    write(
      "Usage: npm run decoder:preflight -- --image sha256:<64 lowercase hex>\nRequires a trusted local image with /bin/sh and cat, and no declared volumes. Controller preflight only; decoder isolation remains unqualified.",
    );
    return 0;
  }
  const image = argv.length === 2 && argv[0] === "--image" ? argv[1] : "";
  const report = await runDecoderPreflight({ image, runner, signal });
  write(JSON.stringify(report));
  return report.verdict === "preflight_passed" ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    process.exitCode = await runPreflightCli(
      process.argv.slice(2),
      (line) => console.log(line),
      undefined,
      controller.signal,
    );
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
