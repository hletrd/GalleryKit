# Test Engineer Review — Cycle 16

**HEAD at review time:** 1f5fb245
**Test suite baseline:** 2088 passed / 4 skipped (228 test files, 230 total)
**Review scope:** Verify cycle-15 TEST-GATE locks; full gap inventory across `__tests__/`

---

## Summary Table

| ID | File / Location | Gap Type | Regression That Slips Through | Severity |
|----|-----------------|----------|-------------------------------|----------|
| TE-16-01 | `sharing.ts:54`, `admin-users.ts:41`, `embeddings.ts:44` | Fix unlocked (CR-15-01) | Revert `count: entry.count + 1` to `entry.count++` — counter frozen at 1, rate limiting permanently open | HIGH |
| TE-16-02 | `migrate.js:636-637` | Fix unlocked (Critic-F1) | Remove `dropTableIfPresent('image_reactions')` + `dropColumnIfPresent('reaction_count')` — legacy DB retains dead schema, no failing test | HIGH |
| TE-16-03 | `csv-escape.ts:54` via `UNICODE_FORMAT_CHARS` | Missing case (deferred TE-15-06) | U+FFF9-FFFB interlinear anchors stripped by implementation but never asserted in `csv-escape.test.ts` | MEDIUM |
| TE-16-04 | `settings-hash.ts:42-51` `COLOR_IMPACTING_KEYS` | Incomplete guard | New byte-impacting setting added but not to `COLOR_IMPACTING_KEYS` — ETag never invalidates, wrong cached derivatives served forever | MEDIUM |
| TE-16-05 | `process-image.ts:1446-1461` `convertDMSToDD` | Missing edge cases | `Infinity` GPS rationals and coordinates beyond `maxDegrees` (lat > 90, lon > 180) — guarded but no test confirms behavior | LOW |
| TE-16-06 | `process-image.ts:1382-1410` `normalizeExposureTime` | Fix unlocked (C8R-C8-02) | `[NaN, 1]` must return null (not `"NaN/1"`), `[1, 0]` denominator-zero must return null, `[Infinity, 1]` must return null — guarded but no regression test | LOW |

---

## Cycle-15 TEST-GATE Verification

All four tests added in cycle 15 are **genuine locks** — reverting the corresponding fix causes a test failure.

### TE-15-01 — `bavail` source-lock (`lr-upload-hdr-gate.test.ts:212-213`)

```
expect(LR_SRC).toMatch(/stats\.bavail\b/)
expect(LR_SRC).not.toMatch(/stats\.bfree\b/)
```

Reverting `route.ts:185` from `bavail` to `bfree` fails the `.not.toMatch` line immediately. **GENUINE LOCK.**

### TE-15-02 — `currentFlushPromise` shutdown drain (`data-view-count-flush.test.ts:206-227`)

Two assertions added in cycle 15:
- `currentFlushPromise = new Promise` appears inside the `flushGroupViewCounts` function body (brace-depth walker isolates the correct function)
- `await currentFlushPromise` appears BEFORE `viewCountBuffer.size === 0` in `flushBufferedSharedGroupViewCounts`

Removing the `currentFlushPromise` assignment from `data.ts` fails the first assertion. Reversing the `await` / `size === 0` order fails the second. **GENUINE LOCK.**

### TE-15-03 — `revalidatePath`/`revalidateTag` in action-origin scanner (`check-action-origin.test.ts:131-160`)

`MUTATING_FUNCTION_NAMES` at `scripts/check-action-origin.ts:201-202` contains `'revalidatePath'` and `'revalidateTag'`. The fixture asserts that placing either call BEFORE `requireSameOriginAdmin()` triggers a FAIL. Removing either name from `MUTATING_FUNCTION_NAMES` lets the scanner accept the early-mutation pattern. **GENUINE LOCK.**

### TE-15-04 — SIGTERM handler + Dockerfile env (`instrumentation-sigterm.test.ts`)

Three pattern-checks via `readFileSync`:
- `process.on('SIGTERM', ...)` wired to `gracefulShutdown('SIGTERM')`
- `process.on('SIGINT', ...)` wired to `gracefulShutdown('SIGINT')`
- `ENV NEXT_MANUAL_SIG_HANDLE=true` in Dockerfile

