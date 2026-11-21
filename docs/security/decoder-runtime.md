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

The preflight and smoke report `decoderIsolationQualified: false`. The local
rootless driver-none daemon fails controller preflight. The API still uses native
decoding. The upload and job paths need a fail-closed adapter that preserves
ownership, approval revisions, deadlines and cleanup.
