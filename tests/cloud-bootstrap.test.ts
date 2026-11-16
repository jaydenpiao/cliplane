import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = "scripts/cloud/bootstrap-access.sh";
describe("Google federation bootstrap preview", () => {
  it("pins GitHub's immutable repository subject and preserves all trust boundaries", () => {
    const plan = execFileSync("bash", [script, "example-staging"], { encoding: "utf8" });
    expect(plan).toContain("repo:jaydenpiao@71306047/cliplane@1459551943:environment:staging");
    for (const constraint of [
      "assertion.repository_id",
      "1459551943",
      "assertion.repository_owner_id",
      "71306047",
      "refs/heads/main",
    ])
      expect(plan).toContain(constraint);
    expect(plan).toContain("Preview only. No cloud changes made.");
    expect(plan).not.toContain("roles/editor");
    expect(plan).not.toContain("roles/owner");
  });
  it("rejects unsupported modes and malformed project inputs before cloud commands", () => {
    for (const args of [["bad;command"], ["example-staging", "--unknown"]]) {
      expect(() => execFileSync("bash", [script, ...args], { stdio: "pipe" })).toThrow();
    }
  });
});
