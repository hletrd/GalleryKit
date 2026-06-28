# Verifier Report — Cycle 21
Date: 2026-06-29
HEAD: 993ed471

---

## Authoritative Gate Baseline

| Gate | Status | Detail |
|------|--------|--------|
| ESLint (`lint`) | PASS (exit 0) | No errors |
| TypeScript (`typecheck`) | PASS (exit 0) | `typecheck:app` + `typecheck:scripts` — 0 errors |
| Vitest (`test`) | PASS (exit 0) | **238 files passed / 2 skipped; 2168 tests passed / 4 skipped** (+2 files, +13 tests vs cycle-20 baseline) |
| `lint:api-auth` | PASS (exit 0) | 2 files checked — all OK |
| `lint:action-origin` | PASS (exit 0) | 41 exports checked (6 exempt) — all mutating actions enforce same-origin |
| `lint:public-route-rate-limit` | PASS (exit 0) | 6 public route files checked — all OK or no mutating handlers |

All 6 gates green at HEAD 993ed471.

---

## Cycle-20 Fix Verification (T1–T7)

### T1 — Env-parse scientific-notation sweep

**Claimed:** All `parseInt(env, 10)` integer-env sites switched to `Number(env)`. Sites: `audit.ts`, `process-image.ts` (×2), `actions/images.ts`, `rate-limit.ts`, `upload-limits.ts`.

**Evidence:**
- `lib/audit.ts:116` — `Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? '')` with R20C20 comment.
- `lib/process-image.ts:46,334,344` — `Number(process.env.SHARP_CONCURRENCY)`, `Number(process.env.IMAGE_MAX_INPUT_PIXELS)`, `Number(process.env.IMAGE_MAX_INPUT_PIXELS_TOPIC)`.
- `app/actions/images.ts:797` — `Math.max(1, Number(process.env.IMAGE_CLEANUP_CONCURRENCY ?? '') || 5)`.
- `lib/rate-limit.ts:147` — `Number(value)` with `Number.isInteger(parsed) && parsed >= 1` guard retained.
- `lib/upload-limits.ts:15` — `Math.floor(Number(rawValue))` in `parsePositiveIntEnv` helper.
- Full sweep via `grep -rn "parseInt.*process\.env"` across `src/` — **0 hits** (no remaining env-parsing parseInt calls outside comments).
- New tests: `upload-limits-env.test.ts` (5 cases, including `'2e9'`→2_000_000_000), `audit-retention.test.ts` extended (`'1e3'`→1000 days at line 91), `rate-limit.test.ts` extended (`getTrustedProxyHopCount('1e1') === 10`).

**Status: VERIFIED (high confidence)**

---

### T2 — gps-strip `walkAborted` honored on items-found path

**Claimed:** `walkAborted` check moved to fire UNCONDITIONALLY (before empty-items branch), so a walk that found ≥1 Exif item then aborted on a later malformed box returns `null` instead of `{stripped:true}`.

**Evidence:**
- `lib/gps-exif-strip.ts:461-470` — R20C20 comment block explains the fix. `if (walkAborted) return null;` at line 470 fires BEFORE the `if (exifItemIds.size === 0 && xmpItemIds.size === 0)` branch — unconditional.
- `__tests__/gps-exif-strip-isobmff.test.ts:105-127` — discriminator test: (a) container with one Exif infe + empty iloc + oversized trailing box → `toBeNull()`; (b) same container WITHOUT the malformed trailing box → `{stripped:false}`. The discriminator eliminates false tautology — the null comes from `walkAborted`, not from the Exif item or empty iloc.

**Status: VERIFIED (high confidence)**

---

### T3 — a11y focus-visible siblings (D20-01/02/03/04)

