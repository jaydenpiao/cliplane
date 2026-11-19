import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePilotTarget } from "../scripts/cloud/pilot-target.mjs";

const env = {
  GITHUB_REPOSITORY: "jaydenpiao/cliplane",
  GITHUB_REPOSITORY_ID: "1459551943",
  GITHUB_REPOSITORY_OWNER_ID: "71306047",
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF: "jaydenpiao/cliplane/.github/workflows/pilot-gcloud.yml@refs/heads/main",
  GITHUB_EVENT_NAME: "repository_dispatch",
};
const payload = { project_id: "example-staging", project_number: "123456789" };
const event = { action: "cliplane-pilot-auth", client_payload: payload };
const target = {
  projectId: payload.project_id,
  projectNumber: payload.project_number,
  provider: "projects/123456789/locations/global/workloadIdentityPools/cliplane-pilot-ci/providers/github",
  serviceAccount: "cliplane-ci-pilot@example-staging.iam.gserviceaccount.com",
};

describe("pilot keyless authentication target", () => {
  it("derives the dedicated provider and account from the two project identifiers", () => {
    expect(resolvePilotTarget(env, event)).toEqual(target);
  });

  it("rejects a different repository, owner, ref, workflow or event", () => {
    for (const override of [
      { GITHUB_REPOSITORY: "other/cliplane" },
      { GITHUB_REPOSITORY_ID: "1" },
      { GITHUB_REPOSITORY_OWNER_ID: "1" },
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_WORKFLOW_REF: "jaydenpiao/cliplane/.github/workflows/cloud-discovery.yml@refs/heads/main" },
      { GITHUB_EVENT_NAME: "workflow_dispatch" },
    ])
      expect(() => resolvePilotTarget({ ...env, ...override }, event)).toThrow();
    expect(() => resolvePilotTarget(env, { ...event, action: "cloud-discovery" })).toThrow();
  });

  it("rejects missing, extra or malformed inputs", () => {
    for (const client_payload of [
      null,
      [payload.project_id, payload.project_number],
      { project_id: payload.project_id },
      { ...payload, service_account: target.serviceAccount },
      { ...payload, workload_identity_provider: target.provider },
      { ...payload, project_id: "Example-Staging" },
      { ...payload, project_id: "example-staging-" },
      { ...payload, project_id: "example-staging\n" },
      { ...payload, project_id: "example-staging\nprovider=malicious" },
      { ...payload, project_id: " example-staging" },
      { ...payload, project_number: "123456789\r\n" },
      { ...payload, project_number: "0123456789" },
      { ...payload, project_number: 123456789 },
      { ...payload, project_number: "1e12" },
    ])
      expect(() => resolvePilotTarget(env, { ...event, client_payload })).toThrow();
  });

  it("masks cloud identifiers before emitting only the auth inputs", () => {
    const directory = mkdtempSync(join(tmpdir(), "cliplane-pilot-target-"));
    try {
      const eventPath = join(directory, "event.json");
      const outputPath = join(directory, "output");
      writeFileSync(eventPath, JSON.stringify(event));
      const stdout = execFileSync(process.execPath, ["scripts/cloud/pilot-target.mjs"], {
        env: { ...env, NODE_ENV: "test", GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath },
        encoding: "utf8",
      });
      expect(stdout.trim().split("\n")).toEqual(Object.values(target).map((value) => `::add-mask::${value}`));
      expect(readFileSync(outputPath, "utf8")).toBe(
        `project_id=${target.projectId}\nprovider=${target.provider}\nservice_account=${target.serviceAccount}\n`,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
