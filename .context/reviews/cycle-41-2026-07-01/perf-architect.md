# Cycle 41 Performance / Architecture Review

Reviewer lane: perf-reviewer + architect.
HEAD reviewed: `ae71bd5a`.
Scope: deep review only; no implementation. The only write from this lane is this review artifact.

## Inventory Built

- Data access and query/index surfaces: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`.
- Migrations/schema/reconcile: `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle/*.sql`, `apps/web/scripts/migrate.js`, `apps/web/src/__tests__/migration-journal.test.ts`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`.
- Image processing and queues: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/lib/background-db-writes.ts`.
- Cache/ETag/service worker: `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/next.config.ts`, upload route handlers.
- Scanner/lint tooling: `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/scripts/check-api-auth.ts`, related tests.
- Deployment/runtime: `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, `apps/web/scripts/entrypoint.sh`.
- Frontend critical paths touched in cycle 40: `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/lib/download-labels.ts`, message files.
- Baseline/carry-forward: cycle 40 aggregate and lane reviews under `.context/reviews/cycle-40-2026-07-01/`; deferred items in `.context/plans/cycle-40-2026-07-01-deferred.md`.

## Findings

### PA-41-01 - `lint:action-origin` still misses Drizzle relational reads when `db` is imported under an alias

Severity: Medium. Confidence: High.

Evidence: the cycle-40 fix added relational-read detection, but it is hard-coded to the literal identifier `db`: `nodeContainsProtectedRead()` recognizes `findFirst`/`findMany` only when the call shape is `db.query.<table>.find*` (`apps/web/scripts/check-action-origin.ts:410` through `apps/web/scripts/check-action-origin.ts:425`). It does not collect the local names imported from `@/db`.

Failure scenario: a future read-only exempt action can write:

```ts
import { db as database } from '@/db';

/** @action-origin-exempt: read-only admin getter */
export async function listSessions() {
  return database.query.sessions.findMany();
}
```

I verified this exact shape with the scanner; it returns `SKIP (exempt comment)` and no failure. That leaves the cycle-40 scheduled guardrail partially fixed: direct `db.query.sessions.findMany()` is caught, but the same protected read through a legal import alias is not. A future admin getter could expose protected rows before `isAdmin()`, `getCurrentUser()`, or `requireSameOriginAdmin()` while CI remains green.

Suggested fix: have `check-action-origin.ts` collect local identifiers imported from `@/db` where the imported symbol is `db` (`db`, `db as database`, etc.) and pass that set into `nodeContainsProtectedRead()`. Match `localDbName.query.<table>.findFirst/findMany`, and add regression tests for aliased named imports. If namespace imports are allowed later, also pin that shape explicitly.

### PA-41-02 - `lint:public-route-rate-limit` misses expensive imported reads when public routes use relative imports

Severity: Medium. Confidence: High.

Evidence: the cycle-40 fix recognizes expensive imported read helpers only when the module specifier exactly matches one of the hard-coded alias strings in `EXPENSIVE_READ_IMPORT_MODULES` (`apps/web/scripts/check-public-route-rate-limit.ts:78` through `apps/web/scripts/check-public-route-rate-limit.ts:88`). `collectImportedExpensiveReadFunctions()` ignores all relative module specifiers (`apps/web/scripts/check-public-route-rate-limit.ts:203` through `apps/web/scripts/check-public-route-rate-limit.ts:233`), and `bodyContainsExpensiveGetWork()` then relies on that collected set for helper names outside the older text markers (`apps/web/scripts/check-public-route-rate-limit.ts:499` through `apps/web/scripts/check-public-route-rate-limit.ts:540`).

Failure scenario: a public route can import the same DB-backed helper relatively:

```ts
import { getTopicBySlug } from '../../../lib/data';

