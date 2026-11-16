# Product and release workflow

Owner and release decision-maker: @jaydenpiao. WIP limit: one implementation issue.
Prioritize a complete vertical slice and the highest-risk release blocker.

| State       | Entry / exit                                                                |
| ----------- | --------------------------------------------------------------------------- |
| Backlog     | Captured problem and outcome                                                |
| Ready       | Owner, priority, size, milestone, dependencies and testable acceptance      |
| In progress | One selected increment with a resumable checkpoint                          |
| In review   | Linked implementation, test results, risk notes and review evidence         |
| Blocked     | Specific dependency/access gap, owner and next action                       |
| Done        | Acceptance verified and linked change integrated; no hidden remaining steps |

Use the native GitHub Project for task management once its owner-local setup is
complete; [board.md](board.md) records the exact preview/apply commands and access
blocker. No Project exists until its returned URL and privacy are verified.
Keep issue bodies as acceptance and evidence, native milestones as release
grouping, and status/priority labels synchronized with Project fields. No
synchronization automation is installed. Markdown is setup documentation only.

## Reviews and code quality

Use focused changes, typed boundaries, synthetic fixtures and concise technical descriptions.
CODEOWNERS identifies review ownership. CI files do not imply branch protection exists.
Before merge, require green verify/browser/container, Secrets and CodeQL checks on the current revision,
material security findings resolved, and review of auth/tenancy, rights/revisions,
job/retry behavior and media timing. Include reproduction/evidence for fixes.

The owner has authorized merging reviewed, passing increments to main. Record
independent review evidence and merge only the checked PR head. Do not fabricate
a GitHub approval or imply a merge deployed the application. Remote ruleset
enforcement is tracked in O7.

## Environments and release gates

Promote one immutable commit/image through staging to production. Use separate
configuration, secrets, databases, storage and service identities; avoid divergent
staging/production code forks. Staging uses synthetic data. G3/G4 own implementation.

- Local checkpoint: selected acceptance passes, reviewed code and durable handoff.
- Staging candidate: isolated configuration/resources, secure startup, immutable image
  and production-mode smoke workflow. Record commit, image digest and migrations.
- Public beta: V1 decoder sandbox, V7 account lifecycle, O4 recovery/rollback, O5 legal/operator
  review and O7 actual repository controls verified, plus applicable G1-G5 evidence.
- Production promotion: configured target, reviewed resource plan, complete evidence and rollback procedure.
  Public source and a passing image build do not establish production readiness.

Keep deployment credentials out of PR workflows. Update issue status, current handoff,
ADRs/research and runbooks in the same increment. Split large tasks into independently
verifiable steps; partial completion remains In progress, never Done.

## Demos and build in public

Show real workflows from a verified revision. Use synthetic or authorized footage.
Record raw evidence, trim idle waits transparently, inspect the final MP4 and caption
only demonstrated behavior. Link public source and avoid claims about revenue or
unimplemented AI. Keep raw captures outside Git; commit a small edited demo and notes.
Keep personal account information and distribution drafts outside the repository.
