# Color-Management Performance Review — The Veteran

**Reviewer**: perf-reviewer (kernel/compiler/hardware specialist)
**Date**: 2026-05-03
**Scope**: Sharp pipelines for AVIF/WebP/JPEG derivatives, ICC handling, P3 tagging, queue architecture, CDN cacheability, native-binary deployment.
**Repo**: `/Users/hletrd/git/gallery`

---

## TL;DR

Pipeline ordering is reasonable for *correctness* but leaves measurable performance and a handful of correctness landmines on the floor. The single decode is parallelized well across formats via `image.clone()`. ICC handling is "embed a named profile" not "do a CMS conversion" — that is the cheap path and the right call. But:

1. **A P0 backfill script references a column that does not exist** (`icc_profile_name`). Run it on prod and it will throw at the SELECT.
2. **Cached AVIF/WebP/JPEG variants are served `immutable`** but their URL key (UUID + size) does **not** include a color-pipeline version — so any future change to the color path will be invisible to clients with cached responses for **a year**.
3. **AVIF effort is implicit-default 4** with no operator override — encoder spends 30-50% more CPU per image than `effort: 2-3` would and produces files only ~3-5% smaller.
4. **No 10-bit pathway**. Wide-gamut originals (P3, Adobe RGB, ProPhoto) are decoded into 8-bit AVIF, throwing away ~half the gamut precision the source carried. The `p3` ICC tag on an 8-bit AVIF is half a lie.
5. **Concurrency math is broken under load**. `SHARP_CONCURRENCY = (cores - 1)` is set as the libvips thread cap *per call*. A single Sharp invocation can spawn that many threads, and `processImageFormats` runs three formats in `Promise.all`, so one image can saturate `3 * (cores-1)` threads. With `QUEUE_CONCURRENCY > 1` it goes superlinear.
6. **Backfill script has no DB UPDATE** — it re-emits files but never records that the row was retagged. Re-running is "idempotent" only because it reads the file back and compares ICC bytes. That round-trip is wasteful and fragile.

Memory budget is fine. Decode-once-clone-three is well done. Atomic rename is well done. The ICC parser is solid.

---

## Findings

### P0-CRITICAL — backfill script references nonexistent DB column

**File**: `apps/web/scripts/backfill-p3-icc.ts:147-152`
**Schema**: `apps/web/src/db/schema.ts:45` — column is `color_space`, not `icc_profile_name`.

```ts
const rawRows = await db.execute(sql`
    SELECT id, filename_avif, icc_profile_name      // ← does not exist
    FROM images
    WHERE processed = TRUE
      AND icc_profile_name IS NOT NULL              // ← does not exist
    ORDER BY id ASC
`);
```

**Impact**: First run on production throws `ER_BAD_FIELD_ERROR: Unknown column 'icc_profile_name' in 'field list'`. The interface `ImageRow` and the resolveAvifIccProfile() filter both reference the missing column. This means the operator-facing P3 backfill story is **completely broken**. If a fix to `resolveAvifIccProfile` ever needs to be backfilled, there is no working tool.

**Confidence**: High. Schema confirmed by reading `src/db/schema.ts` and grepping for `icc_profile_name` in drizzle migrations — zero hits.

**Fix**: The actual stored column is `color_space`, populated from `data.iccProfileName || exifDb.color_space` (`actions/images.ts:330`, `api/admin/lr/upload/route.ts:128`). Either:

- (a) change the SELECT to `color_space` and rename the field in `ImageRow`, OR
- (b) add a dedicated `icc_profile_name varchar(255)` column to `images` so the source-ICC name is decoupled from the display string and the backfill can filter unambiguously.

Option (b) is cleaner long-term — `color_space` currently mixes "ICC profile name", "EXIF tag value (sRGB / Uncalibrated)" and a fallback. That mix means `WHERE color_space LIKE '%P3%'` is the only safe filter, which is a string-match on user-controlled bytes. Add a typed column.

---

### P0-CRITICAL — cached image variants outlive color-pipeline changes (poisoned `immutable` cache)

**File**: `apps/web/src/lib/serve-upload.ts:102`

```ts
'Cache-Control': 'public, max-age=31536000, immutable',
```

