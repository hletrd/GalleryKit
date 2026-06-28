# Document Specialist Report — Cycle 21

Date: 2026-06-29
Source of truth: codebase at HEAD (2a9976a1)
Scope: CLAUDE.md factual claims vs code

---

## Cycle-20 Gap Closure Verification

All 5 cycle-20 GAPs were closed in commit 7be969e9:

| Cycle-20 GAP | Closed? | Evidence |
|---|---|---|
| Key Files row for `og-photo-fetch.ts` | YES | CLAUDE.md now has the row |
| Key Files row for `color-label.ts` | YES | CLAUDE.md now has the row |
| Key Files row for `search-enrichment-fields.ts` | YES | CLAUDE.md now has the row |
| `was_downscaled` missing from images column table | YES | Row present with public-safe note |
| `has_gain_map` missing `infe` box reference | YES | Now reads "HEIF `iinf`/`infe`/`iref`" |

---

## Findings

### DOC21-01 — IMAGE_PIPELINE_VERSION = 7
- Claim: `IMAGE_PIPELINE_VERSION` (currently 7) is DEFINED in `gallery-config-shared.ts:21`
- Code: `gallery-config-shared.ts:21` — `export const IMAGE_PIPELINE_VERSION = 7;`
- **MATCH**
- Confidence: High

### DOC21-02 — COLOR_IMPACTING_KEYS count = 9, list correct
- Claim: "covers all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:45-57`) — the 5 color keys … the 3 quality keys … and `image_sizes`"
- Code: `settings-hash.ts:45-57` — array of exactly 9 entries: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`
- **MATCH**
- Confidence: High

### DOC21-03 — Advisory lock names (6 locks)
- Claim: names `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`
- Code: `lib/advisory-locks.ts` exports all 6 constants with identical string values
- **MATCH**
- Confidence: High

### DOC21-04 — OG photo route timeout / budget / size constants
- Claim: `OG_PHOTO_FETCH_TIMEOUT_MS` 3500 ms, `OG_PHOTO_TOTAL_BUDGET_MS` 10 s (10000 ms), `OG_PHOTO_MAX_BYTES` 1 MB
- Code: `og-photo-fetch.ts:31` = `1024 * 1024`; `:41` = `3500`; `:54` = `10000`
- **MATCH**
- Confidence: High

### DOC21-05 — Argon2id parameters
- Claim: Argon2id, memoryCost=65536, timeCost=3, parallelism=4 — exceeds OWASP minimums
- Code: `password-hashing.ts` — `type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4`
- **MATCH**
- Confidence: High

### DOC21-06 — MySQL connection pool: 10 connections, queue 20, keepalive
- Claim: "Connection pool: 10 connections, queue limit 20, keepalive enabled"
- Code: `db/index.ts` — `connectionLimit: 10`, `queueLimit: 20`, `keepAliveInitialDelay: 30000`
- **MATCH**
- Confidence: High

### DOC21-07 — IMAGE_MAX_INPUT_PIXELS / IMAGE_MAX_INPUT_PIXELS_TOPIC defaults
- Claim: `IMAGE_MAX_INPUT_PIXELS` default 268435456, `IMAGE_MAX_INPUT_PIXELS_TOPIC` default 67108864
- Code: `process-image.ts` — `256 * 1024 * 1024 = 268435456`; `64 * 1024 * 1024 = 67108864`
- **MATCH**
- Confidence: High

### DOC21-08 — Nginx body-size caps
- Claim: 2 MiB global, 64 KiB login, 250 MiB DB restore, 216 MiB admin uploads, 2 MiB catch-all, 216 MiB LR upload
- Code: `nginx/default.conf` — line 31: `2m`, line 58: `64k`, line 75: `250m`, line 92: `216m`, line 108: `2m`, line 132: `216m`
- **MATCH**
- Confidence: High

### DOC21-09 — Rate-limit buckets
- Claim: login rate-limit uses per-IP and per-account buckets (DB backup); OG/share/search/semantic are process-local BoundedMaps
- Code: `rate-limit.ts` — `ogRateLimit`, `shareRateLimit`, `searchRateLimit`, `semanticRateLimit` all `new BoundedMap(...)`, no DB persistence; `auth-rate-limit.ts` — per-IP Map + per-account Map with DB backup via `getAdminLoginAttempts` / `incrementAdminLoginAttempts`
- **MATCH**
- Confidence: High

### DOC21-10 — React cache() wraps exactly 10 functions
- Claim: "every `data.ts` export ending in `Cached` … plus `getSeoSettings`" — lists 9 `*Cached` + 1 `getSeoSettings`
- Code: `data.ts` — 9 `Cached` exports + `getSeoSettings` wrapped with `cache()` = 10 total
- **MATCH**
- Confidence: High

### DOC21-11 — ADMIN_BACKFILL_CONCURRENCY cap formula and result
- Claim: `max(1, floor((POOL_CONNECTION_LIMIT − RESERVED − 1) / 2))` with `RESERVED = max(3, ceil(POOL_CONNECTION_LIMIT / 2))` → cap = 2 at pool size 10
- Code: `admin-backfill-runner.ts:105-142` — `BACKFILL_RESERVED_LIVE_CONNECTIONS = (n) => Math.max(3, Math.ceil(n / 2))`, cap formula `Math.max(1, Math.floor((limit - reserved - 1) / 2))`; at limit=10, reserved=5, cap=2
- **MATCH**
- Confidence: High

### DOC21-12 — HEAD_REVALIDATE_TIMEOUT_MS = 300 ms
- Claim: "bounded by `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` (300 ms)"
- Code: `sw.template.js:38` = `const HEAD_REVALIDATE_TIMEOUT_MS = 300;` (same in `sw.js`)
- **MATCH**
- Confidence: High

### DOC21-13 — smart_collections.query_json at schema.ts:297
- Claim: "JSON predicate AST in the `query_json` column (`schema.ts:297`)"
- Code: `schema.ts:297` — `query_json: text("query_json").notNull()`
- **MATCH**
- Confidence: High

### DOC21-14 — Smart collection route /c/[slug]
- Claim: "The public route `/c/[slug]` renders a smart collection"
- Code: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx` exists; `/s/[key]` is the separate shared-links route
- **MATCH**
- Confidence: High

