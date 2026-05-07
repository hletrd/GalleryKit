# Cycle 6 Composite Review

## C6F-01 (HIGH): `getSharedGroup` returns null on empty images but group exists

**File+line**: `apps/web/src/lib/data.ts:963-966`
**Confidence**: High

### Problem

When a shared group exists in the DB but all its images are still unprocessed (`processed = false`), the `getSharedGroup` function returns `null` (line 963-966: `if (imagesWithTags.length === 0) return null;`). The caller (`/g/[key]/page.tsx`) then renders a 404 via `notFound()`.

This means: an admin creates a shared group with images that are still processing, shares the link, and the recipient gets a 404 instead of a meaningful "photos are still processing" state. The group *does* exist and the images *are* associated — they are just not yet processed.

### Concrete failure scenario

1. Admin uploads 5 photos and creates a shared group immediately
2. The photos are queued but not yet processed
3. Admin shares `/g/ABC123` with a friend
4. Friend visits the link and gets a 404 (because `eq(images.processed, true)` filters out all images)
5. Friend assumes the link is broken

### Fix

Return the group metadata even when images are empty, and let the page component distinguish "group not found" from "group has no processed images yet". This could be as simple as returning `{ ...group, images: [] }` instead of `null` when the group exists but has no processed images. The page component would then show a "photos still processing" message.

### Severity rationale

HIGH because this is a user-facing correctness bug: a valid shared link returns 404 instead of a meaningful state. The admin has no way to know the link is temporarily broken.

---

## C6F-02 (MEDIUM): `getImage` prev/next query for DATED images does not guard `lt/gt` on `capture_date` with `isNotNull`

**File+line**: `apps/web/src/lib/data.ts:760-776`
**Confidence**: High

### Problem

In the C5F-01 fix, `isNull(images.capture_date)` was correctly added to `nextConditions` for dated images (line 773). However, the remaining conditions in both `prevConditions` and `nextConditions` for dated images use `gt/lt/eq` on `images.capture_date` without an explicit `isNotNull(images.capture_date)` guard.

In MySQL, `NULL` comparisons (`gt(images.capture_date, ...)`, `lt(images.capture_date, ...)`, `eq(images.capture_date, ...)`) return NULL (falsy in WHERE), so they implicitly exclude undated rows. This means the behavior is *correct* today — the undated rows are already excluded by the dated comparison conditions, and `isNull(capture_date)` in `nextConditions` explicitly includes them.

However, this is fragile: the correctness depends on MySQL's NULL comparison semantics. If someone were to add a condition like `or(isNull(images.capture_date), gt(images.capture_date, ...))` thinking the `isNull` branch handles undated rows for prev, it would be wrong. A defensive `isNotNull` guard on the dated-only branches would make the intent explicit and prevent future regressions.

### Fix

Add `isNotNull(images.capture_date)` as an AND condition on the dated-only branches of `prevConditions` and `nextConditions` for dated images, matching the pattern already used for undated images (lines 789, 796-797). This is a clarity/defense-in-depth improvement, not a correctness bug.

### Severity rationale

MEDIUM because the current behavior is correct but the code structure is fragile and could easily break in a future edit.

---

## C6F-03 (MEDIUM): `searchImages` ORDER BY uses `images.created_at` which is not in the SELECT list

**File+line**: `apps/web/src/lib/data.ts:1067`
**Confidence**: Medium

### Problem

The `searchImages` function orders by `desc(images.capture_date), desc(images.created_at), desc(images.id)` but the SELECT does not include `images.created_at`. In MySQL, this is valid — you can ORDER BY columns not in the SELECT list. However, the tag and alias sub-queries (lines 1127, 1146) also ORDER BY `images.created_at` without selecting it, and they use `groupBy` that does not include `images.created_at`.