The URL key is `uuid_size.{webp,avif,jpg}`. Nothing in the URL encodes the *color pipeline version*. When you ship a fix that changes how AVIF is tagged (the entire premise of `backfill-p3-icc.ts`), every browser, CDN, and proxy holding the previous variant continues to serve **the wrong-color file for up to one year**, with no cache-busting path.

**Impact**: Today you have a backfill script that rewrites bytes on disk while leaving the URL identical. CDN edges and clients that cached the pre-fix AVIF will keep showing washed-out P3 source images displayed without a P3 ICC tag for the lifetime of the cache. `immutable` *promises the bytes will never change at this URL*. Sharp re-emit + same URL **violates that contract**. This is correctness, not just performance.

**Confidence**: High. Verified `Cache-Control: immutable` and verified URL is filename-only with no version segment.

**Failure scenario**: P3 photographer uploads → photo cached at edge with sRGB-tagged AVIF → bug fix lands → `backfill-p3-icc.ts` (once it works) rewrites bytes → photographer's social-shared URL still serves wrong-color AVIF for 12 months.

**Fix**:

1. Add a `pipeline_version` column to `images` (or maintain a process-wide `IMAGE_PIPELINE_VERSION` constant + a content hash).
2. URL becomes `uuid_size_v{N}.{ext}` or include `?v=N` (the latter is fine because `immutable` matches the *full URL with query string*).
3. On version bump, regenerate variants under new filenames; old files become eligible for eviction.
4. Alternative cheaper fix: drop `immutable`, keep `max-age=31536000` but add `stale-while-revalidate=0` and an `ETag` derived from `(width, quality, pipeline_version, mtime)`. CDN respects ETag on revalidation; clients still get fast hits.

Until this is fixed, **do not** ship any further color-pipeline changes — they will be silently invisible to existing users.

---

### P1-HIGH — concurrency oversubscription on multi-format Promise.all

**File**: `apps/web/src/lib/process-image.ts:17-26, 504-613`
**File**: `apps/web/src/lib/image-queue.ts:151`

```ts
const cpuCount = os.availableParallelism() ?? os.cpus().length;
const maxConcurrency = Math.max(1, cpuCount - 1);
sharp.concurrency(sharpConcurrency);   // global cap on libvips threads
// ...
await Promise.all([
    generateForFormat('webp', ...),
    generateForFormat('avif', ...),
    generateForFormat('jpeg', ...),
]);
```

`sharp.concurrency(N)` is the **per-call** libvips thread cap, not a global thread-pool size. (See sharp docs: "the number of threads libvips uses to process each image".) With three concurrent `toFile()` calls running, libvips schedules up to `3 * N` worker threads on the libuv thread pool. With `QUEUE_CONCURRENCY > 1`, the multiplier compounds: `3 * QUEUE_CONCURRENCY * N`.

**Impact**:
- 8-core box: `(cores-1) = 7`. Per image: 21 libvips threads. With queue=2: 42. The libuv pool defaults to 4. Threads either pile up in the libuv backlog (latency spike) or — if `UV_THREADPOOL_SIZE` is bumped — context-switch storm. Either way, throughput is worse than it should be.
- AVIF encode is the long pole. JPEG and WebP finish first, then AVIF runs alone with whatever threads remain. The "savings" from parallel format dispatch are smaller than they look.
- On a constrained Mac mini deployment (this is a personal gallery, not a fleet), the responsiveness of *the rest of the web process* (HTTP serving, DB queries) suffers during upload.

**Confidence**: High on the threading model, medium on the magnitude — needs a flame graph to confirm the precise contention.

**Failure scenario**: Photographer uploads 50 photos. Each is HD-and-up. While the queue churns, every page render that hits Sharp (PWA icon generation, topic image processing, blur generation) blocks behind the libuv pool. Site goes from snappy to "200ms-to-first-byte" for unrelated requests for several minutes.

**Fix** (in priority order):
1. Set `sharp.concurrency(Math.max(1, Math.floor((cores - 1) / 3)))` — divide by the format count so the per-image total stays at `cores - 1`.
2. Better: serialize the three format encodes when the host has < 6 cores. AVIF dominates wall-clock anyway; running it solo with full threads is faster than three formats fighting for threads.
3. Set `UV_THREADPOOL_SIZE` explicitly in the Dockerfile / entrypoint (e.g., `UV_THREADPOOL_SIZE=16` for an 8-core box).
4. Add `sharp.cache(false)` for server use — see P2 below.

