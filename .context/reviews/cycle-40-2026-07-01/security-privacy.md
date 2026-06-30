# Cycle 40 Security / Privacy Review

Scope: current `master` HEAD `490b93c5`.

Result: no new actionable security/privacy findings from this lane.

## Inventory reviewed

- Project rules and architecture: `AGENTS.md`, `CLAUDE.md`.
- Prior-cycle filter: `.context/reviews/cycle-39-2026-06-30/security-privacy.md`, `.context/reviews/cycle-39-2026-06-30/_aggregate.md`, `.context/plans/cycle-39-2026-06-30-deferred.md`, `.context/plans/cycle-39-2026-06-30-plan.md`.
- Cycle-39-to-40 code delta: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, associated scanner/SW tests, and `apps/web/src/components/search.tsx`.
- Auth/authz/CSRF: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/app/actions/auth.ts`, all `apps/web/src/app/actions/*.ts`, `apps/web/src/app/actions.ts`, admin API route files.
- Public API/rate limits: `apps/web/src/app/api/**/route.*`, upload-serving routes, feed routes, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`.
- Privacy/data exposure: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, timeline/map/search privacy tests.
- File/DB/deploy safety: upload path/serving helpers, backup download, restore/SQL scan helpers, MySQL CLI TLS/stderr redaction, nginx config, deploy scripts.
- Secrets/dependencies: env handling, tracked secret tests, `npm audit --omit=dev --workspace=apps/web`.

## Evidence

- Admin API auth gate passes and covers both admin route files: `npm run lint:api-auth --workspace=apps/web`.
- Server-action origin gate passes, including the top-level action barrel and auth-specific origin checks: `npm run lint:action-origin --workspace=apps/web`.
- Public mutating/expensive route rate-limit gate passes, including expensive `HEAD`: `npm run lint:public-route-rate-limit --workspace=apps/web`.
- Targeted regression/privacy tests passed: `npm test --workspace=apps/web -- privacy-fields.test.ts search-route-privacy.test.ts backup-download-route.test.ts map-privacy.test.ts check-action-origin.test.ts check-public-route-rate-limit.test.ts tracked-secrets.test.ts` (`7` files, `166` tests).
- Production dependency audit is clean: `npm audit --omit=dev --workspace=apps/web` reported `found 0 vulnerabilities`.

## Security posture notes

- `withAdminAuth` enforces same-origin for cookie-authenticated admin API requests and token scope for PAT requests (`apps/web/src/lib/api-auth.ts:72-123`); the scanner confirms both admin API routes use it.
- `requireSameOriginAdmin` is the central server-action origin guard (`apps/web/src/lib/action-guards.ts:37-43`), and the current scanner includes recursive action files plus the top-level barrel (`apps/web/scripts/check-action-origin.ts:86-108`).
- Public route scanning now treats `GET` and `HEAD` as expensive read methods (`apps/web/scripts/check-public-route-rate-limit.ts:37-38`) and fails closed on unresolved/re-exported handlers (`apps/web/scripts/check-public-route-rate-limit.ts:559-619`).
- Public image/data selectors continue to omit sensitive image fields and carry symmetric compile/test guards (`apps/web/src/lib/data.ts:368-488`, `apps/web/src/lib/search-enrichment-fields.ts:29-46`, `apps/web/src/__tests__/privacy-fields.test.ts:7-132`).
- Backup download and upload serving use filename validation, realpath containment, symlink rejection, and no-store/admin response headers where appropriate (`apps/web/src/app/api/admin/db/download/route.ts:21-109`, `apps/web/src/lib/serve-upload.ts:126-328`).
- Restore remains same-origin/admin gated before file processing, then fenced by advisory locks, durable maintenance, chunked dangerous-SQL scanning, `--one-database`, temp-file cleanup, and post-restore migration checks (`apps/web/src/app/[locale]/admin/db-actions.ts:365-760`, `apps/web/src/lib/sql-restore-scan.ts:61-252`).
- The cycle-40 SW change serializes metadata mutations and prefers `Content-Length` for sizing without expanding cache eligibility; admin routes, no-store responses, 401/403 responses, revocable share/photo/map HTML, and admin-rendered HTML remain excluded (`apps/web/public/sw.template.js:42-70`, `apps/web/public/sw.template.js:98-207`, `apps/web/public/sw.template.js:209-280`).

## Deferred filter

I did not re-raise cycle-39 deferred items: feed/sitemap indexes, backfill pipeline-version indexes, broad imported-helper side-effect classification, or sidecar keyset pagination. No new evidence in this lane changes their security severity or makes them scheduled now.

## Findings

No new actionable findings.