Removing either handler registration or the Dockerfile env fails the corresponding assertion. **GENUINE LOCK.**

---

## Gap Detail

### TE-16-01 — BoundedMap shallow-copy pattern not source-locked (HIGH)

**Background:** Cycle-15 CR-15-01 fixed three files where `entry.count++` silently mutated the discarded shallow copy returned by `BoundedMap.get()`, leaving the stored counter frozen at 1 so the rate limit never accumulated.

**Files fixed:**
- `apps/web/src/app/actions/sharing.ts:54` — `const next = { count: entry.count + 1, resetAt: entry.resetAt };`
- `apps/web/src/app/actions/admin-users.ts:41` — `const next = { count: entry.count + 1, resetAt: entry.resetAt };`
- `apps/web/src/app/actions/embeddings.ts:44` — `const next = { count: entry.count + 1, resetAt: entry.resetAt };`

**What existing tests check:**
- `sharing-source-contracts.test.ts` — asserts `rollbackShareRateLimitFull` position; does NOT scan for `count: entry.count + 1`
- `admin-user-create-ordering.test.ts` — asserts `checkUserCreateRateLimit(ip)` is called; does NOT scan for the increment pattern
- `backfill-clip-embeddings-reembed.test.ts` — reads `embeddings.ts` but only for `--re-embed` flag logic

**Regression that slips through:** Reverting `sharing.ts:54` to `entry.count++` passes all 2088 tests. The share-write rate limit silently never accumulates past 1 request. Same for the other two files.

**Note on `auth-rate-limit.ts`:** NOT affected by CR-15-01. `getLoginRateLimitEntry()` at line 33 returns `{ ...entry }` already spread before callers mutate, so the existing increment pattern is correct.

**Tests to add:**

In `sharing-source-contracts.test.ts` (already reads `sharing.ts` source):
```ts
it('uses map.set with count: entry.count + 1, not entry.count++ (CR-15-01 BoundedMap shallow-copy)', () => {
    expect(source).toMatch(/count:\s*entry\.count\s*\+\s*1/);
    expect(source).not.toMatch(/entry\.count\+\+/);
    expect(source).not.toMatch(/entry\.count\s*\+=\s*1/);
});
```

Apply identical pattern to `admin-user-create-ordering.test.ts` (reading `admin-users.ts`) and a corresponding assertion for `embeddings.ts`.

---

### TE-16-02 — Reactions DROP in `reconcileLegacySchema` not pinned (HIGH)

**Background:** Cycle-15 Critic-F1 added two calls at `migrate.js:636-637` to clean up legacy DBs that ran migration `0007_image_reactions.sql`. The file `0014_drop_reactions.sql` is a journalless orphan — Drizzle never applies it. Only `reconcileLegacySchema` handles legacy cleanup.

**What `migrate-reconcile-coverage.test.ts` currently pins (lines 191-213):**
- `dropTableIfPresent(connection, 'entitlements')` — pinned (migration 0023)
- `dropColumnIfPresent(connection, dbName, 'images', 'license_tier')` — pinned (migration 0023)
- `dropTableIfPresent(connection, 'image_reactions')` — **NOT PINNED**
- `dropColumnIfPresent(connection, dbName, 'images', 'reaction_count')` — **NOT PINNED**

**Regression that slips through:** Removing lines 636-637 from `migrate.js` passes all 2088 tests. A legacy DB retains the dead `image_reactions` table and `images.reaction_count` column indefinitely.

**Tests to add** (append to `migrate-reconcile-coverage.test.ts` after the `license_tier` tripwire):

```ts
it('drops the image_reactions table in reconcile (Critic-F1, cycle-15)', () => {
    expect(
        /dropTableIfPresent\(\s*connection\s*,\s*['"]image_reactions['"]\s*\)/.test(migrateSrc),
        "reconcileLegacySchema must call dropTableIfPresent(connection, 'image_reactions') so a legacy DB drops the dead reactions table. 0014_drop_reactions.sql is a journalless orphan and Drizzle never applies it.",
    ).toBe(true);
});

it('drops the images.reaction_count column in reconcile (Critic-F1, cycle-15)', () => {
    expect(
        /dropColumnIfPresent\(\s*connection\s*,\s*dbName\s*,\s*['"]images['"]\s*,\s*['"]reaction_count['"]\s*\)/.test(migrateSrc),
        "reconcileLegacySchema must drop images.reaction_count on legacy databases.",
    ).toBe(true);
});
```

