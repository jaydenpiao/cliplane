# Threat model and public-beta gate

This local MVP handles untrusted media and creator data. The following controls are
implemented; the final table identifies work still required before a public beta.

| Threat                         | Implemented boundary / evidence                                                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDOR / cross-tenant access     | Session membership resolves workspace; all media and mutation queries are scoped; composite foreign keys; cross-workspace API tests including range downloads                      |
| Session theft                  | Random 256-bit tokens, only SHA-256 token hashes persisted, 7-day expiration, HttpOnly/SameSite cookies; Secure mandatory in production                                            |
| CSRF                           | Same-origin Origin validation, cross-site Fetch Metadata rejection, no CORS relaxation                                                                                             |
| Credential guessing            | Scrypt hashes, constant-time comparison, auth route rate limit; no passwords/tokens in logs                                                                                        |
| Media/decoder attack           | Actual ffprobe validation, common container allowlist, no network protocols, opaque filenames, process deadlines/output caps, POSIX process-group termination                      |
| Resource exhaustion            | 2 GB default upload cap, 12-hour/8192-pixel media cap, one active job per API, FFmpeg threads bounded, streaming uploads                                                           |
| SSRF                           | No URL importer exists. Workers accept local regular files and allow only file/pipe protocols                                                                                      |
| Queue replay                   | Atomic SKIP LOCKED claims, lease owner fencing, retries limited to 3, transactional candidate persistence, unique render identity                                                  |
| Obsolete media execution       | Serialized lease liveness checks abort process groups; expiry checked after ownership locks; cancellation gates COMMIT dispatch; shutdown drains cleanup. See decoder-lifecycle.md |
| Unseen/stale approval          | Expected edit and rights revision checked under locks; mutations invalidate approval                                                                                               |
| Duplicate posting              | No live provider. Future providers must distinguish ambiguous failure from safe retry; never retry an ambiguous public publish blindly                                             |
| Stored XSS / caption injection | React renders text, no dangerouslySetInnerHTML; plain-text caption files and FFmpeg expansion disabled; argv subprocesses, no shell                                                |
| Prompt injection               | No AI agent consumes media text in this version. Future transcription/OCR/chat/model input is untrusted data, never tool instructions                                              |
| Data retention failure         | Pending storage cleanup retried in periodic sweep; deletion states remain blocked; auditable failure records                                                                       |
| Secret leakage                 | No private keys/OAuth tokens in source; logger disabled; worker environment omits application/DB secrets                                                                           |
| Supply chain                   | Lockfiles, dependency audit, Dependabot, CodeQL workflow and CI. Hosting-side scanning/rulesets require account configuration                                                      |

## Before public beta

- Run native decoders in an unprivileged container with CPU, memory, file-size/disk and
  process limits, read-only runtime, per-job isolated filesystem and no network. Protocol
  restrictions alone are not an OS sandbox or protection from FFmpeg vulnerabilities.
- Move uploads/renders to S3-compatible storage; short-lived signed URLs and lifecycle
  cleanup. Add resumability, quotas per workspace and maximum concurrent upload limits.
- Add verified email, account recovery/deletion, invite/role administration and abuse controls.
- Set HTTPS, disable demo sessions, protect reverse proxy, rotate operator secrets, use
  non-default database credentials and restrict database service access.
- Encrypt any future OAuth credentials with managed envelope encryption, minimize scopes,
  validate webhook signatures and implement rotation/revocation.
- Run actual restore/rollback and backup-retention drills. Audits are app records, not an
  immutable external compliance log. Record deletion obligations for backups/service providers.
- Review legal/privacy/DMCA operational drafts with the appropriate operator and counsel.

The application intentionally provides no claim that a rights status guarantees legal
clearance, platform originality, ad revenue or eligibility for any monetization program.
