# Plan 12: R4 Performance Fixes

**Priority:** P1-P2  
**Estimated effort:** 2-3 hours  
**Sources:** Performance R3 (R4 review pending), Security H-1/M-3

---

## 1. Lower bodySizeLimit and upload caps (P1)
**Source:** Security H-1, M-3  
**Files:**
- `next.config.ts:28,31` — `'10gb'` → `'250mb'` (aligns with per-file 200MB limit)
- `src/app/actions/images.ts:48-49` — `10 * 1024 * 1024 * 1024` → `2 * 1024 * 1024 * 1024` (2GB total batch)
- `nginx/default.conf:16` — keep `10G` at nginx level (allows large batches via streaming)
- Update CLAUDE.md to reflect new limits

## 2. Admin dashboard: use lighter query (P1)
**Source:** Performance R3 P1-002 (persists)  
**File:** `src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- Already paginated to 50 (done earlier), but still uses `getImages()` with GROUP_CONCAT
- Change to `getImagesLite()` with `includeUnprocessed` support
- Or create `getAdminImagesLite()` that includes unprocessed but skips GROUP BY

## 3. Histogram Worker cache-busting (P3)
**Source:** Code L-02  
**File:** `src/components/histogram.tsx:157`
- Add version query param: `new Worker('/histogram-worker.js?v=1')`
- Or move to bundled worker pattern if Turbopack supports it

## 4. Fix redundant histogram drawChannel branch (P3)
**Source:** Code L-03  
**File:** `src/components/histogram.tsx:97-101`
- Remove the `if/else` — both branches are identical `ctx.lineTo(x, y)`

## 5. Back-to-top passive scroll optimization (P3)
**Source:** UX m9, Code L-01  
- Already `{ passive: true }` — move to useEffect for cleaner lifecycle

---

## Verification
- [ ] Upload of 300MB file rejected by server (not just client)
- [ ] Admin dashboard uses lighter query (no GROUP_CONCAT)
- [ ] Build passes
