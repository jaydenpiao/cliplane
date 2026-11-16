# GitHub Project setup

Native GitHub Projects is the intended task manager. No Cliplane Project has been
created or verified yet. This managed environment replaces GitHub API credentials
with an integration credential that lacks Projects access; owner OAuth approval
does not change that route. Do not repeat authorization here.

Run the helper from an owner-controlled local terminal or Cloud Shell checkout,
with Node.js and GitHub CLI installed:

```sh
env -u GH_TOKEN -u GITHUB_TOKEN gh auth login --hostname github.com --web --scopes project
env -u GH_TOKEN -u GITHUB_TOKEN node scripts/github/setup-project.mjs
env -u GH_TOKEN -u GITHUB_TOKEN node scripts/github/setup-project.mjs --apply
```

The first script command previews live issue counts without writes. `--apply`
creates or reuses a private personal **Cliplane** Project owned by @jaydenpiao,
links the repository and imports open issues plus open PR #31. Repeating it does
not duplicate Projects or items. It prints the verified Project URL and ID after
apply; record those in `github-state.json` and replace this setup notice with the
link. Choose Board layout grouped by Status in GitHub if desired.

Status and Priority come from live issue labels; Milestone uses the native
repository field. Keep issue bodies as acceptance and evidence. Synchronize
status labels when moving cards; no synchronization automation is installed.
Keep one implementation increment active. Done requires verified acceptance and
an integrated checked change. See [workflow.md](workflow.md) for release gates.

The helper's syntax, preview and fixture-based create/rerun behavior are tested.
Live Projects mutations remain unverified because the integration rejects them.
