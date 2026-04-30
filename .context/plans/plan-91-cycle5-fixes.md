# Plan 91 — Cycle 5 Fixes

**Source review:** Cycle 5 Comprehensive Review (C5-F01, C5-F02, C5-F03)
**Status:** DONE

---

## Findings to Address

| ID | Description | Severity | Confidence |
|----|------------|----------|------------|
| C5-F01 | `getImageByShareKey` uses `selectFields` without explicit GPS privacy guard | MEDIUM | HIGH |
| C5-F02 | `home-client.tsx` uses file-level `eslint-disable` when only specific `<img>` tags need it | LOW | HIGH |
| C5-F03 | `processImageFormats` verifies only WebP output — AVIF/JPEG not verified | LOW | MEDIUM |

### Deferred Findings (not implemented this cycle)

None — all findings are scheduled for implementation.

---

## C5-F01: GPS privacy enforcement gap in public shared-photo query

**File:** `apps/web/src/lib/data.ts:383-384`

**Current code:**
```ts
export async function getImageByShareKey(key: string) {
    const trimmedKey = (key || '').trim();
    if (!isBase56(trimmedKey, [5, 10])) {
        return null;
    }

    const result = await db.select({
        ...selectFields,
    })
```

**Problem:** `selectFields` intentionally omits `latitude` and `longitude` for privacy, but this is an implicit omission. If someone adds those fields to `selectFields`, the public `/s/[key]` route would leak GPS data. CLAUDE.md states "GPS coordinates excluded from public API responses" but there is no enforcement.

**Fix:** Add an explicit comment block in `getImageByShareKey` documenting the privacy constraint and the fact that `selectFields` must not include GPS coordinates for public queries. Also add a similar comment to `getSharedGroup` and `getImagesLite` since they also use `selectFields` for public-facing data. This creates a "defense in documentation" layer — any developer modifying `selectFields` will see the comments in all public query functions.

---

## C5-F02: Overly broad eslint-disable in home-client.tsx

**File:** `apps/web/src/components/home-client.tsx:1`

**Current code (line 1):**
```tsx
/* eslint-disable @next/next/no-img-element */
```

**Problem:** This file-level disable suppresses the `@next/next/no-img-element` rule for the entire file. Only the `<img>` tags inside `<picture>` elements (which is the correct pattern where Next.js `<Image>` cannot be used) need the exemption. The `upload-dropzone.tsx` correctly uses `eslint-disable-next-line` for a single instance.

**Fix:**
1. Remove the file-level `/* eslint-disable @next/next/no-img-element */` from line 1
2. Add `{/* eslint-disable-next-line @next/next/no-img-element */}` before the `<img>` tag(s) inside the `<picture>` elements in the `srcSetData` variable and the `orderedImages.map` render

---

## C5-F03: processImageFormats verification gap

**File:** `apps/web/src/lib/process-image.ts:400-407`

**Current code:**
```ts
// Verify output file is not empty
try {
    const stats = await fs.stat(path.join(UPLOAD_DIR_WEBP, filenameWebp));
    if (stats.size === 0) throw new Error('Generated WebP file is empty');
} catch (e) {
    console.error('File verification failed:', e);
    throw new Error('Image processing failed: generated file could not be verified');
}
```

**Problem:** Only the WebP base file is verified. AVIF and JPEG are not checked. The queue separately verifies all three formats, but if `processImageFormats` is called outside the queue, AVIF/JPEG failures go undetected.

**Fix:** Verify all three format base files are non-empty, matching the queue's verification pattern. Use `Promise.all` for parallel stat checks.

```ts
// Verify all three output format base files are not empty
try {
    const [webpStats, avifStats, jpegStats] = await Promise.all([
        fs.stat(path.join(UPLOAD_DIR_WEBP, filenameWebp)),
        fs.stat(path.join(UPLOAD_DIR_AVIF, filenameAvif)),
        fs.stat(path.join(UPLOAD_DIR_JPEG, filenameJpeg)),
    ]);
    if (webpStats.size === 0) throw new Error('Generated WebP file is empty');
    if (avifStats.size === 0) throw new Error('Generated AVIF file is empty');
    if (jpegStats.size === 0) throw new Error('Generated JPEG file is empty');
} catch (e) {
    console.error('File verification failed:', e);
    throw new Error('Image processing failed: generated file could not be verified');
}
```

---

## Implementation Order

1. Fix C5-F01 (add privacy comments to public query functions) — documentation, low risk
2. Fix C5-F02 (narrow eslint-disable scope) — simple, isolated
3. Fix C5-F03 (verify all three formats) — logic change, needs testing

---

## Verification

- [x] C5-F01: Privacy comments added to `getImageByShareKey`, `getSharedGroup`, `getImagesLite` (commit f632447)
- [x] C5-F02: File-level eslint-disable replaced with per-element disable (commit 01323f1)
- [x] C5-F03: All three format base files verified in parallel (commit 94e137d)
- [ ] `npm run lint --workspace=apps/web` passes with 0 errors
- [ ] `npm run build` passes
- [ ] `cd apps/web && npx vitest run` passes
