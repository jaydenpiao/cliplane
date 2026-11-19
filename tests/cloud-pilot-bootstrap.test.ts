import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = "scripts/cloud/bootstrap-pilot-access.sh";
const project = "example-staging";
const mainSha = "a".repeat(40);

function mockApply(options: { returnedProject?: string; poolExists?: boolean } = {}) {
  const temp = mkdtempSync(join(tmpdir(), "cliplane-bootstrap-"));
  try {
    const cli = join(temp, "gcloud");
    const log = join(temp, "calls");
    writeFileSync(
      cli,
      `#!/bin/bash
printf '%s\\n' "$*" >> "$PILOT_TEST_LOG"
case "$1 $2 $3" in
  "projects describe $PILOT_TEST_PROJECT")
    printf '%s\\t123456789\\tACTIVE\\n' "$PILOT_TEST_RETURNED_PROJECT"
    ;;
  "services list --enabled")
    printf '%s\\n' iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com
    ;;
  "iam service-accounts list") ;;
  "iam service-accounts describe") printf '%s\\n' "$4" ;;
  "iam workload-identity-pools list")
    if [[ "$PILOT_TEST_POOL_EXISTS" == 1 ]]; then
      printf '%s\\n' projects/123456789/locations/global/workloadIdentityPools/cliplane-pilot-ci
    fi
    ;;
  "iam service-accounts create" | "iam workload-identity-pools create" | "iam service-accounts add-iam-policy-binding") ;;
  "iam workload-identity-pools providers")
    [[ "$4" == create-oidc ]]
    ;;
  *) exit 81 ;;
esac
`,
    );
    chmodSync(cli, 0o700);
    const result = spawnSync("bash", [script, project, mainSha, "--apply"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${temp}:${process.env.PATH}`,
        PILOT_TEST_LOG: log,
        PILOT_TEST_PROJECT: project,
        PILOT_TEST_RETURNED_PROJECT: options.returnedProject ?? project,
        PILOT_TEST_POOL_EXISTS: options.poolExists ? "1" : "0",
      },
    });
    return { ...result, calls: readFileSync(log, "utf8") };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

describe("pilot authentication bootstrap", () => {
  it("previews a new exact workflow trust and a single service-account binding", () => {
    const output = execFileSync("bash", [script, project, mainSha], { encoding: "utf8" });
    expect(output).toContain("Preview only");
    expect(output).toContain("cliplane-pilot-ci");
    expect(output).toContain("cliplane-ci-pilot");
    expect(output).toContain(".github/workflows/pilot-gcloud.yml@refs/heads/main");
    expect(output).toContain("environment:staging");
    expect(output).toContain("repository_dispatch");
    expect(output).toMatch(/assertion\.sha.*a{40}/);
    expect(output).toMatch(/assertion\.workflow_sha.*a{40}/);
    expect(output).toContain("1459551943");
    expect(output).toContain("71306047");
    expect(output).toContain("roles/iam.workloadIdentityUser");
    expect(output).not.toContain("projects add-iam-policy-binding");
    expect(output).not.toContain("cliplane-ci-discovery");
  });

  it("creates the separate pilot identity without granting it cloud resource roles", () => {
    const result = mockApply();
    expect(result.status).toBe(0);
    const mutations = result.calls.split("\n").filter((line) => /create|add-iam-policy-binding/.test(line));
    expect(mutations).toHaveLength(4);
    expect(mutations.every((line) => line.includes(`--project=${project}`))).toBe(true);
    expect(mutations[3]).toContain(
      "/subject/repo:jaydenpiao@71306047/cliplane@1459551943:environment:staging",
    );
    expect(result.stdout).toContain("PILOT_PROJECT_NUMBER=123456789");
  });

  it("fails before mutation for an unexpected project or existing pilot pool", () => {
    for (const result of [mockApply({ returnedProject: "other-project" }), mockApply({ poolExists: true })]) {
      expect(result.status).not.toBe(0);
      expect(result.calls).not.toMatch(/ create | create-oidc | add-iam-policy-binding /);
    }
  });

  it("rejects invalid project IDs and unknown switches", () => {
    expect(spawnSync("bash", [script, "wrong\nproject"]).status).toBe(2);
    expect(spawnSync("bash", [script, project, mainSha, "--force"]).status).toBe(2);
    expect(spawnSync("bash", [script, project, "main"]).status).toBe(2);
  });
});
