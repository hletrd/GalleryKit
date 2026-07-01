# Cycle 96 Code Review Report

## Inventory of review-relevant files

Reviewed current clean `master` at `2f22620` with emphasis on:

- Repo rules/context: `AGENTS.md`, `CLAUDE.md`, `.context/plans/cycle-95-2026-07-01-{plan,deferred}.md`, `.context/reviews/_aggregate.md`
- Recent source deltas: `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/components/load-more.tsx`, related tests/E2E
- Restore/race surfaces: `db-actions.ts`, `restore-maintenance*.ts`, admin mutating actions under `apps/web/src/app/actions/`
- Upload/API-token path: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/api-auth.ts`
- Semantic search: `schema.ts`, `0012_image_embeddings.sql`, `image-queue.ts`, semantic/similar routes
- Public listing queries: `apps/web/src/lib/data.ts`, `apps/web/src/components/home-client.tsx`
- Accessibility/interaction carry-forward surfaces: `image-zoom.tsx`, `lightbox.tsx`, admin nav/table files
- Tests/gates inventory: route/source-contract tests, Playwright admin spec, action/API lint coverage patterns

## Confirmed findings

### C96-01 — Release ledger is stale again after the latest docs-only commit

- **Severity:** Medium
- **Confidence:** High
- **Region:** `.context/plans/README.md:5-8`, `.context/plans/cycle-95-2026-07-01-plan.md:35-56`, `.context/reviews/_aggregate.md:13-29`
- **Problem:** The durable ledgers say Cycle 95 terminal commit/deploy is `2178046587484fb301bc731f855699e44888d2e6`, but current `HEAD`/`origin/master` is `2f22620c361304ba0408053f546f45e3c74ddfdb`. The latest commit itself changed those ledgers, so the recorded terminal state no longer matches repository state.
- **Failure scenario:** Cycle 96 starts from the wrong “deployed/current” baseline and may skip required deploy/smoke evidence for `2f22620`, repeating the same stale-ledger issue Cycle 95 was meant to close.
- **Suggested fix:** Record `2f22620` as the final signed/pushed/deployed ledger-sync commit, or deploy/smoke it first if that was not done, then update README/current aggregate/plan evidence.

### C96-02 — Restore maintenance still does not fence already-in-flight foreground admin mutations

- **Severity:** High
- **Confidence:** High
- **Region:** `apps/web/src/app/[locale]/admin/db-actions.ts:449-503`, `apps/web/src/app/actions/settings.ts:41-175`, `apps/web/src/app/actions/tags.ts:42-98`, `apps/web/src/app/actions/sharing.ts:91-156`
- **Problem:** Restore sets the durable maintenance marker and drains queues/background writes, but foreground admin actions only check maintenance at entry. There is no shared in-flight foreground mutation lease/refcount that restore closes and waits on before import.
- **Failure scenario:** An admin settings/tag/share mutation passes `getRestoreMaintenanceMessage()` at entry, then a restore starts and imports SQL while that action later writes to application tables. The write can be lost, apply to the restored DB unexpectedly, or fail mid-restore.
- **Suggested fix:** Add a shared foreground admin-write barrier: mutating actions acquire a short lease before DB work; restore flips a “closing” flag, rejects new leases, waits for active leases to drain, then imports. Keep upload/backfill special locks, but cover all application-table writers.

### C96-03 — `image_embeddings` cannot retain/stage multiple model versions per image

- **Severity:** Medium
- **Confidence:** High
- **Region:** `apps/web/src/db/schema.ts:284-299`, `apps/web/drizzle/0012_image_embeddings.sql:5-12`, `apps/web/src/lib/image-queue.ts:379-390`, `apps/web/src/app/api/search/semantic/route.ts:270-279`, `apps/web/src/app/api/search/similar/[id]/route.ts:135-177`
- **Problem:** `image_embeddings.image_id` is the primary key, and writers use `onDuplicateKeyUpdate`, so writing a new model version overwrites the previous model’s row.
- **Failure scenario:** Switching stub → production, or production model v1 → v2, destroys the previous embedding version. Rollback/staged backfill cannot keep both versions available; active-model routes may return empty/partial results until the replacement backfill completes.
- **Suggested fix:** Migrate to a composite key such as `(image_id, model_version)`, update Drizzle/reconcile/journal, and make writers upsert by both columns. Add explicit old-model GC policy after successful cutover.

### C96-04 — First-page public listings still force exact window counts through grouped tag joins

- **Severity:** Medium
- **Confidence:** High
- **Region:** `apps/web/src/lib/data.ts:911-927`, `apps/web/src/lib/data.ts:1495-1510`, `apps/web/src/components/home-client.tsx:267-269`
- **Problem:** Initial listing paths include `COUNT(*) OVER()` on the same query that does `LEFT JOIN imageTags/tags`, `GROUP BY images.id`, ordering, limit, and offset. Cursor load-more avoids this, but first-page/home/smart-collection paths still pay for exact totals.
- **Failure scenario:** A large gallery or broad smart collection blocks initial render on an expensive grouped count even though the UI only needs a display count and page rows.
- **Suggested fix:** Decide product policy for counts: remove exact count from first page, use a separate cheap count query, approximate/cache counts, or lazy-load the count. Update tests that currently lock the window-count shape.

### C96-05 — Zoomed images are keyboard-toggleable but still not keyboard-pannable

- **Severity:** Medium
- **Confidence:** High
- **Region:** `apps/web/src/components/image-zoom.tsx:197-208`, `apps/web/src/components/image-zoom.tsx:328-365`, `apps/web/src/components/lightbox.tsx:340-343`
- **Problem:** Keyboard users can Enter/Space toggle zoom and Escape reset, but there is no keyboard pan path. In the lightbox, ArrowLeft/ArrowRight are bound to previous/next navigation.
- **Failure scenario:** A keyboard-only user zooms into a high-resolution photo but cannot inspect off-center details; arrow keys move slides instead of panning the zoomed image.
- **Suggested fix:** Add keyboard pan controls when zoomed, stop propagation to lightbox navigation while pan mode is active, expose instructions, and cover with focused interaction/a11y tests.

## Likely issues

No additional likely source defects beyond the confirmed findings above.

## Manual-validation risks

1. **LR upload route behavior coverage is still source-contract-heavy.**
   `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-15` explicitly describes source-text coverage for `apps/web/src/app/api/admin/lr/upload/route.ts`, while the route’s auth/body/cleanup logic spans `route.ts:84-594`. Add route-level mocked multipart tests for token/scope rejection, restore `503`, invalid/oversized content length, parsed-file too large, success shape, and cleanup on post-save failure.

2. **Admin Playwright navigation does not cover every first-class admin page.**
   `apps/web/src/components/admin-nav.tsx:15-25` defines dashboard/categories/tags/SEO/settings/tokens/password/users/db/analytics. `apps/web/e2e/admin.spec.ts:20-43` navigates only categories/tags/users/password/db in the navigation workflow; settings is covered separately at `admin.spec.ts:73-103`, dashboard upload at `admin.spec.ts:137-165`, but SEO/tokens/analytics lack stable page assertions. Add a nav-table-driven E2E pass over all `AdminNav` destinations.

## Missed-issue sweep and coverage

- `git status --short --branch` stayed clean.
- Swept recent diffs since the latest source-bearing cycles, server-action exports, API route wrappers/rate-limit markers, and TODO/FIXME/HACK markers.
- No file modifications were made.
- Tests were not run for this review-only lane; findings are from source inspection and line-mapped evidence.