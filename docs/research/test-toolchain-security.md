# Temporary Vitest matcher mitigation

Reviewed 2026-11-17 for PR #47. The unchanged high-severity npm audit gate reported
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) through the
Vitest/Vite/Tinyglobby/Fdir chain. Official Picomatch 4.0.7 had no patched upstream
release at review time. The selected mitigation is an exact Vitest-scoped override:
`npm:@ryotsu/picomatch@4.0.7-a`.

## Evidence and decision

Independent review compared the published tarball with its
[attested source commit](https://github.com/ryotsu-kankichi/secured-picomatch/commit/3ab5a7627d480259e3d9ca67fbc14c125d374f0e), verified the locked SHA-512 integrity,
npm registry signature and SLSA provenance, and inspected executable differences.
All ten published files match that source snapshot. Runtime changes are limited to
parser/constants code; MIT attribution is retained and there are no install hooks,
runtime dependencies, subprocesses or new I/O in the reviewed diff.

The default compiler safeguard removes the outer repetition responsible for the
advisory's described single-branch constructions. This conclusion is from source
review; no resource-exhaustion experiment is claimed. A zero audit is supporting
evidence only: renaming a package can change advisory matching independently of
whether its code is fixed.

The publisher has limited history. Pinning the reviewed artifact and exact integrity
limits future changes; new fork versions require review. Parser behavior differs
for some bracket negation, bare-double-star extension patterns, multiline directory
names, punctuation and captured substrings. Current Vitest discovery fixtures and
all 168 TypeScript/API/helper tests pass with the exact installed pin, and full quality/build
checks plus the unchanged high-severity audit pass.

## Scope and removal

The lock changes one dev-only node under Vitest; application dependencies remain
pinned. Next and Playwright contain separate bundled copies outside this override.
Their version-specific exposure/reachability was outside this review; no all-copy
or whole-application remediation claim is made.

[Issue #48](https://github.com/jaydenpiao/cliplane/issues/48) tracks replacement with
a compatible official release that actually fixes the advisory. Keep the audit
threshold, verify upstream source/compatibility, regenerate the lock and run full
checks/current-head CI before removing the temporary override.
