# Standalone decoder runtime

This increment of [#2](https://github.com/jaydenpiao/cliplane/issues/2) provides a
dedicated media image and a bounded result stream. The API still runs the native
worker. Full decoder isolation requires behavioral enforcement tests and a fail
closed adapter tied to the existing job ownership and approval checks.

## Image and files

The decoder image uses an official Alpine base pinned by digest and contains Python,
FFmpeg, DejaVu fonts and the media worker. Build from `workers/media` and pass the
resolved local image ID to the smoke command. The local ID identifies the exact
built bytes. Alpine package updates can change subsequent builds.

The worker reads a single UTF-8 JSON object from stdin, limited to 1 MiB. Requests
and manifests reject nesting deeper than 32 levels. A request
has `version: 1`, `operation` (`probe`, `analyze` or `render`) and `plan` only for
render. The authorized source is mounted read-only at `/input/source`. The worker
uses private scratch beneath `/work` for generated files and temporary diagnostics.
It emits results while that scratch filesystem is still mounted.

## Result stream

The first four bytes are an unsigned big-endian length for the UTF-8 JSON manifest,
limited to 1 MiB. The manifest contains `version: 1`, the `operation`, the existing
media `result` object and ordered `artifacts` entries with `name` and `bytes`. The
payloads immediately follow the manifest in that order. A valid stream ends at EOF.

| Operation | Artifact order                                                                     |
| --------- | ---------------------------------------------------------------------------------- |
| `probe`   | No artifacts                                                                       |
| `analyze` | `proxy.mp4`, `poster.jpg`, then up to eight `thumb-N.jpg` files in candidate order |
| `render`  | `render.mp4`                                                                       |

Each file is limited to 64 MiB and the combined payload to 96 MiB. Audio analysis
scratch stays inside the worker. The host reader checks the expected operation,
manifest, filenames, lengths and EOF. It streams files into a new private directory
and removes partial files on failure. A valid framing carries untrusted media and
metadata. A caller must verify successful decoder exit, enforce a deadline and
validate results before promoting its private staging directory.

## Qualification smoke

```sh
docker build -f workers/media/Decoder.Dockerfile -t cliplane-decoder:ci workers/media
decoder_image_id="$(docker image inspect --format '{{.Id}}' cliplane-decoder:ci)"
python3 scripts/decoder/smoke.py --image "$decoder_image_id"
```

The command uses controller preflight before checking the filesystem and network
boundary and running a fixed probe, analyze and short captioned render of the
original synthetic fixture. It expects an eligible Docker
cgroup v2 daemon, Node/npm dependencies, and host FFmpeg and ffprobe. The smoke uses
one read-only source bind, a read-only root, no network and bounded scratch. The
container receives no host output directory. The smoke inspects returned media and
checks the original fixture is unchanged. A trusted test command uses the same image,
mounts and runtime controls as the decoder. It checks that the input and root reject
writes, a synthetic sibling and common runtime socket paths are absent, the process
has no capabilities and its only interface is loopback. Regular-file writes verify
scratch access before the smoke tests the file-size and scratch-capacity ceilings.

Fresh test containers check the 384 MiB memory limit, disabled swap, one-CPU
quota and 48-PID limit before running a bounded workload. The CPU test observes
throttling in the container's cgroup. The memory test observes the allocator
child's termination and the cgroup's out-of-memory counters. The PID test
observes a rejected process creation and the PID-limit event counter. The
cancellation test identifies a live descendant in a separate session, stops its
owned container and verifies the descendant has exited and the container is gone.
These checks require the local test runner to observe that container's host
process identities. The smoke and bundle limits are fixture settings. Production
workloads need their own sizing and verification.

## Private probe transport

The hosted smoke connects the TypeScript probe client to a Python Unix listener
using the original synthetic recording. The listener binds a new socket in a
runner-owned directory that permits no group writes or other-user access. It
checks the connecting UID using Linux peer credentials before reading media.
The listener accepts one connection per call. A narrowly scoped group can
permit the client to reach the socket without access to the decoder runtime.

The sender writes a four-byte unsigned
big-endian length followed by that many source bytes and half-closes its write
side. Intake has a fixed deadline and a 64 MiB byte limit. The runner stages
one file under a private directory and exposes it to the decoder as a read-only
bind. The request carries no host path or operation selector.

The runner checks the decoder's exit and validates the artifact-free probe
bundle. After cleanup it sends a four-byte response length and up to 1 MiB of
JSON. A successful response contains `status: "ok"` and `metadata`. The other
statuses are `invalid_request`, `unsupported` and `unavailable`. Responses carry
no private diagnostics. Only the decoder's explicit probe input rejection
produces `unsupported`.

The client closes its connection on error, cancellation or deadline. Accepted
probe work uses the existing container deadline and owned-container cleanup.
The 64 MiB transport limit applies to this probe profile.

## Private analysis transport

The analysis smoke passes the same source frame over a connected Unix socket.
The receiving handler is fixed to analysis. It has a trusted callback that
imports the decoder bundle and verifies process completion and container cleanup.
The runner stages a bounded response in an anonymous file. It removes the named
source and output staging before sending the response under a fixed deadline.

Success is a version 1 analysis bundle ending at EOF. The TypeScript analysis
client validates the result, candidate intervals and thumbnail order, then
checks each file length and the aggregate limit before importing to a new
private directory. Its absolute deadline covers source transfer and artifact
receipt. Failed exchanges remove the owned attempt. Hosted smoke verifies the
result against the probe and decodes the actual proxy, poster and thumbnails.
Media decoding and publication decisions are outside the receiver.

## Private render transport

The connected render handler reads a four-byte unsigned big-endian length
followed by the existing version 1 decoder render request, limited to 1 MiB.
The handler accepts only the render envelope and uses the decoder's existing
request parser and plan handling. The source frame follows the request.
One intake deadline covers both frames and the write half-close.

Render uses the same private staging, bounded response spool and send deadline
as analysis. The TypeScript render client uses an independent deadline and
accepts only a strict render bundle containing `render.mp4`. It checks the
metadata, exact file length and EOF, then returns the new private attempt
directory. Failed exchanges remove attempt files. The hosted smoke sends a
validated render plan through a UID-checked listener, decodes the received
export and checks the original source hash. The receiver's structural checks
leave media decoding and publication decisions to the caller.

## Private runner lifecycle

The private runner loop binds `probe.sock`, `analyze.sock` and `render.sock`
in a trusted runner-owned directory and uses a separate runner-only staging
directory. It reports readiness after all three sockets are available.
Each connection is checked against the configured Linux UID before the
fixed handler reads any bytes. The loop serves one connection at a time
across all three endpoints.

A supervisor can request stop through the loop's stop event. Idle waits
are bounded. The loop stops dispatching new work, lets the active bounded
handler finish and removes its sockets. Startup failures roll back sockets
created by that invocation. Hosted smoke exercises all three TypeScript
clients through the loop with an actual isolated decoder, verifies a rejected
UID and checks endpoint and staging cleanup.

The runner executor accepts a configured immutable image ID and runs only the
fixed probe, analyze and render requests. Its container code checks the
image, identity and runner ownership label before removal. A source bind uses
one regular file from trusted staging. The executor validates the returned
bundle and waits for successful decoder exit and verified container cleanup
before returning. If either step fails after import, the executor removes its
private output. The runner process holds Docker authority.

The accepted connection also provides the cancellation signal. Its required
write half-close allows the decoder to continue. A full disconnect interrupts
the runner's output read or exit wait and triggers verified container cleanup.
The transport discards tentative output and source staging. Hosted smoke
observes a live descendant before disconnecting the client, confirms that
the owned container and descendant exited, and reuses the same service.

Deployment configuration and app selection, including job lease cancellation
through the private runner, remain open.

## Application execution

The API startup selects one media executor and passes it to upload probing and
queued jobs. Both call the selected executor. A rejected upload probe leaves no
source, attestation, or job and removes the staged file. Confirmed probe input
rejection returns HTTP 400. An unavailable executor or invalid probe response
returns HTTP 503 without exposing worker details.

The isolated `MediaExecutor` uses the three fixed private sockets and passes
the caller's cancellation signal to each client. Only the fixed unsupported
probe response produces `UnsupportedMediaError`. The executor imports verified
artifacts on the destination filesystem, using exclusively created analysis
directories and no-replace file links. Its destinations are trusted private job
attempt paths. On failure or cancellation it removes its own incomplete output
and scratch. The job's lease and approval checks control publication.

Startup currently selects the native worker. Production selection requires
deployment and workload qualification, including lease cancellation and
publication through the isolated executor. The smoke continues to report
`decoderIsolationQualified: false`. The local rootless driver-none daemon
fails controller preflight.