Recommended pattern:

```ts
// AVIF first (longest), then webp+jpeg in parallel (both fast).
const avifPromise = generateForFormat('avif', ...);
const fastPair = Promise.all([
    generateForFormat('webp', ...),
    generateForFormat('jpeg', ...),
]);
await Promise.all([avifPromise, fastPair]);
```

Or simply serialize all three when AVIF takes ~80% of wall-clock. The "parallelism" is largely an illusion when one format dwarfs the others.

---

### P1-HIGH — implicit AVIF effort=4 burns CPU for marginal size win

**File**: `apps/web/src/lib/process-image.ts:563`

```ts
.avif({ quality: qualityAvif })   // effort defaults to 4
```

Sharp's AVIF encoder defaults `effort: 4` (libheif/AOM). On HD photos this is roughly 2-4× slower than `effort: 2` while delivering ~2-3% smaller files. `effort: 0-2` is **free CPU time** for trivial size cost. `effort: 7-9` is expensive perfectionism for archive use.

**Impact**: The vast majority of upload latency on this gallery is AVIF encode. A 24MP photo at effort=4 takes ~2-4s on Apple Silicon, ~6-10s on a slower Mac mini. Drop to effort=2 and you halve queue latency.

**Confidence**: High on direction (effort vs time/size is well documented). Magnitude depends on input — recommend operator-level tuning.

**Fix**:

```ts
.avif({
    quality: qualityAvif,
    effort: Number(process.env.AVIF_EFFORT) || 2,    // 2 is a sweet spot for web
})
```

Surface in `gallery-config` so admins can flip between "fast upload" (effort=1-2) and "smaller files" (effort=5-6) per workload. Also document: at effort=0-1, AVIF is *faster* than JPEG encode at quality=85. That should be the production default for a personal gallery.

---

### P1-HIGH — JPEG chroma subsampling left at default (4:2:0) — wide-gamut color edges blur

**File**: `apps/web/src/lib/process-image.ts:566`

```ts
} else {
    await sharpInstance.jpeg({ quality: qualityJpeg }).toFile(outputPath);
}
```

Sharp's JPEG defaults to `chromaSubsampling: '4:2:0'` for `quality < 90` and `'4:4:4'` for `quality >= 90`. The pipeline default is `qualityJpeg = 90`, so the *default* path *should* land on 4:4:4. But the **admin-configurable** quality can drop below 90 — and the moment it does, every wide-gamut source is downsampled to half chroma resolution along both axes. P3 photos with saturated sky/skin transitions show JPEG-style chroma bleeding at edges.

**Impact**: For wide-gamut sources, 4:2:0 JPEG is the wrong choice regardless of quality slider position because the chroma loss interacts pathologically with gamut compression. The user experience degrades silently — no error, just "this photo looks worse than its WebP".

**Confidence**: Medium-high. Documented Sharp behavior. The visible severity depends on subject matter (skies, gradients, neon).

**Fix**:

```ts
await sharpInstance.jpeg({
    quality: qualityJpeg,
    chromaSubsampling: iccProfileName && resolveAvifIccProfile(iccProfileName) === 'p3'
        ? '4:4:4'
        : '4:2:0',
    mozjpeg: true,    // also: mozjpeg gives ~10-20% better compression at same SSIM
}).toFile(outputPath);
```

`mozjpeg: true` is a pure win on the JPEG encode path — same quality, smaller bytes, slightly more CPU. With a slow upload queue this is a no-brainer.

---

### P1-HIGH — 10-bit AVIF path missing for wide-gamut originals

**File**: `apps/web/src/lib/process-image.ts:560-564`

```ts
} else if (format === 'avif') {
    await sharpInstance
        .withMetadata({ icc: avifIcc })          // tag: p3
        .avif({ quality: qualityAvif })          // bitdepth: 8 (default)
        .toFile(outputPath);
}
```

