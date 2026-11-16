# ADR 003: Rights are explicit and approval is revision-bound

Accepted. Every source has creator authorization, provenance and a versioned attestation.
Game, music, likeness, third-party, spoiler and embargo states remain separate. Uploading
a file does not authorize underlying game/music rights. Detection does not establish a license.

Approval records the reviewing user, exact edit revision, rights revision and a reason.
Optimistic revision checks reject stale edits, rights changes and reviews. Edits/rights
changes revoke approval and invalidate access to old rendered versions. Embargo locks
cannot be cleared through normal review routes. Publication contracts require explicit
approval and platform-account provenance; live publishing is not implemented here.
