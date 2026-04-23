# Code Reviewer — Cycle 1 (New)

**Date:** 2026-04-22
**Reviewer:** code-reviewer (direct)
**Scope:** Full repo deep review, focusing on fresh findings beyond 46 prior cycles

## Files Reviewed

All source files under `apps/web/src/` including: actions (auth, images, public, sharing, tags, topics, admin-users, settings, seo), lib (data, process-image, session, validation, tag-records, tag-slugs, rate-limit, auth-rate-limit, request-origin, exif-datetime, image-queue, restore-maintenance, serve-upload, upload-paths, sanitize, sql-restore-scan, db-restore, safe-json-ld, gallery-config, gallery-config-shared, audit, api-auth, clipboard, revalidation, image-url, error-shell, backup-filename, queue-shutdown, upload-limits, upload-tracker, process-topic-image, base56, action-result, constants, locale-path, utils), db (schema, index, seed), components (lightbox, image-zoom, home-client, admin-user-manager, upload-dropzone, photo-viewer, search, tag-filter, tag-input, nav, footer, histogram, load-more, optimistic-image, lazy-focus-trap), proxy.ts, Dockerfile, API routes (health, live, og, db/download), and e2e tests.

## Findings

### C1-01: `searchImages` in data.ts uses LIKE on `images.topic` which stores slugs but `topics.label` may differ — alias search missing from main query
**Severity:** MEDIUM | **Confidence:** Medium
**File:** `apps/web/src/lib/data.ts` lines 685-698
**Description:** The main search query uses `like(images.topic, searchTerm)` but `images.topic` stores slug values (e.g., `landscape-photography`), while users likely search by display label (e.g., "Landscape Photography"). A separate alias search is performed only as a third fallback query, but the main query will miss label matches entirely. If a user searches for the display label of a topic, the main query returns nothing and only the third alias query (which searches `topicAliases.alias`) might match — but only if an alias happens to match the label.
**Failure scenario:** User searches "Landscape Photography" but the topic slug is "landscape-photography" — main query misses, alias query misses (no alias with that name), result is empty despite the topic existing.
**Fix:** Add `like(topics.label, searchTerm)` to the main query's OR conditions (it is already there — confirmed on review). Withdrawing this finding upon closer inspection.

### C1-02: `viewCountBuffer` in data.ts is a process-local Map — concurrent Next.js server processes cannot share buffered increments
**Severity:** MEDIUM | **Confidence:** High
**File:** `apps/web/src/lib/data.ts` lines 12-96
**Description:** The shared group view count buffer uses a module-level `Map` that only lives in the current process. In a multi-process deployment (e.g., multiple Next.js standalone instances behind a load balancer), each process maintains its own independent buffer. View count increments are lost when a process restarts before flushing, and counts are under-reported because each process only sees a fraction of the total traffic.
**Failure scenario:** Two server instances each buffer 50 views for the same group. Each flushes independently — total 100 views recorded. But if instance A restarts before flushing, its 50 buffered views are lost permanently.
**Fix:** This is a known architectural limitation already deferred as D12-03. Noting for completeness but not re-raising as a new finding.

### C1-03: `parseExifDateTime` returns ISO-format string from `Date` objects but `isValidExifDateTimeParts` is not called for that branch
**Severity:** LOW | **Confidence:** High
**File:** `apps/web/src/lib/process-image.ts` lines 136-144
**Description:** When EXIF datetime is a `Date` object or numeric timestamp, `parseExifDateTime` converts it to an ISO-like string without validating the calendar date through `isValidExifDateTimeParts`. The EXIF string path (line 129) validates properly, but the Date/number paths skip validation. This means an impossible Date (e.g., `new Date(9999, 12, 32)` which JavaScript normalizes) could pass through.
**Failure scenario:** A corrupted EXIF datetime stored as a numeric timestamp representing an impossible date would be stored without validation, potentially showing "January 1, 10000" or similar in the gallery.
**Fix:** Add `isValidExifDateTimeParts` validation for the Date/number branches as well, extracting year/month/day/hour/minute/second from the resulting Date object.

