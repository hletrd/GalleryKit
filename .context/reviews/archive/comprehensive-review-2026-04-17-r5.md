# Comprehensive Code Review — GalleryKit R5

**Date:** 2026-04-17
**Reviewers:** 3 parallel agents (Security & Correctness, UI/UX & Components, Architecture & Config)
**Scope:** Full repository — 107 source files across all domains
**Previous reviews:** R1-R4 (2026-04-11 through 2026-04-17)
**Context:** Follow-up review after ~30 commits implementing prior review fixes. Focus on NEW issues, regressions, and previously missed findings.

---

## Summary

GalleryKit has improved substantially since the R4 reviews. Most previously identified security, correctness, and UX issues have been fixed. This review identifies **38 new or newly-confirmed issues** (1 CRITICAL, 7 HIGH, 15 MEDIUM, 15 LOW) across three domains. The single CRITICAL finding is a bypass in the SQL restore validation that allows arbitrary command execution via MySQL conditional comments.

**Overall assessment:** Strong security posture with one critical gap. Code quality is above average. UX/i18n has residual gaps.

---

## CRITICAL FINDINGS

### CR-01: SQL restore validation bypass via conditional comments without space separator

**Confidence: HIGH**
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:226,237-239`

The dangerous SQL pattern scan has two layers of defense, but both can be simultaneously bypassed by placing `PREPARE`/`EXECUTE`/`DELIMITER` inside a MySQL conditional comment without a space after the version number.

**Why it is a problem:**

1. The conditional-comment regex (line 226) only checks for a subset of keywords after `\d*\s*`:
   ```ts
   /\/\*!\d*\s*(GRANT|CREATE\s+USER|ALTER\s+USER|SET\s+PASSWORD|DROP\s+DATABASE|LOAD\s+DATA|SHUTDOWN)/i
   ```
   `PREPARE`, `EXECUTE`, and `DELIMITER` are NOT in this list.

2. The standalone keyword regexes (lines 237-239) use word boundaries:
   ```ts
   /\bPREPARE\b/i
   /\bEXECUTE\b/i
   /\bDELIMITER\b/i
   ```
   In `/*!50000PREPARE`, the digits `50000` are word characters adjacent to `P`, so there is NO `\b` word boundary before `PREPARE`. The regex does not match.

**Failure scenario:** An admin uploads a crafted SQL file containing:
```sql
/*!50000PREPARE stmt FROM 'GRANT ALL ON *.* TO hacker@localhost'*/;
/*!50000EXECUTE stmt*/;
```
Both lines pass the scan. On restore, MySQL executes the GRANT if version >= 5.0.0, giving the attacker full DB access.

**Fix:** Strip conditional comments before pattern matching:
```ts
const strippedChunk = chunk.replace(/\/\*!\d*.*?\*\//gs, ' ');
for (const pattern of dangerousPatterns) {
    if (pattern.test(strippedChunk)) { /* reject */ }
}
```
Also add `PREPARE`, `EXECUTE`, `DELIMITER` to the conditional-comment keyword list as defense-in-depth.

---

## HIGH FINDINGS

### H-01: Queue retry `enqueued` set bug — finally block undoes retry re-enrollment

**Confidence: HIGH**
**File:** `apps/web/src/lib/image-queue.ts:169-184`

When a job fails and is retried, the retry path correctly deletes the job ID from `state.enqueued` and re-adds it via `enqueueImageProcessing(job)`. However, the `finally` block at line 183 unconditionally deletes the job ID from `state.enqueued`, undoing the re-enrollment.

```ts
// Lines 169-176 (retry path inside catch):
state.enqueued.delete(job.id);       // Step 1: Remove from set
enqueueImageProcessing(job);          // Step 2: Re-adds to set AND queue
return;                               // Step 3: Return from callback

// Lines 179-184 (finally block -- ALWAYS runs):
state.enqueued.delete(job.id);        // Step 4: Removes AGAIN
```

After step 2, the job ID is back in `state.enqueued`. After step 4 (finally), it is gone. The job is in the PQueue but not tracked in the enqueued set, allowing duplicate enqueue entries.

**Fix:** Use a flag to skip the finally-block deletion when retried:
```ts
let retried = false;
// In catch block:
if (retries < MAX_RETRIES) {
    state.retryCounts.set(job.id, retries);
    state.enqueued.delete(job.id);
    enqueueImageProcessing(job);
    retried = true;
    return;
}
// In finally block:
if (!retried) {
    state.enqueued.delete(job.id);
}
```

---

### H-02: Hardcoded English strings in image-manager.tsx — i18n violation

**Confidence: HIGH**
**File:** `apps/web/src/components/image-manager.tsx:124,127,145,148,190,193`

Five `toast.error()` calls use hardcoded English fallback strings instead of translation keys:
```ts
toast.error(res?.error || 'Failed to delete images');   // line 124
toast.error('Bulk delete failed');                       // line 127
toast.error(result.error || 'Failed to share group');   // line 145
toast.error('Error sharing group');                      // line 148
toast.error(res.error || "Failed to update");            // line 190
toast.error("Failed to update");                         // line 193
```

Korean admin users see raw English error messages.

**Fix:** Add translation keys to `en.json`/`ko.json` and replace all hardcoded strings with `t()` calls. Use the server action error when available, with translated fallback: `toast.error(res.error || t('imageManager.deleteFailed'))`.

---

### H-03: Hardcoded "Image unavailable" string in optimistic-image.tsx — not i18n'd

**Confidence: HIGH**
**File:** `apps/web/src/components/optimistic-image.tsx:64`

The error state renders a hardcoded English string `"Image unavailable"` that is never translated. The key `common.imageUnavailable` exists in both `en.json` and `ko.json` but is not used here.

**Fix:** Import `useTranslation` and use `t('common.imageUnavailable')`, or pass the translated string as a prop from the parent.

---

### H-04: Shared photo/group pages use hardcoded Unicode arrow instead of i18n key

**Confidence: HIGH**
**Files:** `apps/web/src/app/[locale]/s/[key]/page.tsx:67`, `apps/web/src/app/[locale]/g/[key]/page.tsx:91,109`

The "back to gallery" link uses a raw Unicode left arrow `← ` with site name. Korean users see a bare arrow with no contextual word. The `shared.viewGallery` key exists in both locale files but is unused on these pages.

**Fix:** Replace with the existing translation key and use the Lucide `ArrowLeft` icon:
```tsx
<ArrowLeft className="h-4 w-4" /> {t('shared.viewGallery')}
```

---

### H-05: CSP missing `object-src 'none'` directive

**Confidence: HIGH**
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` → `apps/web/next.config.ts:68-79`

The Content-Security-Policy header does not include an `object-src` directive. Without it, browsers default to `object-src *`, permitting Flash/Java plugin content from any origin. This is a standard OWASP/Mozilla recommendation.

**Fix:** Add `"object-src 'none'"` to the CSP value array.

---

### H-06: Production Docker image contains unnecessary build tools (~100MB+ bloat)

**Confidence: HIGH**
**File:** `apps/web/Dockerfile:1-10`

`python3`, `make`, and `g++` are installed in the `base` stage and inherited by the `runner` stage. These are only needed for compiling native modules during `npm ci`. The final runner image has compilers available, increasing attack surface and image size.

**Fix:** Split the base image into `base-runtime` (gosu + mariadb-client only) and `base-build` (python3 + make + g++). Use `base-build` for deps/builder stages and `base-runtime` for the runner stage.

---

### H-07: `migrate-aliases.ts` catches errors but exits with success code

**Confidence: HIGH**
**File:** `apps/web/scripts/migrate-aliases.ts:24-29`

The `catch` block logs the error but execution falls through to `process.exit(0)`. A failed migration reports success. In CI/CD or Docker entrypoint pipelines, this silently proceeds despite a broken schema.

**Fix:** Add `process.exit(1)` in the `catch` block and move `process.exit(0)` into the `try` block.

---

## MEDIUM FINDINGS

### M-01: InfoBottomSheet `onClose` called inside `setSheetState` updater — side effect in setState

**Confidence: HIGH**
**File:** `apps/web/src/components/info-bottom-sheet.tsx:62-78`

Inside `handleTouchEnd`, the `onClose()` function is called from within the `setSheetState` updater callback. React's documentation warns that updater functions should be pure and not have side effects. Calling `onClose()` (which triggers `setShowBottomSheet(false)` in the parent) inside a state updater can cause unexpected batching behavior.

**Fix:** Move `onClose()` outside the updater. Compute the new state first, then call `onClose()` conditionally after.

---

### M-02: PhotoViewer `navigate` callback has stale `showLightbox` closure

**Confidence: MEDIUM**
**File:** `apps/web/src/components/photo-viewer.tsx:55-72`

The `navigate` callback depends on `showLightbox` to decide whether to set `gallery_auto_lightbox` in sessionStorage. The dependency array includes many values; any changing can produce a version with a stale `showLightbox` snapshot.

**Fix:** Use a ref to track `showLightbox` for the sessionStorage decision:
```ts
const showLightboxRef = useRef(showLightbox);
useEffect(() => { showLightboxRef.current = showLightbox; }, [showLightbox]);
```

---

### M-03: Lightbox backdrop click only re-shows controls instead of closing

**Confidence: MEDIUM**
**File:** `apps/web/src/components/lightbox.tsx:213-284`

When controls are hidden, clicking the backdrop calls `handleBackdropClick` which only calls `showControls()`, not `onClose()`. On touch devices, the user must tap twice: once to show controls, once to click close. The standard UX pattern for lightboxes is close-on-backdrop-tap.

**Fix:** Change `handleBackdropClick` to close the lightbox, or at minimum add close-on-backdrop-tap behavior for touch events.

---

### M-04: PhotoViewer `currentImageId` not reset when `initialImageId` changes

**Confidence: MEDIUM**
**File:** `apps/web/src/components/photo-viewer.tsx:39`

`currentImageId` is initialized from `initialImageId` via `useState(initialImageId)`. If the parent re-renders with a different `images` array, the `currentImageId` state retains the old value, yielding `currentIndex === -1` and rendering the "No photos" fallback.

**Fix:** Add a `useEffect` to sync `currentImageId` when `initialImageId` changes.

---

### M-05: Duplicated shutter speed formatting logic in two components

**Confidence: HIGH**
**Files:** `apps/web/src/components/photo-viewer.tsx:333-344`, `apps/web/src/components/info-bottom-sheet.tsx:109-120`

The shutter speed formatting logic (converting decimal exposure time to `1/Ns` notation) is duplicated nearly verbatim in both files. If a bug is found in one, it must be fixed in both.

**Fix:** Extract into a shared utility function in `lib/image-types.ts`.

---

### M-06: Lightbox `f` key handler conflicts with text input — no input guard

**Confidence: MEDIUM**
**File:** `apps/web/src/components/lightbox.tsx:107-129`

The `keydown` listener fires on `f`/`F` to toggle fullscreen without checking whether the user is typing in an input field. The pattern `if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;` is already used in `search.tsx:62`.

**Fix:** Add the same input guard used in `search.tsx`.

---

### M-07: `isValidTopicAlias` has no length limit — potential DB truncation collision

**Confidence: HIGH**
**File:** `apps/web/src/lib/validation.ts:44-46`

The regex validates character set only. The `topic_aliases.alias` column is `varchar(255)`. A 300+ character alias would pass validation but be truncated by MySQL in non-strict mode, potentially creating a collision with an existing alias.

**Fix:** Add a length check:
```ts
export function isValidTopicAlias(alias: string): boolean {
    return alias.length > 0 && alias.length <= 255 && /^[^/\\\s?#]+$/.test(alias);
}
```

---

### M-08: `searchImages` does not cap `limit` parameter

**Confidence: HIGH**
**File:** `apps/web/src/lib/data.ts:454`

`searchImages(query, limit = 20)` passes `limit` directly to the SQL query without capping. Unlike `getImagesLite` and `getImages` which cap to 500 (`Math.min(limit, 500)`), searchImages allows unbounded results.

**Fix:** Add a cap consistent with other query functions: `Math.min(Math.max(limit, 1), 500)`.

---

### M-09: `searchRateLimit` Map grows unbounded beyond declared cap

**Confidence: MEDIUM**
**File:** `apps/web/src/app/actions/public.ts:33-37`

The map has a declared max of `SEARCH_RATE_LIMIT_MAX_KEYS = 2000`, but there is no hard eviction cap. Pruning only occurs when `size > 50` and only removes expired entries. If all entries are within their 1-minute window, no entries are pruned.

**Fix:** Add hard-cap eviction matching the login rate limit pattern.

---

### M-10: CLAUDE.md documents inaccurate connection pool size and upload limits

**Confidence: HIGH**
**File:** `CLAUDE.md`

Three documentation-vs-code mismatches:
1. "8 connections" but code has `connectionLimit: 10`
2. "10GB total per batch" but code has `2GB`
3. "100 files max" but no `MAX_FILES` constant exists

**Fix:** Update CLAUDE.md to match actual values.

---

### M-11: `migrate-sharing.ts` imports from `bun:sqlite` — incompatible with Node.js

**Confidence: HIGH**
**File:** `apps/web/scripts/migrate-sharing.ts:2`

`import { Database } from 'bun:sqlite'` only works with the Bun runtime. The project uses Node.js.

**Fix:** Delete `migrate-sharing.ts`. The `.js` version is also SQLite-only and obsolete. Both are dead code.

---

### M-12: Five legacy SQLite migration scripts are dead code

**Confidence: HIGH**
**Files:** `scripts/migrate-exif.js`, `scripts/migrate-topic-image.ts`, `scripts/migrate-sharing.js`, `scripts/migrate-sharing.ts`, `scripts/migrate-data.ts`

These scripts reference `better-sqlite3` or `bun:sqlite` and read from `sqlite.db`, which does not exist in the current MySQL architecture. None are referenced from Docker entrypoint or `package.json` scripts.

**Fix:** Delete all five SQLite scripts. Remove `better-sqlite3` and `@types/better-sqlite3` from devDependencies.

---

### M-13: `sitemap.ts` uses `force-dynamic` — defeats ISR for expensive query

**Confidence: MEDIUM**
**File:** `apps/web/src/app/sitemap.ts:5`

`force-dynamic` causes the sitemap to be regenerated from the database on every request. For a gallery with 24,000+ images, this triggers `getImageIdsForSitemap()` on every sitemap access.

**Fix:** Use ISR instead: `export const revalidate = 86400;` (daily). Search engines don't need real-time sitemaps.

---

### M-14: CSP missing `manifest-src 'self'` directive

**Confidence: MEDIUM**
**File:** `apps/web/next.config.ts:68-79`

The app generates a web app manifest via `manifest.ts`, but the CSP does not include `manifest-src`. Without it, browsers default to `manifest-src *`, allowing manifests from any origin.

**Fix:** Add `"manifest-src 'self'"` to the CSP value array.

---

### M-15: `EXECUTE` word-boundary pattern causes false positives on legitimate SQL dumps

**Confidence: MEDIUM**
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:238`

The word "EXECUTE" can appear in legitimate mysqldump output (e.g., in user-generated content). This can block legitimate database restores, forcing admins to work around the safety check.

**Fix:** Only scan SQL statements (not data values), or remove the standalone `EXECUTE` pattern since `PREPARE` is sufficient to flag. Alternatively, combine: `/\bPREPARE\b.*?\bEXECUTE\b/is` to reduce false positives.

---

## LOW FINDINGS

### L-01: `load-more.tsx` logs error to console instead of surfacing to user
**File:** `apps/web/src/components/load-more.tsx:39`
When loading more images fails, the user sees no feedback. Add a toast notification.

### L-02: `nav-client.tsx` theme toggle and locale switcher lack visible focus indicator
**File:** `apps/web/src/components/nav-client.tsx:133-146`
No `focus-visible:ring` on these raw elements. Add focus-visible ring classes.

### L-03: `info-bottom-sheet.tsx` drag handle not focusable/keyboard-accessible
**File:** `apps/web/src/components/info-bottom-sheet.tsx:152`
No `tabIndex`, `role`, or keyboard event handler. Keyboard users cannot transition between states.

### L-04: `search.tsx` active result has no visible focus ring for keyboard navigation
**File:** `apps/web/src/components/search.tsx:157`
Active item highlighted only via `bg-muted` background color. Add `ring-2 ring-ring` for keyboard focus.

### L-05: `deleteGroupShareLink` returns success for non-existent groups
**File:** `apps/web/src/app/actions/sharing.ts:126-137`
Delete always returns `{ success: true }` regardless of `affectedRows`. Check and return error if 0 rows affected.

### L-06: `updateImageMetadata` returns success even when image does not exist
**File:** `apps/web/src/app/actions/images.ts:415-429`
UPDATE affects 0 rows when image ID doesn't exist but still returns `{ success: true }`. Check `affectedRows`.

### L-07: `seed-admin.ts` logs partial Argon2 hash to console
**File:** `apps/web/scripts/seed-admin.ts:34`
Logs first 10 chars of the password hash. Remove the hash value from the log.

### L-08: `tsconfig.json` excludes `scripts/` from type checking
**File:** `apps/web/tsconfig.json:39-42`
Active scripts like `seed-admin.ts` and `init-db.ts` are never type-checked. Create a separate `tsconfig.scripts.json`.

### L-09: `site-config.json` baked into Docker image at build time
**File:** `apps/web/Dockerfile:35`
Updating site-config requires a full image rebuild. Mount as a volume in docker-compose.yml.

### L-10: OG image route has no rate limiting
**File:** `apps/web/src/app/api/og/route.tsx:6`
Each request triggers image generation. Varying the topic parameter bypasses the 1-hour cache.

### L-11: `seed-e2e.ts` performs destructive cleanup without environment guard
**File:** `apps/web/scripts/seed-e2e.ts:114-130`
No `NODE_ENV` check to prevent accidental execution against production database.

### L-12: `prebuild` script uses non-POSIX `cp -n` flag
**File:** `apps/web/package.json:10`
`cp -n` is not POSIX-standard. Use: `test -f src/site-config.json || cp src/site-config.example.json src/site-config.json`

### L-13: `search.tsx` `resultRefs` ref array grows unbounded and never pruned
**File:** `apps/web/src/components/search.tsx:23,154`
When results list shrinks, old entries remain in the ref array. Trim with `useEffect`.

### L-14: Docker Compose uses `network_mode: host` — disables container network isolation
**File:** `apps/web/docker-compose.yml:12`
Gives container full access to host's network stack. Use bridge networking with `host.docker.internal`.

### L-15: `admin/(protected)/loading.tsx` missing `role="status"` and `aria-label`
**File:** `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`
Screen readers see nothing during admin page transitions. Public loading.tsx already has these attributes.

---

## CROSS-CUTTING ANALYSIS

### SQL Restore Validation — Defense-in-Depth Assessment

The CR-01 finding reveals that the conditional-comment bypass is the last remaining gap in an otherwise thorough validation system. The fix (stripping comments before scanning) is a structural improvement that makes the scanner resilient to future keyword additions, rather than playing whack-a-mole with individual patterns.

### Queue Retry Logic — Systemic Issue

The H-01 finding (finally block undoing retry re-enrollment) is a classic try/catch/finally interaction bug. The `retried` flag pattern is the standard fix. This interacts with the retry counter memory leak documented in Plan 15 #1 — both should be fixed together.

### i18n Completeness — Remaining Gaps

The three HIGH i18n findings (H-02, H-03, H-04) are all user-visible text that appears in English regardless of locale. They represent the tail end of a long i18n effort that has addressed 50+ hardcoded strings across prior rounds. The remaining instances are in error toast fallbacks, an image error state, and navigation links on shared pages.

### CSP Hardening — Incremental Progress

The CSP is already comprehensive for a Next.js app (10 directives). The two missing additions (`object-src 'none'` and `manifest-src 'self'`) are both one-line fixes that follow OWASP/Mozilla recommendations. Combined with the `strict-dynamic` addition planned in Plan 14 #4, these would bring the CSP to a very strong level.

### Dead Code — SQLite Migration Scripts

Five migration scripts and their `better-sqlite3` dependency are artifacts from a pre-MySQL era. They add confusion for new contributors and a native dependency that can fail to compile. Removing them is a clean code hygiene win.

---

## FILES EXAMINED

### Server-side logic (fully reviewed):
- `src/app/actions/` — auth.ts, images.ts, topics.ts, tags.ts, sharing.ts, admin-users.ts, public.ts
- `src/lib/` — session.ts, data.ts, process-image.ts, process-topic-image.ts, image-queue.ts, rate-limit.ts, validation.ts, serve-upload.ts, db/index.ts, audit.ts, revalidation.ts, image-url.ts, safe-json-ld.ts, base56.ts, clipboard.ts, action-result.ts, upload-limits.ts, constants.ts, utils.ts, locale-path.ts, queue-shutdown.ts, image-types.ts
- `src/db/` — schema.ts, seed.ts
- `src/proxy.ts`, `src/instrumentation.ts`
- `src/app/[locale]/admin/db-actions.ts`
- `src/app/api/` — admin/db/download/route.ts, health/route.ts, og/route.tsx
- `src/app/uploads/[...path]/route.ts`

### Client components (fully reviewed):
- `src/components/` — photo-viewer.tsx, lightbox.tsx, home-client.tsx, image-zoom.tsx, info-bottom-sheet.tsx, search.tsx, image-manager.tsx, upload-dropzone.tsx, optimistic-image.tsx, load-more.tsx, photo-navigation.tsx, histogram.tsx, nav-client.tsx, nav.tsx, admin-header.tsx, admin-nav.tsx, admin-user-manager.tsx, tag-filter.tsx, tag-input.tsx, footer.tsx, topic-empty-state.tsx, theme-provider.tsx, i18n-provider.tsx

### Pages & layouts (fully reviewed):
- `src/app/[locale]/` — layout.tsx, page.tsx, loading.tsx, error.tsx, not-found.tsx
- `src/app/[locale]/p/[id]/page.tsx`, `[topic]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`
- `src/app/[locale]/admin/` — page.tsx, login-form.tsx, db-actions.ts
- `src/app/[locale]/admin/(protected)/` — layout.tsx, loading.tsx, error.tsx, dashboard/, categories/, tags/, users/, password/, db/

### Configuration & deployment (fully reviewed):
- `next.config.ts`, `Dockerfile`, `docker-compose.yml`, `package.json`, `tsconfig.json`
- `src/app/robots.ts`, `src/app/sitemap.ts`, `src/app/manifest.ts`, `src/app/icon.tsx`, `src/app/apple-icon.tsx`
- `scripts/` — all files
- `messages/` — en.json, ko.json

---

## PRIORITY MATRIX

| ID | Severity | Category | Effort | Description |
|----|----------|----------|--------|-------------|
| CR-01 | Critical | Security | Medium | SQL restore bypass via conditional comments |
| H-01 | High | Correctness | Low | Queue retry finally block bug |
| H-02 | High | i18n | Low | Hardcoded English in image-manager toast errors |
| H-03 | High | i18n | Low | Hardcoded "Image unavailable" not i18n'd |
| H-04 | High | i18n | Low | Shared pages Unicode arrow not translated |
| H-05 | High | Security | Low | CSP missing `object-src 'none'` |
| H-06 | High | Security | Medium | Docker image contains build tools |
| H-07 | High | Correctness | Low | migrate-aliases.ts exits 0 on error |
| M-01 | Medium | React | Low | Side effect in setSheetState updater |
| M-02 | Medium | React | Low | Stale showLightbox closure in navigate |
| M-03 | Medium | UX | Low | Lightbox backdrop click should close |
| M-04 | Medium | React | Low | currentImageId not synced with initialImageId |
| M-05 | Medium | Code Quality | Low | Duplicated shutter speed formatting |
| M-06 | Medium | UX | Low | Lightbox `f` key no input guard |
| M-07 | Medium | Security | Low | isValidTopicAlias no length limit |
| M-08 | Medium | Security | Low | searchImages no limit cap |
| M-09 | Medium | Security | Low | searchRateLimit no hard eviction cap |
| M-10 | Medium | Docs | Low | CLAUDE.md inaccurate values |
| M-11 | Medium | Code Quality | Low | Bun-specific import in migration script |
| M-12 | Medium | Code Quality | Medium | 5 dead SQLite migration scripts |
| M-13 | Medium | Performance | Low | Sitemap force-dynamic vs ISR |
| M-14 | Medium | Security | Low | CSP missing manifest-src |
| M-15 | Medium | UX | Medium | EXECUTE false positives in SQL scan |
| L-01–L-15 | Low | Various | Low | See individual findings above |

---

## RECOMMENDED FIX ORDER

1. **CR-01** — SQL restore bypass: strip conditional comments before scanning
2. **H-01** — Queue retry finally block: add `retried` flag
3. **H-05** + **M-14** — CSP: add `object-src 'none'` and `manifest-src 'self'`
4. **H-02, H-03, H-04** — i18n: translate all remaining hardcoded English
5. **H-07** — migrate-aliases.ts: exit 1 on error
6. **M-07, M-08, M-09** — Validation: add length/cap limits
7. **M-05** — Extract shared shutter speed utility
8. **M-01, M-02, M-04** — React fixes: setState side effects, stale closures, state sync
9. **M-11, M-12** — Dead code: remove SQLite scripts
10. All LOW items
