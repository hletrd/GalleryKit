# Debugger Review - Cycle 21

Date: 2026-07-08 KST
Lane: `debugger`
HEAD: `45b32d1db373e03d82a29511f53832051c770880`

Review-only. I did not edit source code, run deploys, commit, or push. Existing dirty peer review artifacts under `.context/reviews/` were left untouched except for this requested file.

## Required Context Read

- `AGENTS.md`: commit/deploy policy, schema/migration invariants, quality gates, privacy-field rules, and review artifact expectations.
- `CLAUDE.md`: single-instance deployment, restore maintenance/drain protocol, upload and image-processing contracts, CLIP/search activation, migration drift runbook, service-worker cache policy, deploy and disk hygiene.
- `.context/plans/README.md`: plan/review index and current planning history.

## Bug-Prone Inventory

- Server actions and admin/public routes: `apps/web/src/app/actions/*`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `/api/admin/lr/upload`, `/api/admin/db/download`, `/api/search/semantic`, `/api/search/similar/[id]`, upload serving, health/live, feed/sitemap/OG, public photo/share/group/timeline/map pages.
- Image processing and queue: `process-image`, `image-queue`, upload paths, upload tracker, color/HDR settings hash, backfill runner, sidecar backfill scripts, CLIP embedding action/scripts.
- Auth/session/PATs: `auth.ts`, `session.ts`, `api-auth.ts`, `action-guards.ts`, `admin-users.ts`, `lr-tokens.ts`, `admin-tokens.ts`, rate-limit helpers.
- Restore/backup/migrate: DB backup/download/restore actions, SQL restore scanner, restore maintenance marker, advisory-lock release helpers, `scripts/migrate.js`, migration journal, deploy helper assumptions.
- Public APIs and caches: search, similar search, analytics view recording, share lookup throttling, service worker HTML/image cache, sitemap/feed generation.
- Stateful UI: upload dropzone, load-more, search modal, similar photos, photo viewer/lightbox/navigation/zoom, map client, admin settings/tokens/dashboard/category/tag managers.
- Tests and gates: custom lint scanners, source-contract tests, migration/privacy/touch-target/queue/upload/search tests, Playwright e2e entry points.

I did not manually inspect binary fixtures/media bytes, generated `.next`, `node_modules`, runtime upload/data stores, or local secret/env files.

## Findings

### DBG-C21-01 - Archive month/year rendering depends on JavaScript parsing of MySQL datetime strings

Severity: Low
Confidence: Medium

File / region:

- `apps/web/src/lib/data-timeline.ts:247-256` groups year-in-review rows with `new Date(img.capture_date).getMonth() + 1`.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:99-108` repeats the same month grouping in the timeline page.
- `apps/web/src/components/on-this-day-widget.tsx:50-52` renders the photo year with `new Date(photo.capture_date).getFullYear()`.
- `apps/web/src/__tests__/data-timeline.test.ts:127-138` and `apps/web/src/__tests__/data-timeline.test.ts:195-199` mirror the same parsing behavior, so tests lock in the brittle assumption instead of detecting it.

Failure scenario:

`capture_date` is documented and queried as a MySQL-style string such as `YYYY-MM-DD HH:mm:ss`. That is not the strict ECMAScript date-time interchange format. In the current Node/V8 runtime it usually parses as local time, but the behavior is implementation-dependent and fragile if this grouping logic moves to another JS runtime, an Edge runtime, or encounters a legacy/imported malformed value. A parse failure drops a photo from month sections; an invalid year in the widget can render a broken localized year label.

Suggested fix:

Add a tiny shared parser for persisted EXIF/MySQL datetimes that extracts `year`, `month`, and `day` by regex/string slicing and validates ranges without `Date.parse`. Reuse it in `data-timeline.ts`, `timeline/page.tsx`, and `on-this-day-widget.tsx`. Update `data-timeline.test.ts` to assert the parser path directly, including invalid strings and the exact `YYYY-MM-DD HH:mm:ss` storage format.

### DBG-C21-02 - Large multipart upload/restore paths still materialize before app-level streaming checks

Severity: Medium
Confidence: Medium

File / region:

- `apps/web/next.config.ts:111-119` raises Server Action/proxy body limits to the restore/upload cap.
- `apps/web/src/lib/upload-limits.ts:1-6` allows 200 MiB photo files and 250 MiB restore files plus multipart overhead.
- `apps/web/src/components/upload-dropzone.tsx:243-260` sends each browser upload through Server Action `FormData`.
- `apps/web/src/app/actions/images.ts:129-149` receives framework-parsed `File` objects before app-level validation.
- `apps/web/src/app/api/admin/lr/upload/route.ts:174-188` calls `await request.formData()`; the parse slot serializes this, but the body is still materialized before file streaming.
- `apps/web/src/app/[locale]/admin/db-actions.ts:717-729` receives a parsed restore `File`, checks `file.size`, then streams it to disk.

Failure scenario:

An authenticated admin or PAT client submits a near-limit upload or restore while the process is also doing Sharp work, SSR, queue work, or semantic inference. The code correctly caps declared sizes and streams after receiving `File`, but Next/undici has already parsed the multipart body by then. On a memory-constrained host, one 200-250 MiB request can cause RSS pressure, long GC pauses, or OOM before `saveOriginalAndGetMetadata()` or the restore temp-file streaming path gets control.

Suggested fix:

Move the largest payload paths to streaming route handlers: authenticate and check origin/token first, enforce `Content-Length`, stream multipart parts to private temp files while enforcing per-part and total byte caps, then hand temp paths to the existing image metadata/queue or restore pipeline. At minimum, add a production-like RSS smoke test for concurrent near-limit browser upload, LR upload, and restore.

## Not Re-Raised

- Restore and upload race protections: current upload, delete, retry, settings, restore, queue, color backfill, and semantic backfill paths consistently use restore maintenance checks, mutation slots, advisory locks, or explicit exemptions. I did not find a current restore-write race in the inspected source.
- Cycle-20 service-worker stale photo-page issue appears fixed at current HEAD: `apps/web/public/sw.template.js:59-64` classifies `/p`, `/c`, `/s`, `/g`, and `/map` as revocable, and `apps/web/public/sw.template.js:555-558` bypasses offline HTML caching for those routes.
- Cycle-20 mutation-barrier scanner issue appears fixed at current HEAD: `apps/web/scripts/check-action-origin.ts:155-175` requires approved imports, `apps/web/scripts/check-action-origin.ts:651-695` requires `using ... = acquireAdminMutationSlot()` plus an acquired-state gate, and tests cover spoofed/bare/wrong-module calls.
- Auth/session/PAT wrappers: production session secret fails closed, admin API token auth is scope-gated, same-origin checks are centralized, and limiter rollback behavior is documented per path.

## Final Sweep

Inspected categories covered the requested server actions/routes, image queue/processing, auth/session, restore/backup/migrate, public APIs, stateful UI components, scripts, and tests by source category. The main uninspected categories are binary fixtures/media, generated build output, runtime upload/data contents, `node_modules`, and local secret files.

I did not run the full test suite because this was a review-only lane with no source fixes. Validation evidence is static line-number inspection at the requested HEAD plus targeted cross-checks of prior known-risk areas against current source.
