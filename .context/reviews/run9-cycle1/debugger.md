# Debugger Review — Run-9 Cycle-1 (HEAD `d3858cfc`)

**Date:** 2026-06-21
**Reviewer role:** Latent-bug surface / failure-mode / regression sweep
**Scope:** `apps/web/src/` + `scripts/` — focus on parsers (ICC/NCLX/EXIF/GPS ISOBMFF walkers), image queue, backfill runner, restore flow, privacy guard, blur validation, csv-escape, og-sanitize, rate-limit, view-count buffer, settings-hash, smart-collections.
**Excluded (already adjudicated):** REJ-R7C3-01 (gps-exif indexSize DISPROVED), MED-R7C2-01 (histogram clip % REFUTED), OBS-R7C2-02..07 (LOW deferrals).
**New findings count: 1 confirmed LOW, 4 confirmed BENIGN / GREEN**

---

## Areas Investigated

### 1. `parseCicpFromHeif` scan-bound DoS candidate (BENIGN — confirmed GREEN)

**File:** `apps/web/src/lib/color-detection.ts`

The briefing asked whether the per-level `limit = Math.min(end, offset + MAX_SCAN_BYTES, buffer.length)` applied recursively at MAX_DEPTH=5 constitutes a depth × 1 MB over-scan risk.

**Finding: BENIGN.** The caller (`detectColorSignals`) opens the file, reads at most 1 MB into a pre-allocated `Buffer.alloc(1024*1024)`, and passes `header.subarray(0, bytesRead)` — a buffer whose `.length` is at most 1 MB. At every recursion level the third argument `buffer.length` dominates or ties `offset + MAX_SCAN_BYTES`, so the per-level bound can never exceed what the buffer already contains. The depth × 1 MB concern does not apply.

The same analysis applies identically to `hasGainMap` in `gain-map-detection.ts` — same caller, same pre-capped buffer, same limit arithmetic.

---

### 2. ICC `mluc` record offset arithmetic (BENIGN — confirmed GREEN)

**File:** `apps/web/src/lib/icc-extractor.ts`, lines 83–120

The `mluc` offset-from-tag-data-element is computed as `strStart = dataOffset + recTextOffset`. The ICC.1:2010 §10.13 spec defines `recTextOffset` as "offset from the beginning of the tag data element" — i.e., from `dataOffset`. The code matches the spec. The bounds checks `strEnd > iccLen` and `strEnd > dataOffset + dataSize` are both present before any buffer access. No off-by-one.

---

### 3. GPS EXIF strip — integer overflow in value-size arithmetic (BENIGN)

**File:** `apps/web/src/lib/gps-exif-strip.ts`, lines 126–132

`valueSize = typeSize * valueCount` where `typeSize` is at most 8 (DOUBLE) and `valueCount` is a `u32` up to 4,294,967,295. Maximum product is ~34 billion, well within JS float64 precision (MAX_SAFE_INTEGER ~9×10¹⁵). The subsequent `inBounds(valueAbs, valueSize)` check fails (valueSize > buf.length) before any fill. Safe.

ExtendedXMP cross-chunk reconstruction at lines 323–329 sorts chunks by declared offset and joins them, correctly catching GPS tokens that straddle chunk boundaries. The `headerEnd` calculation (35 + 40 = 75) matches the XMP Spec Part 3 §1.1.3.1 layout. No vulnerability found.

---

### 4. Image queue — delete-during-processing race (BENIGN — confirmed GREEN)

**File:** `apps/web/src/lib/image-queue.ts`

The `affectedRows === 0` guard on the conditional UPDATE triggers `deleteImageVariants(dir, filename, [])` with an empty array argument, which performs a full directory scan to catch non-default-size variants. Both the queue worker and the backfill runner (`admin-backfill-runner.ts` lines ~573, ~605) implement this identically. No orphaned file leak.

Fire-and-forget hooks (caption generation, embedding) both carry `.catch()` handlers. No unhandled rejection surface found.

