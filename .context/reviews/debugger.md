# Debugger Review - Cycle 20

Date: 2026-07-08 KST
Lane: `debugger`
Scope: comprehensive latent-bug and failure-mode review. Review-only: no source fixes, no deploys, no runtime state changes. Existing dirty peer review files were left untouched.

## Required Context Read

- `AGENTS.md`: commit/deploy policy, schema/migration invariants, quality gates, privacy-field rules, destructive-action limits, and review artifact conventions.
- `CLAUDE.md`: single-instance topology, restore maintenance/drain model, upload and image-processing contracts, CLIP activation, migration drift runbook, service-worker cache rules, deploy/nginx/disk hygiene, and test gates.
- Existing cycle-20 peer review artifacts under `.context/reviews/` were used only as leads; findings below were re-checked against current source.

## Inventory

Bug-prone files and flows inventoried first:

- Admin/public routes and server actions: `apps/web/src/app/**`, including browser uploads, Lightroom upload API, shared/photo pages, search APIs, OG/feed/sitemap/health/upload routes, and DB restore actions.
- Core libraries: auth/session/PATs, rate limiting, request origin, admin mutation barrier, upload tracker, restore maintenance, advisory locks, image queue, background writes, data/cache layer, gallery config, service worker, upload paths, image processing, CLIP, and analytics.
- Persistence/deploy: Drizzle schema, migrations and `_journal.json`, `scripts/migrate.js`, deploy script, Docker/Compose, nginx template, package scripts, generated PWA artifacts.
- Client/browser code: upload dropzone, photo/share pages, service worker offline behavior, map/search/lightbox/hydration-adjacent components.
- Regression gates: custom lint scanners, source-contract tests, generated SW tests, migration tests, and relevant prior cycle review notes.

Generated `.next`, `node_modules`, runtime upload/data stores, binary media, and local secret files were not treated as source.

## Confirmed Issues

### DBG-C20-01 - Mutation-barrier lint gate accepts a spoofed or non-disposable barrier call

Severity: High
Confidence: High

File / region:

- `apps/web/scripts/check-action-origin.ts:148-164` implements `bodyAcquiresAdminMutationSlot()` as a raw identifier search for any call named `acquireAdminMutationSlot`.
- `apps/web/scripts/check-action-origin.ts:1371-1397` treats that raw call as satisfying the restore-window mutation barrier.
- `apps/web/src/__tests__/check-action-origin.test.ts:618-630` positive fixture does not require the approved import, `using`, or an `if (!mutationSlot.acquired)` early return.
- `apps/web/src/lib/admin-mutation-barrier.ts:67-80` documents the required disposable slot shape and acquired-failure branch.

Failure scenario:

Current action files appear to use the real barrier correctly, but the gate will pass a future mutating action like this:

```ts
import { requireSameOriginAdmin } from '@/lib/action-guards';

function acquireAdminMutationSlot() {
  return { acquired: true };
}

export async function updateSettings(input: unknown) {
  const originError = await requireSameOriginAdmin();
  if (originError) return { error: originError };
  acquireAdminMutationSlot();
  await db.update(settings).set(input);
  return { success: true };
}
```

I verified this synthetic source with `checkActionSource(...)`; it returned `OK: src/app/actions/settings.ts::updateSettings`. Such an action would not hold a disposable shared slot across its body. A DB restore could drain zero holders and import while the action later commits into the restored database, reopening the restore-write race the barrier is meant to close.

Concrete fix:

Mirror the scanner's approved-import/shadowing logic for `requireSameOriginAdmin`: collect names imported from `@/lib/admin-mutation-barrier`, reject local shadowing/unapproved imports, require a `using <slot> = acquireAdminMutationSlot()` declaration before protected work, and require an early return on `!<slot>.acquired`. Add negative fixtures for local spoofing, bare calls without `using`, missing acquired checks, and wrong-module imports.

### DBG-C20-02 - Offline HTML cache can resurrect deleted photo pages for 24 hours

Severity: Medium
Confidence: High

File / region:

- `apps/web/public/sw.template.js:31-34` sets `HTML_MAX_AGE_MS` to 24 hours.
- `apps/web/public/sw.template.js:59-63` excludes `/c`, `/s`, `/g`, and `/map`, but not `/p/:id`.
- `apps/web/public/sw.template.js:445-481` caches any successful non-admin HTML response.
- `apps/web/public/sw.template.js:482-495` serves the cached HTML on network failure.
- `apps/web/public/sw.template.js:554-558` explicitly keeps normal `/p/:id` photo pages eligible for offline fallback.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:40-42` keeps photo pages dynamic, so delete/unpublish state is expected to be fresh online.
- `apps/web/src/app/actions/images.ts:655-756` deletes the DB row and derivative/original files, then revalidates `/p/${id}`, but has no way to evict a visitor's service-worker HTML cache.

Failure scenario:

1. Visit `/en/p/123` while the service worker is active; the HTML response is cached.
2. Admin deletes photo `123`.
3. An online revisit returns the fresh 404, but the service worker does not delete the old cache entry on non-OK responses.
4. The visitor goes offline within 24 hours and navigates to `/en/p/123`; `networkFirstHtml()` catches the failed fetch and serves the old cached 200 page.

Cached derivative images have their own one-hour cap, but the stale page shell, metadata, title/description, and any already cached image bytes can remain visible after deletion. This is a browser stale-state/privacy failure rather than a server authorization bypass.

Concrete fix:

Treat `/p/:id` as revocable content, or evict the matching HTML cache entry when a network response is 404/410 for a previously cached photo route. Add a service-worker contract test that caches `/en/p/123`, simulates a later 404, then proves offline fallback does not serve the old page.

## Likely Issues

### DBG-C20-03 - Shared-group cached reader still hides view-count side effects

Severity: Medium
Confidence: Medium

File / region:

- `apps/web/src/lib/data.ts:49-63` buffers shared-group view-count side effects.
- `apps/web/src/lib/data.ts:1322-1407` fetches a shared group and calls `bufferGroupViewCount(group.id)` inside the data reader.
- `apps/web/src/lib/data.ts:1830-1834` exports `getSharedGroupCached = cache(getSharedGroup)` with a warning about mixed count semantics.
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-142` uses the cached reader and separately fires durable `recordSharedGroupView(...)`.