### C1-04: `seo_og_image_url` is stored and served without origin validation — open redirect in OG meta tags
**Severity:** MEDIUM | **Confidence:** High
**File:** `apps/web/src/app/actions/seo.ts` lines 94-103, and consuming pages
**Description:** The SEO OG image URL is validated only for `http:` or `https:` protocol but not for same-origin. An admin can set `seo_og_image_url` to any external URL (e.g., `https://evil.com/tracker.gif`). While this is an admin-only setting, it means the OG meta tags in the public HTML could reference an external resource that tracks visitors or serves malicious content in social media previews.
**Failure scenario:** An admin (or compromised admin session) sets the OG image URL to an external tracker. Every page load includes a `<meta property="og:image" content="https://evil.com/track">` tag, leaking visitor IPs to the external server when social media crawlers fetch the preview.
**Fix:** Validate that `seo_og_image_url` is either same-origin (matches `BASE_URL` or `site-config.json` URL) or is a relative path. Alternatively, document that admins should only use trusted URLs.

### C1-05: `deleteTopicAlias` uses permissive validation for deletion but `createTopicAlias` uses strict `isValidTopicAlias` — asymmetric validation allows creating aliases that cannot be deleted through normal means
**Severity:** LOW | **Confidence:** Medium
**File:** `apps/web/src/app/actions/topics.ts` lines 364-413
**Description:** `deleteTopicAlias` uses a permissive check (`/[/\\\x00]/`) while `createTopicAlias` enforces `isValidTopicAlias` which rejects dots and other characters. This means legacy aliases with dots (created before the stricter validation was added) can be deleted, which is the stated intent. However, the asymmetry means if a bug or direct DB insertion creates an alias with other disallowed characters that pass the delete check but not the create check, it could only be deleted through direct DB access.
**Failure scenario:** Low risk — this is actually by design to handle legacy aliases. The permissive delete path is intentionally more lenient.
**Fix:** No immediate fix needed — the asymmetry is intentional and documented. Adding a comment explaining the design decision would improve maintainability.

### C1-06: `exportImagesCsv` uses `GROUP_CONCAT` with a 50000-row limit but no `group_concat_max_len` handling
**Severity:** LOW | **Confidence:** Medium
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 41-99
**Description:** MySQL's default `group_concat_max_len` is 1024 bytes. For images with many tags, the `GROUP_CONCAT` result could be silently truncated. The CSV export would then show incomplete tag lists without any warning.
**Failure scenario:** An image with 20+ long tag names would have its tag list truncated in the CSV export, showing only the first few tags. The admin would not be notified of the truncation.
**Fix:** Either set `group_concat_max_len` in the session before the query, or switch to a subquery approach similar to `getImagesLite`.

### C1-07: Rate-limit rollback on unexpected login error may over-credit the counter
**Severity:** LOW | **Confidence:** Medium
**File:** `apps/web/src/app/actions/auth.ts` lines 226-238
**Description:** When login throws an unexpected error (not a wrong-password error), the code rolls back both the IP-scoped and account-scoped rate limits. However, the pre-increment already happened, and the rollback calls `clearSuccessfulLoginAttempts` which completely deletes the rate limit entry rather than decrementing. If 3 concurrent requests all pre-increment and all hit the same unexpected error, the first rollback clears the entry, the second and third rollbacks are no-ops, and the counter is under-counted by 2.
**Failure scenario:** Three concurrent login requests from the same IP all hit a transient DB error. All three pre-increment the rate limit. The first rollback clears the entry entirely. The next two rollbacks find no entry. Net effect: 3 attempts cost 0 toward the rate limit, allowing unlimited retries via transient-error-triggered rollbacks.
**Fix:** Instead of deleting the entry on rollback, decrement the counter by 1. This preserves accurate accounting even with concurrent rollbacks.

## No-issue confirmations

- Privacy guard (`_SensitiveKeysInPublic`) correctly prevents PII leakage at compile time
- `publicSelectFields` properly omits latitude, longitude, filename_original, user_filename, processed
- `dangerouslySetInnerHTML` uses `safeJsonLd` which escapes `<` to prevent XSS
- Session token verification uses `timingSafeEqual` for constant-time comparison
- Argon2id is used with dummy hash for timing-safe user enumeration prevention
- SQL restore scanner covers dangerous SQL patterns comprehensively
- File serving route validates path traversal, symlinks, and extension mismatches
- Upload paths are UUID-based (no user-controlled filenames on disk)
