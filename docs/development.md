# Development reference

## Commands

Use Node 24 (supported minimum 22.12), Python 3.12, uv, FFmpeg/ffprobe and PostgreSQL 17.
Lockfiles pin project dependencies. Do not print environment values or credentials.

| Task                            | Command                                                 |
| ------------------------------- | ------------------------------------------------------- |
| Install JS/Python tooling       | npm ci; uv sync --locked --group dev                    |
| Start local DB                  | npm run db:up                                           |
| Apply/check migrations          | npm run db:migrate                                      |
| Create original sample media    | npm run seed                                            |
| Start API and studio            | npm run dev                                             |
| Full quality gate               | npm run check                                           |
| Decoder controller preflight    | npm run --silent decoder:preflight -- --image sha256:ID |
| Focused API/domain tests        | npm test -- tests/api.test.ts                           |
| Media fixtures / Python quality | npm run test:media; npm run check:python                |
| Real browser workflow           | npm run test:e2e                                        |
| Offline ranking evaluation      | npm run evaluate                                        |
| Dependency audit                | npm audit --audit-level=high                            |
| Container build                 | docker build -f infra/Dockerfile -t cliplane:local .    |
| Repo / issue / PR / checks      | gh repo view; gh issue list; gh pr view; gh run list    |

CI uses the Playwright-managed browser installed by its workflow after `npm ci`.
`CHROMIUM_PATH` is an explicit override; the `/usr/bin/chromium` fallback is for
non-CI local work only. A runner's ambient browser can differ in version and media
support from the installed test runtime. Keep actual source/export playback checks
enabled rather than replacing them with HTTP-only or metadata-only assertions.

Do not run a Next production build while filming a development server using the same
.next directory. Stop/restart only task-owned processes and verify /api/health.

The temporary Vitest-scoped Picomatch override mitigates GHSA-fc5q-39xc-vjpf
using an independently reviewed exact artifact. Preserve its pin/integrity and the
high-severity audit gate; [review scope](research/test-toolchain-security.md) and
[upstream replacement #48](https://github.com/jaydenpiao/cliplane/issues/48) record
compatibility and supply-chain limits. Separate bundled copies are outside that pin.

## Decoder controller preflight

Run `npm run --silent decoder:preflight -- --image sha256:<64 lowercase hex>` with a
trusted immutable local helper image containing `/bin/sh` and `cat`, with no declared
volumes. There is no implicit image pull or application/media execution. `--silent`
keeps npm's wrapper out of the machine-readable JSON stream. Missing/unsupported
controllers, invalid images, execution faults and uncertain cleanup exit 2.

A passing result is controller readback and owned cleanup only; the report always
sets `decoderIsolationQualified: false`. The current rootless runtime rejects at
safe daemon discovery before creating a container. App native media execution and
the full issue #2 isolation gate remain unchanged. See
[research and evidence](research/decoder-controller-preflight.md) for prerequisites
and remaining behavioral tests. The hosted container job builds the dedicated
media image, checks controller readback and processes the original synthetic
fixture. See the [decoder runtime and smoke command](security/decoder-runtime.md).

## Tools, skills and plugins

Inspect the current runtime catalog; availability changes between sessions.
Use GitHub connectors for supported operations and authenticated Git/gh for the rest.
The GitHub account is jaydenpiao; verify `gh api user --jq .login` and local Git identity.
Expected commit email: 71306047+jaydenpiao@users.noreply.github.com.
Never embed credentials in remotes, files or logs.

Use installed debugging, testing, verification and review skills when relevant.
Use the environment/browser skill for recordings, writing-style guidance for posts,
and plugin-management discovery when a required external capability is missing.
Read full skill guidance only for the current task. Project conventions belong in
AGENTS.md; add a reusable skill only for a repeated gap and validate it first.

No new global plugin or skill is required for the existing local workflow. The current
stack already has a test runner, browser recorder and FFmpeg editor. Research a new
tool when an issue needs it; document capability, license, cost, permissions and fit.
Prefer documented official APIs. Never replace missing access with scraping or cookies.

Keep personal account information, drafts and distribution plans outside this public
repository. Product integrations belong in documented provider modules.

## Increment and checkpoint discipline

One active implementation issue; one coherent commit/PR scope. Keep research focused
and reuse accepted decisions. Review material boundaries once, fix verified defects,
and stop repeating unchanged passing checks. Record exact next steps before a limit,
context reset or pause. Context is a resumable record, not a transcript.

The user requests autonomous progress within the authorized project scope. Continue
reversible implementation and checks; report actual external permission/billing
boundaries. Public source is authorized under Apache-2.0. Production hosting and paid
services are not configured. External publication needs explicit authorization and
verified access; personal distribution plans do not belong in this repository.

## Production image smoke

The Quality container job tests the exact built app image on a disposable Docker
network. It runs the real creator export and authenticated workspace-isolation
workflows through loopback HTTPS using managed Chromium. The harness recreates
the app container and verifies the prior session, playable media and original
master hash against the retained test volumes. The job log records the checked
commit, app image ID and PostgreSQL image ID. This covers local persistence and
access guards. Target TLS, queued-job recovery and restore/rollback have separate
release checks.

On a Docker host with PostgreSQL image access, FFmpeg, OpenSSL, jq, project
dependencies and a supported Playwright Chromium, run:

```sh
docker build -f infra/Dockerfile -t cliplane:smoke .
app_image_id="$(docker image inspect --format '{{.Id}}' cliplane:smoke)"
bash scripts/production-smoke.sh "$app_image_id"
```

The harness uses loopback ports 3101 and 3443 and removes its containers and
volumes on exit. Its temporary HTTPS certificate is trusted only for the smoke
run. All uploaded media is generated by the test.