Failure scenario:

The current `/g/[key]` route calls the cached reader once with selected-photo context, then separately records the durable view. The latent failure is the API boundary: a future metadata helper, nested component, or route refactor can call `getSharedGroupCached(key, ...)` twice in one render path with different `incrementViewCount` / `selectedPhotoId` intent. React `cache()` dedupes by argument tuple while the function has hidden side effects, so a call site can silently skip a counter, buffer only the denormalized count but not durable analytics, or make the two counters disagree.

Concrete fix:

Split the shared-group read path into a pure cached query and an explicit `recordSharedGroupPageView(...)` helper that performs both `bufferGroupViewCount` and `recordSharedGroupView` exactly once after selected-photo resolution. Add a regression test that calls the pure cached reader twice and proves no count side effect occurs from reads alone.

## Manual-Validation Risks

### DBG-C20-04 - Large upload and restore ingestion still depends on framework multipart materialization

Severity: Medium
Confidence: High for the code shape; Low/Medium for production impact without RSS measurement

File / region:

- `apps/web/src/components/upload-dropzone.tsx:243-260` creates browser `FormData` with a `File` and calls the server action.
- `apps/web/src/app/actions/images.ts:129-149` receives an already parsed `FormData` and extracts `File` objects.
- `apps/web/src/app/actions/images.ts:239-249` validates total bytes only after parsing.
- `apps/web/src/app/api/admin/lr/upload/route.ts:174-188` calls `await request.formData()` for Lightroom uploads.
- `apps/web/src/app/[locale]/admin/db-actions.ts:693-715` receives a framework-parsed restore `File` and only then streams it to disk.
- `apps/web/src/lib/upload-limits.ts:1-6` allows 200 MiB photo files and a 250 MiB restore/body-parser budget.
- `apps/web/next.config.ts:111-119` configures the framework Server Action/proxy body parser to accept that large body size.

Failure scenario:

A valid admin or PAT client uploads a near-limit multipart file while the Node process is also doing Sharp work, semantic inference, dynamic SSR, or restore work. The route-level checks cap declared sizes and the LR route serializes multipart parsing, but browser Server Actions, DB restore, and `request.formData()` still require the framework/runtime to materialize large `File` bodies before the app can stream/copy to disk. The process can hit RSS pressure, long GC pauses, or OOM before `saveOriginalAndGetMetadata()` and the existing cleanup paths run.

Concrete fix:

Measure RSS under concurrent near-limit browser upload, LR upload, and restore payloads in a production-like container. If the margin is thin, move large uploads/restore to streaming multipart route handlers: authenticate first, enforce per-part and total byte caps while reading, write each part to a temp file under the private upload root, then pass that temp path to the existing metadata/save/queue or restore pipeline.

## Refuted / Not Re-raised

- Cycle-19 Lightroom parse-slot leak: current `apps/web/src/app/api/admin/lr/upload/route.ts:152-188` releases the parse slot in a `finally` around `request.formData()`, and `markAdminAuthTokenUsed(request)` now runs post-commit inside the non-fatal bookkeeping block at `apps/web/src/app/api/admin/lr/upload/route.ts:539-621`. I did not re-raise it.
- Service-worker generated artifact drift: `apps/web/public/sw.template.js` plus current `IMAGE_PIPELINE_VERSION = 7` produces `2bd9e8ba-p7`, matching `apps/web/public/sw.js:26`. No finding.
- Migration journal non-monotonicity: still historically visible in `apps/web/drizzle/meta/_journal.json`, but `apps/web/scripts/migrate.js` and tests explicitly handle the poisoned-cursor class. No fresh migration drift was found in static review.
- Current action files: the source files themselves currently import the real `acquireAdminMutationSlot`, use `using`, and check `mutationSlot.acquired`; DBG-C20-01 is about the regression gate allowing a future false green.

## Final Missed-Issues Sweep

Swept for null/undefined and edge inputs, async errors and cleanup holes, upload quota settlement, queue retry/permanent-failure handling, restore drains, advisory-lock release paths, migration/deploy failure modes, service-worker/browser stale state, React cache side effects, generated artifact drift, auth/PAT route lifecycle, and hydration-adjacent browser flows.

Validation evidence:

- Static source review with line-number reads across the inventory above.
- Synthetic `checkActionSource(...)` probe demonstrating the mutation-barrier scanner false green.
- Local hash/parity probe showing `sw.template.js` + current `build-sw.ts` expects `2bd9e8ba-p7`, matching committed `sw.js`.
- `git ls-files` / `.gitignore` checks confirmed `.env.deploy`, `.next`, runtime upload stores, and generated local resources are ignored rather than tracked.

Tests were not run as a suite because this lane was review-only and made no source fixes. The only filesystem write from this lane is this report.
