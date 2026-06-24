# Tracer Review — GalleryKit Repository

## Review Date: 2026-06-25
## Scope: Full causal flow tracing across 12 critical flows
## Methodology: Manual code inspection, trace data from entry to exit, competing hypotheses for failure modes

---

## 1. Source File Inventory

### Core Server Actions (app/actions/)
| File | Lines | Critical Flows |
|------|-------|----------------|
| images.ts | 1084 | Upload, delete, metadata update, retry |
| auth.ts | 445 | Login, session, password change |
| sharing.ts | 382 | Photo/group share creation/revocation |
| settings.ts | 167 | Admin settings update |
| admin-backfill.ts | 131 | Backfill trigger/status |
| public.ts | 200+ | Load more, search |
| topics.ts | ~200 | Topic CRUD |
| tags.ts | ~150 | Tag CRUD |
| admin-users.ts | ~200 | Admin user management |
| collections.ts | ~150 | Smart collections |
| embeddings.ts | ~100 | CLIP embedding management |
| seo.ts | ~100 | SEO settings |
| lr-tokens.ts | ~150 | Lightroom tokens |

### Core Libraries (lib/)
| File | Lines | Critical Flows |
|------|-------|----------------|
| process-image.ts | 1659 | Image encoding pipeline |
| image-queue.ts | 822 | Background processing queue |
| data.ts | 1666 | Data access layer |
| color-detection.ts | 423 | Color signal detection |
| gallery-config.ts | 211 | Config resolution |
| settings-hash.ts | 178 | ETag hash computation |
| serve-upload.ts | 310 | File serving |
| rate-limit.ts | 450 | Rate limiting |
| admin-backfill-runner.ts | 875 | In-app backfill runner |
| session.ts | 152 | Session management |
| proxy.ts | 142 | Middleware/auth routing |
| gps-exif-strip.ts | 200+ | GPS metadata removal |
| icc-chromaticity.ts | 200+ | ICC gamut detection |
| icc-extractor.ts | ~150 | ICC name extraction |
| gain-map-detection.ts | ~100 | Apple HDR gain map |
| color-primaries.ts | ~50 | Wide gamut predicates |
| color-pipeline-decisions.ts | ~50 | Pipeline decision enum |
| use-display-capability.ts | ~100 | Display gamut detection |
| blur-data-url.ts | ~80 | Blur placeholder validation |
| og-sanitize.ts | ~80 | OG text sanitization |
| csv-escape.ts | ~80 | CSV export security |
| request-origin.ts | 108 | Same-origin validation |
| action-guards.ts | 45 | Same-origin admin guard |
| audit.ts | 79 | Audit logging |
| restore-maintenance.ts | 57 | Restore maintenance flag |
| advisory-locks.ts | 45 | Lock name registry |
| upload-paths.ts | 104 | Upload directory paths |
| bounded-map.ts | 143 | Rate-limit data structure |
| db-restore.ts | 35 | Restore validation |
| password-hashing.ts | ~50 | Argon2 wrapper |
| auth-rate-limit.ts | ~100 | Auth-specific rate limiting |
| revalidation.ts | ~50 | Cache revalidation |
| validation.ts | ~200 | Input validation |
| sanitize.ts | ~100 | String sanitization |
| safe-json-ld.ts | ~50 | JSON-LD safety |
| sw-cache.ts | ~100 | SW cache reference |
| clip-*.ts | ~400 | CLIP semantic search |
| smart-collections.ts | ~200 | Smart collection queries |
| analytics.ts | ~100 | Analytics data |
| analytics-data.ts | ~100 | Analytics aggregation |
| atom-feed.ts | ~100 | Atom feed generation |
| download-filename.ts | ~50 | Download filename |
| error-shell.ts | ~50 | Error UI |
| exif-datetime.ts | ~50 | EXIF date parsing |
| feed-conditional.ts | ~50 | Feed conditional |
| hdr-filenames.ts | ~50 | HDR filename derivation |
| image-types.ts | ~50 | Image type definitions |
| image-url.ts | ~50 | Image URL helpers |
| image-zoom-math.ts | ~50 | Zoom math |
| locale-path.ts | ~50 | Locale path handling |
| mysql-cli-ssl.ts | ~50 | MySQL SSL |
| mysql-datetime.ts | ~50 | MySQL datetime |
| og-photo-fetch.ts | ~50 | OG photo fetch |
| photo-title.ts | ~50 | Photo title |
| queue-shutdown.ts | ~50 | Queue shutdown |
| seo-og-url.ts | ~50 | SEO OG URL |
| storage/ | ~200 | Storage abstraction |
| tag-records.ts | ~50 | Tag records |
| tag-slugs.ts | ~50 | Tag slug handling |
| theme.ts | ~50 | Theme |
| upload-limits.ts | ~50 | Upload limits |
| upload-tracker-state.ts | ~50 | Upload tracker |
| upload-processing-contract-lock.ts | ~50 | Upload contract lock |
| view-retention.ts | ~50 | View retention GC |

### Database Layer (db/)
| File | Lines | Purpose |
|------|-------|---------|
| schema.ts | ~400 | Drizzle schema |
| index.ts | ~50 | Connection pool |

### API Routes (app/api/)
| Route | Purpose |
|-------|---------|
| api/og/route.tsx | OG image generation |
| api/og/photo/[id]/route.tsx | Per-photo OG |
| api/admin/db/download/route.ts | Backup download |
| api/search/semantic/route.ts | Semantic search |
| api/search/similar/[id]/route.ts | Similar photos |
| api/live/route.ts | Liveness probe |
| api/health/route.ts | Health probe |
| api/admin/lr/upload/route.ts | Lightroom upload |

### Components (components/)
| Component | Purpose |
|-----------|---------|
| photo-viewer.tsx | Photo viewer |
| image-manager.tsx | Admin image grid |
| upload-dropzone.tsx | Upload UI |
| search.tsx | Search UI |
| load-more.tsx | Load more |
| color-details-section.tsx | Color audit |
| lightbox-color-pip.tsx | Lightbox color |
| histogram.tsx | Histogram |
| wide-gamut-hint.tsx | Gamut hint |
| home-client.tsx | Home page |
| info-bottom-sheet.tsx | Mobile info |
| tag-input.tsx | Tag input |

---

## 2. Critical Flow Traces

### Flow 1: Image Upload → Background Processing → Public Serving

**Entry:** `uploadImages()` in `app/actions/images.ts:1-1084`
**Exit:** Browser receives processed image via `serve-upload.ts` or Next.js static file server

