# Plan 254 — Cycle 2 gate warnings

## Recorded gate warnings

### GW-C2-01 — Build sitemap fallback logs DB access denied during local production build
- Gate: `npm run build`
- Evidence: build completed with exit code 0, but `sitemap.xml` generation logged `[sitemap] falling back to homepage-only sitemap` because local build credentials could not query `topics` (`ER_ACCESS_DENIED_ERROR` for empty DB user).
- Severity/confidence: Low / High.
- Reason not fixed in this cycle: local verification environment lacks production DB credentials by design; the application has an explicit sitemap fallback and the build still succeeds. Changing the build to require DB access would make offline/local verification brittle and contradict the existing fallback behavior.
- Exit criterion: production build logs the same warning with valid DB credentials, sitemap content is incomplete in deployment, or the repo adopts a DB-backed build fixture for sitemap generation.

## Gate evidence
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed with GW-C2-01.
- `npm run test` — passed (72 files, 479 tests).
- `npm run test:e2e` — passed (20 passed, 2 skipped).
- `npm run lint:api-auth` — passed.
- `npm run lint:action-origin` — passed.