In MySQL with `ONLY_FULL_GROUP_BY` mode (which is NOT the default), this would fail because `images.created_at` is neither in the GROUP BY nor in an aggregate. The current MySQL default does not enable `ONLY_FULL_GROUP_BY` for Drizzle queries, so this works today. But if the MySQL server ever has strict SQL mode enabled, the tag/alias sub-queries would break.

### Fix

Add `images.created_at` to the `searchFields` object and the `groupBy` clauses in the tag and alias sub-queries. This makes the query compatible with strict SQL mode and ensures the sort column is always available.

### Severity rationale

MEDIUM because it's a latent compatibility issue that would surface if MySQL strict mode is enabled.

---

## C6F-04 (MEDIUM): `getSharedGroup` does not include `created_at` in its images SELECT

**File+line**: `apps/web/src/lib/data.ts:920-933`
**Confidence**: High

### Problem

The `getSharedGroup` query at line 920 selects `publicSelectFields` and `blur_data_url` for images. However, `publicSelectFields` includes `capture_date` and `created_at` (inherited from `adminSelectFields`), and the shared group page at `/g/[key]/page.tsx` uses `image.width` and `image.height` for aspect ratio calculations. This part is fine.

However, the `getSharedGroup` result is rendered by `PhotoViewer` which needs `filename_avif` and `filename_webp` for the lightbox `srcSet` (see `lightbox.tsx:236-257`), but `filename_avif` and `filename_webp` are **not** in `publicSelectFields` (they were excluded as internal filenames per the privacy note). The lightbox code at line 236-237 tries to access `image.filename_avif` and `image.filename_webp`, which would be `undefined`.

Looking at `lightbox.tsx:236`:
```ts
const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');
const baseWebp = image.filename_webp?.replace(/\.webp$/i, '');
```

The optional chaining `?.` prevents a crash, but the lightbox would silently fall back to the JPEG `<img>` tag without the AVIF/WebP `<source>` elements. This means shared group viewers don't get the optimal format delivery.

### Concrete failure scenario

1. Admin creates a shared group with 5 photos
2. Visitor opens the group and clicks on a photo (lightbox)
3. The lightbox only shows the JPEG fallback — no AVIF/WebP `<source>` elements
4. Visitor on a slow connection loads a larger JPEG instead of a smaller WebP/AVIF

### Fix

Add `filename_avif: images.filename_avif` and `filename_webp: images.filename_webp` to the `getSharedGroup` images SELECT. These are not PII fields (they are UUID-based generated filenames, not user-provided), and they are already exposed in `publicSelectFields` — wait, let me re-check...

Actually checking `publicSelectFields` again (data.ts:280-300), `filename_avif` and `filename_webp` ARE included in `publicSelectFields` (they are NOT in the omit list — only `latitude`, `longitude`, `filename_original`, `user_filename`, `original_format`, `original_file_size`, `processed` are omitted). So `getSharedGroup` already has access to these fields via the spread `...publicSelectFields`. This finding is actually a false positive on closer inspection.

**RETRACTION**: After re-reading lines 280-300 more carefully, `filename_avif` and `filename_webp` are indeed part of `publicSelectFields` because they are not in the omit destructuring. The lightbox will receive these values. Marking as NOT A FINDING.

---

## C6F-05 (LOW): `getSharedGroup` images query has `.limit(100)` but no pagination

**File+line**: `apps/web/src/lib/data.ts:933`
**Confidence**: Low

### Problem

The `getSharedGroup` images query has a hard `.limit(100)` but no offset or cursor-based pagination. If an admin adds more than 100 images to a shared group, images beyond 100 are silently dropped. The admin UI for creating shared groups allows up to 100 images (checked in `sharing.ts:196`), so this is currently safe. However, the limit is enforced at the write path but not documented as a contract at the read path.

### Fix

Add a comment documenting the invariant: "The limit(100) matches SHARE_MAX_IMAGES (100) enforced at group creation time in sharing.ts." No code change needed.

### Severity rationale

LOW because the write path already enforces the limit.

---

## C6F-06 (MEDIUM): `getImageByShareKey` makes a sequential query for tags after the main query

