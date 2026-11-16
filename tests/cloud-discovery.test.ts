import { describe, expect, it } from "vitest";
import { requiredApis, resolveTarget, validateTarget, verifyAccess } from "../scripts/cloud/discover.mjs";

const target = {
  projectId: "example-staging",
  provider: "projects/123456789/locations/global/workloadIdentityPools/cliplane-github/providers/staging",
  serviceAccount: "cliplane-ci-discovery@example-staging.iam.gserviceaccount.com",
};
const env = {
  GITHUB_REPOSITORY: "jaydenpiao/cliplane",
  GITHUB_REPOSITORY_ID: "1459551943",
  GITHUB_REPOSITORY_OWNER_ID: "71306047",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "repository_dispatch",
};
const event = {
  action: "cloud-discovery",
  client_payload: {
    project_id: target.projectId,
    workload_identity_provider: target.provider,
    service_account: target.serviceAccount,
  },
};
function google(
  options: { projectNumber?: string; missingApi?: boolean; permissions?: string[]; paginate?: boolean } = {},
) {
  const requests: { url: string; method: string; body?: string }[] = [];
  const request: typeof fetch = async (input, initOptions) => {
    const url = input instanceof Request ? input.url : String(input);
    const init = initOptions || {};
    requests.push({ url, method: init.method || "GET", body: init.body as string | undefined });
    expect(new URL(url).hostname.endsWith(".googleapis.com")).toBe(true);
    expect(init.redirect).toBe("error");
    expect(init.headers).toHaveProperty("Authorization", "Bearer ephemeral-test-token");
    if (url.includes("/v3/projects/"))
      return Response.json({
        name: `projects/${options.projectNumber || "123456789"}`,
        projectId: target.projectId,
        state: "ACTIVE",
      });
    if (url.includes(":testIamPermissions"))
      return Response.json(options.permissions ? { permissions: options.permissions } : {});
    const names = options.missingApi ? requiredApis.slice(1) : requiredApis;
    if (options.paginate && !new URL(url).searchParams.has("pageToken"))
      return Response.json({ services: [], nextPageToken: "next / page" });
    return Response.json({ services: names.map((name) => ({ state: "ENABLED", config: { name } })) });
  };
  return { request, requests };
}

describe("keyless discovery boundaries", () => {
  it("resolves only validated Cliplane main dispatch inputs", () => {
    expect(resolveTarget(env, event)).toEqual({ ...target, projectNumber: "123456789" });
    for (const override of [
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_REPOSITORY: "other/cliplane" },
      { GITHUB_REPOSITORY_ID: "1" },
      { GITHUB_REPOSITORY_OWNER_ID: "1" },
      { GITHUB_EVENT_NAME: "pull_request" },
    ])
      expect(() => resolveTarget({ ...env, ...override }, event)).toThrow();
    expect(() => resolveTarget(env, { ...event, action: "deploy" })).toThrow();
    expect(() =>
      resolveTarget(env, { ...event, client_payload: { ...event.client_payload, command: "unexpected" } }),
    ).toThrow();
  });
  it("supports owner-configured variables without accepting arbitrary cloud identities", () => {
    expect(
      resolveTarget(
        {
          ...env,
          GITHUB_EVENT_NAME: "workflow_dispatch",
          CONFIG_PROJECT_ID: target.projectId,
          CONFIG_PROVIDER: target.provider,
          CONFIG_SERVICE_ACCOUNT: target.serviceAccount,
        },
        {},
      ),
    ).toHaveProperty("projectId", target.projectId);
    for (const override of [
      { projectId: "bad\ncommand" },
      { provider: "projects/123/locations/global/workloadIdentityPools/other/providers/staging" },
      { serviceAccount: "other@example-staging.iam.gserviceaccount.com" },
    ])
      expect(() => validateTarget({ ...target, ...override })).toThrow();
  });
  it("verifies the actual project and required APIs without provisioning workloads", async () => {
    const { request, requests } = google();
    const result = await verifyAccess(target, "ephemeral-test-token", request);
    expect(result).toMatchObject({
      keylessAccess: "verified",
      checkedProvisioningPermissions: "absent",
      workloadsCreated: false,
    });
    expect(result).not.toHaveProperty("scope");
    expect(result.checkedPermissions).toEqual(JSON.parse(requests[2].body || "{}").permissions);
    expect(requests.map((r) => r.method)).toEqual(["GET", "GET", "POST"]);
    expect(requests[2].url).toContain(":testIamPermissions");
    expect(JSON.parse(requests[2].body || "{}")).toHaveProperty("permissions");
  });
  it("rejects a mismatched project before reading additional resources", async () => {
    const { request, requests } = google({ projectNumber: "987654321" });
    await expect(verifyAccess(target, "ephemeral-test-token", request)).rejects.toThrow(
      "identity or lifecycle",
    );
    expect(requests).toHaveLength(1);
  });
  it("rejects missing federation APIs and unintended deployment permissions", async () => {
    await expect(
      verifyAccess(target, "ephemeral-test-token", google({ missingApi: true }).request),
    ).rejects.toThrow("not all enabled");
    await expect(
      verifyAccess(target, "ephemeral-test-token", google({ permissions: ["run.services.create"] }).request),
    ).rejects.toThrow("provisioning permissions");
  });
  it("handles paginated service discovery with encoded cursors", async () => {
    const { request, requests } = google({ paginate: true });
    await expect(verifyAccess(target, "ephemeral-test-token", request)).resolves.toHaveProperty(
      "keylessAccess",
      "verified",
    );
    expect(new URL(requests[2].url).searchParams.get("pageToken")).toBe("next / page");
  });
  it("does not expose tokens, transport errors or raw cloud error bodies", async () => {
    await expect(
      verifyAccess(target, "private-token", async () => {
        throw new Error("private-token transport detail");
      }),
    ).rejects.toThrow("request failed or timed out");
    await expect(
      verifyAccess(
        target,
        "private-token",
        async () => new Response("private-token server detail", { status: 403 }),
      ),
    ).rejects.toThrow("HTTP 403");
    await expect(
      verifyAccess(target, "", async () => {
        throw new Error("must not call");
      }),
    ).rejects.toThrow("token is required");
  });
});
