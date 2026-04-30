# Plan 24: Backlog — Round 6 (Low Priority) ✅ DONE

**Priority:** P3
**Estimated effort:** 1-2 hours
**Sources:** Comprehensive Review R6 (L-03, L-09, M-03, M-04)

---

## 1. Replace hardcoded "GalleryKit" brand string in document.title (P3)
**Source:** L-03 (R6 review)
**File:** `src/components/photo-viewer.tsx:55`
**Confidence:** LOW

`document.title` uses hardcoded "GalleryKit" brand string instead of `siteConfig.nav_title`.

**Fix:**
```ts
document.title = `${image.title} — ${siteConfig.nav_title}`;
```
Import `siteConfig` from `@/site-config.json`.

**Verification:**
- [ ] Browser tab title uses configured site name
- [ ] Build passes

---

## 2. Add DB_PASSWORD existence validation before mysql child process (P3)
**Source:** L-09 (R6 review)
**File:** `src/app/[locale]/admin/db-actions.ts:76-78,273-275`
**Confidence:** HIGH

Add to existence check for clear error messages.

**Fix:**
```ts
if (!process.env.DB_PASSWORD) {
    return { error: 'DB_PASSWORD environment variable is not set' };
}
```
Add before spawning `mysqldump`/`mysql` child processes.

**Verification:**
- [ ] Missing DB_PASSWORD returns clear error instead of cryptic spawn failure
- [ ] Build passes

---

## 3. Clean up retryCounts map entries for successfully retried jobs (P3)
**Source:** M-03 (R6 review)
**File:** `src/lib/image-queue.ts:170-187`
**Confidence:** MEDIUM

On retry-then-success, `retryCounts` entry is never cleaned up. Add `state.retryCounts.delete(job.id)` in finally when `!retried`.

**Fix:**
```ts
// In finally block, after state.enqueued.delete(job.id):
if (!retried) {
    state.enqueued.delete(job.id);
    state.retryCounts.delete(job.id); // Clean up retry count
}
```

**Verification:**
- [ ] `retryCounts` Map doesn't grow unboundedly
- [ ] Retry behavior unchanged
- [ ] Build passes

---

## 4. Verify all output formats after image processing (P3)
**Source:** M-04 (R6 review)
**File:** `src/lib/process-image.ts:411-418`
**Confidence:** MEDIUM

Only WebP output verified after processing — AVIF/JPEG failures silently ignored. If AVIF encoder produces zero-byte file, image still marked `processed: true`.

**Fix:**
- After generating all variants, verify each file exists and has non-zero size:
  ```ts
  const verifyFile = async (filePath: string) => {
      try {
          const stat = await fs.stat(filePath);
          return stat.size > 0;
      } catch {
          return false;
      }
  };

  const [webpOk, avifOk, jpegOk] = await Promise.all([
      verifyFile(webpPath),
      verifyFile(avifPath),
      verifyFile(jpegPath),
  ]);

  if (!webpOk || !avifOk || !jpegOk) {
      const missing = [];
      if (!webpOk) missing.push('WebP');
      if (!avifOk) missing.push('AVIF');
      if (!jpegOk) missing.push('JPEG');
      console.error(`Image processing incomplete — missing: ${missing.join(', ')}`);
      // Don't mark as processed — let retry handle it
      return;
  }
  ```

**Verification:**
- [ ] Zero-byte AVIF file prevents `processed: true`
- [ ] All three formats verified before marking complete
- [ ] Build passes