**File+line**: `apps/web/src/lib/data.ts:877-883`
**Confidence**: Medium

### Problem

`getImageByShareKey` (line 850-891) fetches the image in one query, then fetches tags in a second sequential query (lines 877-883). This is 2 DB round-trips. The function was simplified in cycle 3 (removing a redundant `Promise.all`), but the sequential tag query is still an extra round-trip compared to `getImage` which does it in parallel with `Promise.all`.

### Fix

Wrap the image and tag queries in `Promise.all` like `getImage` does. If the image query returns empty, the tag query result is discarded.

### Severity rationale

MEDIUM because it's a performance issue on the public share page — an extra DB round-trip on every shared photo view.

---

## C6F-07 (LOW): `normalizeStringRecord` check order allows `stripControlChars` to run before `UNICODE_FORMAT_CHARS.test`

**File+line**: `apps/web/src/lib/sanitize.ts:60-64`
**Confidence**: Low

### Problem

In `normalizeStringRecord`, the `UNICODE_FORMAT_CHARS.test(value)` check (line 60) happens before `stripControlChars(trimmed)` (line 64). But the check operates on `value` (before trim), while the strip operates on `trimmed` (after trim). If a BOM character (`U+FEFF`) is at the start of the value, `value.trim()` would remove it before `stripControlChars` sees it. However, `UNICODE_FORMAT_CHARS.test(value)` catches it before trim, so the rejection works correctly.

The issue is that `stripControlChars` is applied to `trimmed` (after trim), but the rejection check is on `value` (before trim). If `value` contains only Unicode formatting characters that are also whitespace (like BOM), `trimmed` would be empty after `value.trim()`, and `stripControlChars(trimmed)` would return an empty string — but we already rejected on line 60, so the `stripControlChars` line is never reached. This is correct.

**NOT A FINDING** — the ordering is correct. The rejection check on raw value catches the problem, and the strip is defense-in-depth.

---

## C6F-08 (LOW): `db/index.ts` pool connection handler not reviewed

**File+line**: `apps/web/src/db/index.ts`
**Confidence**: Low

### Problem

The database connection pool configuration and the `poolConnection.on('connection', ...)` handler mentioned in `db-actions.ts` (line 56) as setting `group_concat_max_len` were not reviewed in this cycle. This is a gap in review coverage.

---

## Verified Prior Fixes

### C5F-01 (prev/next at dated/undated boundary) — VERIFIED CORRECT
- `isNull(capture_date)` correctly moved from prevConditions to nextConditions for dated images (line 773)
- `isNotNull(capture_date)` correctly added to prevConditions for undated images (line 788)
- Parity with `buildCursorCondition` confirmed

### C4F-11 (hard link for variant dedup) — VERIFIED CORRECT
- `processImageFormats` at line 483 uses `fs.link` with fallback to `fs.copyFile`
- Atomic rename via `.tmp` file at lines 513-532

### C4F-08/C4F-09 (blur_data_url and topic_label in getImageByShareKey) — VERIFIED CORRECT
- `getImageByShareKey` at lines 860-864 includes both `blur_data_url` and `topic_label`

### C3-AGG-03 (search alias-query cap) — VERIFIED CORRECT
- `aliasRemainingLimit` capped at `remainingLimit` (line 1104)

---

## Summary of Actionable Findings

| ID | Severity | Confidence | Title |
|----|----------|------------|-------|
| C6F-01 | HIGH | High | `getSharedGroup` returns null on empty processed images — shared link 404 |
| C6F-02 | MEDIUM | High | Dated prev/next conditions lack explicit `isNotNull` guard |
| C6F-03 | MEDIUM | Medium | `searchImages` ORDER BY uses column not in GROUP BY |
| C6F-05 | LOW | Low | `getSharedGroup` limit(100) undocumented contract |
| C6F-06 | MEDIUM | Medium | `getImageByShareKey` sequential tag query (perf) |
