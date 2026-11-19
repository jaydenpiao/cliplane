import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function resolvePilotTarget(env, event) {
  if (
    env.GITHUB_REPOSITORY !== "jaydenpiao/cliplane" ||
    env.GITHUB_REPOSITORY_ID !== "1459551943" ||
    env.GITHUB_REPOSITORY_OWNER_ID !== "71306047" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_WORKFLOW_REF !== "jaydenpiao/cliplane/.github/workflows/pilot-gcloud.yml@refs/heads/main" ||
    env.GITHUB_EVENT_NAME !== "repository_dispatch" ||
    event?.action !== "cliplane-pilot-auth"
  )
    throw new Error("Pilot authentication requires the Cliplane main pilot workflow and dispatch.");

  const payload = event.client_payload;
  if (
    !payload ||
    Object.keys(payload).length !== 2 ||
    !Object.hasOwn(payload, "project_id") ||
    !Object.hasOwn(payload, "project_number")
  )
    throw new Error("Pilot dispatch requires only the project ID and number.");

  const { project_id: projectId, project_number: projectNumber } = payload;
  if (typeof projectId !== "string" || projectId.match(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/)?.[0] !== projectId)
    throw new Error("Invalid pilot project ID.");
  if (typeof projectNumber !== "string" || projectNumber.match(/^[1-9][0-9]*$/)?.[0] !== projectNumber)
    throw new Error("Invalid pilot project number.");

  return {
    projectId,
    projectNumber,
    provider: `projects/${projectNumber}/locations/global/workloadIdentityPools/cliplane-pilot-ci/providers/github`,
    serviceAccount: `cliplane-ci-pilot@${projectId}.iam.gserviceaccount.com`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const target = resolvePilotTarget(
      process.env,
      JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
    );
    for (const value of Object.values(target)) console.log(`::add-mask::${value}`);
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `project_id=${target.projectId}\nprovider=${target.provider}\nservice_account=${target.serviceAccount}\n`,
    );
  } catch {
    console.error("Pilot authentication stopped before sending an identity target to Google Cloud.");
    process.exitCode = 1;
  }
}