**Trace:**
1. **Auth check** (`isAdmin()`) + same-origin guard (`requireSameOriginAdmin()`)
2. **File validation**: type (JPEG/PNG/WebP/HEIC/AVIF/TIFF), size (<=200MB), cumulative quota (`UPLOAD_MAX_TOTAL_BYTES`)
3. **Disk space check** (`checkDiskSpace`)
4. **Upload contract lock**: If `image_sizes` or `strip_gps_on_upload` changed, acquires `gallerykit_upload_processing_contract` advisory lock
5. **Pre-increment upload tracker**: Prevents TOCTOU on cumulative quota
6. **Per-file loop**:
   - Save original to `UPLOAD_DIR_ORIGINAL` with UUID filename
   - Sharp metadata extraction (`limitInputPixels: 256M`)
   - **Color detection** (`detectColorSignals`): NCLX > ICC chromaticity > ICC name
   - **HDR rejection**: If `isHdr && !allowHdrIngest`, reject with localized error
   - **GPS stripping**: If `strip_gps_on_upload`, byte-level GPS neutralization (JPEG/TIFF/HEIF/WebP); fallback to metadata-free re-encode for PNG/anomalous files
   - **EXIF extraction**: Date, camera, lens, dimensions
   - **Blur placeholder**: 16px base64 data URL (capped at 4096 chars)
   - **DB insert**: `images` table with `processed=false`
   - **Tag processing**: Canonicalize slugs, `INSERT IGNORE`
   - **Enqueue**: `imageQueue.add()` for background processing
7. **Settle upload tracker**: Reconcile pre-claimed quota with actual results
8. **Background processing** (`image-queue.ts`):
   - Acquire `gallerykit:image-processing:{jobId}` advisory lock (non-blocking, 0s timeout)
   - Verify row still exists (was not deleted mid-queue)
   - `processImageFormats()`:
     - Per-format fresh Sharp instances (WI-14 cross-format isolation)
     - Parallel AVIF/WebP/JPEG encoding
     - Wide-gamut rgb16 pipeline for non-sRGB sources
     - 10-bit AVIF gated on `canUseHighBitdepthAvif()` Promise-singleton probe
     - Atomic rename via `.tmp` files
     - DCI-P3 Bradford D65 adaptation
     - Downscale if > `wide_gamut_max_source_pixels`
   - Verify outputs exist
   - Conditional UPDATE `processed=true` (affectedRows check for delete-during-processing)
   - Fire-and-forget: caption generation, CLIP embedding
9. **Serving**:
   - Next.js static server serves `public/uploads/{avif,webp,jpeg}/` (primary path)
   - Fallback: `serve-upload.ts` with ETag `W/"v{version}-{mtime}-{size}-{settingsHash}"`
   - Path traversal protection: `realpath` containment + symlink rejection + extension validation

**Competing Hypotheses for Failure Modes:**

| Hypothesis | Confidence | Evidence | Testability |
|------------|------------|----------|-------------|
| H1: Delete-during-processing race leaves orphaned files | **Medium** | `image-queue.ts` checks `affectedRows===0` and cleans up, BUT `deleteImage` does NOT hold the per-image processing lock, so a delete CAN interleave between encode completion and UPDATE. The cleanup uses `deleteImageVariants(dir, fn, [])` which scans the directory — but if the backfill runner also wrote variants, the scan might miss non-default-size variants. | Test: Concurrent delete + processing with timing-controlled delays |
| H2: GPS stripping fallback (PNG/anomalous) silently degrades quality | **Low** | The fallback path uses `autoOrient + keepIccProfile` with explicit high-quality settings, but it's still a re-encode. The comment says "never use Sharp `withMetadata()` for stripping" but the fallback path doesn't use `withMetadata()` — it uses explicit quality settings. | Test: Upload PNG with GPS, verify original quality preserved |
| H3: Upload tracker TOCTOU on cumulative quota | **Low** | Pre-increment happens before validation, but `settleUploadTrackerClaim` reconciles. However, if the process crashes between pre-increment and settlement, the tracker stays inflated. The tracker is in-memory (process-local), so a restart clears it. | Test: Crash injection between pre-increment and settlement |
| H4: 10-bit AVIF probe singleton may stale-lock on libheif failure | **Low** | `canUseHighBitdepthAvif()` is a Promise-singleton cached in module scope. If the first probe fails transiently (e.g., libheif not yet initialized), all subsequent uploads get 8-bit AVIF for the process lifetime. | Test: Inspect probe caching logic — it does cache the result, but the probe is a one-shot. A transient failure would permanently disable 10-bit. |
| H5: `savedOriginalFilename` tracking for cleanup on failure may miss files | **Medium** | The `savedOriginalFilename` Set tracks originals for cleanup, but if the upload action throws AFTER saving the original but BEFORE adding to the Set, the original is not cleaned up. The code adds to the Set immediately after `fs.writeFile`, so this window is tiny. | Test: Inject failure between `fs.writeFile` and `savedOriginalFilename.add()` |

---

### Flow 2: Authentication → Session → Admin Route Protection

**Entry:** `login()` in `app/actions/auth.ts`
**Exit:** Admin page render or redirect to login

**Trace:**
1. **Rate limit pre-increment**: IP bucket + account bucket (`acct:<sha256-prefix>`) BEFORE Argon2 verify
2. **Dummy hash timing equalization**: If user not found, still run Argon2 on a dummy hash to prevent timing enumeration
3. **Argon2 verify**: `memoryCost=65536` (64 MiB), `timeCost=3`, `parallelism=4`
4. **Rollback on success**: Clear attempt counters on successful login
5. **NO rollback on infrastructure error**: Security policy — attacker-triggered errors should not grant extra attempts
6. **Session creation**: HMAC-SHA256 token (`timestamp:random:signature`), 24h expiry
7. **DB insert**: `sessions` table with hashed token
8. **Cookie**: `admin_session` with `httpOnly`, `secure` (production), `sameSite: lax`, `path: /`
9. **Middleware** (`proxy.ts`):
   - Checks `admin_session` cookie presence for `/[locale]/admin/*` routes
   - Validates token format (length >= 100, 3 colon-separated parts)
   - Does NOT perform full cryptographic validation (defers to server actions)
   - Sets `x-gk-admin-render: 1` header when admin cookie present
10. **Server action auth** (`isAdmin()`):
    - Verifies session token cryptographically (HMAC + timingSafeEqual)
    - Checks token age <= 24h
    - Looks up hashed token in DB
    - Every mutating action independently calls `isAdmin()`

**Competing Hypotheses:**

