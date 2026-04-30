# Plan 320 — Cycle 1 Review-Fix Implementation

Date: 2026-04-29
Status: Completed
Source: `.context/reviews/_aggregate.md` (Cycle 1 fresh reviews)

## Must-fix items (scheduled for implementation this cycle)

### P320-01: Batch tag update Array.isArray guard (AGG1-09) -- DONE

- **File:** `apps/web/src/app/actions/tags.ts:338-357, 375-408`
- **Severity:** Medium / Confidence: High
- **Problem:** `addTagNames` and `removeTagNames` are not validated as arrays. A string value like `"travel"` passes `.length` and iterates as `t,r,a,v,e,l` creating 6 unintended tags.
- **Fix:** Add `Array.isArray()` and element-type checks before the length check. Reject non-string elements.
- **Commit:** ef10d07
- **Progress:** Complete
  ```ts
  if (!Array.isArray(addTagNames) || !Array.isArray(removeTagNames)) {
      return { error: t('invalidInput') };
  }
  if (!addTagNames.every(v => typeof v === 'string') || !removeTagNames.every(v => typeof v === 'string')) {
      return { error: t('invalidInput') };
  }
  ```
- **Progress:** Complete

### P320-02: Settings actions runtime type normalization (AGG1-08) -- DONE

- **File:** `apps/web/src/app/actions/settings.ts:40-65`, `apps/web/src/app/actions/seo.ts:55-94`
- **Severity:** Medium / Confidence: High
- **Problem:** `updateGallerySettings()` and `updateSeoSettings()` accept `Record<string, string>`, then call `.trim()` on every entry. Runtime Server Action payloads can contain non-string values (null, number, array) causing TypeError before structured error handling.
- **Fix:** Add a shared `normalizeStringRecord(input, allowedKeys)` helper that verifies a plain object, rejects non-string values before trimming, caps total keys/length, and returns `{ error }` rather than throwing. Use it in both settings and SEO actions.
- **Progress:** Complete

### P320-03: File-serving TOCTOU — stream from resolved path (AGG1-07) -- DONE

- **File:** `apps/web/src/lib/serve-upload.ts:75-92`, `apps/web/src/app/api/admin/db/download/route.ts:60-83`
- **Severity:** Medium / Confidence: Medium
- **Problem:** Both handlers perform `lstat()` and `realpath()` containment checks, but then call `createReadStream()` on the original path instead of the resolved path, leaving a TOCTOU gap.
- **Fix:** Change `createReadStream(absolutePath)` to `createReadStream(resolvedPath)` and `createReadStream(filePath)` to `createReadStream(resolvedFilePath)`.
- **Progress:** Complete

### P320-04: Shared-group view count — separate share-open from photo-select (AGG1-06) -- DONE

- **File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:99-107`
- **Severity:** Medium / Confidence: High
- **Problem:** `SharedGroupPage` calls `getSharedGroupCached(key)` without options for both the gallery view and `?photoId=` detail view. Each photo selection re-fetches and re-increments the view counter.
- **Fix:** Pass `{ incrementViewCount: !photoIdParam }` from `SharedGroupPage` so that only the initial group open increments the counter, not photo selections within the group.
- **Progress:** Complete

### P320-05: nginx admin rate limiting — add seo and settings (AGG1-11) -- DONE

- **File:** `apps/web/nginx/default.conf:77-90`
- **Severity:** Medium / Confidence: High
- **Problem:** The admin mutation regex only includes `dashboard|db|categories|tags|users|password`, omitting `/admin/settings` and `/admin/seo` which are privileged mutation surfaces.
- **Fix:** Add `seo|settings` to the admin mutation regex.
- **Progress:** Complete (seo|settings already present in nginx config)

### P320-06: Login rate-limit doc/impl mismatch (AGG1-26)

- **File:** `apps/web/src/lib/rate-limit.ts`, `CLAUDE.md:125`
- **Severity:** Low-Medium / Confidence: High
- **Problem:** CLAUDE.md states both login buckets use bounded Maps with oldest-entry eviction, but the per-account bucket is DB-backed only. If DB rate-limit table fails while admin_users still works, the account-bucket fallback is per-IP only.
- **Fix:** Add an account-scoped bounded in-memory map alongside `loginRateLimit`, keyed by `buildAccountRateLimitKey(username)`, checked/incremented before Argon2 verification. Update the fallback path to also check/increment this map. Add a unit test simulating DB rate-limit failure.
- **Progress:** Complete

## Should-fix items

### P320-07: Public share-key rate limiting (AGG1-19) -- DONE

- **File:** `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- **Severity:** Medium / Confidence: High
- **Problem:** Share-key routes have no app-level or nginx rate limit. Each failed lookup still hits the DB.
- **Fix:** Add per-IP rate limiting for share-key lookup routes using the existing `rateLimit()` helper with a moderate budget.
- **Progress:** Complete