### DOC21-15 — NCLX transfer function 18 = HLG
- Claim: "`18=HLG`"
- Code: `color-detection.ts:212` — `18: 'hlg',     // ARIB STD-B67`
- **MATCH**
- Confidence: High

### DOC21-16 — DEFAULT_SERVER_ACTION_UPLOAD_BODY_BYTES derivation
- Claim: `NEXT_UPLOAD_BODY_MAX_BYTES` default ~266 MiB
- Code: `upload-limits.ts:6` — `Math.max(200 MiB, 250 MiB) + 16 MiB = 266 MiB = 278921216`; CLAUDE.md says "~266 MiB"
- **MATCH**
- Confidence: High

### DOC21-17 — Cycle-20 new column rows (was_downscaled, og-photo-fetch.ts, color-label.ts, search-enrichment-fields.ts, infe)
- All 5 rows present and accurate in CLAUDE.md after commit 7be969e9
- **MATCH**
- Confidence: High

---

## MISMATCH

### DOC21-M1 — Advisory-lock scope note misdescribes `gallerykit_topic_route_segments` scope (LOW)
- **CLAUDE.md claim** (Race Condition Protections scope note): "Two GalleryKit instances … will serialize each other's restores, upload-contract changes, **topic renames**, admin-user deletes, backfill runs, and image-processing claims across tenants."
- **Code reality** (`topics.ts`): `withTopicRouteMutationLock` is invoked from THREE functions — `createTopic` (line 137), `updateTopic` (line 244), and `createTopicAlias` (line 484). The lock serializes topic CREATE, topic UPDATE (which includes slug rename), and topic ALIAS creation — not only slug renames.
- **Severity**: Low. The scope note is in a multi-tenant collision warning. Under-describing the scope means an operator debugging a `TopicRouteLockTimeoutError` on topic creation or alias creation would not expect the lock, leading to confusion. No data-loss risk.
- **Suggested fix**: Change "topic renames" to "topic route mutations (create, update/rename, alias creation)" in the advisory-lock scope note.
- Confidence: High