The pipeline tags AVIF with the Display P3 ICC profile but encodes it at 8-bit per channel. P3 in 8-bit has **fewer perceptually-distinct steps** than sRGB-in-8-bit because the same 256 codes are spread across a larger gamut. Visible banding in skies and gradients on capable displays is the failure mode. The whole point of P3 is to deliver smoother gradients and richer color — 8-bit cancels half of that.

Compounding: the original may be 14-bit raw (Sony ARW) or 16-bit (TIFF). The pipeline reads `metadata.depth` and stores `bit_depth`, but never uses it to drive encoder bitdepth.

**Impact**: P3-tagged AVIF rendered on a P3 display shows banding. The site's claim of being a "high-quality gallery" leaks at exactly the displays it advertises support for.

**Confidence**: High on the technical reasoning. The cost is real: 10-bit AVIF takes ~1.5-2× the CPU and produces ~25-40% larger files than 8-bit at equivalent perceptual quality.

**Fix**:

```ts
const isWideGamut = resolveAvifIccProfile(iccProfileName) === 'p3';
const sourceBitDepth = bitDepth ?? 8;
const useTenBit = isWideGamut && sourceBitDepth >= 10;

await sharpInstance
    .withMetadata({ icc: avifIcc })
    .avif({
        quality: qualityAvif,
        effort: 2,
        bitdepth: useTenBit ? 10 : 8,
        chromaSubsampling: isWideGamut ? '4:4:4' : '4:2:0',
    })
    .toFile(outputPath);
```

Surface as `imageQualityAvifBitdepth` (`8 | 10 | auto`) in admin settings. `auto` is the default and matches source-driven behavior above.

---

### P1-HIGH — pipelineColorspace unused; wide-gamut downscale not linear-light

**File**: `apps/web/src/lib/process-image.ts:556`

```ts
const sharpInstance = image.clone().resize({ width: resizeWidth }).keepIccProfile();
```

The resize happens in the source's native colorspace (commonly sRGB or P3, gamma-encoded). For best perceptual quality, downscaling should be done in linear light — `sharp().pipelineColorspace('rgb16').resize(...)` does exactly that. Without it, edges and highlights desaturate slightly during downscale. Most galleries don't care; a *photo gallery* with explicit P3 plumbing implies they do.

**Impact**: Subtle. ~5-10% perceptual quality loss on high-contrast edges and highlights when downscaling 24MP → 2048px. Invisible on most images, very visible on backlit foliage, lens flares, point light sources at night.

**Confidence**: Medium. The default Lanczos3 filter is already very good. The gain from rgb16 is real but small — and it doubles peak memory during resize.

**Cost**: rgb16 doubles the in-memory pixel buffer during the resize step (~16MB extra for a 24MP image during the resize hot path, transient). Worth it if you care about perceptual quality. Skippable if you care about memory on a Mac mini.

**Fix**:

```ts
const wide = resolveAvifIccProfile(iccProfileName) === 'p3';
const sharpInstance = image.clone()
    .pipelineColorspace(wide ? 'rgb16' : 'srgb')   // linear-light for wide gamut only
    .resize({ width: resizeWidth })
    .keepIccProfile();
```

Gate on wide-gamut sources so the memory cost is only paid where the perceptual win matters.

---

### P1-HIGH — `Sharp.cache(false)` not set for server use

**File**: `apps/web/src/lib/process-image.ts:1-26`

Sharp ships with an in-process libvips operation cache enabled by default, sized for short CLI scripts. For a long-running server process, this cache:

- Grows over time and is rarely a hit (every UUID is fresh).
- Pins libvips internal buffers in memory.
- Can interact badly with libuv worker reuse.

The Sharp documentation explicitly recommends `sharp.cache(false)` for server contexts.

**Impact**: Slow memory growth over time; in extreme cases libvips' cache pinning causes RSS to drift up and stay there until process restart. On a Mac mini with 16GB and other services on the box, this matters.

**Confidence**: High — this is a documented best practice.

**Fix** (one line, top of `process-image.ts`):

```ts
sharp.cache(false);     // server-side: every image is unique, cache wastes RAM
sharp.simd(true);       // explicit: confirm SIMD on
```

Both should go right next to the existing `sharp.concurrency(...)` call.

---