| Hypothesis | Confidence | Evidence | Testability |
|------------|------------|----------|-------------|
| H1: Middleware format check is weak (length >= 100, 3 parts) | **Medium** | A token with 3 parts and length >= 100 passes middleware but fails `verifySessionToken`. This is defense-in-depth (middleware is coarse filter, server actions do full verify), but it means the middleware doesn't actually validate the session. | Test: Craft a 3-part, 100+ char string that fails HMAC verify — middleware passes, server action rejects |
| H2: Session secret fallback to DB in dev is a production risk | **Low** | `getSessionSecret()` prefers env var, falls back to DB `admin_settings` in dev. The `process.env.NODE_ENV !== 'production'` guard prevents this in production, but if `NODE_ENV` is misconfigured, the fallback activates. | Test: Verify env guard is present and correct — it is (`gallery-config.ts` checks `NODE_ENV`) |
| H3: `getCurrentUser()` cache() may return stale admin status | **Low** | `getCurrentUser` is wrapped in `cache()`, deduplicating within a single React server context. If an admin is deleted mid-request, the cached result is stale. But `isAdmin()` is called independently in each action, not relying on `getCurrentUser`. | Test: Delete admin mid-request, verify subsequent `isAdmin()` returns false |
| H4: Rate limit DB backup may drift from in-memory Map | **Medium** | Login rate limit uses in-memory Map as fast path with DB backup. On restart, the Map is empty but DB has counts. The `checkRateLimit` reads DB, but `incrementRateLimit` only writes DB. The in-memory Map is the primary check, so after restart, the first 5 attempts from any IP are un-limited until the DB is read. | Test: Restart process, verify rate limit behavior on first request |

---

### Flow 3: Color Signal Detection → Pipeline Decision → Derivative Encoding

**Entry:** `detectColorSignals()` in `lib/color-detection.ts`
**Exit:** Derivative files with correct color space encoding

**Trace:**
1. **ICC name extraction**: `extractIccProfileName()` from `metadata.icc` buffer
2. **Bit depth mapping**: Sharp `metadata.depth` string → numeric bits
3. **NCLX parsing** (HEIF/AVIF only):
   - Read 1MB header from file
   - Bounded ISOBMFF walker (max depth 5, max scan 1MB)
   - Extract CICP triplet from `colr` box with `colour_type='nclx'`
   - Gain map detection via `parseGainMapFromHeif()`
4. **ICC chromaticity** (if NCLX absent or primaries unknown):
   - `detectGamutFromIccChromaticity()`:
     - Parse ICC tag table (max 100 tags, 4KB)
     - Read `wtpt`, `rXYZ`, `gXYZ`, `bXYZ`
     - Apply `chad` matrix inverse if present (ICC v4 D50 PCS adaptation)
     - XYZ → xy chromaticity
     - Match against presets within ΔE ≤ 0.005 (high) or ≤ 0.015 (medium)
5. **ICC name heuristic**: String matching for "Display P3", "Adobe RGB", etc.
6. **Transfer function inference**: From ICC description + bit depth + NCLX
7. **Matrix coefficients**: From ICC name + NCLX
8. **HDR detection**: `transferFunction === 'pq' || transferFunction === 'hlg'`
9. **Pipeline decision** (`resolveColorPipelineDecision` in `process-image.ts`):
   - sRGB → `srgb`
   - Display P3 → `p3-from-displayp3` (P3 10-bit AVIF, P3 8-bit JPEG)
   - DCI-P3 → `p3-from-dcip3` (Bradford D65 adaptation)
   - Adobe RGB → `p3-from-adobergb` (rgb16 pipeline)
   - ProPhoto → `p3-from-prophoto` (rgb16, may clip cyan)
   - Rec.2020 → `p3-from-rec2020` (rgb16)
   - Unknown → `srgb-from-unknown`
10. **Encoding** (`processImageFormats`):
    - Per-format fresh Sharp instances
    - Wide-gamut: `pipelineColorspace('rgb16')` resize
    - DCI-P3: skip rgb16, keep source ICC for Bradford transform
    - `force_srgb_derivatives`: WebP/JPEG forced to sRGB, AVIF still gamut-preserved
    - 10-bit AVIF: gated on `canUseHighBitdepthAvif()` singleton probe

**Competing Hypotheses:**

| Hypothesis | Confidence | Evidence | Testability |
|------------|------------|----------|-------------|
| H1: NCLX code 2 ("Unspecified") + PQ-named ICC → false HDR rejection | **Low** | AGG-R8c3-01 documents this: NCLX code 2 leaves transfer unspecified, but ICC name says PQ → `transferFunction='pq'` → `isHdr=true` → rejection by default. This is CORRECT behavior (the file IS HDR), but it's a delivered-byte side effect. | Test: Upload HEIF with NCLX code-2 transfer + PQ-named ICC — verify rejection |
| H2: ICC chromaticity `chad` matrix inversion may fail for near-singular matrices | **Medium** | `invert3x3()` returns `null` when determinant is near-zero. The caller falls back to no-chad path (assumes native-illuminant). For profiles with near-singular chad matrices, this could misidentify the gamut. | Test: Craft ICC profile with near-singular chad matrix, verify detection |
| H3: `canUseHighBitdepthAvif()` singleton caches failure permanently | **Medium** | The probe is a module-scoped Promise. If it rejects once, the rejection is cached. All subsequent uploads get 8-bit AVIF. The probe tests libheif encoding capability — a transient failure (e.g., memory pressure) permanently disables 10-bit. | Test: Inspect probe implementation — it IS a cached Promise. No retry mechanism. |
| H4: ProPhoto → P3 conversion may clip cyan without warning | **Low** | Documented in code: "may clip cyan". The admin sees the `color_pipeline_decision` in the audit panel, but there's no explicit "clipping occurred" warning. | Test: Upload ProPhoto image with saturated cyan, verify P3 output |
| H5: `wide_gamut_max_source_pixels` downscale may alter aspect ratio unexpectedly | **Low** | Downscale uses Sharp `resize({ width: Math.round(...) })` without explicit height. For very wide or tall images, this may produce unexpected dimensions. But the `withoutEnlargement: true` and `fit: 'inside'` should preserve aspect ratio. | Test: Upload 100MP panoramic image, verify output dimensions |

---

### Flow 4: Admin Settings Change → ETag Invalidation → Cache Behavior

**Entry:** `updateGallerySettings()` in `app/actions/settings.ts`
**Exit:** Browser revalidates cached derivatives

