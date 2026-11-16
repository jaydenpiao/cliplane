#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const owner = "jaydenpiao";
const repository = "cliplane";
const title = "Cliplane";
const statusNames = ["Backlog", "Ready", "In progress", "In review", "Blocked", "Done"];
const statuses = Object.fromEntries(
  statusNames.map((name) => [`status:${name.toLowerCase().replaceAll(" ", "-")}`, name]),
);
const readme = `Task management for ${owner}/${repository}. Issue bodies retain acceptance and evidence. Status and Priority follow issue labels; Milestone is the native repository milestone. Keep one implementation increment active. Done requires verified acceptance and an integrated checked change. No label synchronization automation is installed.`;

const projectFields = `id title number url public closed readme viewerCanUpdate repositories(first:100) { nodes { id } }`;
const detailFields = `${projectFields}
  fields(first:100) { nodes {
    ... on ProjectV2FieldCommon { id name }
    ... on ProjectV2SingleSelectField { options { id name color description } }
  } }
  items(first:100, after:$after) { nodes {
    id content { ... on Issue { id } ... on PullRequest { id } }
    fieldValues(first:100) { nodes { ... on ProjectV2ItemFieldSingleSelectValue {
      optionId field { ... on ProjectV2FieldCommon { id } }
    } } }
  } pageInfo { hasNextPage endCursor } }`;

function githubApi(query, variables = {}) {
  let raw;
  try {
    raw = execFileSync("gh", ["api", "graphql", "--input", "-"], {
      input: JSON.stringify({ query, variables }),
      encoding: "utf8",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GH_PAGER: "cat" },
    });
  } catch (error) {
    // Never forward command/env/stderr dumps: those can contain credentials.
    let messages;
    try {
      messages = JSON.parse(String(error.stdout))
        .errors?.map((item) => item.message)
        .join("; ");
    } catch {}
    throw new Error(messages || "GitHub request failed. Verify gh installation, login and project scope.");
  }
  const result = JSON.parse(raw);
  if (result.errors?.length) throw new Error(result.errors.map((item) => item.message).join("; "));
  return result.data;
}

function collectPages(load) {
  const nodes = [];
  let after = null;
  do {
    const page = load(after);
    nodes.push(...page.nodes.filter(Boolean));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if (page.pageInfo.hasNextPage && !after)
      throw new Error("GitHub returned an incomplete pagination cursor.");
  } while (after);
  return nodes;
}

function itemPlan(item) {
  const labels = item.labels.nodes.map((label) => label.name);
  const stateLabels = labels.filter((label) => label.startsWith("status:"));
  if (stateLabels.length > 1 || (stateLabels[0] && !statuses[stateLabels[0]])) {
    throw new Error(`Issue/PR #${item.number} needs one recognized status label before setup.`);
  }
  const priorityLabels = labels.filter((label) => /^priority:p[012]$/.test(label));
  if (priorityLabels.length > 1) throw new Error(`Issue/PR #${item.number} has conflicting priorities.`);
  return {
    ...item,
    status: statuses[stateLabels[0]] ?? "Backlog",
    priority: priorityLabels[0]?.slice(9).toUpperCase(),
  };
}

function projectDetails(api, id) {
  let project;
  const items = collectPages((after) => {
    const result = api(
      `query ProjectDetails($id:ID!, $after:String) { node(id:$id) { ... on ProjectV2 { ${detailFields} } } }`,
      { id, after },
    );
    if (!result.node) throw new Error("Project is no longer accessible.");
    project = result.node;
    return project.items;
  });
  return { ...project, items: { nodes: items } };
}

function ensureOptions(api, field, names) {
  const existing = field.options;
  if (!existing) throw new Error(`${field.name} must be a single-select field.`);
  const used = new Set();
  const options = names.map((name) => {
    const previous =
      existing.find((option) => option.name.toLowerCase() === name.toLowerCase()) ??
      (name === "Backlog" ? existing.find((option) => option.name === "Todo") : undefined);
    if (previous) used.add(previous.id);
    return {
      ...(previous ? { id: previous.id } : {}),
      name,
      color: previous?.color ?? "GRAY",
      description: previous?.description ?? "",
    };
  });
  // Keep owner-created options and their IDs; deleting them could clear existing values.
  options.push(...existing.filter((option) => !used.has(option.id)));
  if (JSON.stringify(existing) === JSON.stringify(options)) return field;
  return api(
    `mutation UpdateOptions($fieldId:ID!, $options:[ProjectV2SingleSelectFieldOptionInput!]!) {
    updateProjectV2Field(input:{fieldId:$fieldId, singleSelectOptions:$options}) {
      projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name color description } } }
    }
  }`,
    { fieldId: field.id, options },
  ).updateProjectV2Field.projectV2Field;
}