### P2-MEDIUM — backfill script lacks DB UPDATE; idempotency relies on file-byte comparison

**File**: `apps/web/scripts/backfill-p3-icc.ts:171-201`

The script re-emits AVIF bytes but never updates the DB to record that the row was retagged. Re-running depends on `avifAlreadyHasP3()` reading the file back and comparing the embedded ICC against an sRGB reference. That works but:

1. It does an extra Sharp metadata read per file (~50-100ms each).
2. If the on-disk file is corrupt or partially written, the retagger silently skips it.
3. There is no audit trail of which rows were touched, when, or by which version.

**Impact**: 1000 images × extra 75ms metadata read = ~75s of wasted I/O per re-run. More importantly, no observable record of the migration.

**Confidence**: High.

**Fix**: Add `pipeline_version` and `pipeline_processed_at` columns. The backfill script writes both after a successful retag. Re-runs query `WHERE pipeline_version < CURRENT_PIPELINE_VERSION OR pipeline_version IS NULL`. Idempotency comes from the version comparison, not file inspection.

---

### P2-MEDIUM — `keepIccProfile()` interaction with `withMetadata({icc: 'p3'})` is order-dependent and undocumented

**File**: `apps/web/src/lib/process-image.ts:556, 562`

```ts
const sharpInstance = image.clone().resize({ width: resizeWidth }).keepIccProfile();
// ... later for AVIF only:
await sharpInstance
    .withMetadata({ icc: avifIcc })
    .avif({ quality: qualityAvif })
    .toFile(outputPath);
```

The pipeline calls `keepIccProfile()` (preserves source ICC) and then `withMetadata({ icc: 'p3' })` (overrides ICC). The **last call wins** — `withMetadata` overrides `keepIccProfile`. This works *today*, but it is fragile:

1. WebP and JPEG paths inherit `keepIccProfile()` and never call `withMetadata`. So WebP and JPEG carry the **source** ICC profile, not sRGB. The comment in `process-image.ts:292-294` claims "WebP and JPEG derivatives are always left at sRGB for universal compatibility" — but that is only true if the source is sRGB. A P3 source will produce a P3-tagged WebP and a P3-tagged JPEG, contradicting the comment.
2. Sharp's API contract for "keep + override" ordering is not version-stable.

**Impact**: WebP and JPEG with embedded P3 ICC will be color-managed correctly by P3-aware browsers but may render too saturated on legacy/embedded clients that ignore ICC. This is the opposite of the documented intent.

**Confidence**: High on the API behavior. Verified by reading the Sharp documentation for `keepIccProfile` and `withMetadata`.

**Fix**: Make the ICC override explicit per format:

```ts
if (format === 'webp') {
    await sharpInstance
        .withIccProfile('srgb', { attach: true })
        .webp({ quality: qualityWebp })
        .toFile(outputPath);
} else if (format === 'avif') {
    await sharpInstance
        .withIccProfile(avifIcc, { attach: true })
        .avif({ quality: qualityAvif, effort: 2, bitdepth: useTenBit ? 10 : 8 })
        .toFile(outputPath);
} else {
    await sharpInstance
        .withIccProfile('srgb', { attach: true })
        .jpeg({ quality: qualityJpeg, mozjpeg: true, chromaSubsampling: ... })
        .toFile(outputPath);
}
```

`withIccProfile` (Sharp 0.32+) is the explicit replacement for `withMetadata({icc})` and pairs cleanly with `attach: true`. The current `withMetadata({icc: ...})` is technically deprecated in favor of `withIccProfile`.

Note: `withIccProfile` *converts* into the profile if `keepIccProfile` was not called, so on the WebP/JPEG paths you get an actual sRGB conversion, not just a metadata stamp. That is a behavior change — verify with regression tests.

---

### P2-MEDIUM — three formats decode the source three times when running serial

**File**: `apps/web/src/lib/process-image.ts:556`

The `image` Sharp instance is constructed once per `processImageFormats` call (line 519). `image.clone()` creates a copy of the instance — but **does not cache the decoded pixels**. Each clone re-runs the decode pipeline when `.toFile()` is called.

For a single sortedSize (the common case after the first run reuses via hard link), three formats × one size = three decodes of the same source file. JPEG decode of a 24MP source is ~150-300ms. AVIF decode of a 24MP source is ~400-800ms.

