# Cycle 78 Code/Security Review

HEAD reviewed: `9286bef16f3401fb0d8c17f52de5c96804c04533`.

## Inventory

- Current-cycle diff from `8aefc365` to HEAD: `apps/web/scripts/backfill-color-pipeline.ts`, OG route tests, backfill regression tests, and Cycle 77 artifacts.
- Admin API/auth boundary: `apps/web/src/lib/api-auth.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`.
- Same-origin/session/token trust: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/admin-tokens.ts`.
- Public expensive routes/rate limits: `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.
- File handling/path containment: `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/app/api/admin/db/download/route.ts`.
- Raw SQL/restore/child process surfaces: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/smart-collections.ts`.
- Privacy selectors/search enrichment: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`.
- XSS/JSON-LD sinks: `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`.

## Findings

No confirmed correctness or security findings were identified in this lane.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` passed in the delegated lane.
- `npm run lint:action-origin --workspace=apps/web` passed in the delegated lane.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed in the delegated lane.
- `npm audit --omit=dev --workspace=apps/web --audit-level=high` reported `found 0 vulnerabilities` in the delegated lane.
- Focused Vitest set passed: 10 files, 261 tests.

## Residual Risks

- Existing deferred `C77-ARCH-01` remains: restore maintenance does not yet provide a whole-action foreground mutation barrier for all non-upload admin mutations. Not re-raised as a new finding.
- Public rate-limit fast paths are partly in-memory and rely on the documented single web-instance topology.
- Restore SQL scanning is a strong heuristic around an admin-only operation, not a formal SQL parser proof.
- Admin users remain full-power by product design; no role separation.
- DB backups are plaintext at rest inside the operator boundary.