export function setupProject({ apply = false, api = githubApi, output = console.log } = {}) {
  const variables = { owner, name: repository };
  const initial = api(
    `query RepositoryPlan($owner:String!, $name:String!) {
    viewer { id login }
    repository(owner:$owner, name:$name) { id viewerPermission
      pullRequest(number:31) { id number state labels(first:100) { nodes { name } } }
    }
  }`,
    variables,
  );
  if (initial.viewer.login !== owner)
    throw new Error(`Authenticate gh as ${owner} before running this script.`);
  if (!initial.repository) throw new Error(`${owner}/${repository} is not accessible.`);
  const issues = collectPages(
    (after) =>
      api(
        `query OpenIssues($owner:String!, $name:String!, $after:String) {
    repository(owner:$owner, name:$name) { issues(first:100, after:$after, states:OPEN) {
      nodes { id number labels(first:100) { nodes { name } } } pageInfo { hasNextPage endCursor }
    } }
  }`,
        { ...variables, after },
      ).repository.issues,
  );
  const pr = initial.repository.pullRequest;
  const items = [...issues, ...(pr?.state === "OPEN" ? [pr] : [])].map(itemPlan);
  const counts = {};
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  let projects = [];
  let projectAccessError;
  try {
    projects = collectPages(
      (after) =>
        api(
          `query PersonalProjects($after:String) {
      viewer { projectsV2(first:100, after:$after) { nodes { ${projectFields} } pageInfo { hasNextPage endCursor } } }
    }`,
          { after },
        ).viewer.projectsV2,
    );
  } catch (error) {
    if (apply) throw error;
    projectAccessError = error.message;
  }
  const named = projects.filter((project) => project.title === title && !project.closed);
  const linked = named.filter((project) =>
    project.repositories.nodes.some((repo) => repo.id === initial.repository.id),
  );
  const candidates = linked.length ? linked : named;
  if (candidates.length > 1)
    throw new Error("Multiple active Cliplane Projects match. Rename the unrelated Projects before setup.");
  let project = candidates[0];
  if (project?.repositories.nodes.length && !linked.length) {
    throw new Error("The existing Cliplane Project links another repository. Rename it before setup.");
  }
  const result = {
    apply,
    repository: `${owner}/${repository}`,
    itemCount: items.length,
    counts,
    projectAccessError,
    project: project ? { id: project.id, url: project.url } : null,
  };
  output(
    JSON.stringify(
      {
        ...result,
        action: projectAccessError
          ? "Project discovery blocked; no writes"
          : project
            ? "Reuse private Project and synchronize labels"
            : "Create private Cliplane Project and import open work",
      },
      null,
      2,
    ),
  );
  if (!apply) {
    output(
      "Preview only. Run with --apply from an owner terminal with GitHub project scope to make changes.",
    );
    return result;
  }
  if (!["ADMIN", "MAINTAIN", "WRITE"].includes(initial.repository.viewerPermission))
    throw new Error("Repository write access is required.");
  if (project && !project.viewerCanUpdate) throw new Error("Project update permission is required.");
  if (!project) {
    project = api(
      `mutation CreateProject($ownerId:ID!, $title:String!) {
      createProjectV2(input:{ownerId:$ownerId, title:$title}) { projectV2 { ${projectFields} } }
    }`,
      { ownerId: initial.viewer.id, title },
    ).createProjectV2.projectV2;
  }
  project = projectDetails(api, project.id);
  api(
    `mutation UpdateProject($id:ID!, $public:Boolean!, $readme:String!) {
    updateProjectV2(input:{projectId:$id, public:$public, readme:$readme}) { projectV2 { id public } }
  }`,
    { id: project.id, public: false, readme: project.readme || readme },
  );
  if (!project.repositories.nodes.some((repo) => repo.id === initial.repository.id)) {
    api(
      `mutation LinkRepository($projectId:ID!, $repositoryId:ID!) {
      linkProjectV2ToRepository(input:{projectId:$projectId, repositoryId:$repositoryId}) { repository { id } }
    }`,
      { projectId: project.id, repositoryId: initial.repository.id },
    );
  }
  const statusField = project.fields.nodes.find((field) => field.name === "Status");
  if (!statusField) throw new Error("Project has no native Status field.");
  const status = ensureOptions(api, statusField, statusNames);
  let priority = project.fields.nodes.find((field) => field.name === "Priority");
  if (!priority) {
    priority = api(
      `mutation CreatePriority($projectId:ID!, $options:[ProjectV2SingleSelectFieldOptionInput!]!) {
      createProjectV2Field(input:{projectId:$projectId, dataType:SINGLE_SELECT, name:"Priority", singleSelectOptions:$options}) {
        projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name color description } } }
      }
    }`,
      {
        projectId: project.id,
        options: ["P0", "P1", "P2"].map((name) => ({
          name,
          color: "GRAY",
          description: "From priority label",
        })),
      },
    ).createProjectV2Field.projectV2Field;
  } else {
    priority = ensureOptions(api, priority, ["P0", "P1", "P2"]);
  }
  const existing = new Map(
    project.items.nodes.filter((item) => item.content).map((item) => [item.content.id, item]),
  );
  for (const planned of items) {
    let item = existing.get(planned.id);
    if (!item) {
      item = api(
        `mutation AddItem($projectId:ID!, $contentId:ID!) {
        addProjectV2ItemById(input:{projectId:$projectId, contentId:$contentId}) { item { id } }
      }`,
        { projectId: project.id, contentId: planned.id },
      ).addProjectV2ItemById.item;
      existing.set(planned.id, item);
    }
    for (const [field, value] of [
      [status, planned.status],
      [priority, planned.priority],
    ]) {
      if (!value) {
        if (item.fieldValues?.nodes.some((current) => current.field?.id === field.id)) {
          api(
            `mutation ClearValue($projectId:ID!, $itemId:ID!, $fieldId:ID!) {
            clearProjectV2ItemFieldValue(input:{projectId:$projectId, itemId:$itemId, fieldId:$fieldId}) {
              projectV2Item { id }
            }
          }`,
            { projectId: project.id, itemId: item.id, fieldId: field.id },
          );
        }
        continue;
      }
      const optionId = field.options.find((option) => option.name === value)?.id;
      if (!optionId) throw new Error(`${field.name} option ${value} was not created.`);
      if (
        item.fieldValues?.nodes.some(
          (current) => current.field?.id === field.id && current.optionId === optionId,
        )
      )
        continue;
      api(
        `mutation SetValue($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
        updateProjectV2ItemFieldValue(input:{projectId:$projectId, itemId:$itemId, fieldId:$fieldId, value:{singleSelectOptionId:$optionId}}) {
          projectV2Item { id }
        }
      }`,
        { projectId: project.id, itemId: item.id, fieldId: field.id, optionId },
      );
    }
  }
  const verified = projectDetails(api, project.id);
  if (
    verified.public ||
    !verified.repositories.nodes.some((repo) => repo.id === initial.repository.id) ||
    items.some((item) => !verified.items.nodes.some((entry) => entry.content?.id === item.id))
  ) {
    throw new Error(
      "Final Project privacy, repository link or item verification failed. Rerun safely after checking access.",
    );
  }
  result.project = { id: verified.id, url: verified.url };
  output(JSON.stringify({ verified: true, private: !verified.public, ...result }, null, 2));
  output(
    "Milestone is the native repository field. Select Board layout and group by Status in GitHub if desired.",
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: node scripts/github/setup-project.mjs [--apply]\nDefault: read-only preview. --apply creates/reuses a private personal Cliplane Project, links the repository and synchronizes open issues/PR31 from labels. Requires gh authenticated as jaydenpiao with project scope. No tokens belong in source or chat.",
    );
  } else if (args.some((arg) => arg !== "--apply") || args.length > 1) {
    console.error("Unknown arguments. Use --help.");
    process.exitCode = 1;
  } else {
    try {
      setupProject({ apply: args.includes("--apply") });
    } catch (error) {
      console.error(`Project setup stopped: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
