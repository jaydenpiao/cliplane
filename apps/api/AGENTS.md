# API context

Read root AGENTS.md and docs/security/threat-model.md.
Sessions determine workspace; never trust a caller-supplied tenant identifier.
Scope SQL/file access and use transactions for source/job/edit/review transitions.
Approval and worker completion must recheck exact edit/rights revisions and lease owner.
Use argv subprocesses, opaque file keys and bounded resources; never log media or secrets.
Run tests/api.test.ts plus full checks for API changes. Update architecture/ADRs for durable changes.