---

### TE-16-03 — CSV escape: U+FFF9-FFFB interlinear anchors not tested (MEDIUM)

**Implementation:** `csv-escape.ts:54` calls `value.replace(UNICODE_FORMAT_CHARS_G, '')` where `UNICODE_FORMAT_CHARS` (imported from `validation.ts:58`) is `/[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/`. U+FFF9-FFFB are included.

**Test gap:** `csv-escape.test.ts` covers bidi overrides, bidi isolates, U+200B-200F, U+2060, U+FEFF, U+180E — but has no case for U+FFF9 (INTERLINEAR ANNOTATION ANCHOR), U+FFFA (SEPARATOR), or U+FFFB (TERMINATOR).

`validation.test.ts` does assert `containsUnicodeFormatting('￹')` returns true, but that tests the validator, not `escapeCsvField`.

**Regression that slips through:** If `UNICODE_FORMAT_CHARS` is refactored to drop `￹-￻`, `escapeCsvField` silently stops stripping them. No csv-escape test catches it. The existing validation test catches the validator side but not the CSV export side.

**Test to add** (in `csv-escape.test.ts`):

```ts
it('strips U+FFF9-FFFB (interlinear annotation anchors) — C8R-RPL-01', () => {
    expect(escapeCsvField('￹value￻')).toBe('"value"');
    // Invisible anchor before formula char must not bypass the prefix guard
    expect(escapeCsvField('￹=exploit')).toBe('"\'=exploit"');
});
```

---

### TE-16-04 — `COLOR_IMPACTING_KEYS` exhaustiveness not pinned (MEDIUM)

**File:** `apps/web/src/lib/settings-hash.ts:42-51`

CLAUDE.md states: "A compile-time guard (`_ColorKeysAreSettingKeys`) catches a typo'd or removed key at `tsc`, but it CANNOT catch a forgotten *new* byte-impacting key."

`settings-hash.test.ts` tests that each of the current 9 keys individually causes the ETag to change (one `it()` per key). There is no assertion that `COLOR_IMPACTING_KEYS` has exactly 9 entries, nor that the array matches a known complete list.

**Regression that slips through:** A new admin setting (e.g., `avif_speed`) that changes derivative bytes is added to `GalleryConfig` and `gallery-config-shared.ts` but not to `COLOR_IMPACTING_KEYS`. The compile-time guard passes — every current key is still a valid setting key. All 2088 tests pass. Serve-upload ETags never change when that setting is toggled; clients cache wrong derivatives indefinitely.

**Test to add** (in `settings-hash.test.ts`):

```ts
it('COLOR_IMPACTING_KEYS contains exactly the expected set — exhaustiveness guard (AGG-R7C3-02)', () => {
    const EXPECTED: string[] = [
        'wide_gamut_jpeg_chroma',
        'sdr_jpeg_chroma',
        'avif_effort',
        'force_srgb_derivatives',
        'wide_gamut_max_source_pixels',
        'image_quality_webp',
        'image_quality_avif',
        'image_quality_jpeg',
        'image_sizes',
    ];
    // If this fails, a newly added byte-impacting setting was not added to
    // COLOR_IMPACTING_KEYS. See CLAUDE.md "Adding a new color-impacting setting".
    expect([...COLOR_IMPACTING_KEYS].sort()).toEqual(EXPECTED.slice().sort());
});
```

Requires exporting `COLOR_IMPACTING_KEYS` from `settings-hash.ts` (currently unexported).

---

### TE-16-05 — GPS: Infinity and out-of-bounds coordinates not tested (LOW)

**File:** `apps/web/src/lib/process-image.ts:1446-1461` (`convertDMSToDD`)

Cycle-15 DBG-15-01 tested the NaN guard (`Number.isFinite()` for all three DMS components plus the final `dd`). The same function has a `maxDegrees` bounds check:

```ts
if (dms[0] < 0 || dms[0] > maxDegrees || dms[1] < 0 || dms[1] >= 60 || dms[2] < 0 || dms[2] >= 60) return null;
```

