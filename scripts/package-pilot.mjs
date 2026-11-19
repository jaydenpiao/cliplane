import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function resolvePackageRequest(env, event) {
  if (
    env.GITHUB_REPOSITORY !== "jaydenpiao/cliplane" ||
    env.GITHUB_REPOSITORY_ID !== "1459551943" ||
    env.GITHUB_REPOSITORY_OWNER_ID !== "71306047" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_WORKFLOW_REF !== "jaydenpiao/cliplane/.github/workflows/pilot-package.yml@refs/heads/main" ||
    env.GITHUB_EVENT_NAME !== "repository_dispatch" ||
    event?.action !== "cliplane-pilot-package"
  )
    throw new Error("Packaging requires the Cliplane main pilot package workflow and dispatch.");

  const payload = event.client_payload;
  if (
    !payload ||
    Object.keys(payload).length !== 2 ||
    !Object.hasOwn(payload, "expected_sha") ||
    !Object.hasOwn(payload, "recipient_cert_base64")
  )
    throw new Error("Packaging requires the reviewed commit and recipient certificate.");
  const { expected_sha: expectedSha, recipient_cert_base64: encoded } = payload;
  if (
    typeof expectedSha !== "string" ||
    expectedSha.length !== 40 ||
    !/^[0-9a-f]+$/.test(expectedSha) ||
    expectedSha !== env.GITHUB_SHA
  )
    throw new Error("Packaging requires a matching reviewed commit.");
  if (typeof encoded !== "string" || !encoded || encoded.length > 8192)
    throw new Error("Invalid recipient certificate encoding.");

  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64") !== encoded) throw new Error("Invalid recipient certificate encoding.");
  const pem = decoded.toString("utf8");
  const block = pem.match(/^-----BEGIN CERTIFICATE-----\n([A-Za-z0-9+/=\n]+)\n-----END CERTIFICATE-----\n?$/);
  if (block?.[0] !== pem) throw new Error("Packaging requires a single PEM recipient certificate.");

  const der = execFileSync("openssl", ["x509", "-inform", "PEM", "-outform", "DER"], {
    input: decoded,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (der.toString("base64") !== block[1].replaceAll("\n", ""))
    throw new Error("Invalid recipient certificate body.");
  const key = new X509Certificate(der).publicKey;
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
    throw new Error("Packaging requires an RSA recipient key of at least 2048 bits.");
  return decoded;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , output] = process.argv;
    if (
      process.argv.length !== 3 ||
      !output ||
      !process.env.RUNNER_TEMP ||
      dirname(resolve(output)) !== resolve(process.env.RUNNER_TEMP)
    )
      throw new Error("Pass the recipient path directly under the runner's temporary directory.");
    const certificate = resolvePackageRequest(
      process.env,
      JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
    );
    writeFileSync(output, certificate, { flag: "wx", mode: 0o600 });
  } catch {
    console.error("Private pilot package request was rejected.");
    process.exitCode = 1;
  }
}
