# Cycle 15 Debugger Review

**Date:** 2026-06-27
**HEAD:** 2f886351 (cycle-14 fixes landed; all six gates GREEN at baseline)
**Reviewer:** debugger agent (Opus 4.8 1M)
**Scope:** Full latent-bug sweep of the rich bug-surface targets — binary metadata parsers (color-detection NCLX/ISOBMFF walker, icc-extractor, icc-chromaticity, gain-map-detection, gps-exif-strip byte surgery), the Sharp pipeline (process-image: downscale math, 10-bit fallback, fresh-instance-per-format), number/rational math (decimalToRational, EXIF coercion), rate-limit / bounded-map eviction, the view-count buffer swap/flush (incl. the cycle-14 `currentFlushPromise` change), CSV/Unicode/OG sanitizers, retention/date math (view-retention, audit-log sweep, exif-datetime), and every `* bsize` / `* 1024` arithmetic site flagged in the brief.

**One-line summary:** One confirmed NEW MEDIUM bug — a malformed/placeholder EXIF GPS rational (`0/0` → NaN) bypasses `convertDMSToDD`'s range guard and propagates NaN into the `images` INSERT, which mysql2's text protocol serializes as a bare `NaN` token → `ER_BAD_FIELD_ERROR` → the entire (valid) photo upload is rejected; everything else on the audited surface is well-hardened and the cycle-14 fixes are regression-free.

---

## Severity Table

