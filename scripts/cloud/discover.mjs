#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const requiredApis = [
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "sts.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "serviceusage.googleapis.com",
];
const provisioningPermissions = [
  "run.services.create",
  "cloudsql.instances.create",
  "storage.buckets.create",
  "resourcemanager.projects.setIamPolicy",
];

export function validateTarget(values) {
  const { projectId, provider, serviceAccount } = values;
  if (typeof projectId !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId))
    throw new Error("Invalid cloud project ID.");
  const match =
    typeof provider === "string" &&
    provider.match(
      /^projects\/([0-9]+)\/locations\/global\/workloadIdentityPools\/cliplane-github\/providers\/staging$/,
    );
  if (!match) throw new Error("Invalid Cliplane staging identity provider.");
  if (serviceAccount !== `cliplane-ci-discovery@${projectId}.iam.gserviceaccount.com`)
    throw new Error("Discovery account does not match the project.");
  return { projectId, provider, serviceAccount, projectNumber: match[1] };
}

export function resolveTarget(env, event) {
  if (
    env.GITHUB_REPOSITORY !== "jaydenpiao/cliplane" ||
    env.GITHUB_REPOSITORY_ID !== "1459551943" ||
    env.GITHUB_REPOSITORY_OWNER_ID !== "71306047" ||
    env.GITHUB_REF !== "refs/heads/main"
  )
    throw new Error("Cloud discovery only runs for Cliplane main.");
  const dispatched = env.GITHUB_EVENT_NAME === "repository_dispatch" && event.action === "cloud-discovery";
  if (!dispatched && env.GITHUB_EVENT_NAME !== "workflow_dispatch")
    throw new Error("Unsupported cloud discovery trigger.");
  const payload = dispatched ? event.client_payload : {};
  if (
    !payload ||
    Object.keys(payload).some(
      (key) => !["project_id", "workload_identity_provider", "service_account"].includes(key),
    )
  )
    throw new Error("Unexpected cloud discovery payload.");
  return validateTarget({
    projectId: payload.project_id || env.CONFIG_PROJECT_ID,
    provider: payload.workload_identity_provider || env.CONFIG_PROVIDER,
    serviceAccount: payload.service_account || env.CONFIG_SERVICE_ACCOUNT,
  });
}

export async function verifyAccess(target, token, request = fetch) {
  target = validateTarget(target);
  if (typeof token !== "string" || !token.trim()) throw new Error("A short-lived access token is required.");
  const api = async (url, body) => {
    let response;
    try {
      response = await request(url, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error("Cloud discovery request failed or timed out.");
    }
    if (!response.ok) throw new Error(`Cloud discovery API returned HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw new Error("Cloud discovery API returned invalid JSON.");
    }
  };
  const project = await api(`https://cloudresourcemanager.googleapis.com/v3/projects/${target.projectId}`);
  if (
    project.name !== `projects/${target.projectNumber}` ||
    project.projectId !== target.projectId ||
    project.state !== "ACTIVE"
  )
    throw new Error("Cloud project identity or lifecycle check failed.");
  const enabled = new Set();
  let pageToken;
  for (let page = 0; page < 5; page++) {
    const url = new URL(`https://serviceusage.googleapis.com/v1/projects/${target.projectNumber}/services`);
    url.searchParams.set("filter", "state:ENABLED");
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await api(url.href);
    if (result.services !== undefined && !Array.isArray(result.services))
      throw new Error("Invalid enabled API response.");
    for (const service of result.services || [])
      if (service.state === "ENABLED" && typeof service.config?.name === "string")
        enabled.add(service.config.name);
    pageToken = result.nextPageToken;
    if (!pageToken) break;
    if (page === 4) throw new Error("Enabled API response exceeded discovery limit.");
  }
  if (requiredApis.some((name) => !enabled.has(name)))
    throw new Error("Required federation APIs are not all enabled.");
  const permissions = await api(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${target.projectId}:testIamPermissions`,
    { permissions: provisioningPermissions },
  );
  if (
    permissions.permissions !== undefined &&
    (!Array.isArray(permissions.permissions) || permissions.permissions.length > 0)
  )
    throw new Error("Discovery identity unexpectedly has provisioning permissions.");
  return {
    keylessAccess: "verified",
    projectState: "ACTIVE",
    requiredApis: "enabled",
    checkedProvisioningPermissions: "absent",
    checkedPermissions: [...provisioningPermissions],
    workloadsCreated: false,
  };
}

async function main() {
  if (process.argv[2] === "configure") {
    const target = resolveTarget(
      process.env,
      JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
    );
    for (const value of [target.projectId, target.provider, target.serviceAccount])
      console.log(`::add-mask::${value}`);
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `project_id=${target.projectId}\nprovider=${target.provider}\nservice_account=${target.serviceAccount}\n`,
    );
  } else if (process.argv[2] === "verify") {
    const result = await verifyAccess(
      {
        projectId: process.env.CLOUD_PROJECT_ID,
        provider: process.env.CLOUD_PROVIDER,
        serviceAccount: process.env.CLOUD_SERVICE_ACCOUNT,
      },
      process.env.CLOUD_ACCESS_TOKEN,
    );
    console.log(JSON.stringify(result));
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      "## Cloud access verification\n\nKeyless authentication and project identity verified. Required APIs enabled.\nNone of the four checked provisioning permissions were granted. Full IAM scope was not audited. No workloads created.\n",
    );
  } else throw new Error("Usage: node scripts/cloud/discover.mjs configure|verify");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(`Cloud discovery stopped: ${error.message}`);
    process.exitCode = 1;
  });
