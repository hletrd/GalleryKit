# Verifier Review - Cycle 11 Prompt 1

Date: 2026-06-29
Role: verifier, evidence-based correctness check against stated behavior
Scope: `/Users/hletrd/flash-shared/gallery` on `master`
Constraint: review artifact only. No production code edited.

## Inventory Built First

Review-relevant inventory before judging findings:

- Governing docs and contracts: `AGENTS.md` from the prompt, `CLAUDE.md`, root `package.json`, `apps/web/package.json`.
- App/runtime config: `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/drizzle.config.ts`.
- Public/admin route surface: every `apps/web/src/app/**/route.{ts,tsx}` file, including admin DB download, Lightroom upload, uploads serving, OG image routes, feeds, health/live, semantic search, and similar-image search.
- Server actions: every `apps/web/src/app/actions/*.ts` plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Core correctness libraries: `data.ts`, `data-timeline.ts`, `request-origin.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `session.ts`, `api-auth.ts`, `admin-tokens.ts`, `image-queue.ts`, `process-image.ts`, `serve-upload.ts`, `gallery-config*.ts`, `settings-hash.ts`, `upload-*`, `restore-maintenance.ts`, `smart-collections.ts`, `search-enrichment-fields.ts`.
- Schema/migrations: `apps/web/src/db/schema.ts`, all `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`.
- Regression tests sampled or run: privacy fields, migration reconcile/journal, action/API/rate-limit scanners, semantic search route, similar route, plus adjacent source-contract suites referenced by the reviewed code.

## Findings

No confirmed, likely, or risk-level correctness findings were identified in this pass.

Evidence for no findings:

- Admin API route exports are all wrapped by `withAdminAuth(...)` and the scanner passed.
- Mutating server actions all return early on `requireSameOriginAdmin()` or have explicit read-only/public exemptions, and the scanner passed.
- Public mutating API routes are rate-limit covered or non-mutating, and the scanner passed.
- Public image-data reads use `publicSelectFields`, `publicMapSelectFields` with `topics.map_visible = true`, `timelineSelectFields` with the exported privacy guard, or `searchEnrichmentSelectFields` with a type-only sensitive-key guard.
- Upload paths reconcile quota claims on early returns and exceptions, validate topics before insert, snapshot processing settings, strip GPS originals when configured, and gate HDR ingest consistently across browser and Lightroom paths.
- Delete paths remove DB rows transactionally and scan derivative directories so old-size variants are cleaned up.
- Migration/reconcile paths mirror current schema tables, columns, indexes, and known drops; journal behavior is covered by tests despite historical non-monotonic `when` values.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` -> passed; 2 admin routes OK.
- `npm run lint:action-origin --workspace=apps/web` -> passed; all mutating server actions enforce same-origin provenance.
- `npm run lint:public-route-rate-limit --workspace=apps/web` -> passed.
- `npm test --workspace=apps/web -- src/__tests__/privacy-fields.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/migration-journal.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts` -> 8 files passed, 183 tests passed.

## Files And Regions Reviewed

- Auth/session/admin API: `apps/web/src/app/actions/auth.ts:70-445`, `apps/web/src/lib/session.ts:16-151`, `apps/web/src/lib/api-auth.ts:54-133`, `apps/web/src/lib/admin-tokens.ts:137-242`, `apps/web/src/app/api/admin/db/download/route.ts:22-101`, `apps/web/src/app/api/admin/lr/upload/route.ts:62-531`.
- Public actions/rate limits: `apps/web/src/app/actions/public.ts:31-438`, `apps/web/src/lib/rate-limit.ts:1-344`, `apps/web/src/lib/request-origin.ts:45-107`.
- Public data/privacy: `apps/web/src/lib/data.ts:250-507`, `apps/web/src/lib/data.ts:784-1695`, `apps/web/src/lib/data-timeline.ts:35-260`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`.
- Upload/mutation correctness: `apps/web/src/app/actions/images.ts:114-612`, `apps/web/src/app/actions/images.ts:615-1260`, `apps/web/src/app/actions/settings.ts:40-167`, `apps/web/src/app/actions/topics.ts:85-360`.
- Public API/serving: `apps/web/src/app/api/search/semantic/route.ts:106-355`, `apps/web/src/app/api/search/similar/[id]/route.ts:60-235`, `apps/web/src/app/api/og/photo/[id]/route.tsx:37-298`, `apps/web/src/app/uploads/[...path]/route.ts:4-27`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:4-22`, `apps/web/src/lib/serve-upload.ts:127-309`.
- Schema/migrations/deploy: `apps/web/src/db/schema.ts:1-310`, `apps/web/drizzle/meta/_journal.json:1-202`, `apps/web/scripts/migrate.js:170-760`, `apps/web/next.config.ts:36-107`, `apps/web/nginx/default.conf:1-200`, `apps/web/deploy.sh:1-62`.

## Final Missed-Issues Sweep

Final sweeps checked:

- Every app route export for missing wrappers, same-origin checks, or rate-limit pre-increments.
- Admin-path files for direct DB mutations without auth/origin gates.
- Public select shapes for sensitive key drift and map GPS exposure constraints.
- Upload and Lightroom path parity for HDR, GPS stripping, settings snapshots, quota settle, and topic existence.
- Migration journal/reconcile/schema alignment and deploy/nginx body-size/cache/header contracts.

No additional issues surfaced.