**Claimed:** Added `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to nav-client topic pills, admin-nav section links, timeline year-scrubber pills, g/[key] back-links, and fixed lightbox-color-pip inner buttons.

**Evidence:**
- `components/nav-client.tsx:127` — `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` on topic pill Links.
- `components/admin-nav.tsx:40` — `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` on section links.
- `app/[locale]/(public)/timeline/page.tsx:135,154` — `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` on year-scrubber pills and year-in-review link.
- `app/[locale]/(public)/g/[key]/page.tsx:140,172` — `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` on both back-link branches.
- `components/lightbox-color-pip.tsx:223,305` — inner expanded-panel buttons now carry `focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black`.
- `__tests__/focus-visible-rings-cycle20.test.ts` — 4 describe blocks pin all five controls.

**D20-02 plan-to-code divergence (VER21-01):** The cycle-20 plan said "replace `ring-white` with `ring-ring ring-offset-2 ring-offset-black`" but the implementation kept `ring-white` and added the offset (`ring-white ring-offset-2 ring-offset-black`). The test is aligned with the implementation. WCAG 2.4.11 is satisfied (enclosing gap provided by the offset). This is not a defect — white against a `ring-offset-black` gap is actually higher-contrast on the dark lightbox overlay than the design-system `ring-ring` token would be. However, the plan's prescription was not followed exactly and the test description says "ring-white inner buttons now carry a ring offset," which matches code but diverges from the plan.

**Status: VERIFIED (with D20-02 note above)**

---

### T4 — A2 stale comments corrected

**Claimed:** Both search route files' enrichment-select comments corrected from "in lib/data.ts" to `lib/search-enrichment-fields.ts`.

**Evidence:**
- `app/api/search/semantic/route.ts:295` — `searchEnrichmentSelectFields in lib/search-enrichment-fields.ts`.
- `app/api/search/similar/[id]/route.ts:196` — same corrected comment.
- Both files import from `'@/lib/search-enrichment-fields'` directly (lines 55 and 44 respectively).

**Status: VERIFIED (high confidence)**

---

### T5 — OG cold-path per-attempt timeout lowered + deadline test

**Claimed:** `OG_PHOTO_FETCH_TIMEOUT_MS` lowered to 3500 ms (below `OG_PHOTO_TOTAL_BUDGET_MS` = 10000 ms); fake-timers deadline test added.

**Evidence:**
- `lib/og-photo-fetch.ts:41` — `const OG_PHOTO_FETCH_TIMEOUT_MS = 3500;` with R20C20 comment.
- `lib/og-photo-fetch.ts:54` — `export const OG_PHOTO_TOTAL_BUDGET_MS = 10000;`
- `lib/og-photo-fetch.ts:108-120` — `deadline = Date.now() + OG_PHOTO_TOTAL_BUDGET_MS`; loop breaks on `Date.now() >= deadline`.
- `__tests__/og-photo-fallback.test.ts:167-194` — R20C20 FINDING-1 test: `vi.useFakeTimers()`, starts at t=0, first mock fetch advances time to `OG_PHOTO_TOTAL_BUDGET_MS + 1`, asserts `calls.toHaveLength(1)` from 4 available sizes. If the deadline check were deleted or inverted, the loop would continue through all 4 sizes and the assertion would fail. Non-tautological.
- `__tests__/og-photo-fallback.test.ts:88` — asserts `OG_PHOTO_TOTAL_BUDGET_MS > 3500` as a guard.

**Status: VERIFIED (high confidence)**

---

### T6 — bounded-map `.data` live-ref documentation

**Claimed:** Either copy-on-read or a load-bearing doc comment warning on `.data`.

**Evidence:**
- `lib/bounded-map.ts:52-59` — R20C20 (CQ20-07) comment block: "this is a LIVE reference — intentionally … callers MUST NOT mutate entry values obtained via `.data`". Implementation chose doc warning (not copy-on-read).
- The `get()` and `entries()` paths still use `copyValue()` (shallow copy), so external callers via the normal API are protected; only `.data` is the live-ref path.

**Status: VERIFIED (high confidence)** — doc warning path chosen (acceptable per plan).

---

### T7 — Doc-gap closures in CLAUDE.md

**Claimed:** Key-Files rows for `og-photo-fetch.ts`, `color-label.ts`, `search-enrichment-fields.ts`; `has_gain_map` column updated with `infe`; `was_downscaled` column row added.

**Evidence:**
- `CLAUDE.md:128` — `lib/og-photo-fetch.ts` row added with OG_PHOTO_FETCH_TIMEOUT_MS / OG_PHOTO_TOTAL_BUDGET_MS note.
- `CLAUDE.md:129` — `lib/color-label.ts` row added.
- `CLAUDE.md:130` — `lib/search-enrichment-fields.ts` row added.
- `CLAUDE.md:166` — `has_gain_map` row now reads `iinf`/`infe`/`iref` (added `infe`).
- `CLAUDE.md:167` — `was_downscaled` column row added with admin-only designation.

**Status: VERIFIED (high confidence)**

---

## Behavioral Claim Verification (CLAUDE.md vs Code)

### Claim A — publicSelectFields omits every PII key; compile-time guard enforces it

**Evidence:**
- `lib/data.ts:463` — `type PrivacySensitiveKeys = 'latitude' | 'longitude' | … (20 keys)`.
- `lib/data.ts:465` — `_SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>`.
- `lib/data.ts:466` — `_privacyGuard: _SensitiveKeysInPublic extends never ? true : [_SensitiveKeysInPublic, 'ERROR: …'] = true`.
- `typecheck` exits 0 — guard passes, no sensitive key in public fields.

**Status: MATCH (high confidence)**

---

### Claim B — Advisory lock names match CLAUDE.md documentation (6 locks + per-image)

**Evidence in `lib/advisory-locks.ts`:**
| CLAUDE.md name | Constant | Match |
|---|---|---|
| `gallerykit_db_restore` | `LOCK_DB_RESTORE` | ✓ |
| `gallerykit_upload_processing_contract` | `LOCK_UPLOAD_PROCESSING_CONTRACT` | ✓ |
| `gallerykit_topic_route_segments` | `LOCK_TOPIC_ROUTE_SEGMENTS` | ✓ |
| `gallerykit_admin_delete` | `LOCK_ADMIN_DELETE` | ✓ |
| `gallerykit_color_pipeline_backfill` | `LOCK_COLOR_PIPELINE_BACKFILL` | ✓ |
| `gallerykit:image-processing:{jobId}` | `getImageProcessingLockName(jobId)` | ✓ |

**Status: MATCH (high confidence)**

---

### Claim C — COLOR_IMPACTING_KEYS contains exactly 9 entries

**Evidence:**
`lib/settings-hash.ts:45-59` — array has 9 entries: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`. Compile-time guard `_ColorKeysAreSettingKeys` passes at tsc exit 0.