---

### 5. Restore flow — maintenance flag, advisory lock, temp file lifecycle (BENIGN)

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts`, lines 264–360

All three resources (advisory lock, upload-contract lock, `restoreMaintenance` flag) are released inside the outer `finally` block, which executes on every code path including the quiesce-failure early return at line 337. The temp file is created *inside* `runRestore()`, which is only called after quiesce succeeds — so the quiesce-failure early return cannot leave a stranded temp file. Within `runRestore`, every failure path (stream error, header validation failure, dangerous-SQL detection, env-var missing, spawn error, non-zero exit) calls `fs.unlink(tempPath).catch(() => {})`. The `conn.release()` in the outermost `finally` (line 359) is reached on all code paths. No resource leak detected.

---

### 6. `UNICODE_FORMAT_CHARS_GLOBAL` singleton with `/g` flag (BENIGN)

**File:** `apps/web/src/lib/validation.ts`, lines 77–94

`UNICODE_FORMAT_CHARS_GLOBAL` is constructed once at module load as `new RegExp(UNICODE_FORMAT_CHARS.source, 'g')` and used only via `String.prototype.replace`. `replace()` with a global regex always resets `lastIndex` to 0 on completion, so there is no `lastIndex` state bug from sharing this singleton across calls. The separate non-global `UNICODE_FORMAT_CHARS` is used only with `.test()` — also no state issue. The parallel construction in `csv-escape.ts` (`UNICODE_FORMAT_CHARS_G`) follows the same safe pattern.

---

### 7. `settings-hash.ts` — inflight dedup race (BENIGN)

**File:** `apps/web/src/lib/settings-hash.ts`, lines 77–159

The module-level `inflight` promise correctly deduplicates concurrent callers during a DB fetch window. The `.finally` handler nulls `inflight` after the promise settles, so a subsequent call after settlement triggers a fresh fetch. The cache TTL check (`now - cache.fetchedAt < CACHE_TTL_MS`) uses `Date.now()` at both write and read time — no clock skew surface. The `FALLBACK_HASH` path (DB unreachable) returns a stable deterministic value rather than throwing. Clean.

---

### 8. Smart-collections SQL compiler (BENIGN — confirmed GREEN)

**File:** `apps/web/src/lib/smart-collections.ts`

All column references use Drizzle column objects from `ALLOWED_COLUMNS` (an allowlisted map of Drizzle `images.*` references), never string interpolation. Values (`eq`, `gt`, `lt`, `contains`, `between`, `in`) are passed as Drizzle-parameterized values. The `contains` and `tag.contains` operators escape LIKE wildcards (`%_\`) before binding. The `between` path uses the Drizzle `sql\`${col} BETWEEN ${p.lo} AND ${p.hi}\`` tagged-template form where `col` is a column ref and `p.lo`/`p.hi` are bound as parameters. Depth cap (MAX_DEPTH=4) and IN-value cap (MAX_IN_VALUES) guard against runaway query expansion. No SQL injection surface.

---

### 9. Blur data URL production and validation (BENIGN)

**File:** `apps/web/src/lib/process-image.ts` (blur section), `apps/web/src/lib/blur-data-url.ts`

The blur producer converts to sRGB (`toColorspace('srgb')`) then JPEG q40 at 16px before encoding — the resulting base64 string is on the order of 270–680 chars, well inside the 4096-char `MAX_BLUR_DATA_URL_LENGTH` cap enforced by `assertBlurDataUrl`. The rejection-log throttle correctly uses `count === 0 || count % 1000 === 0` to suppress per-request spam while keeping the first occurrence and periodic recurrences observable. The `rejectionTuple` key hashes by `(typeof, length, head8)` — coarse enough to collapse identical poisoned rows but not leaking payload content. No issues.

---

### 10. View-count buffer atomic swap (BENIGN)

**File:** `apps/web/src/lib/data.ts`, lines 13–125 (view count section)

