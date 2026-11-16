# Contributing

Follow README setup and run `npm run check`. Use a disposable database for tests.
Open an issue with concrete acceptance criteria; use a focused branch and PR.
Do not change applied migrations; add forward migrations. Keep workers stateless and
domain edits declarative. New behavior needs meaningful unit/fixture/integration tests.

Preserve tenant isolation, explicit rights states and human review. Do not add public
media scraping, proprietary game fixtures, credentials, real social posts or paid API
calls to tests. Use original synthetic fixtures. Do not broadly refactor unrelated code.
Document durable design changes in docs/adr and public-beta risks in the threat model.

Please be respectful. See CODE_OF_CONDUCT.md and SECURITY.md.
