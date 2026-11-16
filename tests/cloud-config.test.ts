import { expect, it } from "vitest";
import { configureGithub } from "../scripts/cloud/configure-github.mjs";

const target = {
  project: "cliplane-test-123",
  provider: "projects/123456789/locations/global/workloadIdentityPools/cliplane-github/providers/staging",
  serviceAccount: "cliplane-ci-discovery@cliplane-test-123.iam.gserviceaccount.com",
};
const prefix = "repos/jaydenpiao/cliplane";
const environmentPath = `${prefix}/environments/staging`;
function githubFixture({ login = "jaydenpiao", admin = true } = {}) {
  let environment: any = null;
  const policies: any[] = [];
  const variables = new Map<string, string>();
  const writes: { method: string; path: string; body: any }[] = [];
  const dispatches: any[] = [];
  const api = (method: string, path: string, body?: any): any => {
    const endpoint = path.split("?")[0];
    if (method !== "GET") writes.push({ method, path: endpoint, body });
    if (endpoint === "user") return { login };
    if (endpoint === prefix) return { permissions: { admin } };
    if (endpoint === `${prefix}/actions/workflows/cloud-discovery.yml`) return { state: "active" };
    if (endpoint === environmentPath) {
      if (method === "PUT") environment = { ...body, protection_rules: [] };
      return environment;
    }
    if (endpoint === `${environmentPath}/deployment-branch-policies`) {
      if (method === "POST") {
        const policy = { id: policies.length + 1, ...body };
        policies.push(policy);
        return policy;
      }
      return { total_count: policies.length, branch_policies: [...policies] };
    }
    if (endpoint === `${environmentPath}/variables`) {
      if (method === "POST") {
        if (variables.has(body.name)) throw new Error("Duplicate variable");
        variables.set(body.name, body.value);
        return null;
      }
      return {
        total_count: variables.size,
        variables: [...variables].map(([name, value]) => ({ name, value })),
      };
    }
    if (endpoint.startsWith(`${environmentPath}/variables/`) && method === "PATCH") {
      variables.set(body.name, body.value);
      return null;
    }
    if (endpoint === `${prefix}/actions/workflows/cloud-discovery.yml/dispatches` && method === "POST") {
      dispatches.push(body);
      return null;
    }
    throw new Error(`Unexpected fixture request: ${method} ${path}`);
  };
  return { api, writes, policies, variables, dispatches, environment: () => environment };
}

it("previews configuration without calling GitHub or writing anything", () => {
  const result = configureGithub({
    ...target,
    api: () => {
      throw new Error("Preview must not require network access");
    },
    output: () => {},
  });
  expect(result).toMatchObject({ apply: false, environment: "staging", ref: "main", dispatched: false });
});

it.each([
  { project: "../wrong" },
  {
    project: "cliplane-test-123\n",
    serviceAccount: "cliplane-ci-discovery@cliplane-test-123\n.iam.gserviceaccount.com",
  },
  {
    provider: "projects/123456789/locations/global/workloadIdentityPools/cliplane-github/providers/staging\n",
  },
  { serviceAccount: "other@cliplane-test-123.iam.gserviceaccount.com" },
  { serviceAccount: "cliplane-ci-discovery@other-project.iam.gserviceaccount.com" },
  { provider: "projects/123456789/locations/global/workloadIdentityPools/other/providers/staging" },
])("rejects malformed or mismatched targets before GitHub writes: %j", (invalid) => {
  const fixture = githubFixture();
  expect(() =>
    configureGithub({ ...target, ...invalid, apply: true, api: fixture.api, output: () => {} }),
  ).toThrow();
  expect(fixture.writes).toHaveLength(0);
});

it.each([{ login: "other-owner" }, { admin: false }])(
  "fails closed on insufficient owner access: %j",
  (access) => {
    const fixture = githubFixture(access);
    expect(() => configureGithub({ ...target, apply: true, api: fixture.api, output: () => {} })).toThrow();
    expect(fixture.writes).toHaveLength(0);
  },
);

it("configures a main-only staging target and dispatches the read-only workflow on main", () => {
  const fixture = githubFixture();
  const result = configureGithub({ ...target, apply: true, api: fixture.api, output: () => {} });
  expect(fixture.environment().deployment_branch_policy).toEqual({
    protected_branches: false,
    custom_branch_policies: true,
  });
  expect(fixture.policies).toEqual([{ id: 1, name: "main", type: "branch" }]);
  expect(Object.fromEntries(fixture.variables)).toEqual({
    GCP_PROJECT_ID: "cliplane-test-123",
    GCP_WORKLOAD_IDENTITY_PROVIDER:
      "projects/123456789/locations/global/workloadIdentityPools/cliplane-github/providers/staging",
    GCP_SERVICE_ACCOUNT: "cliplane-ci-discovery@cliplane-test-123.iam.gserviceaccount.com",
  });
  expect(fixture.dispatches).toEqual([{ ref: "main" }]);
  expect(result).toMatchObject({ configured: true, dispatched: true });
});

it("reuses environment and branch policy and updates changed variables on rerun", () => {
  const fixture = githubFixture();
  const config = { ...target, apply: true, api: fixture.api, output: () => {} };
  configureGithub(config);
  fixture.variables.set("GCP_PROJECT_ID", "stale-target");
  fixture.writes.length = 0;
  configureGithub(config);
  expect(fixture.policies).toHaveLength(1);
  expect(fixture.variables.get("GCP_PROJECT_ID")).toBe("cliplane-test-123");
  expect(fixture.writes.map(({ method, path }) => ({ method, path }))).toEqual([
    { method: "PATCH", path: `${environmentPath}/variables/GCP_PROJECT_ID` },
    { method: "POST", path: `${prefix}/actions/workflows/cloud-discovery.yml/dispatches` },
  ]);
});

it("preserves owner-created policies and protection rules instead of silently replacing them", () => {
  const fixture = githubFixture();
  const config = { ...target, apply: true, api: fixture.api, output: () => {} };
  configureGithub(config);
  fixture.policies.push({ id: 2, name: "release/*", type: "branch" });
  fixture.writes.length = 0;
  expect(() => configureGithub(config)).toThrow(/policies/);
  expect(fixture.writes).toHaveLength(0);
  fixture.policies.pop();
  fixture.environment().deployment_branch_policy.custom_branch_policies = false;
  fixture.environment().protection_rules = [{ type: "wait_timer", wait_timer: 30 }];
  expect(() => configureGithub(config)).toThrow(/protection rules/);
  expect(fixture.writes).toHaveLength(0);
});