Untested cases:
- `GPSLatitude: [Infinity, 0, 0]` — `Number.isFinite(Infinity)` is false → should return null
- `GPSLatitude: [91, 0, 0]` — `dms[0] > 90` → should return null
- `GPSLongitude: [181, 0, 0]` — `dms[0] > 180` → should return null

The implementation correctly handles all three, but no test confirms the behavior. A future refactor that removes or reorders the guards would pass all tests.

**Tests to add** (append to `process-image-metadata.test.ts`):

```ts
it('returns null latitude for GPS Infinity rational', () => {
    const r = extractExifForDb({ gps: { GPSLatitude: [Infinity, 0, 0], GPSLatitudeRef: 'N', GPSLongitude: [0, 0, 0], GPSLongitudeRef: 'E' } });
    expect(r.latitude).toBeNull();
});

it('returns null latitude for out-of-range degrees > 90', () => {
    const r = extractExifForDb({ gps: { GPSLatitude: [91, 0, 0], GPSLatitudeRef: 'N', GPSLongitude: [0, 0, 0], GPSLongitudeRef: 'E' } });
    expect(r.latitude).toBeNull();
});

it('returns null longitude for out-of-range degrees > 180', () => {
    const r = extractExifForDb({ gps: { GPSLatitude: [0, 0, 0], GPSLatitudeRef: 'N', GPSLongitude: [181, 0, 0], GPSLongitudeRef: 'E' } });
    expect(r.longitude).toBeNull();
});
```

---

### TE-16-06 — `normalizeExposureTime` degenerate array inputs not tested (LOW)

**File:** `apps/web/src/lib/process-image.ts:1404-1409`

The source comment at line 1405 reads `C8R-C8-02: guard against NaN/Infinity in numerator/denominator to prevent nonsensical strings like "NaN/1" from being stored (DBG-NEW-1)`. The guard:

```ts
if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'number' && typeof val[1] === 'number'
    && val[1] !== 0 && Number.isFinite(val[0]) && Number.isFinite(val[1])) {
    return `${val[0]}/${val[1]}`;
}
```

No test in `__tests__/` covers these cases. `process-image-metadata.test.ts` tests GPS NaN (from the same cycle) but not exposure-time NaN. The function is not exported but `extractExifForDb` is.

**Tests to add** (append to `process-image-metadata.test.ts`, adjusting argument shape to match `ExifDataRaw`):

```ts
it('normalizeExposureTime: [NaN, 1] returns null or non-NaN string (C8R-C8-02)', () => {
    const r = extractExifForDb({ exif: { ExposureTime: [NaN, 1] } });
    expect(r.exposure_time ?? '').not.toContain('NaN');
});

it('normalizeExposureTime: [1, 0] denominator zero returns null or non-divide-by-zero string', () => {
    const r = extractExifForDb({ exif: { ExposureTime: [1, 0] } });
    expect(r.exposure_time ?? '').not.toMatch(/\/0($|[^.0-9])/);
});

it('normalizeExposureTime: [Infinity, 1] returns null or non-Infinity string', () => {
    const r = extractExifForDb({ exif: { ExposureTime: [Infinity, 1] } });
    expect(r.exposure_time ?? '').not.toContain('Infinity');
});
```

---

## E2E Coverage Observations

### Acknowledged gap — `/s/[key]` 200-path (TEST-R5C3-08)

`public.spec.ts` contains an explicit `test.skip` guard with a TODO comment:

> `// TODO (TEST-R5C3-08 / plan-327 deferred entry 1): the /s/[key] 200-path has NO e2e coverage until a share key is seeded`

The test is already written and will auto-run when `E2E_SHARE_KEY` is seeded in the CI fixture. No action needed beyond that deferred item.

### Admin e2e: upload covered; shared group creation and DB restore not covered

`admin.spec.ts` covers: unauthenticated redirect, login, wrong-password rate limit, GPS toggle, topic CRUD, upload. Not covered:
- Creating a shared group from the admin UI and verifying the resulting `/g/[key]` route is publicly accessible
- DB backup download (authenticated `GET /api/admin/db/download`)
- Admin backfill re-encode trigger

These are lower priority (all paths are unit-tested), but shared group creation + public access is a meaningful cross-boundary flow. The others are admin-internal.

---

