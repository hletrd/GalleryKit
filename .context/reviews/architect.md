# Architect Review — Cycle 1 (2026-04-24)

## Scope and inventory covered
Reviewed the repo docs (`CLAUDE.md`, `.context/reviews/prompts/architect.md`, `common_review_scope.md`) and the full `apps/web` surface relevant to architecture and coupling: app routes/layouts/API, server actions, `src/lib`, `src/components`, `src/db`, `scripts`, `messages`, config, and the test surface that documents the expected boundaries.

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 2
- Risks Requiring Manual Validation: 1

## Confirmed Issues

### ARC1 — `getGalleryConfig()` has no failure fallback, so a noncritical settings-table outage can take down the public shell
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Files / regions:** `apps/web/src/lib/gallery-config.ts:33-39, 68-84`; call sites `apps/web/src/app/[locale]/layout.tsx:73-76`, `apps/web/src/components/nav.tsx:6-12`, `apps/web/src/app/[locale]/(public)/page.tsx:106-121`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:122-133`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:89-95`
- **Why it is a problem:** `getGalleryConfig()` reads `admin_settings` directly and does not catch DB errors or fall back to `gallery-config-shared` defaults. That makes the root layout, navigation, and several public pages hostage to a settings-table read even when the gallery could otherwise keep rendering with defaults.
- **Concrete failure scenario:** a transient MySQL lock or outage affecting only `admin_settings` causes the home page and topic/share shells to throw during render. The code already treats SEO settings more defensively; this helper is the outlier.
- **Suggested fix:** mirror the fallback strategy used by `getSeoSettings()` — catch read failures in `getGalleryConfig()` and return defaults from `gallery-config-shared`, or move the read behind an explicit startup cache with documented fallback semantics.

### ARC2 — `lib/data.ts` is still mixing read-model queries with operational lifecycle state
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Files / regions:** `apps/web/src/lib/data.ts:11-109, 594-669`; restore consumer `apps/web/src/app/[locale]/admin/db-actions.ts:21-24, 290-294`
- **Why it is a problem:** the same module owns the shared-group view buffer, flush timer, backoff state, and `flushBufferedSharedGroupViewCounts()` API alongside the query helpers. That means restore/shutdown orchestration has to import the same module that public routes use for page data, and future changes to the read layer can accidentally alter operational behavior.
- **Concrete failure scenario:** a refactor to “just the data layer” unintentionally changes restore behavior or queue shutdown because the lifecycle code lives beside the query helpers. The module is no longer a clean read boundary; it is also a process-control boundary.
- **Suggested fix:** split the shared-group view-count buffer/flush lifecycle into a dedicated module with a narrow API, and keep `lib/data.ts` focused on query composition and cached read helpers.

## Likely Issues

### ARC3 — `getSharedGroup()` is a query helper with a hidden write contract
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Files / regions:** `apps/web/src/lib/data.ts:594-669`; call sites `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:29-35, 89-95, 118-144`
- **Why it is a problem:** the function increments `sharedGroups.view_count` by default and only avoids that write when callers remember to pass `{ incrementViewCount: false }`. That turns a public read helper into a command with opt-out semantics, which is easy to misuse in future callers.
- **Concrete failure scenario:** a future page, metadata path, or prefetch consumer calls the same helper without the flag and starts counting non-view traffic as real views, or a future refactor accidentally uses the incrementing path in a context that should be read-only.
- **Suggested fix:** split the API into explicit read vs. record-view operations, or at minimum make the side-effecting path separately named so callers must opt in to the write behavior.

### ARC4 — `image-queue.ts` is not side-effect-free; importing the queue helper starts bootstrap work and timers
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Files / regions:** `apps/web/src/lib/image-queue.ts:330-411`; importers `apps/web/src/app/actions/images.ts:13-15, 298-306`, `apps/web/src/app/[locale]/admin/db-actions.ts:22-24, 292-304`
- **Why it is a problem:** the module auto-calls `bootstrapImageProcessingQueue()` at import time. A consumer that only wants queue helpers still gets DB probing, pending-job enqueueing, orphan cleanup, and an hourly GC interval.
- **Concrete failure scenario:** a unit test or a new route imports `enqueueImageProcessing` and unexpectedly triggers queue bootstrap or interval setup. In runtime, incidental import order can produce extra DB work or lifecycle behavior before the app is actually ready to process jobs.
- **Suggested fix:** move bootstrap and periodic maintenance into an explicit startup path (`instrumentation.ts`/entrypoint or a dedicated initializer) and keep `lib/image-queue.ts` focused on queue operations only.

## Risks Requiring Manual Validation

### ARC5 — The current deployment model still assumes one process owns queue state, rate limits, and shared-group analytics
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Files / regions:** `apps/web/src/lib/image-queue.ts:94-123, 164-187, 330-373`; `apps/web/src/lib/data.ts:11-109`; `apps/web/src/lib/rate-limit.ts:22-26, 101-149`; `apps/web/src/lib/restore-maintenance.ts:1-56`
- **Why it matters:** queue claims, buffered view counts, maintenance state, and in-memory fast-path limits are all process-local. That is coherent for the documented single-host runtime, but it is not safe to scale out blindly.
- **Validate:** confirm the deployment/runbooks continue to enforce a single-process app model, or plan a shared coordination layer before any horizontal scaling.

## Final sweep
No relevant `apps/web` source area was skipped. The main architectural pressure points are still the config-read boundary, the mixed query/operational boundary in `lib/data.ts`, and hidden lifecycle side effects in queue/bootstrap code.