**Trace:**
1. **Auth + same-origin check**
2. **Validation**: All keys in `GALLERY_SETTING_KEYS`, values pass `isValidSettingValue()`
3. **Upload contract lock**: If `image_sizes` or `strip_gps_on_upload` changing, acquire advisory lock + check no active uploads
4. **Image sizes change**: If images exist, reject (prevent derivative size mismatch)
5. **Strip GPS change**: If images exist, reject (prevent inconsistent GPS stripping)
6. **Transaction upsert**: `INSERT ... ON DUPLICATE KEY UPDATE`
7. **Revalidate**: `revalidateAllAppData()` — purges Next.js cache
8. **ETag computation** (`settings-hash.ts`):
   - 9 color/quality/size-impacting keys: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`
   - 8-char SHA-256 prefix over sorted key=value pairs
   - 5-second debounced cache with inflight deduplication
   - `buildHashFromConfig()` uses resolved values (not raw DB strings)
9. **Serving ETag** (`serve-upload.ts`):
   - `W/"v{IMAGE_PIPELINE_VERSION}-{mtimeMs}-{size}-{settingsHash}"`
   - 304 conditional GET, HEAD optimization
   - **Operational gotcha**: Settings-hash ETag only affects `serve-upload.ts` path. Next.js static server uses `W/"{size}-{mtime}"` — flipping a setting does NOT invalidate static-served derivatives until backfill re-encodes them.

**Competing Hypotheses:**

| Hypothesis | Confidence | Evidence | Testability |
|------------|------------|----------|-------------|
| H1: Static path ETag miss after settings change without backfill | **High** | Documented in CLAUDE.md as "CRT-D1: Operational gotcha". The static path serves the overwhelming majority of traffic. An admin who changes `force_srgb_derivatives` without running backfill will see new bytes on `serve-upload.ts` fallback only. | Test: Change setting, verify ETag on static vs fallback paths |
| H2: `buildHashFromConfig` may misalign with actual encoder settings | **Low** | The hash uses `GalleryConfig` resolved values, but the encoder (`processImageFormats`) may use additional runtime settings not in `COLOR_IMPACTING_KEYS`. The compile-time guard `_ColorKeysAreSettingKeys` catches typos but NOT forgotten new keys. | Test: Audit all encoder parameters against `COLOR_IMPACTING_KEYS` |
| H3: 5-second cache TTL may cause brief ETag skew across processes | **Low** | In a multi-process deployment, each process has its own 5-second cache. A settings change may take up to 5 seconds to propagate. This is documented as acceptable. | Test: Multi-process deployment, change setting, observe ETag convergence |
| H4: `revalidateAllAppData()` may not revalidate image derivative routes | **Medium** | `revalidateAllAppData()` calls `revalidatePath('/')` and `revalidateTag('app-data')`. Image derivatives are served via static files or `serve-upload.ts`, not via Next.js page cache. The revalidation affects HTML pages, not derivative files. | Test: Verify what `revalidateAllAppData()` actually invalidates |

---

### Flow 5: Share Link Creation → Public Access → View Counting

**Entry:** `createPhotoShareLink()` / `createGroupShareLink()` in `app/actions/sharing.ts`
**Exit:** Public visitor sees shared photo(s) with view count incremented

**Trace:**
1. **Auth + same-origin + restore maintenance check**
2. **Validation**: Image ID integer, processed=true
3. **Rate limit**: In-memory pre-increment + DB backup (Pattern 3: rollback on over-limit/FK violation)
4. **Key generation**: `generateBase56()` with collision retry (max 5 retries)
5. **Atomic update**: `UPDATE ... WHERE share_key IS NULL` (photo) or transaction insert (group)
6. **Public access** (`app/[locale]/s/[key]/page.tsx` or `g/[key]/page.tsx`):
   - Rate-limited share lookup (`preIncrementShareAttempt`)
   - DB query for image(s) by share key
   - `publicSelectFields` — privacy-sensitive fields excluded
7. **View counting**:
   - `shared_group_views` table for group page loads
   - Buffered in process memory, flushed asynchronously
   - Best-effort: may undercount on crash/SIGKILL

**Competing Hypotheses:**

| Hypothesis | Confidence | Evidence | Testability |
|------------|------------|----------|-------------|
| H1: Share key collision retry may exhaust 5 retries under load | **Low** | Base56 alphabet with 10-char keys gives ~3.6e17 combinations. Collision probability is negligible. | Test: Mathematical analysis — collision probability is astronomically low |
| H2: Group share creation FK violation on deleted image | **Medium** | The group creation validates all images exist before transaction, but an image could be deleted between validation and transaction. The FK violation triggers `rollbackShareRateLimitFull()` and returns error. | Test: Delete image between validation and group creation |
| H3: View count buffer lost on SIGKILL | **High** | Documented: "best-effort approximate analytics". The buffer is flushed on graceful SIGTERM but lost on SIGKILL. This is by design. | Test: Send SIGKILL during share view, verify count loss |
| H4: Share rate limit DB decrement may race with concurrent increment | **Low** | `decrementRateLimit` uses `GREATEST(count - 1, 0)` then deletes zero rows. Two concurrent decrements on count=1 could both see count=1, decrement to 0, then both try to delete — but the second delete is idempotent (no rows match). | Test: Concurrent decrement on count=1 |

---

### Flow 6: Database Backup → Download → Restore

**Entry:** Admin clicks "Backup" or "Restore"
**Exit:** Database restored from backup file

**Trace:**
1. **Backup** (`app/[locale]/admin/db-actions.ts`):
   - Auth + same-origin check
   - Acquire `gallerykit_db_restore` advisory lock (non-blocking)
   - `mysqldump` with `--single-transaction`, `--routines`, `--no-tablespaces`
   - `MYSQL_PWD` env var (not `-p` flag)
   - File saved to `data/backups/` with timestamp
   - Audit log
2. **Download** (`app/api/admin/db/download/route.ts`):
   - `withAdminAuth()` wrapper (lint-gate enforced)
   - Stream file with `Content-Disposition: attachment`
   - Path traversal protection
3. **Restore** (`app/[locale]/admin/db-actions.ts`):
   - Auth + same-origin check
   - Acquire `gallerykit_db_restore` advisory lock
   - `beginRestoreMaintenance()` — sets global flag
   - `quiesceImageProcessingQueueForRestore()` — `clear()` then `onIdle()`
   - Validate file header (`hasPlausibleSqlDumpHeader`)
   - `mysql` CLI with `--one-database`
   - `endRestoreMaintenance()`
   - Revalidate all paths

**Competing Hypotheses:**

| Hypothesis | Confidence | Evidence | Testability |
|------------|------------|----------|-------------|
| H1: Restore maintenance flag is process-local, fails under scale-out | **High** | Documented in CLAUDE.md: "Runtime topology: single web-instance / single-writer". The `restoreMaintenanceKey` is `Symbol.for('gallerykit.restoreMaintenance')` on `globalThis` — process-local. A second instance would not see the flag. | Test: Multi-process deployment, trigger restore on instance A, upload on instance B |
| H2: `quiesceImageProcessingQueueForRestore()` may deadlock if tasks are stuck | **Medium** | `clear()` removes pending tasks, then `onIdle()` waits for running tasks. If a task is stuck (e.g., Sharp encoding hung), `onIdle()` never resolves. The `queue-shutdown.ts` has timeout logic but the restore path doesn't use it. | Test: Inject hung Sharp task, trigger restore |
| H3: SQL dump header validation is weak | **Medium** | `hasPlausibleSqlDumpHeader` checks for `--`, `CREATE `, `INSERT `, `DROP `, `SET `, or `/*!`. A crafted file starting with `--` passes. But the restore runs with `--one-database` and the DB user has limited privileges. | Test: Craft file with `--` header but malicious SQL |
| H4: Backup file may contain sensitive data (GPS coordinates, admin emails) | **Low** | The backup is a full DB dump. GPS coordinates are in the `images` table (admin-only columns). The backup is served only to authenticated admins. | Test: Verify backup contains admin-only columns — expected behavior |
| H5: Advisory lock release on connection close may not fire on process kill | **Low** | MySQL advisory locks are released on connection close. If the process is killed mid-restore, the connection may not close cleanly. But MySQL will detect the TCP disconnect and release the lock. | Test: Kill process mid-restore, verify lock released |

---

### Flow 7: Semantic Search Query → CLIP Embedding → Result Ranking

**Entry:** `POST /api/search/semantic` or admin UI search
**Exit:** Ranked list of semantically similar images

**Trace:**
1. **Rate limit**: `preIncrementSemanticAttempt()` — 30 req/min per IP
2. **Mode check**: `getGalleryConfig().semanticSearchMode`
   - `'disabled'` → 503
   - `'stub'` → deterministic (non-normalized) vectors
   - `'production'` → real `jina-clip-v2` encoder (gated by `SEMANTIC_SEARCH_ALLOW_PRODUCTION` env)
3. **Query embedding**: Text → CLIP embedding (512-dim float32)
4. **DB search**: `image_embeddings` table with cosine similarity
   - `MEDIUMBLOB` stores raw 2048-byte float32 vector
   - `decodeEmbeddingColumn()` reads and converts
5. **Result ranking**: Top-K by similarity score
6. **Rate limit rollback**: On validation failure (disabled mode, invalid query, too short)

**Competing Hypotheses:**

| Hypothesis | Confidence | Evidence | Testability |
|------------|------------|----------|-------------|
| H1: Stub mode vectors are not normalized, similarity scores are meaningless | **High** | Documented: "Stub mode uses non-meaningful deterministic (non-normalized) vectors." The stub mode is for UI testing only, not for actual search quality. | Test: Verify stub vectors are not unit length |
| H2: Production mode may 503 if model weights not seeded | **Medium** | The encoder loads weights from `CLIP_MODELS_ROOT` at first inference. If weights are missing, the inference fails. The route should catch this and return 503, but the error handling path is not explicitly documented. | Test: Remove weights, trigger semantic search |
| H3: Embedding DB column type (MEDIUMBLOB) may not be portable | **Low** | MEDIUMBLOB is MySQL-specific. If migrating to PostgreSQL, the column type would need adjustment. But the project is MySQL-only. | Test: Verify schema portability |
| H4: Concurrent embedding generation may race on same image | **Low** | The caption generation and CLIP embedding are fire-and-forget after image processing. If two images upload simultaneously, their embeddings are generated independently. No race condition. | Test: Concurrent uploads, verify embedding generation |

---

### Flow 8: Service Worker Install → Cache Population → Stale-While-Revalidate

**Entry:** Browser registers SW from `public/sw.js`
**Exit:** Cached image served with optional background revalidation

**Trace:**
1. **SW registration**: `navigator.serviceWorker.register('/sw.js')`
2. **SW source**: `public/sw.template.js` → `scripts/build-sw.ts` stamps `__SW_VERSION__` (git SHA + pipeline version) → `public/sw.js`
3. **Cache strategies**:
   - **Image derivatives**: Stale-while-revalidate with ETag HEAD probe
     - 50 MB LRU cap
     - HEAD request bounded by `AbortSignal.timeout(300ms)`
     - On slow network: serve cached + background revalidate
   - **HTML offline fallback**: `networkFirstHtml`
     - Caches 200 GET HTML explicitly
     - 24h TTL, 50-entry cap
     - Excludes admin routes and admin-rendered pages (`x-gk-admin-render: 1`)
4. **ETag probe**: HEAD request to `/uploads/...` with `If-None-Match`
5. **Cache update**: If 200, replace cached entry; if 304, keep cached entry

**Competing Hypotheses:**

| Hypothesis | Confidence | Evidence | Testability |
|------------|------------|----------|-------------|
| H1: 300ms HEAD timeout may cause unnecessary cache misses on slow networks | **Low** | The timeout is documented as preserving "synchronous-freshness intent" while bounding stall time. On slow networks, the cached version is served immediately, and the background revalidation updates the cache for next time. This is correct behavior. | Test: Simulate 300ms+ RTT, verify cached serve + background update |
| H2: SW cache may grow unbounded if LRU eviction fails | **Low** | The LRU logic is unit-tested in `sw-cache.ts` and fixture-tested in `sw-template-contract.test.ts`. The 50 MB cap is enforced. | Test: Fill cache beyond 50 MB, verify eviction |
| H3: Admin-rendered pages may be cached if `x-gk-admin-render` header is missing | **Medium** | The SW checks `x-gk-admin-render: 1` response header. If the server fails to set this header (e.g., middleware bug), admin pages could be cached for offline use. The middleware (`proxy.ts`) sets this header when `admin_session` cookie is present. | Test: Verify header is set on all admin-rendered responses |
| H4: SW version stamp may not invalidate cache on pipeline version bump | **Low** | The SW version includes `p{IMAGE_PIPELINE_VERSION}`. A pipeline version bump changes the SW version, triggering `skipWaiting` and cache invalidation. But the actual cache keys are the image URLs, not the SW version. Old cache entries persist until evicted by LRU or overwritten by new fetches. | Test: Bump pipeline version, verify cache behavior |

---

### Flow 9: Caption Generation → Alt Text → Accessibility

**Entry:** Image processing completion in `image-queue.ts`
**Exit:** `alt` attribute on `<img>` tags

**Trace:**
1. **Fire-and-forget**: After image processing, `generateCaption()` is called
2. **ONNX model**: Florence-2 via ONNX Runtime (local, no network)
3. **Stub mode**: Default `autoAltTextEnabled=false`. When enabled, generates alt text
4. **Storage**: Caption stored in `images` table
5. **Rendering**: `photo-viewer.tsx` uses caption for `alt` attribute

**Competing Hypotheses:**

| Hypothesis | Confidence | Evidence | Testability |
|------------|------------|----------|-------------|
| H1: Caption generation failure is silently swallowed | **Medium** | The caption generation is fire-and-forget with `.catch(() => undefined)`. If the ONNX model fails, no error is surfaced to the admin. The image has no alt text, but the upload appears successful. | Test: Trigger ONNX failure, verify no error surfaced |
| H2: Alt text may be inaccurate or misleading | **Low** | The Florence-2 model is a general vision model, not photography-specific. It may misidentify subjects, especially in artistic/abstract photos. | Test: Upload abstract photo, verify alt text quality |
| H3: Caption generation may block event loop | **Low** | ONNX inference is CPU-bound and runs on the main thread. For large images, this could block the event loop. But the fire-and-forget pattern means it doesn't block the response. | Test: Profile event loop during caption generation |

---

### Flow 10: Admin Backfill Trigger → Runner → Version Bump

**Entry:** Admin clicks "Re-encode existing photos"
**Exit:** Images re-encoded at current pipeline version

**Trace:**
1. **Trigger** (`admin-backfill.ts`):
   - Auth + same-origin check
   - `triggerAdminBackfill()` → `getAdminBackfillCandidateCount()`
   - Acquire `gallerykit_color_pipeline_backfill` advisory lock (non-blocking, 0s timeout)
   - If lock held → `already_running`
   - If candidate count = 0 → `queued` with 0 rows
   - Fire-and-forget `runBackfill(lockConn)`
2. **Runner** (`admin-backfill-runner.ts`):
   - Batched keyset pagination (100 rows/batch)
   - PQueue with concurrency capped by pool budget (max 2 at pool=10)
   - Per-row:
     - Verify original exists
     - Acquire `gallerykit:image-processing:{id}` lock (skip if held)
     - `processImageFormats()` — same as upload path
     - Re-detect color signals
     - Conditional UPDATE with `pipeline_version = CURRENT`
     - If `affectedRows === 0` → deleted mid-reencode, cleanup variants
3. **Status polling** (`getBackfillStatus()`):
   - Reads `globalThis` state symbol
   - Returns running flag, counters, last error

**Competing Hypotheses:**

| Hypothesis | Confidence | Evidence | Testability |
|------------|------------|----------|-------------|
| H1: `lastError` is last-writer-wins at concurrency > 1 | **High** | Documented in code: "last-writer-wins across workers". The error counts are correct, but the human-readable message reflects whichever worker failed last. | Test: Concurrent failures, verify lastError |
| H2: Pool exhaustion may cause `acquireImageProcessingClaim` to throw, counted as `locked` | **Medium** | The code catches `getConnection()` rejection and returns `{ ok: false, reason: 'locked' }`. But the error message says "pool exhausted?" which is misleading — it's not a held lock, it's a resource shortage. | Test: Exhaust pool, verify skip behavior |
| H3: Batch cursor may skip rows if new uploads arrive mid-run | **Low** | The keyset pagination uses `id > cursor` with `pipeline_version < CURRENT`. New uploads get `pipeline_version = CURRENT`, so they're not candidates. The cursor advances to the highest ID in the batch. No rows are skipped. | Test: Upload new image mid-backfill, verify it's not picked up |
| H4: `deletedMidReencode` cleanup may fail silently | **Low** | `cleanupDeletedMidReencodeVariants` uses `Promise.all` with `.catch()` that logs but doesn't throw. A cleanup failure is logged but doesn't stop the runner. | Test: Inject unlink failure, verify runner continues |
| H5: Runner state on `globalThis` may leak between tests | **Medium** | The state uses `Symbol.for('gallerykit.adminBackfillState')` which is global across the process. Tests use `_resetAdminBackfillStateForTesting()` but only when `NODE_ENV === 'test' || VITEST`. If a test forgets to reset, state leaks. | Test: Run backfill tests in sequence, verify isolation |

---

### Flow 11: GPS EXIF Strip → Original Preservation → Privacy

**Entry:** `uploadImages()` with `strip_gps_on_upload=true`
**Exit:** Original file with GPS neutralized, derivatives without GPS

**Trace:**
1. **Container detection** (`gps-exif-strip.ts`):
   - JPEG: APP1 Exif segment walk, GPS IFD zeroing, XMP GPS token detection
   - TIFF: Whole-file IFD walk, GPS IFD zeroing
   - HEIF/AVIF/HEIC: ISOBMFF walk, Exif item location, GPS IFD zeroing
   - WebP: RIFF EXIF chunk TIFF scrub, XMP chunk retagging
   - PNG/structurally anomalous: Fallback to metadata-free re-encode
2. **GPS neutralization**:
   - GPS IFD entries zeroed (inline values + offset-referenced ranges)
   - Entry count set to 0
   - Next-IFD pointer zeroed
3. **XMP handling**:
   - GPS-bearing XMP packets dropped (JPEG ExtendedXMP overflow segments tested)
   - JPEG post-EOI trailers treated as structural anomaly → fallback re-encode
4. **Fallback re-encode**:
   - `autoOrient + keepIccProfile` with explicit high-quality settings
   - NOT `withMetadata()` (which would keep GPS)

**Competing Hypotheses:**

| Hypothesis | Confidence | Evidence | Testability |
|------------|------------|----------|-------------|
| H1: Fallback re-encode for PNG may not preserve all metadata | **Medium** | The fallback uses `autoOrient + keepIccProfile` but doesn't explicitly preserve other metadata (e.g., XMP, IPTC). For PNG, this may strip non-GPS metadata that the photographer wants to keep. | Test: Upload PNG with non-GPS metadata, verify preservation |
| H2: JPEG post-EOI trailer detection may false-positive on valid files | **Low** | The walker returns `null` (structural anomaly) for post-EOI trailers, triggering fallback re-encode. This is conservative (safer to re-encode than to miss GPS data). | Test: Upload JPEG with post-EOI trailer, verify fallback |
| H3: GPS IFD zeroing may leave recoverable data in slack space | **Low** | The code zeroes the GPS IFD entries and their referenced values, but TIFF files may have slack space between IFDs. The GPS data is in the IFD structure, not in slack space. | Test: Forensic analysis of stripped file |
| H4: `strip_gps_on_upload` setting change is locked after first upload | **High** | `updateGallerySettings()` rejects `strip_gps_on_upload` changes if images exist. This prevents inconsistent GPS stripping across the gallery. | Test: Attempt to change setting after upload, verify rejection |

---

### Flow 12: Rate Limit → In-Memory Map → DB Backup → Purge

**Entry:** Any rate-limited action (login, search, loadMore, OG, share, semantic)
**Exit:** Request allowed or rejected based on combined in-memory + DB limit

**Trace:**
1. **In-memory pre-increment**: `BoundedMap` with `prune()` before check
2. **DB increment**: `INSERT ... ON DUPLICATE KEY UPDATE` (atomic upsert)
3. **Combined check**: If either in-memory or DB count exceeds limit, reject
4. **Rollback patterns**:
   - Pattern 1 (auth): No rollback on infrastructure error
   - Pattern 2 (public read): Rollback on validation failure / early return
   - Pattern 3 (admin write): Rollback on over-limit / FK violation
   - Pattern 4 (OG): Rollback ONLY for pre-DB syntactic rejections
5. **Periodic purge**: `purgeOldBuckets()` removes expired DB rows (hourly GC)
6. **BoundedMap eviction**: Oldest entries evicted when hard cap exceeded

**Competing Hypotheses:**

| Hypothesis | Confidence | Evidence | Testability |
|------------|------------|----------|-------------|
| H1: In-memory Map may grow unbounded if `prune()` is not called | **Medium** | `BoundedMap.prune()` must be called before each check. If a caller forgets to call `prune()`, the Map grows until the hard cap is reached, then eviction kicks in. But the cap is enforced, so growth is bounded. | Test: Verify all callers call `prune()` before check |
| H2: DB `decrementRateLimit` may undercount with concurrent decrements | **Low** | The decrement uses `GREATEST(count - 1, 0)` then deletes zero rows. Two concurrent decrements on count=1: both see count=1, both decrement to 0, both try to delete. The second delete is a no-op. The net effect is count=0, which is correct. | Test: Concurrent decrement on count=1 |
| H3: `purgeOldBuckets` may not run during DB outage | **Medium** | The hourly GC runs `purgeOldBuckets()`. If the DB is down, the purge fails. Old buckets accumulate. But the `bucketStart` field is a unix timestamp, so old buckets are naturally excluded from current-window checks. | Test: DB outage, verify rate limit behavior |
| H4: Login rate limit DB backup may not be read on first request after restart | **Medium** | After restart, the in-memory Map is empty. The first login attempt pre-increments the in-memory Map, then increments DB. The check reads DB. If the DB has a count from before restart, the check sees it. But the in-memory Map is now at 1, so the combined check is correct. | Test: Restart process, verify rate limit behavior on first request |
| H5: `getClientIp` may return "unknown" in production without `TRUST_PROXY` | **High** | Documented: "ALL users share a single rate-limit bucket" without `TRUST_PROXY`. After 5 failed logins from ANY IP, ALL users are locked out for 15 minutes. The console warning is emitted once. | Test: Production without `TRUST_PROXY`, verify shared bucket behavior |

---

## 3. Cross-Cutting Concerns

### 3.1 Process-Local State (Single-Instance Assumption)

Multiple modules use `globalThis` or module-scoped state that is NOT shared across processes:
- `restoreMaintenanceKey` (`restore-maintenance.ts`)
- `adminBackfillStateKey` (`admin-backfill-runner.ts`)
- `uploadTrackerState` (`upload-tracker-state.ts`)
- `inflight` / `cache` (`settings-hash.ts`)
- All `BoundedMap` instances (`rate-limit.ts`)
- `permanentlyFailedIds` / `claimRetryCounts` (`image-queue.ts`)

**Impact**: Horizontal scaling would break these invariants. The CLAUDE.md documents this as a known limitation.

### 3.2 Fire-and-Forget Patterns

Multiple operations are fire-and-forget with `.catch(() => undefined)` or `.catch(console.debug)`:
- Caption generation (`image-queue.ts`)
- CLIP embedding (`image-queue.ts`)
- Audit logging (`audit.ts`)
- Revalidation (`revalidation.ts`)
- Backfill runner (`admin-backfill.ts`)

**Risk**: Failures are silently swallowed. The admin has no visibility into caption/embedding failures without checking logs.

### 3.3 Advisory Lock Scope

MySQL advisory locks are server-scoped, not database-scoped. Two GalleryKit instances on the same MySQL server share locks. Documented in `advisory-locks.ts` and CLAUDE.md.

### 3.4 Compile-Time Guards

Multiple TypeScript compile-time guards enforce invariants:
- `_PrivacySensitiveKeys` (`data.ts`): Ensures admin-only fields are not in public selects
- `_SensitiveKeysInPublic` (`data.ts`): Ensures no sensitive keys in `publicSelectFields`
- `_ColorKeysAreSettingKeys` (`settings-hash.ts`): Ensures hash keys are valid settings
- `_MapSensitiveKeys` (`data.ts`): Ensures map select fields don't leak sensitive data

**Limitation**: These guards catch typos and removals but NOT forgotten additions. A new byte-impacting setting not added to `COLOR_IMPACTING_KEYS` would pass compilation but break ETag invalidation.

### 3.5 Test Coverage Gaps

From test file inventory:
- `gps-exif-strip.ts`: Complex byte-level logic, limited test coverage for all container types
- `icc-chromaticity.ts`: Matrix inversion, chad adaptation — mathematical correctness
- `color-detection.ts`: NCLX parsing edge cases (malformed boxes, depth overflow)
- `process-image.ts`: Wide-gamut pipeline, 10-bit AVIF fallback, DCI-P3 adaptation
- `image-queue.ts`: Delete-during-processing race, lock timeout, retry exhaustion
- `admin-backfill-runner.ts`: Pool exhaustion, concurrent runner, deleted-mid-reencode
- `serve-upload.ts`: Path traversal, symlink, extension validation
- `rate-limit.ts`: Concurrent increment/decrement, prune behavior, eviction

---

## 4. Commonly Missed Issues (Final Sweep)

### 4.1 Timing Attacks

| Surface | Status | Notes |
|---------|--------|-------|
| Login (Argon2 verify) | **Mitigated** | Dummy hash on missing user |
| Session token verify | **Mitigated** | `timingSafeEqual` |
| Share key existence | **Partial** | `createPhotoShareLink` checks `share_key` before rate limit — an attacker could time the difference between "already has key" and "needs key generation" |
| Image existence | **Partial** | `loadMoreImages` validates slug before rate limit — timing difference between "invalid slug" and "valid slug" |

### 4.2 Resource Exhaustion

| Vector | Status | Notes |
|--------|--------|-------|
| Sharp `limitInputPixels` | **Mitigated** | 256M pixels cap |
| Upload size | **Mitigated** | 200MB per file, 2GB cumulative |
| Image sizes count | **Mitigated** | Max 8 sizes |
| Rate limit Map size | **Mitigated** | BoundedMap hard caps |
| DB connection pool | **Mitigated** | 10 connections, queue limit 20 |
| Backfill concurrency | **Mitigated** | Capped by pool budget |
| PQueue concurrency | **Mitigated** | Default 1, override via `QUEUE_CONCURRENCY` |
| AVIF 10-bit probe | **Risk** | No timeout on probe — could hang if libheif is broken |

### 4.3 Error Handling Gaps

| Pattern | Location | Risk |
|---------|----------|------|
| `.catch(() => undefined)` | `image-queue.ts` (caption, embedding) | Silent failure, no retry |
| `.catch(console.debug)` | `audit.ts`, `sharing.ts` | Silent failure, audit log lost |
| `try { ... } catch { ... }` | `color-detection.ts` (NCLX read) | Non-critical fallback, but no logging |
| `try { ... } catch { ... }` | `gallery-config.ts` | Falls back to defaults, but no alerting |
| `try { ... } catch { ... }` | `settings-hash.ts` | Falls back to `FALLBACK_HASH`, but no alerting |

### 4.4 Race Conditions (Beyond Documented Ones)

| Scenario | Likelihood | Impact |
|----------|------------|--------|
| Admin deletes image while backfill is processing it | Medium | Backfill detects `affectedRows===0`, cleans up variants — handled |
| Admin changes settings while upload is in progress | Low | Upload contract lock prevents `image_sizes`/`strip_gps` changes during active uploads |
| Two admins create share keys for same image concurrently | Low | Atomic `UPDATE ... WHERE share_key IS NULL` prevents duplicate |
| Two admins delete the same admin user concurrently | Low | `LOCK_ADMIN_DELETE` advisory lock serializes deletions |
| Session secret rotation mid-request | Very low | `getSessionSecret` is cached for the request via `cache()` |
| DB connection pool exhaustion during peak load | Medium | Queue may stall, requests timeout |

### 4.5 Data Integrity

| Concern | Status | Notes |
|---------|--------|-------|
| `filename_original` uniqueness | **Assumed** | UUID via `crypto.randomUUID()` — collision probability negligible |
| `share_key` uniqueness | **Enforced** | Base56 generation with retry + DB unique constraint |
| `group_key` uniqueness | **Enforced** | Same as share_key |
| `topic_slug` uniqueness | **Enforced** | DB unique constraint |
| `tag_slug` uniqueness | **Enforced** | `INSERT IGNORE` + collision detection |
| Image ID sequence | **Auto-increment** | MySQL `AUTO_INCREMENT` |
| `pipeline_version` monotonicity | **Manual** | Bumped by developer, not automatic |

### 4.6 Security Surface Review

| Check | Status | Notes |
|-------|--------|-------|
| SQL injection | **Mitigated** | Drizzle ORM parameterization; raw SQL only in schema/maintenance |
| XSS | **Mitigated** | React escaping; `sanitizeForOg` for OG images; CSP nonce |
| CSRF | **Mitigated** | Next.js framework CSRF + `requireSameOriginAdmin()` |
| Path traversal | **Mitigated** | `realpath` containment + `startsWith` check |
| Symlink attack | **Mitigated** | `lstat()` + `isSymbolicLink()` rejection |
| SSRF | **N/A** | No outbound URL fetching from user input |
| Command injection | **Mitigated** | `mysqldump`/`mysql` args are hardcoded; filenames are UUIDs |
| Race condition (TOCTOU) | **Mitigated** | Advisory locks + atomic updates + pre-increment patterns |
| Information disclosure | **Mitigated** | `publicSelectFields` omits sensitive data; compile-time guards |
| DoS | **Partial** | Rate limits, size caps, pool limits; but OG generation is CPU-intensive |

---

## 5. Summary of Findings

### High Confidence Issues

1. **TRC-H1**: Static path ETag miss after settings change without backfill (documented as CRT-D1)
2. **TRC-H2**: Process-local state prevents horizontal scaling (documented in CLAUDE.md)
3. **TRC-H3**: `getClientIp` returns "unknown" without `TRUST_PROXY`, causing shared rate-limit bucket
4. **TRC-H4**: Fire-and-forget caption/embedding failures are silently swallowed
5. **TRC-H5**: `canUseHighBitdepthAvif()` singleton caches failure permanently

### Medium Confidence Issues

1. **TRC-M1**: Delete-during-processing race may leave orphaned files (handled for queue, but backfill cleanup uses directory scan which may miss non-default-size variants)
2. **TRC-M2**: `lastError` in backfill is last-writer-wins at concurrency > 1
3. **TRC-M3**: GPS stripping fallback for PNG may strip non-GPS metadata
4. **TRC-M4**: Login rate limit in-memory Map is empty after restart, giving 5 free attempts
5. **TRC-M5**: OG route rate limit rollback pattern may be inconsistent with other surfaces
6. **TRC-M6**: `quiesceImageProcessingQueueForRestore` may deadlock on hung Sharp tasks
7. **TRC-M7**: Middleware format check is weak (doesn't validate HMAC)
8. **TRC-M8**: `buildHashFromConfig` may misalign with actual encoder settings if new parameter added

### Low Confidence Issues

1. **TRC-L1**: ICC chromaticity `chad` matrix inversion may fail for near-singular matrices
2. **TRC-L2**: ProPhoto → P3 conversion may clip cyan without warning
3. **TRC-L3**: `wide_gamut_max_source_pixels` downscale may alter aspect ratio unexpectedly
4. **TRC-L4**: SW cache may not invalidate on pipeline version bump
5. **TRC-L5**: Admin-rendered pages may be cached if `x-gk-admin-render` header missing
6. **TRC-L6**: Caption generation may be inaccurate for abstract photos
7. **TRC-L7**: `savedOriginalFilename` tracking may miss files on failure between write and track
8. **TRC-L8**: Semantic search production mode may 503 if weights not seeded

### Invariants Verified

1. **TRC-V1**: No sensitive keys in `publicSelectFields` (compile-time guard `_SensitiveKeysInPublic`)
2. **TRC-V2**: All `COLOR_IMPACTING_KEYS` are valid setting keys (compile-time guard `_ColorKeysAreSettingKeys`)
3. **TRC-V3**: Every mutating admin action calls `requireSameOriginAdmin()` (lint-gate enforced)
4. **TRC-V4**: Every admin API route wraps with `withAdminAuth()` (lint-gate enforced)
5. **TRC-V5**: Public mutating routes have rate-limit pre-increment (lint-gate enforced)
6. **TRC-V6**: Touch targets >= 44px (unit test enforced)
7. **TRC-V7**: No Unicode bidi/formatting chars in admin strings (validator enforced)
8. **TRC-V8**: GPS coordinates excluded from public API (field omission + compile-time guard)
9. **TRC-V9**: Session tokens use HMAC-SHA256 + timingSafeEqual
10. **TRC-V10**: Passwords use Argon2id with OWASP-exceeding parameters

---

## 6. Recommendations

### Immediate (High Priority)

1. **Add 10-bit AVIF probe retry**: The `canUseHighBitdepthAvif()` singleton should have a retry mechanism or periodic revalidation to recover from transient libheif failures.
2. **Surface fire-and-forget failures**: Caption generation and CLIP embedding failures should be logged at `warn` level (not `debug`) and surfaced in admin status.
3. **Document `TRUST_PROXY` requirement prominently**: The production rate-limit behavior without `TRUST_PROXY` is dangerous and should be in the deployment checklist.

### Short-term (Medium Priority)

1. **Add test for delete-during-processing race**: Verify orphaned file cleanup for both queue and backfill paths.
2. **Add test for backfill `lastError` concurrency**: Verify last-writer-wins behavior is documented and acceptable.
3. **Add test for GPS stripping fallback**: Verify PNG metadata preservation in fallback re-encode path.
4. **Add test for `buildHashFromConfig` alignment**: Verify all encoder parameters are in `COLOR_IMPACTING_KEYS`.
5. **Review OG route rollback pattern**: Ensure consistency with documented Pattern 4 semantics.

### Long-term (Low Priority)

1. **Consider distributed state**: If horizontal scaling is needed, move process-local state (restore maintenance, backfill state, rate-limit Maps) to Redis or similar.
2. **Add alerting for settings-hash fallback**: `FALLBACK_HASH` usage should trigger an alert.
3. **Add per-row backfill error logging**: Instead of just `lastError`, consider a small error log table for backfill failures.
4. **Review caption generation accuracy**: Consider photography-specific model or manual alt-text workflow.

---

*Review completed by tracer agent. All flows traced from entry to exit with competing hypotheses for failure modes.*