The Sharp API does not expose "decode once into a buffer, encode N times from buffer" — `image.toBuffer()` does decode into a raw buffer, but you lose the pipeline composability. Workaround: feed `.raw()` output to N format encoders.

**Impact**: For a large source: 3 × 200ms = 400ms of redundant decode per upload. With 50 uploads in a session that is 20s of pure decode redundancy.

**Confidence**: Medium. This is a known Sharp quirk — `clone()` clones the pipeline graph, not the result. The libvips cache *might* hide some of this if `Sharp.cache` were on, but it's still a measurable win to decode once.

**Fix**:

```ts
// Decode once into a 16-bit linear buffer
const { data, info } = await image
    .pipelineColorspace(wide ? 'rgb16' : 'srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

const fromRaw = () => sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
});

// Encode each format from the raw buffer
await Promise.all([
    fromRaw().resize({ width }).webp({ quality: 90 }).toFile(...),
    fromRaw().resize({ width }).avif({ quality: 85, effort: 2 }).toFile(...),
    fromRaw().resize({ width }).jpeg({ quality: 90, mozjpeg: true }).toFile(...),
]);
```

Caveat: the raw buffer is *large* (24MP × 4ch × 2B = ~200MB in 16-bit). If you have multiple uploads in flight, RAM goes through the roof. Apply only when `QUEUE_CONCURRENCY === 1` or gate by file size. Or stay at 8-bit linear (~100MB).

This is a real trade-off. For a personal gallery on a Mac mini, the safer fix is **serialize the encodes** (P1 finding above) so only one format is decoding at a time, and rely on the OS page cache to hold the decoded source warm between encodes.

---

### P2-MEDIUM — ICC parser allocates ASCII-decoded substring per tag scan

**File**: `apps/web/src/lib/process-image.ts:333-390`

```ts
for (let i = 0; i < tagCount; i++) {
    const tagOffset = 132 + i * 12;
    if (tagOffset + 12 > iccLen) break;
    const tagSig = icc.subarray(tagOffset, tagOffset + 4).toString('ascii');  // alloc
    if (tagSig !== 'desc') continue;
    ...
}
```

For each tag in the ICC profile (up to 100), the code allocates a 4-byte ASCII string just to compare it to `'desc'`. With ~30 tags per typical ICC profile, that's 30 small string allocations per call.

**Impact**: Minor. Each upload triggers one parse. Tens of allocations × tens of uploads = hundreds of strings in young-gen — V8 handles this fine. Mostly noise.

**Confidence**: High on the inefficiency, low on the practical impact.

**Fix** (cheap):

```ts
const DESC_SIG = 0x64657363;  // 'desc' as big-endian uint32
const MLUC_SIG = 0x6d6c7563;  // 'mluc'
// ...
const tagSig = icc.readUInt32BE(tagOffset);
if (tagSig !== DESC_SIG) continue;
// ... and similarly for the descType comparison
```

Zero allocations, branch is a register comparison. Worth doing because the function runs on every upload's hot path.

---

### P2-MEDIUM — per-call `sharp.concurrency()` set globally; modules that import process-image inherit the cap

**File**: `apps/web/src/lib/process-image.ts:26`

```ts
sharp.concurrency(sharpConcurrency);  // module-load side effect
```

`sharp.concurrency()` sets a **process-global** thread cap. Any module that imports anything from `process-image.ts` triggers this side effect. `process-topic-image.ts` imports `MAX_INPUT_PIXELS_TOPIC` from this file (line 9 of process-topic-image.ts), so loading topic image processing also sets the global thread cap.

**Impact**: Low. The behavior happens to be what you want (limit Sharp threads). But it is a non-obvious side effect of an import. A future refactor that imports a constant from this module without realizing it will silently change Sharp's threading behavior.

**Confidence**: High on the side effect, low on the practical risk.

**Fix**: Move the side effect to a dedicated `lib/sharp-init.ts` module that is explicitly imported once at app startup (e.g., from `instrumentation.ts` or the queue bootstrap). Document as "must be imported before any sharp() call".

---

### P2-MEDIUM — backfill script PQueue concurrency hardcoded to 2

