# Code Quality Review — Cycle 1 (2026-04-19)

**Scope:** Logic bugs, correctness, edge cases, maintainability
**Methodology:** File-by-file inspection with cross-file interaction analysis

---

## FINDINGS

### CQ-01: `upload-dropzone.tsx` preview URLs are recreated for ALL files on every `files` change
**File:** `apps/web/src/components/upload-dropzone.tsx:43-57`
**Severity:** MEDIUM
**Confidence:** HIGH

The `useMemo` for `previewUrls` creates new `URL.createObjectURL` calls for ALL files whenever `files` changes. The cleanup effect revokes all old URLs and creates new ones, causing a visual flash for existing previews when adding a single new file. With 50 existing files and 1 new file, all 51 previews flicker.

The previous review (S-02) identified this but it was not implemented in any plan.

**Fix:** Use a ref-based Map that only creates URLs for newly added files and revokes URLs for removed files, rather than recreating all URLs on every change.

---

### CQ-02: `image-queue.ts` claim retry is unbounded — no MAX_RETRIES equivalent for claim failures
**File:** `apps/web/src/lib/image-queue.ts:112-118`
**Severity:** MEDIUM
**Confidence:** HIGH

When a job cannot acquire a MySQL advisory lock, it re-enqueues itself via `setTimeout`. This retry has no cap — if another worker holds the lock permanently (e.g., due to a bug or crash without release), the job retries every 5 seconds forever. The `MAX_RETRIES = 3` at line 104 only applies to processing errors, not claim failures.

The previous review (S-03) identified this but it was not implemented in any plan.

**Fix:** Track claim-retry attempts separately (e.g., `claimRetryCounts` Map) and cap at 5-10 attempts with escalating backoff. After exhausting claim retries, log an error and give up (the image stays in `processed=false` state and will be retried on server restart via `bootstrapImageProcessingQueue`).

---

### CQ-03: `getSharedGroup` fetches tags with N+1 queries — one per image
**File:** `apps/web/src/lib/data.ts:444-456`
**Severity:** MEDIUM
**Confidence:** HIGH

`getSharedGroup` fetches tags for each image individually in a `Promise.all` loop. With 100 images, this creates 100 separate DB queries. The `getImagesLite` function uses a scalar subquery with `GROUP_CONCAT` which is much more efficient.

**Fix:** Use a single query to fetch all imageTags for the group's images, then distribute them in-memory:
```ts
const allTags = await db.select({
    imageId: imageTags.imageId,
    slug: tags.slug,
    name: tags.name,
}).from(imageTags)
.innerJoin(tags, eq(imageTags.tagId, tags.id))
.where(inArray(imageTags.imageId, groupImages.map(img => img.id)));

const tagsByImage = new Map<number, TagInfo[]>();
for (const t of allTags) {
    const arr = tagsByImage.get(t.imageId) || [];
    arr.push({ slug: t.slug, name: t.name });
    tagsByImage.set(t.imageId, arr);
}
```

---

### CQ-04: `histogram.tsx` uses `Math.max(...bins)` which can stack overflow with large arrays
**File:** `apps/web/src/components/histogram.tsx:86, 107`
**Severity:** LOW
**Confidence:** HIGH

`Math.max(...bins)` spreads 256 elements (for luminance) or up to 768 elements (for RGB mode with `...data.r, ...data.g, ...data.b`). While 768 is well under the typical call stack limit (~100K), the spread pattern is fragile. Using `bins.reduce((a, b) => a > b ? a : b, 0)` is safer and more idiomatic.

The previous review (S-09) identified this but it was not implemented.

**Fix:** Replace `Math.max(...bins)` with `bins.reduce((max, v) => v > max ? v : max, 0)`.

---

### CQ-05: `clipboard.ts` uses deprecated `execCommand('copy')` as fallback
**File:** `apps/web/src/lib/clipboard.ts:13-27`
**Severity:** LOW
**Confidence:** HIGH

The previous review (S-10) identified this. `document.execCommand('copy')` is deprecated. Modern browsers support `navigator.clipboard.writeText()` universally. The fallback should be removed or replaced.

**Fix:** Remove the `execCommand` fallback and rely solely on `navigator.clipboard.writeText()`. If clipboard API is unavailable, show a message to the user.

---

### CQ-06: `load-more.tsx` IntersectionObserver is recreated on every `hasMore` change
**File:** `apps/web/src/components/load-more.tsx:69-84`
**Severity:** LOW
**Confidence:** MEDIUM

The `IntersectionObserver` is created in a `useEffect` that depends on `hasMore`. Every time `hasMore` changes (which happens on every successful load), the observer is torn down and recreated. This is unnecessary — the observer's callback already checks `hasMore` via the ref `loadMoreRef.current`.

The previous review (S-13) identified this but it was not implemented.

**Fix:** Remove `hasMore` from the dependency array. The observer only needs to be created once (on mount) and destroyed on unmount.

---

### CQ-07: `photo-viewer.tsx` reads `sessionStorage` in `useState` initializer — causes hydration mismatch
**File:** `apps/web/src/components/photo-viewer.tsx:46-48`
**Severity:** LOW
**Confidence:** MEDIUM

