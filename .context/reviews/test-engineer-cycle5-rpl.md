# Test Engineer — Cycle 5 (RPL loop)

Generated: 2026-04-24. HEAD: `0000000789a97f7afcb515eacbe40555cee7ca8f`.

Scope: review of vitest + Playwright surfaces with focus on coverage, gaps, and regression value.

## Inventory

- **Vitest unit tests:** 46 files in `apps/web/src/__tests__/`.
- **Playwright e2e:** 5 files (`admin.spec.ts`, `public.spec.ts`, `nav-visual-check.spec.ts`, `test-fixes.spec.ts`, `helpers.ts`).
- **Lint gates:** `lint:api-auth`, `lint:action-origin`.

## Positive observations

- Test surface covers: action-guards, admin-users, auth-rate-limit, auth-rethrow, backup-download route, backup-filename, base56, clipboard, data-pagination, db-pool-connection-handler, db-restore, error-shell, exif-datetime, gallery-config-shared, health-route, histogram, image-url, images-actions, lightbox, live-route, locale-path, next-config, photo-title, privacy-fields, public-actions, queue-shutdown, rate-limit, request-origin, restore-maintenance, revalidation, safe-json-ld, sanitize, seo-actions, serve-upload, session, shared-page-title, sql-restore-scan, tag-input, tag-records, tag-slugs, tags-actions, topics-actions, upload-dropzone, upload-tracker, validation.
- Cycle-4-rpl2 added `db-pool-connection-handler.test.ts`, `safe-json-ld.test.ts` (expanded), and relevant coverage.
- Cycle-1-rpl added `request-origin.test.ts` fail-closed strict default test.

## Findings

### T5-01 — `check-action-origin.ts` has no unit/integration test harness
- **Severity:** LOW. **Confidence:** HIGH.
- **Evidence:** the script is a standalone TS scanner run by `npm run lint:action-origin`. There is no `check-action-origin.test.ts` or `scripts/__tests__/check-action-origin.test.ts`. No fixtures, no regression coverage.
- **Why it matters:** a change to the scanner (e.g. the arrow-export fix from C5-01 / S5-01 / V5-F01 this cycle) should ship with a red/green test asserting:
  (a) a mutating arrow-export WITHOUT `requireSameOriginAdmin()` fails the lint;
  (b) a mutating arrow-export WITH `requireSameOriginAdmin()` passes;
  (c) an arrow-export named `getFoo` (starts-with-`get`) is auto-exempted;
  (d) a function-declaration WITHOUT the check fails (existing behavior);
  (e) a function-declaration with the `@action-origin-exempt:` comment is exempted.
- **Fix:** create `apps/web/src/__tests__/check-action-origin.test.ts` (or script-adjacent) that exercises the scanner against fixture strings. A fixture-based test runs quickly and locks the behavior.

### T5-02 — `check-api-auth.ts` has no unit test harness
- **Severity:** LOW. **Confidence:** HIGH.
- **Evidence:** same as T5-01 for the API auth scanner.
- **Fix:** add unit test; cover `route.ts` / `.js` / (proposed) `.tsx`, and the various `withAdminAuth()` detection patterns.

### T5-03 — No test exercises `searchImages` returning via the alias-join fallback path
- **Severity:** LOW. **Confidence:** MEDIUM.
- **Evidence:** `data.ts:802-820` — alias-join is the 3rd fallback. The existing `public-actions.test.ts` exercises `searchImagesAction` flow but likely not the specific alias-join branch.
- **Why it matters:** the deferred rewrite (D2-05 / PERF-02) to collapse into one UNION query would change behavior; without a baseline test the new design could silently regress alias lookup.
- **Fix direction:** add a targeted test in `data.test.ts` (new file) or `public-actions.test.ts` covering:
  - query matches ONLY via `topic_aliases.alias LIKE '%term%'`;
  - main query and tag-join produce no rows;
  - alias fallback returns the expected image ids.
- Low priority pending the deferred perf work.

### T5-04 — `flushGroupViewCounts` has no test coverage for the re-buffer path
- **Severity:** LOW. **Confidence:** MEDIUM.
- **Evidence:** `data.ts:55-80` contains the re-buffer logic for DB-update failures. No test exercises this path.
- **Why it matters:** the re-buffer capacity check `viewCountBuffer.size >= MAX_VIEW_COUNT_BUFFER_SIZE` guards against unbounded growth. A test would lock this behavior.
- **Fix:** add `data-view-count-flush.test.ts` mocking `db.update(sharedGroups)` to reject for a subset of entries.

### T5-05 — No e2e test for the `/api/admin/db/download` authenticated route
- **Severity:** LOW. **Confidence:** MEDIUM.
- **Evidence:** there's a vitest `backup-download-route.test.ts` but no Playwright flow that creates a backup and downloads it end-to-end.
- **Why it matters:** covers the admin UX + auth middleware + filename validation interplay.
- **Fix direction:** defer — depends on admin lane stability. Mark as observational.

### T5-06 — Playwright `admin.spec.ts` only runs when local credentials are present
- **Severity:** LOW. **Confidence:** HIGH (already fixed in cycle-1-rpl).
- **Disposition:** prior fix (C1R-08) auto-enables locally. Verified; observational.

### T5-07 — JSON-LD structural shape has unit coverage but not Playwright assertion
- **Severity:** LOW. **Confidence:** MEDIUM. Cross-ref cycle-4-rpl2 TE-04.
- **Evidence:** `safe-json-ld.test.ts` covers serialization. Playwright specs do not load a live page and assert `<script type="application/ld+json">` shape.
- **Fix direction:** add a Playwright assertion parsing `document.querySelectorAll('script[type="application/ld+json"]')` content and shape. Matches existing deferred backlog.

## Summary

7 LOW findings, mostly test-coverage expansion opportunities:
- Actionable this cycle: T5-01, T5-02 if the arrow-export lint gap gets fixed (C5-01 / S5-01 / V5-F01) — the test should ship with the fix.
- Defer: T5-03 (depends on deferred perf rewrite), T5-04, T5-05, T5-07.
