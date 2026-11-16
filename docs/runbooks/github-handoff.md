# GitHub handoff

Repository: https://github.com/jaydenpiao/cliplane (public, Apache-2.0).
Draft PR: https://github.com/jaydenpiao/cliplane/pull/31.

The architecture baseline is main; implementation and setup are on feat/vertical-mvp.
Commits, issues and the PR resolve to jaydenpiao. Use its authenticated identity and
no-reply commit email; never embed credentials in Git remotes or source.

Four milestones and 26 project labels are created. See docs/project/board.md
and github-state.json for actual links. Issue #2 is the next implementation priority.

The current connection rejects Projects creation and administration/settings endpoints.
No native Project or enforced branch rule is claimed. The issue board and status labels
are usable now. For native setup, the owner can create a Project under
https://github.com/users/jaydenpiao/projects and configure repository rules at
https://github.com/jaydenpiao/cliplane/settings/rules if supported by the account.

Recommended main policy: PR-based changes, passing Quality/Secrets/CodeQL checks on the
reviewed revision and recorded independent review. Do not require an unavailable second
human for a sole-maintainer repo. Keep final merge/release decisions explicit.

The repo is public, so CodeQL can run without enabling a paid private-repo feature.
Source publication is complete; application production deployment remains behind the
release gates. No paid infrastructure was created.
