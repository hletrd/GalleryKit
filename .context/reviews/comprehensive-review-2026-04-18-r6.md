# Comprehensive Code Review — R6 (2026-04-18)

**Scope:** Full repository review after R5 implementation
**Reviewers:** 4 parallel agents (Security, Correctness, UX/A11y, Performance)
**Files Examined:** 35+

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH | 9 |
| MEDIUM | 18 |
| LOW | 11 |
| **Total** | **40** |

---

## CRITICAL

### C-01: SQL restore scanner bypassed via regular multi-line comments
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:260`
**Confidence:** HIGH

The scanner strips conditional comments (`/*!...*/`) but not regular multi-line comments (`/* ... */`). MySQL strips both before parsing. An attacker splits any blocked keyword with an inline comment:

```sql
GR/**/ANT ALL ON *.* TO 'attacker'@'%';
```

The scanner sees `GR` and `ANT` as separate tokens — neither matches `\bGRANT\b`. MySQL strips `/**/` and executes `GRANT ALL`. Same technique works for every blocked keyword: `PRE/**/PARE`, `CREATE/**/ USER`, `DROP/**/ DATABASE`, etc.

**Fix:** Replace the conditional-comment-only regex with one that strips all multi-line comments:
```ts
const strippedChunk = chunk.replace(/\/\*.*?\*\//gs, ' ');
```

### C-02: `blur_data_url` stored as TEXT — bloats InnoDB buffer pool and SSR payload
**File:** `apps/web/src/db/schema.ts:51`, `apps/web/src/lib/data.ts:39`
**Confidence:** HIGH

The `blur_data_url` column stores ~500-800 byte base64 strings per row. With 10,000 images, this adds 150-250MB of blob data to the InnoDB buffer pool, pushing actual query data out of memory. On the listing queries, `blur_data_url` is selected for every image in the grid, adding ~20KB of base64 to the SSR HTML per page.

**Fix:** Move to a compact `blurhash` encoding (~30 bytes per image), or exclude from listing `selectFields` and only include in a lightweight query.

---

## HIGH

### H-01: `useSearchParams()` breaks ISR caching for all public pages
**Files:** `apps/web/src/components/nav-client.tsx:24`, `apps/web/src/components/tag-filter.tsx:13`
**Confidence:** HIGH

`NavClient` and `TagFilter` call `useSearchParams()` without a `<Suspense>` boundary. This forces the entire page into client-side rendering, completely negating `revalidate = 3600` on homepage and topic pages. Every page hit is a full SSR request instead of serving cached HTML.

**Fix:** Wrap both components in `<Suspense>` boundaries so `useSearchParams()` only opts the leaf component into dynamic rendering.

### H-02: Sharing actions missing ISR revalidation — revoked links remain accessible
**File:** `apps/web/src/app/actions/sharing.ts` (entire file)
**Confidence:** HIGH

None of the four sharing server actions call `revalidateLocalizedPaths`. After revoking a share link, the cached version continues to serve the photo until ISR expires. This is a privacy issue.

**Fix:** Add `revalidateLocalizedPaths` to each sharing action, fetching the key before nullifying for revoke/delete.

### H-03: Schema default `processed: true` contradicts business logic
**File:** `apps/web/src/db/schema.ts:60`
**Confidence:** HIGH

The `processed` column defaults to `true`, but all inserts set `processed: false`. Any future code path that inserts without explicitly setting `processed` creates a phantom "processed" image with no variants on disk — broken images for end users.

**Fix:** Change default to `false`: `boolean("processed").default(false)`.

### H-04: Rate limit shared 'unknown' bucket when TRUST_PROXY not set behind reverse proxy
**File:** `apps/web/src/lib/rate-limit.ts:43-61`
**Confidence:** HIGH

Without `TRUST_PROXY=true`, `getClientIp()` returns `'unknown'` for ALL requests behind a reverse proxy. All users share one rate-limit bucket. An attacker making 5 rapid requests locks out every admin globally.

**Fix:** Add production warning log when IP is `'unknown'`. Document `TRUST_PROXY` requirement prominently in deployment docs.

### H-05: Hardcoded English in `aria-label` strings (3 locations)
**Files:** `home-client.tsx:238`, `image-manager.tsx:299`, `tag-input.tsx:133`
**Confidence:** HIGH

```tsx
aria-label={`View photo: ${displayTitle}`}  // home-client.tsx
aria-label={`Select image ${image.title || image.id}`}  // image-manager.tsx
aria-label={`Remove ${tag} tag`}  // tag-input.tsx
```

Screen readers read English regardless of locale. Add `t('aria.xxx')` keys.

### H-06: Hardcoded English fallback strings in image-manager.tsx dialog
**File:** `apps/web/src/components/image-manager.tsx:415-425`
**Confidence:** HIGH

Pattern `t('key') || 'English fallback'` — if translation returns empty string, `||` falls through to English. Remove English fallbacks.

### H-07: Hardcoded English in load-more.tsx aria-live region
**File:** `apps/web/src/components/load-more.tsx:84`
**Confidence:** HIGH

```tsx
{loading ? 'Loading more images…' : ''}
```

Screen reader announcement ignores locale. Add i18n key.

### H-08: Docker image copies full `node_modules` — ~200MB+ wasted
**File:** `apps/web/src/app/../../Dockerfile:57`
**Confidence:** HIGH

The standalone output already bundles dependencies, but the full `node_modules` is also copied. Duplicate packages add 150-250MB to the image.

**Fix:** Remove full `node_modules` copy. Only copy specific packages needed for `migrate.js`.

### H-09: Sequential DB queries in `getImageByShareKey`
**File:** `apps/web/src/lib/data.ts:322-354`
**Confidence:** HIGH

Two sequential `await` calls where `getImage` uses `Promise.all`. Adds a full DB roundtrip to every shared photo page.

**Fix:** Use `Promise.all` pattern as in `getImage`.

---

## MEDIUM

### M-01: `toLocaleDateString()` without locale parameter — 8 call sites
**Files:** `photo-viewer.tsx:289,465,470`, `info-bottom-sheet.tsx:173,295,300`, `image-manager.tsx:370`, `admin-user-manager.tsx:110`
**Confidence:** HIGH

Browser's default locale used instead of app's chosen language. Korean UI on English browser sees "1/15/2026" instead of "2026. 1. 15."

### M-02: Histogram dark mode detection stale — doesn't react to theme changes
**File:** `apps/web/src/components/histogram.tsx:86`
**Confidence:** MEDIUM

`document.documentElement.classList.contains('dark')` is checked only when data/mode changes. Toggling theme leaves histogram stale.

**Fix:** Use `useTheme()` + add `resolvedTheme` to useEffect deps.

### M-03: `retryCounts` map leaks memory for successfully retried jobs
**File:** `apps/web/src/lib/image-queue.ts:170-187`
**Confidence:** MEDIUM

On retry-then-success, `retryCounts` entry is never cleaned up. Add `state.retryCounts.delete(job.id)` in finally when `!retried`.

### M-04: Only WebP output verified after processing — AVIF/JPEG failures silently ignored
**File:** `apps/web/src/lib/process-image.ts:411-418`
**Confidence:** MEDIUM

If AVIF encoder produces zero-byte file, image still marked `processed: true`. Chrome shows broken image while Safari works.

**Fix:** Verify all three base files after generation.

### M-05: `updateImageMetadata` does not revalidate the topic page
**File:** `apps/web/src/app/actions/images.ts:427`
**Confidence:** MEDIUM

Topic pages show stale title for up to 1 hour after metadata update. Add topic page revalidation.

### M-06: SQL restore X'...' hex string bypasses 0x pattern
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:246-247`
**Confidence:** MEDIUM

`SET @cmd = X'4752414E54'` assigns "GRANT" but isn't caught by the `0x` pattern. Not directly exploitable (PREPARE/EXECUTE are blocked), but defense-in-depth gap.

**Fix:** Add pattern `/\bSET\s+@\w+\s*=\s*X'/i`.

### M-07: Uploaded original files written with default (world-readable) permissions
**File:** `apps/web/src/lib/process-image.ts:238`
**Confidence:** HIGH

`createWriteStream(originalPath)` uses default 0o644. Any local user can read full-resolution private originals.

**Fix:** Add `{ mode: 0o600 }`.

### M-08: Login rate-limit DB reset is fire-and-forget; failure silently leaves IP rate-limited
**File:** `apps/web/src/app/actions/auth.ts:134`
**Confidence:** MEDIUM

If DB reset fails, the IP remains rate-limited in database. Admin locked out on next attempt.

**Fix:** Await or at least log failure.

### M-09: No enforcement mechanism for auth on new `/api/admin/*` routes
**File:** `apps/web/src/proxy.ts:60-62`
**Confidence:** HIGH

No programmatic check that all admin API routes use `withAdminAuth`. Relies on developer discipline.

**Fix:** Add CI/lint rule checking all files under `api/admin/` for `withAdminAuth` usage.

### M-10: `createTopicAlias` returns misleading error for non-duplicate-key failures
**File:** `apps/web/src/app/actions/topics.ts:241-246`
**Confidence:** MEDIUM

FK violation shows "Invalid alias format" instead of "Topic does not exist."

### M-11: Photo counter badge not accessible to screen readers
**File:** `apps/web/src/components/photo-viewer.tsx:273-275`
**Confidence:** HIGH

No ARIA role or label on "3 / 12" counter. Screen reader users have no positional context.

**Fix:** Add `role="status"` with `aria-live="polite"` and `aria-label` with i18n key.

### M-12: Back-to-top button ignores `prefers-reduced-motion`
**File:** `apps/web/src/components/home-client.tsx:327`
**Confidence:** HIGH

`behavior: 'smooth'` forces animation regardless of OS reduced-motion preference.

**Fix:** Check `matchMedia('(prefers-reduced-motion: reduce)')` before scrolling.

### M-13: Passive touch listeners prevent preventing scroll during horizontal swipes
**File:** `apps/web/src/components/photo-navigation.tsx:108-110`
**Confidence:** MEDIUM

`touchmove` registered as `{ passive: true }` — browser can't suppress vertical scroll during diagonal swipe navigation.

**Fix:** Make `touchmove` non-passive; call `preventDefault()` when horizontal swipe detected.

### M-14: Pretendard Variable font is 2.0MB — no subsetting applied
**File:** `apps/web/public/fonts/PretendardVariable.woff2`
**Confidence:** HIGH

Korean-only gallery only needs Hangul + Latin (~400-600KB). Also lacks cache-busting query parameter.

**Fix:** Subset to Korean + Latin using `pyftsubset`. Add `?v=1` cache-bust query.

### M-15: `displayTags` computation runs on every render without memoization
**File:** `apps/web/src/components/home-client.tsx:175-178`
**Confidence:** LOW

O(N*M) without `useMemo`. Negligible at current scale but worth fixing.

### M-16: `getSharedGroup` fire-and-forget view count can exhaust connection pool
**File:** `apps/web/src/lib/data.ts:379-383`
**Confidence:** MEDIUM

Under load, concurrent `view_count` updates could exhaust the 10-connection pool. Should batch/debounce.

### M-17: `revalidateLocalizedPaths` doubles cache invalidation per locale
**File:** `apps/web/src/lib/revalidation.ts:28-38`
**Confidence:** MEDIUM

Every mutation invalidates 2x ISR entries (en + ko). With 2 locales this is manageable but pattern is O(N) in locale count.

### M-18: Sequential awaits in topic page that could be parallelized
**File:** `apps/web/src/app/[locale]/[topic]/page.tsx:86-98`
**Confidence:** MEDIUM

3 sequential async barriers when 2 would suffice. Adds ~5-15ms latency per topic page.

---

## LOW

### L-01: `console.error` in production code — load-more.tsx, upload-dropzone.tsx
**Files:** `load-more.tsx:39`, `upload-dropzone.tsx:105,114`
**Confidence:** HIGH

`load-more.tsx` silently fails with no user feedback. Replace with toast or retry button.

### L-02: Inline IIFE computations in photo-viewer.tsx and lightbox.tsx run on every render
**Files:** `photo-viewer.tsx:219-267`, `lightbox.tsx:140-153`
**Confidence:** LOW

srcSet string construction recomputed on every render. Extract into `useMemo`.

### L-03: `document.title` uses hardcoded "GalleryKit" brand string
**File:** `apps/web/src/components/photo-viewer.tsx:55`
**Confidence:** LOW

Should use `siteConfig.nav_title` instead.

### L-04: `tag-input.tsx` dropdown missing ARIA listbox/option roles
**File:** `apps/web/src/components/tag-input.tsx:155-194`
**Confidence:** MEDIUM

No `role="combobox"` / `role="listbox"` / `role="option"` — compare with `search.tsx` which implements this correctly.

### L-05: `photo-viewer.tsx:201` — `bg-black/5` invisible in dark mode
**File:** `apps/web/src/components/photo-viewer.tsx:201`
**Confidence:** MEDIUM

Use `bg-black/5 dark:bg-white/5`.

### L-06: ISO EXIF extraction uses `||` instead of `??`
**File:** `apps/web/src/lib/process-image.ts:442`
**Confidence:** LOW

`ISO: 0` would fall through to `ISOSpeedRatings`. Change to `??`.

### L-07: `searchImages` accepts `limit: 0` but returns empty after executing queries
**File:** `apps/web/src/lib/data.ts:454-501`
**Confidence:** LOW

Add early return for `limit <= 0`.

### L-08: `deleteImage` does not log audit event, inconsistent with `deleteImages`
**File:** `apps/web/src/app/actions/images.ts:257-311`
**Confidence:** LOW

Single-image deletions are invisible in audit log. Add `logAuditEvent`.

### L-09: DB_PASSWORD not validated for existence before mysql child process
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:76-78,273-275`
**Confidence:** HIGH

Add to existence check for clear error messages.

### L-10: `focus-trap-react` imported unconditionally in 3 components — ~15KB to client bundle
**Files:** `search.tsx:6`, `lightbox.tsx:4`, `info-bottom-sheet.tsx:4`
**Confidence:** MEDIUM

Consider shared lazy wrapper or lightweight custom implementation.

### L-11: `HomeClient` scroll handler fires on every scroll event without throttle
**File:** `apps/web/src/components/home-client.tsx:161-166`
**Confidence:** LOW

Add threshold check: `setShowBackToTop(prev => prev === shouldShow ? prev : shouldShow)`.

---

## Positive Observations

- **Strong defense-in-depth auth**: Middleware + server action + layout triple-check. HMAC-SHA256 tokens with `timingSafeEqual`. Argon2id with dummy hash for timing-safe user enumeration prevention.
- **Excellent upload security**: UUID filenames, extension validation, `limitInputPixels`, directory whitelist, symlink rejection, path containment.
- **Correct `Promise.all` parallelism** in `getImage` and `Promise.all` format processing.
- **`content-visibility: auto`** on masonry cards — significant rendering win.
- **Streaming upload** avoids materializing 200MB on heap.
- **Sharp `clone()` pattern** avoids triple buffer decode.
- **Scalar subquery for `tag_names`** avoids expensive LEFT JOIN + GROUP BY.
- **Ref-based DOM manipulation in ImageZoom** avoids React re-renders on mousemove.
- **Good reduced-motion support** via `useReducedMotion()` and `matchMedia`.
- **Well-structured ARIA combobox** in search.tsx.
- **Safe JSON-LD rendering** with `<` escaping.