| ID | File:Line | Severity | Confidence | Summary |
|----|-----------|----------|------------|---------|
| **DBG-15-01** | `lib/process-image.ts:1446-1455` | **MEDIUM** | **High** | `convertDMSToDD` range guard (`<`/`>` comparisons) silently passes `NaN`; a `0/0` GPS rational → `latitude/longitude = NaN` → `db.insert(images)` emits a bare `NaN` SQL token → `ER_BAD_FIELD_ERROR: Unknown column 'NaN'` → valid photo rejected at upload. Affects BOTH upload paths (browser + Lightroom). |
| DBG-15-02 | `lib/color-detection.ts:249`, `lib/gain-map-detection.ts:72` | INFO | High | 64-bit ISOBMFF box-size `Number(readBigUInt64BE())` omits the `> Number.MAX_SAFE_INTEGER` guard that `gps-exif-strip.ts:395` and the iloc `readSized` apply. Harmless today (subsequent `pos+size > buffer.length` bounds check breaks), but inconsistent with the repo's own defensive pattern. |
| DBG-15-03 | `lib/validation.ts:58` (`UNICODE_FORMAT_CHARS`) | INFO | High | Sanitizer set omits U+2028/U+2029 (line/paragraph separators) and U+061C (ALM). The canonical Trojan-Source reordering set IS covered (U+202A-202E, U+2066-2069); these survive both admin validation reject and the CSV/OG strip. Not exploitable (spreadsheets don't split CSV rows on U+2028; ALM is implicit-only). Defense-in-depth note. |

Cycle-14 fixes re-verified individually correct (see "Cycle-14 Regression Check" below). Deferred carry-overs re-confirmed unchanged.

---

## DBG-15-01 — NaN GPS coordinate aborts a valid photo upload (MEDIUM, High confidence)

**File:** `apps/web/src/lib/process-image.ts:1446-1455` (`convertDMSToDD`, inside `extractExifForDb`)

```ts
const convertDMSToDD = (dms: number[], ref: string, maxDegrees: number) => {
    if (!dms || dms.length < 3) return null;
    if (dms[0] < 0 || dms[0] > maxDegrees || dms[1] < 0 || dms[1] >= 60 || dms[2] < 0 || dms[2] >= 60) return null;
    let dd = dms[0] + dms[1] / 60 + dms[2] / 3600;
    if (ref === 'S' || ref === 'W') dd = dd * -1;
    if (Math.abs(dd) > maxDegrees) return null;   // ← also false for NaN
    return dd;                                     // ← returns NaN
};
```

### Triggering input (concrete)
An uploaded photo whose EXIF GPS IFD carries a **zero-denominator rational** in any DMS component, e.g.:
- `GPSLatitude = [0/0, 30/1, 0/1]` (a single corrupt degree rational), or
- `GPSLatitude = [0/0, 0/0, 0/0]` (a full placeholder GPS IFD — some cameras/phones write a zeroed GPS IFD stub when there is no satellite fix).

`exif-reader@2.0.3` computes RATIONAL tags by division (`index.js:167` `readUInt32(...) / readUInt32(...)`), so a `0/0` rational decodes to `0/0 = NaN` (verified: `Number.isFinite(0/0) === false`). The DMS array therefore contains a `NaN` element.

This only matters when GPS is NOT stripped, which is the **default**: `strip_gps_on_upload` defaults to `'false'` (`gallery-config-shared.ts:96`). When the toggle is on, `images.ts:316-317` / `lr/upload/route.ts:317-318` null the coordinates and the bug is masked.

### Why the current guard does not catch it
The only finite-validation is the range comparison. Every comparison against `NaN` is `false`:
- `NaN < 0` → false, `NaN > 90` → false (degree check passes)
- the valid minute/second elements pass their own checks
- `dd = NaN + 30/60 + 0 = NaN`
- `Math.abs(NaN) > 90` → false (final guard passes)

So `convertDMSToDD` **returns `NaN`** instead of `null`. (`Infinity` from an `x/0` rational IS caught, because `Infinity > maxDegrees` is true — only the `0/0 → NaN` path slips through.)

### Failure (verified end-to-end)
1. `latitude`/`longitude` (`process-image.ts:1473-1474`) = `NaN`, returned from `extractExifForDb`.
2. Spread into `insertValues` (`images.ts:358`, `lr/upload/route.ts:366`) → `db.insert(images).values({ …, latitude: NaN, … })`.
3. Drizzle's mysql2 driver uses the **text protocol** (`drizzle-orm/mysql2/session.cjs:74,100,113` → `client.query(rawQuery, params)`), and mysql2@3.22.5 serializes `NaN` to a **bare token** (verified: `conn.format('INSERT INTO t VALUES (?)', [NaN]) === "INSERT INTO t VALUES (NaN)"`).
4. The emitted SQL is `INSERT INTO images (…, latitude, …) VALUES (…, NaN, …)`. MySQL parses bare `NaN` as an identifier → **`ER_BAD_FIELD_ERROR: Unknown column 'NaN' in 'field list'`** — the INSERT throws.
5. The per-file `try/catch` (`images.ts:481-498`, and the LR route's equivalent) logs the error, deletes the saved original, and pushes the file to `failedFiles`.

**Net effect:** a perfectly valid, fully-decodable photo is **silently rejected at upload** with no actionable reason surfaced to the admin — purely because of corrupt/placeholder GPS metadata that should have been coerced to `NULL`. The `latitude`/`longitude` columns are `double` (`schema.ts:43-44`), so the intended representation of "unknown coordinate" is `NULL`, exactly what every sibling numeric field already does.

### Why this is a clean, isolated gap
Every other numeric EXIF field in `extractExifForDb` is finite-guarded:
- `iso` / `f_number` / `focal_length` → `cleanNumber` (`process-image.ts:1423-1428`) which returns `null` on `!Number.isFinite(n)`.
- `exposure_time` → `normalizeExposureTime`, which even has an explicit anti-`NaN`/`Infinity` array guard (line 1407, "C8R-C8-02: guard against NaN/Infinity … to prevent nonsensical strings like `NaN/1`").
- `exposure_compensation` / `flash` → explicit `Number.isFinite` checks (lines 1508, 1526).

Only `latitude`/`longitude` (which bypass `cleanNumber` and go through `convertDMSToDD`) lack the guard. The exact same defensive thinking that produced C8R-C8-02 was simply not applied to the GPS conversion. This is the same class as the cycle-14 bavail-mock NaN bug (`undefined * 1024 = NaN`, `NaN < x = false`) — a `NaN` silently surviving relational comparisons.

### Reproduction
1. Set `strip_gps_on_upload = false` (default).
2. Upload a JPEG/HEIF whose `GPSLatitude` or `GPSLongitude` degree rational is `0/0` (any zero-denominator component). A minimal repro can be constructed by patching an EXIF GPS IFD's degree numerator+denominator to `0,0`.
3. Observe: the upload lands in the "failed" bucket; server log shows `Failed to process file …: Error: Unknown column 'NaN' in 'field list'`.

### Fix (one line; mirror `cleanNumber`)
Add a finite check before the final return (and/or up front on the components):

```ts
const convertDMSToDD = (dms: number[], ref: string, maxDegrees: number) => {
    if (!dms || dms.length < 3) return null;
    if (![dms[0], dms[1], dms[2]].every(Number.isFinite)) return null;   // ← NEW
    if (dms[0] < 0 || dms[0] > maxDegrees || dms[1] < 0 || dms[1] >= 60 || dms[2] < 0 || dms[2] >= 60) return null;
    let dd = dms[0] + dms[1] / 60 + dms[2] / 3600;
    if (ref === 'S' || ref === 'W') dd = dd * -1;
    if (!Number.isFinite(dd) || Math.abs(dd) > maxDegrees) return null;
    return dd;
};
```

A regression test belongs in `__tests__/process-image-metadata.test.ts`: feed `extractExifForDb({ gps: { GPSLatitude: [NaN, 30, 0], GPSLatitudeRef: 'N', … } })` and assert `latitude === null` (today it is `NaN`). The existing GPS tests only exercise valid rationals (`37/1 30/1 15/1`), so the gate is currently blind to this.

### Verification
`Number.isFinite(0/0) === false`; `NaN < 0 === false`, `NaN > 90 === false`, `Math.abs(NaN) > 90 === false` (run). `mysql2.format('… VALUES (?)', [NaN]) === "… VALUES (NaN)"` (run). drizzle `client.query` text-protocol path confirmed in `session.cjs`. `strip_gps_on_upload` default `'false'` confirmed.

**Similar issues:** both ingest paths share `extractExifForDb` (browser `app/actions/images.ts:312`; Lightroom `app/api/admin/lr/upload/route.ts:315`), so the single fix covers both. The backfill path does NOT re-extract EXIF, so it is unaffected.

---

## DBG-15-02 — 64-bit ISOBMFF box size missing MAX_SAFE_INTEGER guard (INFO)

**Files:** `lib/color-detection.ts:249`, `lib/gain-map-detection.ts:72`

```ts
size = Number(buffer.readBigUInt64BE(pos + 8));   // no `big > Number.MAX_SAFE_INTEGER` guard
```

`gps-exif-strip.ts:395` and the iloc `readSized` (`gps-exif-strip.ts:471-473`) both guard `big > BigInt(Number.MAX_SAFE_INTEGER)` before `Number(...)`; these two walkers do not. **No bug today** — a 64-bit size large enough to lose precision is necessarily `> buffer.length` (the header read is capped at 1 MB), so the immediate `if (size < headerSize || pos + size > buffer.length) break;` rejects it. Flagged only as a defensive-consistency gap (the repo's documented style prefers an explicit bound over relying on a downstream check). No action required unless aligning the four walkers.

---

## DBG-15-03 — Unicode sanitizer omits U+2028/U+2029/U+061C (INFO)

**File:** `lib/validation.ts:58` (`UNICODE_FORMAT_CHARS`), consumed by CSV (`csv-escape.ts`), OG (`og-sanitize.ts`), and every admin-string validator.

The set covers the canonical Trojan-Source reordering controls (U+202A-202E, U+2066-2069) and the zero-width/invisible block (U+200B-200F, U+2060, U+FEFF, U+180E, U+FFF9-FFFB), but NOT U+2028 LINE SEPARATOR, U+2029 PARAGRAPH SEPARATOR, or U+061C ARABIC LETTER MARK. These survive both the admin-write rejection and the CSV/OG strip. **Not exploitable:** CSV row-splitting is CR/LF only (the `[\r\n]+` collapse + quote-wrap already neutralize injection, and spreadsheets do not split rows on U+2028); ALM is an implicit bidi control that does not enable the explicit-override reordering attack. Recorded as a defense-in-depth completeness note for whenever the character set is next revised.

---

## Cycle-14 Regression Check (the brief's "regressions introduced by recent fixes")

All ten cycle-14 commits (`712def6f`…`2f886351`) audited; none introduced a regression.

| Commit | Change | Verdict |
|--------|--------|---------|
| `712def6f` | `ENV NEXT_MANUAL_SIG_HANDLE=true` (Dockerfile:103) | Correct. Next's competing `start-server.js` SIGTERM handler is now skipped; `instrumentation.ts` `gracefulShutdown` is the sole owner and ends with `process.exit(exitCode)` (0 clean / 1 truncated) — deterministic. SIGINT path symmetric; double-signal guarded by `shutdownInProgress`. |
| `b04bb98d` | LR-upload `bfree`→`bavail` (`lr/upload/route.ts:185`) | Correct. Now mirrors `images.ts:211`. Both disk pre-checks consistent. |
| `ff69b2ef` | bavail regression-gate repair + below-threshold negative test | Correct (the broken `undefined * 1024 = NaN` mock is now real). |
| `51497c4b` | `currentFlushPromise` await before shutdown buffer check (`data.ts:70,101-104,205-206,222-230`) | **Correct, and I specifically re-audited the microtask ordering.** The drain publishes `currentFlushPromise` before the swap; the finally re-arms a timer (≥ `BASE_FLUSH_INTERVAL_MS` = 5000 ms, never 0 — `getNextFlushInterval`) THEN nulls the promise + `resolveDrain()`; the shutdown flush awaits, then cancels the re-armed timer (lines 227-230) and drains any post-swap increments. The re-armed timer cannot fire before the awaiting continuation (microtask precedes the ≥5 s macrotask). No truncation, no lost drain. |
| `26069844` | lightbox-color-pip admin fields gated on `isAdmin` | Correct; mirrors `color-details-section.tsx`. |
| `cf7f4330` | icc-extractor `mluc` `dataSize < 16` guard (`icc-extractor.ts:95`) | Correct, and localized to the `mluc` branch (the shared outer `< 12` guard is untouched, so small valid `desc` profiles still parse). The read at `dataOffset+12` now has its 4 bytes guaranteed. |
| `58d7e83d`,`c6e98915`,`750833b0`,`2f886351` | test/a11y/SW-stamp | Non-runtime; no behavior change. |

---

## Areas inspected — NO new issues (hardened)

- **`gps-exif-strip.ts`** — JPEG/TIFF/ISOBMFF/WebP byte surgery: every walker is bounds-checked; the HEIF Exif extent end (`start + 4 + (length - 4)` = `start + length`) is correct; the `tiffStart += 6` "Exif\0\0" bump cannot read OOB (a pathological overshoot lands in the `tiffEnd - tiffStart < 8 → null` guard); the post-EOI-trailer rejection, ExtendedXMP reconstruction, and TIFF GPS-IFD zeroing are all sound. WebP padding `next <= offset` is dead-but-harmless.
- **`icc-extractor.ts`** — `mluc` record walk bounds (`recOffset+12`, `strEnd > dataOffset+dataSize`) correct; odd `recLen` UTF-16BE decode is graceful (TextDecoder, no throw); outer `try/catch` is the correct best-effort fallback.
- **`icc-chromaticity.ts`** — `invert3x3` guards `|det| < 1e-12` and `Number.isFinite(det)`; `xyzToXy` guards `|sum| < 1e-9`; `readS15Fixed16`/`readXyzTag`/`readChadMatrix` bounds-check every offset; tag-table walk capped at 100 tags / 4 KB.
- **`color-detection.ts`** — NCLX `colr` walker `limit = min(end, offset+1MB, buffer.length)`, `size < headerSize || pos+size > buffer.length` break, FullBox `meta` content-offset handling all correct.
- **`gain-map-detection.ts`** — `iinf`/`iref`/`infe` parsing bounds-checked; `readNullTerminatedAscii` clamps to buffer; refCount loop bounded (1024); heuristics 1+2 correct.
- **`process-image.ts`** — wide-gamut downscale: `WIDE_GAMUT_MAX_SOURCE_PIXELS` is validated to `[10M,200M]` (config) so the `?? 50_000_000` zero-coercion path is unreachable; `Math.sqrt(cap/basePixels)` + `Math.max(1, round(...))` safe; 10-bit AVIF `base.clone()` fallback correct (explicit `bitdepth:8`, idempotent re-apply of toColorspace/withIccProfile); atomic base-rename fallback chain sound. `decimalToRational` subnormal is the known DEFERRED carry-over (real exposure times never approach `Number.MIN_VALUE`).
- **`data.ts` view-count buffer** — atomic Map swap, chunked drain, retry-count cap (`MAX_VIEW_COUNT_RETRY_SIZE`), FIFO buffer-cap enforcement, backoff (≥5 s, capped 5 min) all correct.
- **`bounded-map.ts`** — `enforceHardCap` on `set`, collect-then-delete `prune`, shallow-copy `get`. Sound. (`entries()` raw-iterator is the known DEFERRED zero-caller carry-over.)
- **`view-retention.ts` / `audit.ts`** — both have the negative/non-finite guard (`Number.isFinite && > 0` → else default), chunked DELETE, iteration cap. No future-cutoff regression.
- **`exif-datetime.ts` / `parseExifDateTime`** — calendar validation via `Date.UTC` round-trip rejects Feb-30 etc.; timezone handled by storing camera-local components verbatim and rendering with `timeZone: 'UTC'`. No off-by-TZ.
- **`csv-escape.ts` / `og-sanitize.ts`** — C0/C1 strip, derived global UNICODE regex (no shared lastIndex), formula-prefix guard tolerant of leading whitespace. (See DBG-15-03 for the U+2028/2029 completeness note.)
- **`analytics.ts`** — `extractTldPlusOne` strips all trailing dots; `sanitizeReferrerHost` rejects non-http(s), private hosts (IPv6-bracket-aware), length-capped. URL parsing in try/catch.
- **`smart-collections.ts`** — `isScalarValue` (`Number.isFinite`) enforcement, depth/IN-count caps, LIKE escaping, parameterized binding throughout. `feed.xml` reduces are `entries.length > 0`-guarded; all `JSON.parse` sites are try/caught.
- **`instrumentation.ts`** — graceful shutdown sole-owner correctness confirmed (see cycle-14 table).
- **`image-queue.ts`** — claim/release, FIFO map pruning, permanently-failed cap, runtime-shape validation of the global state all sound. (Bootstrap re-enqueue is the known DEFERRED design-tradeoff carry-over.)

---

## Deferred carry-overs — re-confirmed, no change

- `decimalToRational` subnormal `"1/Infinity"` (`process-image.ts:1414-1421`) — unreachable with real EXIF exposure times.
- `BoundedMap.entries()` raw iterator (`bounded-map.ts:115-117`) — zero production callers.
- admin-token length-timing (`admin-tokens.ts`) — pre-hash length compare; deferred.
- tracer bootstrap re-enqueue (`image-queue.ts:687`) — bounded (≤3/restart), removing the path disables legitimate transient-failure recovery; design decision.

---

## Summary

**New confirmed findings: 1 (MEDIUM) + 2 (INFO).**
- **DBG-15-01 (MEDIUM, High):** `convertDMSToDD` (`process-image.ts:1446-1455`) lets a `0/0` GPS rational produce `NaN` (range guard uses NaN-blind `<`/`>` comparisons); the `NaN` reaches `db.insert(images)`, mysql2 text-protocol emits a bare `NaN` token, MySQL throws `Unknown column 'NaN'`, and the valid photo upload is rejected. Default config (`strip_gps_on_upload=false`) and both ingest paths are affected. Fix: one `Number.isFinite` guard mirroring the sibling `cleanNumber`. Verified end-to-end (exif-reader division, NaN comparison semantics, mysql2 serialization, drizzle text protocol, default config).
- **DBG-15-02 (INFO):** two ISOBMFF walkers omit the MAX_SAFE_INTEGER guard the other two apply — harmless today.
- **DBG-15-03 (INFO):** Unicode sanitizer omits U+2028/U+2029/U+061C — non-exploitable defense-in-depth gap.

**Cycle-14 regressions:** none. All ten commits verified correct; the `currentFlushPromise` microtask ordering specifically re-audited.
**Build gates:** GREEN at baseline (not re-run — read-only investigation).