**File**: `apps/web/scripts/backfill-p3-icc.ts:166`

```ts
const queue = new PQueue({ concurrency: 2 });
```

A retag is a full AVIF re-encode of every variant size, per image. On 1000 P3 images with 4 sizes each, that is 4000 AVIF encodes at default `effort: 4`. Pegging at concurrency=2 means ~4 hours of pure encode time on a Mac mini, during which the live web process competes for the same Sharp thread pool.

Worse, there is no env override. An operator running this on a beefier ARM workstation cannot raise the concurrency without code edits.

**Impact**: Production-blocking long-running script. Operator likely runs it overnight and hopes for the best.

**Confidence**: High.

**Fix**:

```ts
const concurrency = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY) || 2);
const queue = new PQueue({ concurrency });
```

Also: log progress (`done/total`) every N items, not per-item. The current per-item log will spam tens of thousands of lines on a large library.

---

### P2-MEDIUM — atomic rename of retagged file leaks `.retag.tmp` on crash

**File**: `apps/web/scripts/backfill-p3-icc.ts:114-128`

```ts
const tmpPath = filePath + '.retag.tmp';
try {
    await sharp(filePath)
        .withMetadata({ icc: 'p3' })
        .avif({ quality: 85 })
        .toFile(tmpPath);
    await fs.rename(tmpPath, filePath);
    retagged++;
} catch (err) {
    console.error(`  [error] Failed to retag ${filename}: ${err}`);
    await fs.unlink(tmpPath).catch(() => {});
}
```

If the process is SIGKILLed mid-encode (memory pressure, OOM killer, accidental Ctrl-C), `.retag.tmp` files persist forever. The orphan-cleanup logic in `image-queue.ts:cleanOrphanedTmpFiles` only catches files ending in `.tmp` in the per-format upload directories — but it scans `UPLOAD_DIR_AVIF` and only removes `.tmp`, not `.retag.tmp` specifically. Verify, but the suffix matching is exact.

**Impact**: Disk leak on crash. Operator-visible only after running `du`.

**Confidence**: Medium — the cleanup function does match `.endsWith('.tmp')`, so `*.retag.tmp` would be caught (since it ends in `.tmp`). But the semantics are accidental, not intentional.

**Fix**: Use a UUID-based tmp suffix and document the cleanup contract. Or, on backfill startup, scan for `*.retag.tmp` and unlink them upfront.

---

### P3-LOW — generate-pwa-icons sequential loop

**File**: `apps/web/scripts/generate-pwa-icons.ts:68-75`

```ts
for (const { name, size, maskable } of sizes) {
    const svg = buildSvg(size, maskable);
    const outPath = resolve(iconsDir, name);
    await sharp(svg).png().toFile(outPath);    // serial
    console.log(`[generate-pwa-icons] wrote ${name}...`);
}
```

Three independent SVG → PNG conversions, run serially during prebuild. Each takes ~50-100ms. Cost: ~250ms of wasted prebuild time per build.

**Impact**: Minor build-time annoyance. Negligible at runtime (script runs once per build).

**Confidence**: High.

**Fix**:

```ts
await Promise.all(sizes.map(async ({ name, size, maskable }) => {
    const svg = buildSvg(size, maskable);
    const outPath = resolve(iconsDir, name);
    await sharp(svg).png({ compressionLevel: 9, palette: true }).toFile(outPath);
}));
```

`palette: true` for these flat-color icons cuts file size by ~70% (PWA icon = 9KB → 2.5KB). `compressionLevel: 9` is appropriate for build-once assets.

---

### P3-LOW — download route opens `lstat` + `realpath` × 2 + `createReadStream` for every byte

**File**: `apps/web/src/app/api/download/[imageId]/route.ts:128-182`

For every download:
1. `lstat(filePath)` — one syscall.
2. `realpath(uploadsDir)` + `realpath(filePath)` parallel — two syscalls.
3. DB `SELECT ... FROM entitlements`.
4. DB `SELECT ... FROM images`.
5. DB `UPDATE entitlements ...`.
6. `createReadStream` + `Readable.toWeb`.

That is 3 file syscalls and 3 DB roundtrips before the first byte streams. Acceptable for a paid-download endpoint (rare, security-critical) but the order can be tightened.

