# Plan 04: Performance Optimization

**Priority:** P1 (items 1-7), P2 (items 8-15)  
**Estimated effort:** 6-8 hours  
**Sources:** Performance P0/P1/P2, Architecture 5/8/9

---

## P0 — Critical Performance

### 1. Fix Sharp concurrency formula
**Source:** Perf P0-01  
**File:** `apps/web/src/lib/process-image.ts:9-14`
- Change `Math.max(1, cpuCount - 2)` to `Math.max(1, cpuCount - 1)`
- Make configurable: `const envConcurrency = Number.parseInt(process.env.SHARP_CONCURRENCY ?? '', 10)`
- Already has env override path — just fix the default formula

### 2. Stream uploads to disk instead of heap buffer
**Source:** Perf P0-02  
**File:** `apps/web/src/lib/process-image.ts:231`
- Replace `Buffer.from(await file.arrayBuffer())` with streaming to temp file
- Pass temp file path to Sharp for metadata extraction (mmap, no heap copy)
- Rename temp file to final path after metadata extraction
- Update blur placeholder generation to use `sharp(tempPath).clone()`

### 3. Parallel file metadata extraction in upload
**Source:** Perf P0-03  
**File:** `apps/web/src/app/actions.ts:635-803`
- Replace sequential `for...of` with `Promise.all` for metadata extraction (max 3 concurrent)
- Batch DB operations: collect all insert values, do single multi-row INSERT
- Keep queue enqueue as fire-and-forget (current behavior is fine)

---

## P1 — High Priority

### 4. Self-host Pretendard font / non-blocking load
**Source:** Perf P1-03  
**File:** `apps/web/src/app/[locale]/layout.tsx:95-103`
- Option A: Use `next/font/local` with self-hosted Pretendard woff2 files
- Option B: Make current CDN load non-blocking: `media="print" onload="this.media='all'"`
- Remove the `<link rel="preload">` if using next/font

### 5. Add nginx gzip compression
**Source:** Perf P1-04  
**File:** `apps/web/nginx/default.conf`
```nginx
gzip on;
gzip_comp_level 5;
gzip_min_length 256;
gzip_types text/html text/css application/javascript application/json image/svg+xml;
gzip_vary on;
```

### 6. Fix nginx upstream keepalive
**Source:** Perf P1-05  
**File:** `apps/web/nginx/default.conf:61-62`
```nginx
upstream nextjs {
    server 127.0.0.1:3000;
    keepalive 32;
}
# In location blocks:
proxy_set_header Connection "";  # Enable keepalive (remove 'upgrade')
```

### 7. Docker HEALTHCHECK
**Source:** Perf P1-08, Architecture 9.2  
**Files:**
- Create `apps/web/src/app/api/health/route.ts` — check DB connectivity, report queue depth
- `apps/web/Dockerfile` — add HEALTHCHECK instruction

---

## P2 — Medium Priority

### 8. Remove GROUP_CONCAT JOIN from gallery listing
**Source:** Perf P1-01, Code H-05  
**File:** `apps/web/src/lib/data.ts:165-182`
- Create `getImagesLite()` without tag JOINs for homepage/topic/loadMore
- Keep `getImages()` with tags for contexts that need them
- Fetch tags separately for photo detail page (already done in `getImage()`)

### 9. Admin dashboard pagination
**Source:** Perf P1-02, Code M-13  
**File:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:7`
- Add `page` search parameter
- Fetch 50 images per page instead of 200
- Add pagination controls to dashboard client

### 10. Search FULLTEXT index
**Source:** Perf P1-06  
**Files:**
- Add MySQL FULLTEXT index on `images(title, description, camera_model)`
- Rewrite `searchImages()` to use `MATCH ... AGAINST` instead of `LIKE '%term%'`
- Combine the two parallel queries into a single UNION

### 11. Right-size MySQL connection pool
**Source:** Perf P2-04  
**File:** `apps/web/src/db/index.ts:18`
- Change `connectionLimit: 20` to `connectionLimit: 8`
- Change `queueLimit: 50` to `queueLimit: 20`

### 12. Fix revalidatePath thrashing
**Source:** Perf P2-08  
**File:** `apps/web/src/app/actions.ts`
- Remove `revalidatePath('/')` from queue job callback (line ~119)
- Keep only the one after the upload loop completes
- Consider `revalidateTag` for granular invalidation

### 13. Replace framer-motion with CSS transitions
**Source:** Perf P2-01  
**Files:**
- `apps/web/src/components/photo-viewer.tsx:9,160-166` — replace `AnimatePresence`/`motion.div` with CSS `transition` + conditional classes
- `apps/web/src/components/lightbox.tsx:5` — replace `useReducedMotion` with `@media (prefers-reduced-motion)`
- Remove `framer-motion` from package.json entirely (saves ~40KB gzipped)

### 14. Fix ImageZoom CSS transition lag during pan
**Source:** Perf P2-09  
**File:** `apps/web/src/components/image-zoom.tsx:133`
- Conditionally remove `transition-transform duration-300` when zoomed
- `innerRef.current.style.transition = zoomed ? 'none' : 'transform 0.3s ease-out'`

### 15. Lazy-load histogram
**Source:** Perf P2-10  
**File:** `apps/web/src/components/photo-viewer.tsx:407-412`
- Only render `<Histogram>` when info panel is visible and pinned
- Use `OffscreenCanvas` with web worker for computation

---

## Verification
- [ ] Sharp concurrency > 1 on 3-CPU host (`docker exec ... node -e "console.log(require('sharp').concurrency())"`)
- [ ] No 200MB heap buffers during upload (monitor with `--max-old-space-size`)
- [ ] 10-file upload completes in < 5 seconds (metadata phase)
- [ ] `curl -sI gallery.atik.kr | grep content-encoding` shows gzip
- [ ] `/api/health` returns 200 with DB status
- [ ] Homepage loads in < 1s on cold cache (Lighthouse)
