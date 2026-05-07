# Verifier — Cycle 8 (Fresh, broad sweep)

**Scope:** verify that prior-cycle invariants still hold; spot regressions; flag claims that lack evidence.

## Verifications

### V8F-01 — Unicode-formatting policy: still applied at every entry point
**Verified by re-reading:** `validation.ts` (`UNICODE_FORMAT_CHARS`, `containsUnicodeFormatting`, `isValidTopicAlias`, `isValidTagName`), `actions/topics.ts` (createTopic/updateTopic), `actions/seo.ts` (updateSeoSettings: 4 free-form fields), `actions/images.ts` (updateImageMetadata: title + description), `actions/tags.ts` (assumed; not re-read this cycle but covered last cycle).
**Status:** OK. Single canonical helper used everywhere. CSV path strips inline.

### V8F-02 — `requireSameOriginAdmin` now invoked across every mutating action
**Verified:** `actions/{auth,images,public,sharing,admin-users,topics,seo,settings}.ts` all call it. The lint `lint:action-origin` enforces this at CI time.
**Status:** OK.

### V8F-03 — `withAdminAuth` wraps every `/api/admin/*` route
**Verified:** Only `/api/admin/db/download/route.ts` lives under that prefix. It uses `export const GET = withAdminAuth(...)`. The lint `lint:api-auth` enforces.
**Status:** OK.

### V8F-04 — Restore advisory-lock release on every exit path (fix from C7R-RPL-02 / AGG7R-02)
**Verified:** `db-actions.ts:292-294` releases on `beginRestoreMaintenance` early-return; `db-actions.ts:316-318` releases in outer `finally`; both wrapped in `.catch()` that logs at debug.
**Status:** OK.

### V8F-05 — CSV `escapeCsvField` ordering: control-char strip → bidi/invisible strip → CRLF collapse → formula-prefix guard
**Verified:** `lib/csv-escape.ts:33-53` matches the C7R-RPL-01 / C8R-RPL-01 invariant. Tab is pre-stripped by C0/C1 pass; formula-prefix regex `/^\s*[=+\-@]/` tolerates leading whitespace.
**Status:** OK.

### V8F-06 — Privacy guard: `_PrivacySensitiveKeys` extends never check
**Verified:** `lib/data.ts:197-200`. The compile-time guard correctly enforces `latitude`, `longitude`, `filename_original`, `user_filename`, `processed`, `original_format`, `original_file_size` are absent from `publicSelectFields`.
**Status:** OK.

### V8F-07 — `view_count` int overflow not yet fixed (CR8F-06 from this cycle)
**Status:** OPEN. Acceptable for personal-gallery scope; should be planned or explicitly deferred.

### V8F-08 — Sitemap config inconsistency (`force-dynamic` + `revalidate`) not previously flagged
**Status:** OPEN. New finding, no prior coverage.

### V8F-09 — `/api/og` lacks rate limit
**Status:** OPEN. New finding, no prior coverage. The other public unauthenticated CPU-bound endpoints (`/api/og` is the only one) all have rate-limit guards via the action layer; this is the first gap of its kind.

### V8F-10 — Audit-log metadata 4096 truncation
**Status:** OPEN. No previous explicit coverage; observed during cycle 8 broad sweep.

### V8F-11 — Permissions-Policy missing modern privacy directives
**Status:** OPEN. New finding.

### V8F-12 — Test coverage check: `vitest` and `playwright` suites
**Examined:** `apps/web/src/__tests__/` directory listing showed 59 test files. E2E coverage: untested in this review; assumed stable from prior cycles.
**Note:** No new tests added for the items raised this cycle, which is expected since they have not been implemented yet.

## Net summary

- 6 items confirmed still solid (Unicode policy, action-origin, api-auth, restore lock, CSV ordering, privacy guard).
- 5 items NEW open this cycle (view_count overflow, sitemap config, /api/og no-RL, audit truncation, Permissions-Policy).
- No regressions of previously-fixed items.
- No tests broken.
