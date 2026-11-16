import { expect, it } from "vitest";
import { setupProject } from "../scripts/github/setup-project.mjs";

function githubFixture({ denied = false, login = "jaydenpiao" } = {}) {
  const project: any = {
    id: "project-1",
    title: "Cliplane",
    number: 1,
    url: "https://github.com/users/jaydenpiao/projects/1",
    public: true,
    closed: false,
    viewerCanUpdate: true,
    repositories: { nodes: [] },
    fields: {
      nodes: [
        {
          id: "status",
          name: "Status",
          options: [{ id: "todo", name: "Todo", color: "GRAY", description: "" }],
        },
        { id: "milestone", name: "Milestone" },
      ],
    },
    items: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  };
  const issues = [
    { id: "issue-2", number: 2, labels: { nodes: [{ name: "status:ready" }, { name: "priority:p0" }] } },
    {
      id: "issue-29",
      number: 29,
      labels: { nodes: [{ name: "status:in-progress" }, { name: "priority:p1" }] },
    },
    { id: "issue-32", number: 32, labels: { nodes: [{ name: "status:in-review" }] } },
  ];
  const pullRequest = {
    id: "pr-31",
    number: 31,
    state: "OPEN",
    labels: { nodes: [{ name: "status:in-review" }] },
  };
  const projects: any[] = [];
  const mutations: { name: string; variables: any }[] = [];
  const values = new Map<string, string>();
  const api = (query: string, variables: any = {}): any => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1];
    if (query.startsWith("mutation")) mutations.push({ name: name ?? "", variables });
    switch (name) {
      case "RepositoryPlan":
        return {
          viewer: { id: "owner", login },
          repository: { id: "repo", viewerPermission: "ADMIN", pullRequest },
        };
      case "OpenIssues":
        return {
          repository: { issues: { nodes: issues, pageInfo: { hasNextPage: false, endCursor: null } } },
        };
      case "PersonalProjects":
        if (denied) throw new Error("Resource not accessible by integration");
        return {
          viewer: { projectsV2: { nodes: projects, pageInfo: { hasNextPage: false, endCursor: null } } },
        };
      case "CreateProject":
        project.public = false;
        projects.push(project);
        return { createProjectV2: { projectV2: project } };
      case "ProjectDetails":
        return { node: project };
      case "UpdateProject":
        project.public = variables.public;
        return { updateProjectV2: { projectV2: project } };
      case "LinkRepository":
        project.repositories.nodes.push({ id: "repo" });
        return { linkProjectV2ToRepository: { repository: { id: "repo" } } };
      case "UpdateOptions": {
        const field = project.fields.nodes.find((item: any) => item.id === variables.fieldId);
        field.options = variables.options.map((option: any, i: number) => ({
          ...option,
          id: option.id ?? `${field.id}-${i}`,
        }));
        return { updateProjectV2Field: { projectV2Field: field } };
      }
      case "CreatePriority": {
        const field = {
          id: "priority",
          name: "Priority",
          options: variables.options.map((option: any, i: number) => ({ ...option, id: `priority-${i}` })),
        };
        project.fields.nodes.push(field);
        return { createProjectV2Field: { projectV2Field: field } };
      }
      case "AddItem": {
        const item = {
          id: `item-${variables.contentId}`,
          content: { id: variables.contentId },
          fieldValues: { nodes: [] },
        };
        project.items.nodes.push(item);
        return { addProjectV2ItemById: { item } };
      }
      case "SetValue":
        values.set(`${variables.itemId}:${variables.fieldId}`, variables.optionId);
        return { updateProjectV2ItemFieldValue: { projectV2Item: { id: variables.itemId } } };
      case "ClearValue":
        values.delete(`${variables.itemId}:${variables.fieldId}`);
        return { clearProjectV2ItemFieldValue: { projectV2Item: { id: variables.itemId } } };
      default:
        throw new Error(`Unexpected operation: ${name}`);
    }
  };
  return { api, project, projects, mutations, values };
}

it("previews live issue state without writes even when Projects permission is unavailable", () => {
  const fixture = githubFixture({ denied: true });
  const result = setupProject({ api: fixture.api, output: () => {} });
  expect(result.apply).toBe(false);
  expect(result.counts).toEqual({ Ready: 1, "In progress": 1, "In review": 2 });
  expect(result.projectAccessError).toContain("Resource not accessible");
  expect(fixture.mutations).toEqual([]);
});

it("refuses apply before any mutation when Projects permission or owner identity is wrong", () => {
  const denied = githubFixture({ denied: true });
  expect(() => setupProject({ apply: true, api: denied.api, output: () => {} })).toThrow(
    "Resource not accessible",
  );
  expect(denied.mutations).toEqual([]);
  const otherOwner = githubFixture({ login: "someone-else" });
  expect(() => setupProject({ apply: true, api: otherOwner.api, output: () => {} })).toThrow("jaydenpiao");
  expect(otherOwner.mutations).toEqual([]);
});

it("creates a private linked project and reruns without duplicate projects or items", () => {
  const fixture = githubFixture();
  setupProject({ apply: true, api: fixture.api, output: () => {} });
  setupProject({ apply: true, api: fixture.api, output: () => {} });
  expect(fixture.projects).toHaveLength(1);
  expect(fixture.project.public).toBe(false);
  expect(fixture.project.repositories.nodes).toEqual([{ id: "repo" }]);
  expect(fixture.project.items.nodes).toHaveLength(4);
  expect(fixture.mutations.filter((call) => call.name === "CreateProject")).toHaveLength(1);
  expect(fixture.mutations.filter((call) => call.name === "AddItem")).toHaveLength(4);
  const status = fixture.project.fields.nodes.find((field: any) => field.name === "Status");
  const ready = status.options.find((option: any) => option.name === "Ready");
  expect(fixture.values.get("item-issue-2:status")).toBe(ready.id);
  expect(fixture.values.has("item-pr-31:priority")).toBe(false);
  expect(fixture.mutations.some((call) => call.variables.fieldId === "milestone")).toBe(false);
});

it("reuses the linked title match and preserves existing custom status options", () => {
  const fixture = githubFixture();
  fixture.project.repositories.nodes.push({ id: "repo" });
  fixture.project.fields.nodes[0].options.push({
    id: "hold",
    name: "On hold",
    color: "RED",
    description: "Owner state",
  });
  fixture.projects.push({ ...fixture.project, id: "unlinked", repositories: { nodes: [] } }, fixture.project);
  setupProject({ apply: true, api: fixture.api, output: () => {} });
  expect(fixture.mutations.some((call) => call.name === "CreateProject")).toBe(false);
  expect(fixture.project.fields.nodes[0].options).toContainEqual({
    id: "hold",
    name: "On hold",
    color: "RED",
    description: "Owner state",
  });
});

it("clears stale project priority after an issue priority label is removed", () => {
  const fixture = githubFixture();
  fixture.projects.push(fixture.project);
  fixture.project.fields.nodes.push({
    id: "priority",
    name: "Priority",
    options: [{ id: "p0", name: "P0", color: "GRAY", description: "" }],
  });
  fixture.project.items.nodes.push({
    id: "item-issue-32",
    content: { id: "issue-32" },
    fieldValues: { nodes: [{ field: { id: "priority" }, optionId: "p0" }] },
  });
  fixture.values.set("item-issue-32:priority", "p0");
  setupProject({ apply: true, api: fixture.api, output: () => {} });
  expect(fixture.values.has("item-issue-32:priority")).toBe(false);
});