```ts
const [showLightbox, setShowLightbox] = useState(() => {
    try { return sessionStorage.getItem('gallery_auto_lightbox') === 'true'; } catch { return false; }
});
```

`sessionStorage` is not available during SSR. While the `try/catch` prevents a crash, the server renders with `false` and the client may initialize with `true`, causing a hydration mismatch warning.

The previous review (S-14) identified this but it was not implemented.

**Fix:** Initialize with `false` and read `sessionStorage` in a `useEffect` on mount:
```ts
const [showLightbox, setShowLightbox] = useState(false);
useEffect(() => {
    try { setShowLightbox(sessionStorage.getItem('gallery_auto_lightbox') === 'true'); } catch {}
}, []);
```

---

### CQ-08: `adminExtraFields` exported but never imported — dead code risk
**File:** `apps/web/src/lib/data.ts:82-86, 579`
**Severity:** LOW
**Confidence:** HIGH

`adminExtraFields` contains `user_filename`, `latitude`, `longitude` (PII fields). It's exported at line 579 but never imported anywhere. The previous review (R-01) identified this. It's an attractive nuisance — someone could accidentally import it into a public query.

**Fix:** Either (a) use it in admin-specific queries (e.g., `getAdminImages`) and remove the standalone export, or (b) remove the export entirely and keep it as a module-local constant.

---

### CQ-09: `db/index.ts` connection limit doesn't match CLAUDE.md documentation
**File:** `apps/web/src/db/index.ts:18`, `CLAUDE.md`
**Severity:** LOW
**Confidence:** HIGH

The previous review (D-10) identified that `connectionLimit: 10` in `db/index.ts` doesn't match CLAUDE.md's "8 connections, queue limit 20". Let me verify.

**Fix:** Either update the code to match the documentation or update the documentation to match the code.

---

### CQ-10: `process-topic-image.ts` duplicated `maxInputPixels` config with different default from `process-image.ts`
**File:** `apps/web/src/lib/process-topic-image.ts:11-14`, `apps/web/src/lib/process-image.ts:20-23`
**Severity:** MEDIUM
**Confidence:** HIGH

Both files parse `IMAGE_MAX_INPUT_PIXELS` independently with different fallback defaults: 64M for topic images vs 256M for regular images. If the env var is set, it overrides both, eliminating the intentional lower limit for topic images (which are resized to 512x512 and don't need the extra headroom).

The previous review (S-08) identified this but it was not implemented.

**Fix:** Use a separate env var `IMAGE_MAX_INPUT_PIXELS_TOPIC` for topic images, or define the shared config in a single module with per-context defaults.

---

## PREVIOUSLY FIXED — Confirmed Resolved

| Previous ID | Description | Fix Commit | Verified |
|-------------|-------------|------------|----------|
| D-02 | Advisory lock unreliable with pooled connections | e992dfb | YES — dedicated connection via `connection.getConnection()` |
| D-04 | updateTag returns success on 0 rows | a466cbf | YES — checks `affectedRows` |
| D-05 | deleteTopicAlias lacks error handling | cc5ec10 | YES — try/catch added |
| D-07 | batchUpdateImageTags non-transactional | 53c57d8 | YES — wrapped in `db.transaction()` |
| D-08 | CSV export silent truncation | efe1a0c | YES — warning returned when result count >= 50000 |
| D-09 | revokePhotoShareLink success on 0 rows | a466cbf | YES — checks `affectedRows` |
| C-02 | Tags discarded on shared photo page | 61f3d95 | YES — passes `image.tags` |
| C-03 | Tags discarded on shared group page | 4bc3388 | YES — fetches and passes tags |
| S-05 | document.title not restored | 90f2f7f | YES — cleanup function added |
| S-06 | Native confirm() in admin-user-manager | 8a15e0c | YES — replaced with AlertDialog |
| S-07 | Temp file without restrictive permissions | ff08972 | YES — `mode: 0o600` added |

---

## ISSUE SUMMARY

| ID | Severity | File | Description | Status |
|----|----------|------|-------------|--------|
| CQ-01 | MEDIUM | `upload-dropzone.tsx:43` | Preview URLs recreated on every file change | New (prev S-02) |
| CQ-02 | MEDIUM | `image-queue.ts:112` | Unbounded claim retry | New (prev S-03) |
| CQ-03 | MEDIUM | `data.ts:444` | N+1 queries for shared group tags | New |
| CQ-04 | LOW | `histogram.tsx:86` | Math.max spread pattern | New (prev S-09) |
| CQ-05 | LOW | `clipboard.ts:13` | Deprecated execCommand fallback | New (prev S-10) |
| CQ-06 | LOW | `load-more.tsx:69` | IntersectionObserver recreated on hasMore change | New (prev S-13) |
| CQ-07 | LOW | `photo-viewer.tsx:46` | sessionStorage in useState causes hydration mismatch | New (prev S-14) |
| CQ-08 | LOW | `data.ts:579` | adminExtraFields exported but unused | New (prev R-01) |
| CQ-09 | LOW | `db/index.ts:18` | Connection limit mismatch with docs | New (prev D-10) |
| CQ-10 | MEDIUM | `process-topic-image.ts:11` | Duplicated maxInputPixels with inconsistent defaults | New (prev S-08) |