---

## GAPs

### DOC21-G1 — `color_space`, `icc_profile_name`, `bit_depth` rows lack explicit admin-only label (MEDIUM)
- **Section**: "images color/HDR columns (admin-only via `_PrivacySensitiveKeys` guard)" table
- **Current state**: Section header contains the blanket `(admin-only)` qualifier. However, the Notes cells for the three rows `color_space`, `icc_profile_name`, and `bit_depth` contain only descriptive content with no explicit "admin-only" tag. The two public exceptions (`color_primaries` and `avif_10bit`) are explicitly labeled "public" and "public-safe (R10-M4)" respectively in their Notes cells. A reader scanning individual rows (not the header) may incorrectly assume the unlabeled rows are also public.
- **Code reality**: `data.ts` `_PrivacySensitiveKeys` union includes `color_space`, `icc_profile_name`, and `bit_depth` — all three are admin-only.
- **Severity**: Medium. A developer adding a new feature that reads `color_space` from public APIs would not notice the admin-only restriction from the table row alone.
- **Suggested fix**: Add "Admin-only" to the Notes cells of `color_space`, `icc_profile_name`, and `bit_depth` rows (consistent with how `avif_10bit` says "public-safe").

### DOC21-G2 — Race Condition Protections section omits advisory lock for topic CREATE and alias creation (MEDIUM)
- **Section**: "Race Condition Protections" — "Topic slug rename" bullet
- **Current state**: The bullet reads "Transaction wraps reference updates before PK rename" — accurately describes the transaction. But:
  1. It does not mention that the advisory lock `gallerykit_topic_route_segments` is ALSO used, making `createTopic` and `createTopicAlias` blocking advisory-lock operations (not just rename).
  2. The advisory-lock scope note (at the bottom of the Race Condition section) misdescribes the lock as covering only "topic renames" — missing `createTopic` and `createTopicAlias`.
- **Code reality**: `withTopicRouteMutationLock` is called in `createTopic`, `updateTopic`, and `createTopicAlias`.
- **Severity**: Medium. An operator deploying two GalleryKit instances against the same MySQL server would not expect `createTopic` or `createTopicAlias` calls to contend on an advisory lock, potentially causing unexpected `TopicRouteLockTimeoutError` results on those operations.
- **Suggested fix**: (a) Update the "Topic slug rename" bullet to note the advisory lock: "Advisory lock `gallerykit_topic_route_segments` wraps topic create, update (slug rename), and alias creation; a transaction inside re-points FK children." (b) Update the advisory-lock scope note's "topic renames" to "topic route mutations (create, update/rename, alias creation)."

### DOC21-G3 — SHARP_CONCURRENCY default formula not documented (LOW)
- **Section**: Optional Operational Variables table — `SHARP_CONCURRENCY` row
- **Current state**: "Upper bound for Sharp/libvips threads (runtime caps at CPU parallelism - 1)"
- **Code reality**: `process-image.ts` — when `SHARP_CONCURRENCY` env var is absent, the default is `Math.max(1, Math.floor((cpuCount - 1) / 3))` (roughly one-third of CPUs). The "CPU parallelism - 1" cap applies only when the env var IS set. The default is intentionally conservative: `cpuCount - 1` would be aggressive; one-third is chosen to leave headroom for the main process and concurrent requests.
- **Severity**: Low. An operator expecting Sharp to use `cpuCount - 1` threads by default would over-provision or under-provision based on a wrong mental model, but the practical impact is performance-only.
- **Suggested fix**: Expand the description: "Upper bound for Sharp/libvips threads. Default (unset) = `max(1, floor((cpuCount-1)/3))`; when set, capped at `max(1, cpuCount-1)`."

---

## Summary

| Category | Count |
|---|---|
| MATCH | 17 |
| MISMATCH | 1 |
| GAP | 3 |

**No critical or high-severity MISMATCHes.** The single MISMATCH (DOC21-M1) is low-severity: the advisory-lock scope note underdescribes the `gallerykit_topic_route_segments` scope to "topic renames" when the lock covers topic create, update, and alias creation. The three GAPs are documentation completeness issues with no data-loss risk. All cycle-20 GAPs confirmed closed.