**Status: MATCH (high confidence)**

---

### Claim D — ETag format W/"v{pipeline_version}-{mtimeMs}-{size}-{settingsHash}"

**Evidence:**
`lib/serve-upload.ts:215` — `const etag = \`W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"\`;`

Exactly matches CLAUDE.md description. `getServingColorSettingsHash()` called at line 214.

**Status: MATCH (high confidence)**

---

### Claim E — Rate-limit buckets use BoundedMap, not bare Map

**Evidence:**
- `lib/rate-limit.ts:77,89,105,107,317` — `ogRateLimit`, `shareRateLimit`, `loginRateLimit`, `searchRateLimit`, `semanticRateLimit` all created via `createResetAtBoundedMap` or `createWindowBoundedMap`.
- `lib/auth-rate-limit.ts:19,105` — `accountLoginRateLimit`, `passwordChangeRateLimit` use `createWindowBoundedMap`.
- No `new Map()` calls for rate-limit state. Oldest-entry eviction bounded by `MAX_KEYS` constants.

**Status: MATCH (high confidence)**

---

### Claim F — View-retention GC uses chunked DELETE with MAX_BATCHES cap

**Evidence:**
- `lib/view-retention.ts:37` — `MAX_BATCHES_PER_TABLE = 200`.
- `lib/view-retention.ts:77-89` — loop `for (let i = 0; i < MAX_BATCHES_PER_TABLE; i++)` with `.limit(VIEW_PURGE_BATCH)` drizzle DELETE; breaks early when `affected < VIEW_PURGE_BATCH`.
- Negative/non-finite `VIEW_RETENTION_DAYS` falls back to 395-day default via `Number.isFinite(retentionDays) && retentionDays > 0` guard at line 51.