export async function GET() {
  const topic = await getTopicBySlug('weddings');
  return Response.json({ topic });
}
```

I verified this exact shape with the scanner; it reports `OK ... no mutating or expensive GET handlers`. The alias form `import { getTopicBySlug } from '@/lib/data'` is now caught, so this is a remaining path-normalization gap rather than a missing helper-name marker. If a future public route follows relative-import style, it can ship an unmetered DB read or heavier data helper even though the route-rate-limit gate is expected to fail closed.

Suggested fix: normalize import specifiers before classification. For relative imports, resolve them against the route file path and compare the normalized project-relative target to known expensive modules such as `src/lib/data`, `src/lib/gallery-config`, `src/lib/og-photo-fetch`, `src/lib/serve-upload`, and `src/db`. Add regression tests for `../../../lib/data`, aliased named imports, and namespace relative imports.

## Clean / Rechecked Surfaces

- Download-label cycle-40 fix is low-risk at runtime. `getJpegDownloadCopy()` branches only on public `color_primaries` and resolved `forceSrgbDerivatives` (`apps/web/src/lib/download-labels.ts:6` through `apps/web/src/lib/download-labels.ts:21`). `photo-viewer.tsx` and `info-bottom-sheet.tsx` consume the helper before rendering the JPEG dropdown labels (`apps/web/src/components/photo-viewer.tsx:209` through `apps/web/src/components/photo-viewer.tsx:210`, `apps/web/src/components/photo-viewer.tsx:940` through `apps/web/src/components/photo-viewer.tsx:955`; `apps/web/src/components/info-bottom-sheet.tsx:165` through `apps/web/src/components/info-bottom-sheet.tsx:166`, `apps/web/src/components/info-bottom-sheet.tsx:501` through `apps/web/src/components/info-bottom-sheet.tsx:516`). Translation keys exist in both locales.
- No schema/reconcile drift found in this pass. The reconcile coverage test strips comments and asserts tables, columns, indexes, and live FKs from the Drizzle/migration sources (`apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:76` through `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:219`), and the targeted run passed.
- Migration journal current state: 29 entries, last tag `0028_rate_limit_bucket_start_idx`. The only non-increasing `when` is the documented grandfathered idx 6 -> 7 inversion; the test intentionally starts monotonic assertions from idx 7 and requires global-max monotonicity from idx 18 forward (`apps/web/src/__tests__/migration-journal.test.ts:19` through `apps/web/src/__tests__/migration-journal.test.ts:27`, `apps/web/src/__tests__/migration-journal.test.ts:87` through `apps/web/src/__tests__/migration-journal.test.ts:105`).
- Source-derived lists checked clean by targeted tests: privacy sensitive keys, SQL restore table superset, settings hash color-impacting keys, and migration/reconcile source tripwires. `APP_BACKUP_TABLES` still lists the 18 schema tables (`apps/web/src/lib/sql-restore-scan.ts:12` through `apps/web/src/lib/sql-restore-scan.ts:31`). `COLOR_IMPACTING_KEYS` remains the 9 byte-impacting settings (`apps/web/src/lib/settings-hash.ts:47` through `apps/web/src/lib/settings-hash.ts:59`). Privacy-sensitive fields remain guarded by the symmetric fixture (`apps/web/src/__tests__/privacy-fields.test.ts:7` through `apps/web/src/__tests__/privacy-fields.test.ts:45`).
- I did not re-raise cycle-40 deferred migration/index, sidecar memory/keyset, semantic vector scan, static derivative invalidation, or process-local scale-out items. This pass found no new production evidence changing their severity or scheduling criteria.

## Validation Evidence

- `npm run lint:action-origin --workspace=apps/web` passed on current HEAD.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed on current HEAD.
- `npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/download-labels.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/migration-journal.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/settings-hash.test.ts src/__tests__/sql-restore-scan.test.ts` passed: 8 files, 275 tests.
- Two ad hoc scanner probes demonstrated PA-41-01 and PA-41-02 as live false negatives in the lint logic.

## Final Sweep

Migration/reconcile gaps: none found.
Source-derived list drift: none found outside the two scanner source-classification gaps above.
New actionable findings: 2.
