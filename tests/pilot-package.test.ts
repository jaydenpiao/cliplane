import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolvePackageRequest } from "../scripts/package-pilot.mjs";

const commit = "1".repeat(40);
const env = {
  GITHUB_REPOSITORY: "jaydenpiao/cliplane",
  GITHUB_REPOSITORY_ID: "1459551943",
  GITHUB_REPOSITORY_OWNER_ID: "71306047",
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF: "jaydenpiao/cliplane/.github/workflows/pilot-package.yml@refs/heads/main",
  GITHUB_EVENT_NAME: "repository_dispatch",
  GITHUB_SHA: commit,
};
const action = "cliplane-pilot-package";
const appImage = `sha256:${"a".repeat(64)}`;
const postgresImage = `sha256:${"b".repeat(64)}`;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
let directory: string;
let certificate: Buffer;
let keyPath: string;
let certPath: string;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "cliplane-pilot-package-test-"));
  keyPath = join(directory, "test.key");
  certPath = join(directory, "test.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-noenc",
      "-days",
      "1",
      "-subj",
      "/CN=Cliplane synthetic package test",
      "-keyout",
      keyPath,
      "-out",
      certPath,
    ],
    { stdio: "ignore" },
  );
  certificate = readFileSync(certPath);
});

afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe("private pilot package request", () => {
  it("checks the exact reviewed commit and the intended workflow and dispatch", () => {
    const client_payload = { expected_sha: commit, recipient_cert_base64: certificate.toString("base64") };
    const event = { action, client_payload };
    expect(resolvePackageRequest(env, event)).toEqual(certificate);
    for (const changed of [
      { ...env, GITHUB_SHA: "2".repeat(40) },
      { ...env, GITHUB_REF: "refs/heads/feature" },
      { ...env, GITHUB_REPOSITORY_ID: "1" },
      { ...env, GITHUB_REPOSITORY_OWNER_ID: "1" },
      { ...env, GITHUB_WORKFLOW_REF: "unexpected.yml@refs/heads/main" },
      { ...env, GITHUB_EVENT_NAME: "pull_request" },
    ])
      expect(() => resolvePackageRequest(changed, event)).toThrow();
    expect(() => resolvePackageRequest(env, { ...event, action: "unexpected" })).toThrow();
    expect(() =>
      resolvePackageRequest(env, { action, client_payload: { ...client_payload, bucket: "example" } }),
    ).toThrow();
  });

  it("rejects noncanonical base64, a second PEM block, and private key bytes", () => {
    for (const encoded of [
      `${certificate.toString("base64")}\n`,
      "a".repeat(8196),
      Buffer.concat([certificate, certificate]).toString("base64"),
      readFileSync(keyPath).toString("base64"),
    ])
      expect(() =>
        resolvePackageRequest(env, {
          action,
          client_payload: { expected_sha: commit, recipient_cert_base64: encoded },
        }),
      ).toThrow();
  });
});

describe("private pilot package sealing", () => {
  it("seals only the checked image pair, binds the manifest, and rejects tampered ciphertext", () => {
    const checkout = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const evidence = join(directory, "smoke.json");
    writeFileSync(
      evidence,
      JSON.stringify({ commit: checkout, app_image_id: appImage, postgres_image_id: postgresImage }),
    );
    writeFileSync(
      join(directory, "docker"),
      `#!/bin/bash
set -eu
if [[ "$1 $2" == "image inspect" ]]; then
  printf '%s linux/amd64\\n' "$5"
elif [[ "$1 $2" == "image save" && "$3" == "${appImage}" && "$4" == "${postgresImage}" ]]; then
  printf 'synthetic image pair'
else
  exit 1
fi
`,
      { mode: 0o700 },
    );
    const output = join(directory, "pilot.cms");
    const packageEnv = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      GITHUB_RUN_ID: "12345",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_SHA: checkout,
    };
    const log = execFileSync("bash", ["scripts/package-pilot.sh", evidence, certPath, output], {
      encoding: "utf8",
      env: packageEnv,
    });
    const sealed = readFileSync(output);
    expect(log).toContain(`bytes=${sealed.length} sha256=${sha256(sealed)}`);
    const owner = join(directory, "owner.pem");
    writeFileSync(owner, Buffer.concat([certificate, readFileSync(keyPath)]), { mode: 0o600 });
    const unpack = ["scripts/unpack-pilot.sh", output, owner, sha256(sealed), checkout];
    const unpacked = join(directory, "unpacked");
    execFileSync("bash", [...unpack, unpacked], { stdio: "pipe" });
    const manifest = JSON.parse(readFileSync(join(unpacked, "manifest.json"), "utf8"));
    const images = readFileSync(join(unpacked, "images.tar.gz"));
    expect(manifest).toEqual({
      schema: 1,
      commit: checkout,
      platform: "linux/amd64",
      run_id: "12345",
      run_attempt: "1",
      app_image_id: appImage,
      postgres_image_id: postgresImage,
      archive_sha256: sha256(images),
      archive_bytes: images.length,
    });
    expect(execFileSync("gzip", ["-dc"], { input: images, encoding: "utf8" })).toBe("synthetic image pair");
    const rejected = join(directory, "rejected");
    expect(spawnSync("bash", [...unpack.slice(0, 3), "f".repeat(64), checkout, rejected]).status).not.toBe(0);
    expect(spawnSync("bash", [...unpack.slice(0, 4), "f".repeat(40), rejected]).status).not.toBe(0);
    sealed[Math.floor(sealed.length / 2)] ^= 1;
    writeFileSync(output, sealed);
    expect(spawnSync("bash", [...unpack.slice(0, 3), sha256(sealed), checkout, rejected]).status).not.toBe(0);
    expect(existsSync(rejected)).toBe(false);
  });
});