**Status: MATCH (high confidence)** — consistent with CLAUDE.md's "chunked DELETE" and "never a future cutoff" claims.

---

### Claim G — OG home card points at /api/og/photo/<latestId>

**Evidence:**
- `app/[locale]/(public)/page.tsx:118` — `url: absoluteImageUrl('/api/og/photo/${latestImage.id}', seo.url)` on the default path.
- Admin `seo.og_image_url` override branch at line 63 only fires when explicitly configured.

**Status: MATCH (high confidence)**

---

## Findings

### VER21-01 (LOW, doc/plan divergence, not a code defect)
**D20-02 lightbox ring-white kept vs. ring-ring replacement prescribed**

Plan prescribed replacing `ring-white` with `ring-ring ring-offset-2 ring-offset-black` on `lightbox-color-pip.tsx` inner buttons. Implementation kept `ring-white` and added `ring-offset-2 ring-offset-black`. Both satisfy WCAG 2.4.11 (enclosing gap). White on `ring-offset-black` is higher-contrast than `ring-ring` on a dark overlay. The test (`focus-visible-rings-cycle20.test.ts:D20-02`) is aligned with the code. No behavioral defect. The plan's description diverges from the delivered implementation, but the spirit of the fix was fulfilled.

**Confidence: high** — implementation is functionally correct, plan description is stale.

---

### VER21-02 (LOW, expected-deferred state)
**audit.ts DELETE remains unbounded (E2 DEFERRED)**

`lib/audit.ts:117` still issues an unbounded `DELETE WHERE created_at < cutoff` with no LIMIT+loop pattern (unlike `view-retention.ts`). This was explicitly deferred in the cycle-20 plan. Expected state. The audit log is low-write-rate so lock-duration risk is small. Consistent with the deferred record.

**Confidence: high** — this is a documented deferred item, not a regression.

---

### VER21-03 (INFO, correct existing behavior)
**Remaining `parseInt(str, 10)` calls in URL-parsing contexts are correct**

7 `parseInt(str, 10)` calls remain in `topics.ts`, `session.ts`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `og/photo/[id]/route.tsx`, `dashboard/page.tsx`. All parse URL path segments or query parameters (not env vars). Scientific-notation strings don't appear in URL segments. These are correct uses of `parseInt` — the T1 sweep did not overreach.

**Confidence: high** — no false negatives in T1.

---

## Test Adequacy — New Tests (cycle-20 additions)

| Test file | Added tests | Tautology risk | Assessment |
|-----------|-------------|----------------|------------|
| `upload-limits-env.test.ts` | 5 (new file) | None — dynamically reloads module per env config | Non-tautological |
| `audit-retention.test.ts` | 1 (`'1e3'` case) | None — asserts cutoff = now − 1000 days, not 1 day | Non-tautological |
| `rate-limit.test.ts` | 1 (TRUSTED_PROXY_HOPS 1e1) | None — asserts return value = 10, not 1 | Non-tautological |
| `gps-exif-strip-isobmff.test.ts` | 1 (walkAborted items-found) | Mitigated — discriminator negative case proves causality | Non-tautological |
| `og-photo-fallback.test.ts` | 1 (fake-timers deadline) | Mitigated — asserts 1 call not 4; would fail if check deleted | Non-tautological |
| `focus-visible-rings-cycle20.test.ts` | 4 describe blocks (new file) | None — source-contract assertions | Non-tautological |

**No tautological tests found in new cycle-20 additions.**

---

## Verdict

**Status: PASS**
**Confidence: high**
**Blockers: 0**

All 6 gates green at HEAD 993ed471 (238 files / 2168 tests passed). All T1–T7 cycle-20 fixes are present in the code and behave as documented. All 7 behavioral CLAUDE.md claims MATCH the actual code with file:line evidence. No tautological tests found in new additions. Two findings identified: VER21-01 (plan-to-code divergence for D20-02, not a defect), VER21-02 (E2 audit DELETE unbounded, expected-deferred). No regression observed from cycle-20 changes.

**Recommendation: APPROVE**