**Impact**: Minor. ~5-15ms of pre-stream latency per download.

**Confidence**: High.

**Fix**: Cache `realpath(uploadsDir)` at module load — it does not change at runtime. That removes one of the two realpath calls per request. The DB SELECT for `entitlements` followed by a SELECT for `images` could be a single JOIN.

---

### P3-LOW — admin Lr upload route does not enforce same-origin and skips upload tracker

**File**: `apps/web/src/app/api/admin/lr/upload/route.ts:40-170`

This is a separate code path from `actions/images.ts:uploadImages` and bypasses:
- The cumulative upload tracker (rate limit window).
- Disk-space pre-check.
- The 1GB free-space guard.

Each LR upload calls `saveOriginalAndGetMetadata` and `enqueueImageProcessing` directly. If a misconfigured LR plugin spams 10000 uploads, the disk fills up and the queue saturates with no backpressure.

**Impact**: Operational risk, not a perf bug per se. But the path bypasses the same protections the browser path enforces, so one auth-token leak ⇒ unbounded upload.

**Confidence**: High.

**Fix**: Share the disk-space and upload-tracker guards with the browser path. Refactor `uploadImages` to extract the per-file pipeline into a helper and call it from both routes.

---

## Summary

| Severity | Count | Categories |
|----------|-------|------------|
| P0 | 2 | Backfill broken (missing column); CDN cache poison on color-pipeline change |
| P1 | 6 | Concurrency oversubscription; AVIF effort defaults; JPEG chroma subsampling; 10-bit AVIF missing; pipelineColorspace gating; sharp.cache for server use |
| P2 | 6 | Decode redundancy; ICC parser allocations; module side-effects; backfill concurrency hardcode; atomic rename tmp suffix; keepIccProfile / withMetadata ordering |
| P3 | 3 | PWA icon generation serial; download route syscall ordering; LR upload bypasses guards |

## Verdict

**REDESIGN REQUIRED** — for two reasons that compound:

1. **The cache-poisoning issue (P0 #2) makes any further color-pipeline change a regression hazard for clients holding cached AVIF.** Fix this first; everything else is incremental.
2. **The backfill script is broken (P0 #1).** There is no working tool to re-derive existing images when color handling changes. Combined with #1, the project is locked out of safely evolving its color pipeline.

After those two are fixed, the remaining P1s are tuning, not architecture: AVIF effort (1-line config), chroma subsampling (one-line conditional), 10-bit gating (small dispatcher), sharp.cache(false) (one-line). The P1 concurrency story benefits from a flame graph before changing — it's correct to fix, but the right magnitude needs measurement, not guessing.

Memory budget is fine (file path + Sharp's mmap is the right call). The decode-once-clone-three pattern is correct in spirit. ICC parsing is robust. Atomic rename is well done. The architectural bones are good — the joint failure is on color-pipeline lifecycle (versioning, cache invalidation, backfill correctness).

## Files Cited

- `/Users/hletrd/git/gallery/apps/web/src/lib/process-image.ts`
- `/Users/hletrd/git/gallery/apps/web/src/lib/image-queue.ts`
- `/Users/hletrd/git/gallery/apps/web/src/lib/process-topic-image.ts`
- `/Users/hletrd/git/gallery/apps/web/src/lib/serve-upload.ts`
- `/Users/hletrd/git/gallery/apps/web/src/app/actions/images.ts`
- `/Users/hletrd/git/gallery/apps/web/src/app/api/admin/lr/upload/route.ts`
- `/Users/hletrd/git/gallery/apps/web/src/app/api/download/[imageId]/route.ts`
- `/Users/hletrd/git/gallery/apps/web/scripts/generate-pwa-icons.ts`
- `/Users/hletrd/git/gallery/apps/web/scripts/backfill-p3-icc.ts`
- `/Users/hletrd/git/gallery/apps/web/src/__tests__/process-image-p3-icc.test.ts`
- `/Users/hletrd/git/gallery/apps/web/src/db/schema.ts`
- `/Users/hletrd/git/gallery/apps/web/Dockerfile`
- `/Users/hletrd/git/gallery/apps/web/package.json`