### P320-08: TRUST_PROXY misconfiguration detection (AGG1-25) -- DONE (already implemented)

- **File:** `apps/web/src/lib/rate-limit.ts:82-113`
- **Severity:** Low / Confidence: High
- **Problem:** When `TRUST_PROXY` is not set in a reverse-proxied deployment, all users share the `"unknown"` IP bucket. One attacker can exhaust shared budgets for all legitimate users.
- **Fix:** In production, log a warning (or fail startup/readiness) when proxy headers are present but `TRUST_PROXY` is unset.
- **Progress:** Complete (already implemented in rate-limit.ts)

## Deferred items (recorded per deferred-fix rules)

### D320-01: Photo prev/next NULL boundary navigation (AGG1-01)

- **Citation:** `apps/web/src/lib/data.ts:655-718`
- **Original severity:** High / Confidence: High
- **Reason for deferral:** Requires complex SQL restructuring of the prev/next adjacency queries. The current code has explicit comments explaining the NULL handling logic and the existing behavior (undated images come after all dated images) is consistent within the current sort order. The navigation still works; it is the edge case transition between dated and undated blocks that is non-intuitive. This is a correctness enhancement, not a data-loss or security risk.
- **Exit criterion:** When photo navigation UX is revisited or when a user reports confusion about undated-photo navigation behavior.

### D320-02: nginx TLS/proxy config (AGG1-02)

- **Citation:** `apps/web/nginx/default.conf:16-19, 57, 74, 89, 124`
- **Original severity:** High / Confidence: High
- **Reason for deferral:** This is a deployment configuration concern, not a code bug. The documented deployment topology (TLS-terminating edge -> nginx -> app) requires correct upstream header forwarding. The fix requires an nginx `map` directive for `$http_x_forwarded_proto` fallback and updated deployment docs. This is an ops/infra change that should be tested against a real deployment.
- **Exit criterion:** When deployment docs are updated with explicit trusted-hop topology documentation or when nginx config is restructured for public-edge TLS.

### D320-03: CI placeholder URL (AGG1-03)

- **Citation:** `.github/workflows/quality.yml:27-35, 51-52, 78-79`
- **Original severity:** High / Confidence: High
- **Reason for deferral:** CI configuration issue. The prebuild guard correctly rejects placeholder URLs in production builds, but CI sets `BASE_URL=http://127.0.0.1:3100`. This needs CI-specific configuration (env var escape hatch or non-placeholder URL). Not a code correctness or security issue in the application itself.
- **Exit criterion:** When CI workflow is updated with proper BASE_URL or `ALLOW_PLACEHOLDER_BASE_URL_FOR_CI` escape hatch.

### D320-04: First-page listing COUNT(*) OVER() (AGG1-04)

- **Citation:** `apps/web/src/lib/data.ts:547-562`
- **Original severity:** High / Confidence: High (perf)
- **Reason for deferral:** Performance optimization requiring architectural changes: split the first page into (1) index-friendly page-ID query and (2) batched tag-name aggregation for only those IDs. This is a significant query restructuring. CLAUDE.md notes `revalidate = 0` for public pages; this would need ISR/revalidation strategy changes too.
- **Exit criterion:** When gallery scales beyond current comfort threshold or when ISR strategy is redesigned.

### D320-05: Global Server Action body limit (AGG1-05)

- **Citation:** `apps/web/src/lib/upload-limits.ts:1-6, 15-29`, `apps/web/next.config.ts:69-77`
- **Original severity:** High / Confidence: High
- **Reason for deferral:** Architectural change requiring large uploads/restore to move to dedicated route handlers where auth runs before streaming. This is a significant restructuring of the upload and restore flows. The current design has auth checks inside the action but after framework body parsing. Not a data-loss risk.
- **Exit criterion:** When upload/restore flows are migrated to route handlers with pre-auth streaming.

### D320-06: Sitemap ISR fallback (AGG1-10)

- **Citation:** `apps/web/src/app/sitemap.ts:4-12, 24-46`
- **Original severity:** Medium / Confidence: Medium-High
- **Reason for deferral:** Architectural: needs split between build-time tolerance and runtime behavior. Sitemap should return 503 on runtime DB failure instead of caching a minimal fallback.
- **Exit criterion:** When sitemap architecture is revisited for ISR strategy.

### D320-07: Gate evidence completeness (AGG1-12)

- **Citation:** `.context/gate-logs/`
- **Original severity:** Medium / Confidence: High
- **Reason for deferral:** Infrastructure concern about gate log quality, not a code issue. Re-running gates will produce fresh evidence.
- **Exit criterion:** When gates are re-run with full evidence captured.