## Well-Covered Areas (no action needed)

| Area | Test file(s) | Confidence |
|------|-------------|------------|
| SIGTERM/SIGINT handler + Dockerfile env (TE-15-04) | `instrumentation-sigterm.test.ts` | GENUINE LOCK |
| `currentFlushPromise` shutdown drain (TE-15-02) | `data-view-count-flush.test.ts:206-227` | GENUINE LOCK |
| `bavail` source-lock (TE-15-01) | `lr-upload-hdr-gate.test.ts:212-213` | GENUINE LOCK |
| `revalidatePath`/`revalidateTag` action-origin (TE-15-03) | `check-action-origin.test.ts:131-160` | GENUINE LOCK |
| GPS NaN fix (DBG-15-01) | `process-image-metadata.test.ts:171-183` | GENUINE LOCK |
| `icc_profile_name`/`bit_depth` admin-only gate (SEC-15-01) | `color-details-section-delivered.test.ts` | GENUINE LOCK |
| GPS strip (JPEG/AVIF/WebP/TIFF/PNG, XMP, ExtendedXMP, post-EOI trailer) | `strip-gps-from-original.test.ts` | Extensive |
| CSV escape (bidi, isolates, ZWSP, BOM, MVS, C0/C1, formula injection) | `csv-escape.test.ts` | Extensive (U+FFF9-FFFB gap only) |
| `icc-chromaticity` (sRGB/P3/DCI-P3/AdobeRGB/ProPhoto/Rec.2020, chad, truncated) | `icc-chromaticity.test.ts` | Extensive |
| Color detection (NCLX codes, ICC name, HDR transfer, full map) | `color-detection.test.ts` | Good |
| Color pipeline decisions (`resolveColorPipelineDecision`, `resolveAvifIccProfile`) | `color-pipeline-decision.test.ts` | Good |
| Process-image color round-trip (sRGB/P3/Adobe/ProPhoto/Rec.2020, 10-bit probe, 4:4:4) | `process-image-color-roundtrip.test.ts` | Extensive |
| Serve-upload ETag format, 304, 499, symlink rejection | `serve-upload.test.ts` | Good |
| Settings-hash per-key ETag sensitivity (all 9 keys individually) | `settings-hash.test.ts` | Good (count exhaustiveness gap — TE-16-04) |
| Backfill concurrency cap formula | `admin-backfill-concurrency-cap.test.ts` | Extensive |
| Migration journal monotonicity and tag→file mapping | `migration-journal.test.ts` | Good |
| `reconcileLegacySchema` entitlements/license_tier DROP | `migrate-reconcile-coverage.test.ts` | Pinned (reactions gap — TE-16-02) |
| Auth rate-limit BoundedMap (NOT affected by CR-15-01) | `auth-rate-limit.test.ts` | Good — `getLoginRateLimitEntry()` returns spread copy before mutation |
| AVIF post-encode NCLX/ICC verification | `process-image-post-encode-verification.test.ts` | Good |
| `action-origin` scanner (all 4 patterns) | `check-action-origin.test.ts` | Extensive |
| API auth wrapper coverage | `check-api-auth.test.ts` | Good |
| Public route rate-limit coverage | `check-public-route-rate-limit.test.ts` | Good |
| `tag_names` SQL aggregation contract | `data-tag-names-sql.test.ts` | Good |
| Blur data URL wiring (producer/write/consumer) | `process-image-blur-wiring.test.ts`, `images-action-blur-wiring.test.ts` | Good |
| SW template contract + LRU ETag + HEAD timeout | `sw-template-contract.test.ts` | Good |
| OG sanitizer shared import (all 3 consumers) | `sanitize-for-og-global.test.ts`, `og-sanitize.test.ts` | Good |
| Privacy field split (`_PrivacySensitiveKeys` guard) | `privacy-fields.test.ts` | Good |
| Touch-target audit (44 px floor) | `touch-target-audit.test.ts` | Good |
| i18n key parity (en/ko) | `i18n-parity.test.ts` | Good |

---

## Verification

Test suite at HEAD (before any new tests added):

```
npm test --workspace=apps/web
```

Expected: 2088 passed / 4 skipped. After adding TE-16-01 through TE-16-06 fixes and their corresponding tests: ~2098+ passed.
