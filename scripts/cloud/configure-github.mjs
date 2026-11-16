#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repository = "jaydenpiao/cliplane";
const prefix = `repos/${repository}`;
const environmentPath = `${prefix}/environments/staging`;
const workflowPath = `${prefix}/actions/workflows/cloud-discovery.yml`;
const branchPolicy = { protected_branches: false, custom_branch_policies: true };

function githubApi(method, path, body, allowMissing = false) {
  const args = ["api", path, "--method", method, "-H", "X-GitHub-Api-Version: 2026-03-10"];
  if (body !== undefined) args.push("--input", "-");
  try {
    const raw = execFileSync("gh", args, {
      input: body === undefined ? undefined : JSON.stringify(body),
      encoding: "utf8",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GH_PAGER: "cat" },
    });
    return raw.trim() ? JSON.parse(raw) : null;
  } catch (error) {
    const status = /HTTP (\d{3})/.exec(String(error.stderr))?.[1];
    if (allowMissing && status === "404") return null;
    // Do not forward process arguments, environment or raw stderr containing credentials.
    throw new Error(
      `GitHub request failed${status ? ` (HTTP ${status})` : ""}. Check gh login and permissions.`,
    );
  }
}

function collect(api, path, key) {
  const entries = [];
  for (let page = 1; ; page++) {
    const result = api("GET", `${path}?per_page=100&page=${page}`);
    entries.push(...result[key]);
    if (entries.length >= result.total_count) return entries;
    if (!result[key].length) throw new Error("GitHub returned an incomplete collection.");
  }
}

export function configureGithub({
  project,
  provider,
  serviceAccount,
  apply = false,
  api = githubApi,
  output = console.log,
} = {}) {
  if (
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project ?? "") ||
    !/^projects\/[1-9]\d*\/locations\/global\/workloadIdentityPools\/cliplane-github\/providers\/staging$/.test(
      provider ?? "",
    ) ||
    serviceAccount !== `cliplane-ci-discovery@${project}.iam.gserviceaccount.com`
  )
    throw new Error("Provide a valid project, staging provider and discovery account in that same project.");
  const variables = {
    GCP_PROJECT_ID: project,
    GCP_WORKLOAD_IDENTITY_PROVIDER: provider,
    GCP_SERVICE_ACCOUNT: serviceAccount,
  };
  const result = {
    apply,
    repository,
    environment: "staging",
    ref: "main",
    configured: false,
    dispatched: false,
  };
  if (!apply) {
    output(
      JSON.stringify({ ...result, variables, action: "Preview only; no GitHub or cloud changes" }, null, 2),
    );
    return result;
  }
  if (api("GET", "user").login !== "jaydenpiao" || !api("GET", prefix).permissions?.admin) {
    throw new Error(
      "Authenticate gh as repository owner jaydenpiao with administration and Actions variable access.",
    );
  }
  if (api("GET", workflowPath).state !== "active")
    throw new Error("Merge and enable cloud-discovery.yml first.");
  const environment = api("GET", environmentPath, undefined, true);
  const policies = environment
    ? collect(api, `${environmentPath}/deployment-branch-policies`, "branch_policies")
    : [];
  const existingVariables = environment ? collect(api, `${environmentPath}/variables`, "variables") : [];
  if (policies.some((policy) => policy.name !== "main" || (policy.type ?? "branch") !== "branch")) {
    throw new Error(
      "Staging has deployment policies other than the main branch; review them before configuring access.",
    );
  }
  const needsEnvironment =
    !environment?.deployment_branch_policy?.custom_branch_policies ||
    environment.deployment_branch_policy.protected_branches;
  if (needsEnvironment && environment?.protection_rules?.some((rule) => rule.type !== "branch_policy")) {
    throw new Error(
      "Preserve existing staging protection rules through an owner review before changing branch policy.",
    );
  }
  if (needsEnvironment) api("PUT", environmentPath, { deployment_branch_policy: branchPolicy });
  if (!policies.length)
    api("POST", `${environmentPath}/deployment-branch-policies`, { name: "main", type: "branch" });
  for (const [name, value] of Object.entries(variables)) {
    const existing = existingVariables.find((variable) => variable.name === name);
    if (existing?.value === value) continue;
    api(existing ? "PATCH" : "POST", `${environmentPath}/variables${existing ? `/${name}` : ""}`, {
      name,
      value,
    });
  }
  const verified = api("GET", environmentPath);
  const verifiedPolicies = collect(api, `${environmentPath}/deployment-branch-policies`, "branch_policies");
  const verifiedVariables = collect(api, `${environmentPath}/variables`, "variables");
  if (
    !verified.deployment_branch_policy?.custom_branch_policies ||
    verified.deployment_branch_policy.protected_branches ||
    !verifiedPolicies.length ||
    verifiedPolicies.some((policy) => policy.name !== "main" || (policy.type ?? "branch") !== "branch") ||
    Object.entries(variables).some(
      ([name, value]) =>
        !verifiedVariables.some((variable) => variable.name === name && variable.value === value),
    )
  )
    throw new Error("GitHub configuration verification failed; discovery was not dispatched.");
  result.configured = true;
  api("POST", `${workflowPath}/dispatches`, { ref: "main" });
  result.dispatched = true;
  output(JSON.stringify(result, null, 2));
  output("Discovery was requested, not verified. Inspect its Actions run. No cloud workloads were created.");
  return result;
}

function parseArgs(args) {
  const names = { "--project": "project", "--provider": "provider", "--service-account": "serviceAccount" };
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--apply" && !options.apply) {
      options.apply = true;
      continue;
    }
    const name = names[flag];
    if (!name || options[name] || !args[index + 1] || args[index + 1].startsWith("--"))
      throw new Error("Invalid or repeated arguments; use --help.");
    options[name] = args[++index];
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--help")) {
    console.log(
      "Usage: node scripts/cloud/configure-github.mjs --project PROJECT_ID --provider PROVIDER_RESOURCE --service-account DISCOVERY_ACCOUNT [--apply]\nDefault: offline preview. Run --apply from an owner terminal outside managed credential routing. No keys or tokens belong in arguments.",
    );
  } else {
    try {
      configureGithub(parseArgs(process.argv.slice(2)));
    } catch (error) {
      console.error(`Cloud setup stopped: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