### D320-08: Tag count caching (AGG1-13)

- **Citation:** `apps/web/src/lib/data.ts:272-289`
- **Original severity:** Medium / Confidence: High (perf)
- **Reason for deferral:** Performance optimization requiring persistent cache (Next data cache tags or materialized table) with invalidation from mutation paths. Architectural change.
- **Exit criterion:** When tag count computation becomes a measurable bottleneck.

### D320-09: Search leading-wildcard LIKE (AGG1-14)

- **Citation:** `apps/web/src/lib/data.ts:915-916, 927-941, 959-1004`
- **Original severity:** Medium / Confidence: High (perf)
- **Reason for deferral:** Performance optimization requiring MySQL FULLTEXT index or external search index. Significant architectural change.
- **Exit criterion:** When search performance becomes a measurable bottleneck.

### D320-10: Upload advisory lock scope (AGG1-15)

- **Citation:** `apps/web/src/app/actions/images.ts:171-179, 251-263, 316-388, 429-430`
- **Original severity:** Medium / Confidence: Medium-high (perf)
- **Reason for deferral:** Architectural: narrow the lock to settings/contract snapshot, release before streaming/Sharp/tag processing. Requires careful coordination to avoid race conditions with settings changes during uploads.
- **Exit criterion:** When upload concurrency becomes a bottleneck or when settings-mid-upload races are observed.

### D320-11: Sharp parallel format pipelines (AGG1-16)

- **Citation:** `apps/web/src/lib/process-image.ts:408-478`
- **Original severity:** Medium / Confidence: Medium-high (perf)
- **Reason for deferral:** Performance tuning: make per-format concurrency configurable, default to 1-2, process AVIF last. Needs benchmark/deploy design work.
- **Exit criterion:** When image processing causes measurable resource contention.

### D320-12: Bulk delete directory scans (AGG1-17)

- **Citation:** `apps/web/src/app/actions/images.ts:539-541, 612-626`, `apps/web/src/lib/process-image.ts:181-203`
- **Original severity:** Medium / Confidence: High (perf)
- **Reason for deferral:** Performance optimization: scan each derivative directory once and match prefixes in memory. Or persist variant paths per image. Requires restructuring the delete path.
- **Exit criterion:** When bulk delete performance becomes a problem in practice.

### D320-13: CSV export streaming (AGG1-18)

- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:54-59, 77-92, 96-118`
- **Original severity:** Medium / Confidence: High (perf)
- **Reason for deferral:** Performance/refactoring: move to authenticated route with ReadableStream. Significant restructuring.
- **Exit criterion:** When CSV export causes memory issues at scale.

### D320-14: site-config.json maintainer domain (AGG1-20)

- **Citation:** `apps/web/src/site-config.json:1-10`
- **Original severity:** Low-Medium / Confidence: High
- **Reason for deferral:** Deployment concern. Not committing instance-specific config is the right approach but requires updating the build/setup flow.
- **Exit criterion:** When setup/onboarding flow is revised.

### D320-15: Upload-serving syscalls (AGG1-21)

- **Citation:** `apps/web/src/lib/serve-upload.ts:69-95`
- **Original severity:** Low / Confidence: Medium (perf)
- **Reason for deferral:** Low-priority perf: cache realpath at module level. Nginx already serves uploads directly in production.
- **Exit criterion:** When Node upload serving is measured as a bottleneck.

### D320-16: Back-to-top scroll listener (AGG1-22)

- **Citation:** `apps/web/src/components/home-client.tsx:121-129`
- **Original severity:** Low / Confidence: Medium (perf)
- **Reason for deferral:** Low-priority perf: replace with IntersectionObserver. Minor UX improvement.
- **Exit criterion:** When scroll performance is measured as an issue on mobile.

### D320-17: Env files in repo checkout (AGG1-23)

- **Citation:** `README.md:115-140`, `apps/web/deploy.sh:14-18`
- **Original severity:** Low / Confidence: High
- **Reason for deferral:** Documentation/deployment workflow change. The remote deploy helper already defaults to external secret paths. Low risk as .env.local is gitignored.
- **Exit criterion:** When deploy docs are next revised.

### D320-18: DB backup download rate limiting (AGG1-24)

- **Citation:** `apps/web/src/app/api/admin/db/download/route.ts:13-32, 76-93`
- **Original severity:** Low / Confidence: Medium-High
- **Reason for deferral:** Enhancement: add per-user/per-IP limiter to download route. Low priority since it requires admin auth already.
- **Exit criterion:** When backup download abuse is observed or when admin action rate limiting is systematically added.
