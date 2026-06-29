# Code Reviewer - Cycle 13

**Date:** 2026-06-29  
**HEAD reviewed:** `b269a36bde0fa6e22ebe6c025a41af3f4e050cc6` (`b269a36 test(auth): ✅ lock auth and ops guardrails`)  
**Role:** code-reviewer subagent  
**Scope:** whole current repository from code quality, logic, SOLID, maintainability, cross-file contracts, state consistency, race/shared-state hazards, error handling, and documentation/code mismatches. Review-only: no production code was changed.

## Required Context Read

- `AGENTS.md`
- `CLAUDE.md`
- Local review workflow: `/Users/hletrd/.agents/skills/code-review/SKILL.md`

## Inventory Coverage

I built the review inventory before evaluating findings.

- Tracked repository inventory after required exclusions: **2,546 files** via `git ls-files`, excluding `node_modules`, `.git`, build output, runtime upload/data/resource directories, `test-results`, and `apps/web/tsconfig.tsbuildinfo`.
- App/script/migration executable surface: **556 files** under `apps/web/src`, `apps/web/scripts`, and `apps/web/drizzle` (`*.ts`, `*.tsx`, `*.js`, `*.mjs`, `*.sql`, `*.json`) after the same runtime/build exclusions.
- Total executable-surface line count: **83,953 lines**. Largest hotspots directly reviewed included `process-image.ts`, `data.ts`, `actions/images.ts`, `image-queue.ts`, `photo-viewer.tsx`, `migrate.js`, `admin-backfill-runner.ts`, `settings-client.tsx`, `image-manager.tsx`, `admin/db-actions.ts`, `gps-exif-strip.ts`, `actions/topics.ts`, `upload-dropzone.tsx`, `api/admin/lr/upload/route.ts`, `rate-limit.ts`, `search.tsx`, `actions/tags.ts`, `smart-collections.ts`, `actions/auth.ts`, and `actions/public.ts`.
- Binary fixtures and historical docs/review artifacts were inventoried but not treated as behavioral code. The pre-existing untracked `.context/reviews/.critic-inventory.tmp` was left untouched.

Coverage method:

- Direct source reads of the core data layer, schema, migrations/reconcile logic, upload and Lightroom ingest paths, image processing queue, restore/backfill operations, admin authentication/session/token/rate-limit paths, public/search/similar/OG routes, sharing, topics/tags/collections, smart-collection parser/compiler, privacy projections, service worker, and high-risk client components.
- Repository-wide sweeps for raw SQL, route/action auth wrappers, same-origin gates, public mutating rate limits, JSON-LD injection, path/file handling, numeric coercion, async fire-and-forget, advisory locks, rollbacks, environment parsing, cache/service-worker behavior, and privacy-sensitive fields.
- Cross-file checks against schema/migration/reconcile mirrors and source-locked tests for privacy, service-worker cache routing, migration journal monotonicity, upload/processing contracts, map visibility, and action-origin/API-auth lint rules.

## Confirmed Issues

No confirmed code-quality, logic, maintainability, state-consistency, or cross-file behavior defects were found at this review threshold.

## Likely Issues

No likely issues were identified with enough evidence to classify above risk/watchlist level.

## Risks Needing Manual Validation

### C13-RISK-01 - Public route IDs accept unsafe integer ranges before DB lookup

**Severity:** Low  
**Confidence:** Medium  
**Classification:** Maintainability / future-schema risk, not a confirmed current production bug.

**File/region:**

- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:40-58` and `:129-145`
- `apps/web/src/app/api/search/similar/[id]/route.ts:74-82`
- `apps/web/src/app/api/og/photo/[id]/route.tsx:51-64`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:93-99`
- Current schema bound: `apps/web/src/db/schema.ts:19-20` (`images.id` is MySQL `int` autoincrement)

**Risk:** These route params first require `/^\d+$/`, then use `parseInt(...)`, and only reject `NaN`, non-positive, or non-integer values. Values above `Number.MAX_SAFE_INTEGER`, and values above the current MySQL signed-int range, still pass local validation and are sent into the data lookup as JavaScript numbers. With the current `images.id int` schema, practical impact is low because valid IDs cannot reach those ranges. The inconsistency is still worth cleaning up because the repository already treats unsafe integer coercion as a known risk class for insert IDs in `apps/web/src/lib/validation.ts:162-187`.

**Concrete failure scenario:** If a future migration widens `images.id` or shared-photo selection to `bigint`, `/p/9007199254740993` would pass the regex, round during JavaScript numeric coercion, and could query the wrong numeric ID. Even today, impossible values such as `/api/search/similar/999999999999999999999` consume validation/database work instead of being rejected at the route boundary.

**Suggested fix:** Centralize route-ID parsing, for example `parseImageRouteId(raw): number | null`, and require `Number.isSafeInteger(id)`, `id > 0`, and the current schema maximum (`id <= 2147483647`) before any DB/cache lookup. Reuse it across photo pages, similar search, OG photo, and shared-group `photoId`.

## Final Sweep Notes

- The previous cycle's service-worker stale HTML findings are fixed in the current tree: `apps/web/public/sw.template.js:61-65` and generated `apps/web/public/sw.js:61-65` now match `/c/*`, `/s/*`, `/g/*`, and `/map`, and the fetch handler bypasses those HTML routes at `apps/web/public/sw.template.js:391-397`. `apps/web/src/__tests__/sw-template-contract.test.ts:71-80` now source-locks that broader predicate.
- JSON-LD injection sites all route through `safeJsonLd(...)` or generated script literals with controlled config values.
- Raw SQL in request paths is parameterized through Drizzle/sql templates or dedicated connection queries with fixed SQL and bound parameters. Migration helper dynamic identifiers are guard-railed by helper functions and static migration inputs.
- Schema/migration/reconcile checks found current columns such as `processing_settings_json`, `avif_10bit`, and `topics.map_visible` mirrored between `schema.ts`, committed migrations, `migrate.js`, and tests.
- Privacy-sensitive DB projections, smart-collection query compilation, semantic/similar response shaping, upload quota/rollback accounting, derivative cleanup, queue claims/retries, restore-maintenance locks, and admin mutation guards did not yield a confirmed non-duplicate finding.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm run typecheck --workspace=apps/web` - passed.
- `npm run lint --workspace=apps/web` - passed.

I did not run full `npm run build`, `npm test --workspace=apps/web`, or Playwright e2e because this was a review-only artifact and no executable source was changed. The targeted gates above were used to validate the review's control-surface claims.