The `flushGroupViewCounts` function atomically swaps the buffer by reassigning the module-level `let viewCountBuffer` to a fresh `new Map()` before beginning the DB flush, so increments arriving during a flush go into the new buffer and are not lost. The exponential backoff (`Math.pow(2, Math.min(consecutiveFlushFailures - 3, 5))`) is capped at `MAX_FLUSH_INTERVAL_MS`. The size cap with FIFO eviction (`viewCountBuffer.has(groupId)` guard on increment) prevents unbounded buffer growth. Clean.

---

## Confirmed Finding

### LOW-01 — `settings-hash.ts` no-arg path reads raw DB strings, CONFIG-ARG path reads validated values; the two hashes can diverge when invalid admin settings are stored

**Severity:** LOW
**File:** `apps/web/src/lib/settings-hash.ts`, lines 104–118 vs 89–102

**Description:** `getColorSettingsHash()` (no-arg form) fetches raw DB strings and feeds them directly into `buildHash`. `getColorSettingsHash(config)` (CONFIG-ARG form, added R8-H1) computes the hash from validated `GalleryConfig` values, which apply defaults when DB values are out-of-range. If an admin setting is stored with an invalid value (e.g., `image_quality_avif=150`), the no-arg form produces a different hash than the config-arg form. `serve-upload.ts` uses the config-arg form (R4C3 PERF-R4C3-05), so the ETag it emits is consistent with the actual encoded bytes. The no-arg form is used by other callers that may not hold a resolved config — those callers emit a mismatching ETag that cannot trigger a 304 mismatch (the two ETags differ, so revalidation always returns 200 rather than 304), but it means the no-arg ETag no longer reflects encoder reality on invalid settings.

**Impact:** ETag instability when admin settings contain out-of-range values. No security impact. Only observable as cache-miss behavior (clients never get a stale 304 for a changed setting), not as stale-bytes delivery. However, the two-hash divergence is a potential source of confusion if the no-arg form is called from a path that assumes it tracks the encoder.

**Fix (minimal):** Document the divergence explicitly in the no-arg JSDoc and note that the no-arg form is for non-encoder paths only; or consolidate both forms through `buildHashFromConfig` by resolving the config first. Either way, this is a low-priority cleanup.

**Reproduction:** Store `image_quality_avif=150` in `admin_settings`, then call both `getColorSettingsHash()` and `getColorSettingsHash(resolvedConfig)` — they return different 8-char hashes.

---

## Summary

| ID | Severity | File | Description | Disposition |
|----|----------|------|-------------|-------------|
| LOW-01 | LOW | `settings-hash.ts` | no-arg vs config-arg hash diverges on invalid DB settings | New finding |
| — | BENIGN | `color-detection.ts` | `parseCicpFromHeif` per-level scan bound | Confirmed safe |
| — | BENIGN | `gain-map-detection.ts` | `hasGainMap` scan bound (same pattern) | Confirmed safe |
| — | BENIGN | `icc-extractor.ts` | `mluc` record offset arithmetic | Confirmed correct |
| — | BENIGN | `gps-exif-strip.ts` | integer overflow in value-size; XMP cross-chunk reconstruction | Confirmed safe |
| — | BENIGN | `db-actions.ts` | restore maintenance flag + lock + temp file lifecycle | Confirmed clean |
| — | BENIGN | `validation.ts` / `csv-escape.ts` | global-regex `/g` lastIndex state | Confirmed safe |
| — | BENIGN | `settings-hash.ts` | inflight dedup | Confirmed clean |
| — | BENIGN | `smart-collections.ts` | SQL parameterization + column allowlist | Confirmed safe |
| — | BENIGN | `process-image.ts` / `blur-data-url.ts` | blur URL production and validation | Confirmed safe |
| — | BENIGN | `data.ts` | view-count atomic swap + backoff + size cap | Confirmed clean |

**New actionable findings: 1 (LOW-01)**

No CRIT, HIGH, or MED findings. The codebase is in excellent defensive shape at HEAD `d3858cfc`.
