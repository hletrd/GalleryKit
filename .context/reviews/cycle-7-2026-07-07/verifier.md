# Cycle 7 Verifier Review — GalleryKit

**Reviewer angle:** evidence-based verification that CLAUDE.md's numeric/contract claims match the
actual code at HEAD, plus quality-gate execution.
**Baseline reviewed:** committed HEAD `14d31ea4`.
**Working-tree note:** at review time, `git status` showed peer-in-flight dirty files: the flat
`.context/reviews/*.md` files (peer-owned, not touched), `.context/plans/README.md`, and two
non-review files — `apps/web/src/__tests__/cycle12-ops-contracts.test.ts` and
`scripts/check-proxy-topology.mjs`. Per the shared-worktree rule, these were reviewed as committed
(`git show HEAD:<path>`) and NOT edited. Their working-tree diff (adding two more asserted strings to
the ops-contract test, and clarifying the proxy-topology script's self-description of what it does
NOT verify) is self-consistent and does not appear to threaten gate results — confirmed by fresh gate
runs below completing cleanly against the actual working tree.

## GATE RESULTS

All six gates run fresh, from `apps/web/`, against the current working tree (HEAD `14d31ea4` +
the two peer-dirty files noted above).

| Gate | Command | Result | Evidence |
|---|---|---|---|
| ESLint | `npm run lint --workspace=apps/web` | **PASS** | exit 0, no output beyond the eslint invocation banner |
| Typecheck | `npm run typecheck --workspace=apps/web` | **PASS** | exit 0 — `typecheck:app` (next typegen + `tsc -p tsconfig.typecheck.json --noEmit`) and `typecheck:scripts` (`check-js-scripts.mjs` checked 8 JS scripts + `tsc -p tsconfig.scripts.json --noEmit`) both clean |
| Unit tests | `npm test --workspace=apps/web` (vitest) | **PASS** | `Test Files 347 passed \| 2 skipped (349)`, `Tests 3198 passed \| 4 skipped (3202)`, exit 0, duration 16.46s |
| `lint:api-auth` | `npm run lint:api-auth --workspace=apps/web` | **PASS** | exit 0 — 2 admin API route files checked (`db/download`, `lr/upload`), both OK |
| `lint:action-origin` | `npm run lint:action-origin --workspace=apps/web` | **PASS** | exit 0 — every mutating server action across `db-actions.ts`, `admin-backfill.ts`, `admin-users.ts`, `auth.ts`, `collections.ts`, `embeddings.ts`, `images.ts`, `lr-tokens.ts`, `public.ts`, `seo.ts`, `settings.ts`, `sharing.ts`, `tags.ts`, `topics.ts` reported OK or an explicit exempt-comment SKIP; "All mutating server actions enforce same-origin provenance." |
| `lint:public-route-rate-limit` | `npm run lint:public-route-rate-limit --workspace=apps/web` | **PASS** | exit 0 — all 10 scanned public route files OK (rate-limit helper present or carrying `@public-no-rate-limit-required`) |

No gate failures to attribute. (One operator error on my part: the first `npm run lint` invocation
was run without `cd`-ing into the repo root first and failed with "No workspaces found" — this was my
own mistake, not a code or peer-dirty-file issue; the corrected re-run from the repo root passed clean
and is the result reported above.)

## Numeric / contract cross-checks (CLAUDE.md prose vs. code at HEAD)

Every claim below was checked directly against source, not assumed from the doc. All matched —
**no drift found** in this pass, across a broad and previously-hardened surface. Listing the checks
performed (not just failures) so this pass is falsifiable/repeatable.

| Claim (CLAUDE.md) | Code location | Result |
|---|---|---|
| `IMAGE_PIPELINE_VERSION` = 7 | `src/lib/gallery-config-shared.ts:22` (`export const IMAGE_PIPELINE_VERSION = 7;`), re-exported from `process-image.ts:397` | MATCH |
| `COLOR_IMPACTING_KEYS` = 9 keys (5 color + 3 quality + `image_sizes`) | `src/lib/gallery-config-shared.ts:75-85` `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS` (aliased as `COLOR_IMPACTING_KEYS` in `settings-hash.ts:47`) — exactly `wide_gamut_jpeg_chroma, sdr_jpeg_chroma, avif_effort, force_srgb_derivatives, wide_gamut_max_source_pixels, image_quality_webp, image_quality_avif, image_quality_jpeg, image_sizes` | MATCH (9 keys, exact names) |
| Pool: 10 connections, queue limit 20, keepalive on | `src/db/index.ts:31,39,41,43` (`POOL_CONNECTION_LIMIT = 10`, `queueLimit: 20`, `enableKeepAlive: true`) | MATCH |
| `QUEUE_CONCURRENCY` clamp formula → effective **2** at pool 10 | `src/lib/image-queue.ts:120-133` `resolveImageQueueConcurrency`/`IMAGE_QUEUE_RESERVED_LIVE_CONNECTIONS` — `reserved = max(3, ceil(10/2)) = 5`; `cap = max(1, floor((10-5)/2)) = 2` | MATCH |
| `ADMIN_BACKFILL_CONCURRENCY` clamp formula → effective **2** at pool 10 | `src/lib/admin-backfill-runner.ts:105-141` `BACKFILL_RESERVED_LIVE_CONNECTIONS`/`resolveBackfillConcurrency` — `reserved = max(3, ceil(10/2)) = 5`; `cap = max(1, floor((10-5-1)/2)) = 2` | MATCH |
| Advisory lock names (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit_semantic_embedding_backfill`, `gallerykit:image-processing:{jobId}`, `gallerykit_web_singleton_<hash>`) | `src/lib/advisory-locks.ts:21,24,27,36,43,46,49,67-71` | MATCH — all 8 present verbatim |
| nginx body-size caps: 2 MiB default / 64 KiB login / 250 MiB restore / 216 MiB dashboard / 216 MiB LR upload | `apps/web/nginx/default.conf` lines 74, 101, 118, 135, 175 (with 151/192 also 2M for the admin-mutation and generic `/api/admin/` catch-alls) | MATCH, and route-to-cap mapping in the doc (which location gets which cap) is also correct |
| nginx public/nextimage edge rate-limit zones: `zone=public rate=10r/s burst=40`, `zone=nextimage rate=30r/s burst=120` | `default.conf:10,19` (zone definitions) + `:262,294` (`limit_req zone=nextimage burst=120`, `limit_req zone=public burst=40`) | MATCH |
| Migration journal: non-monotonic `when` timestamps (2025/2026 mix) | `apps/web/drizzle/meta/_journal.json` — 30 entries total; scripted scan found exactly 1 out-of-order entry (`0007_image_reactions`, `when=1746144000000`, i.e. below its predecessor) | MATCH (doc makes a qualitative claim, not an exact count; the described phenomenon is present) |
| Token format: `gk_` + 43 base64url chars = 46 total, from 32 random bytes | `src/lib/admin-tokens.ts:20-23,53-54` (`TOKEN_PREFIX='gk_'`, `TOKEN_RANDOM_BYTES=32`, `TOKEN_PLAINTEXT_LENGTH = 3+43 = 46`, `randomBytes(32).toString('base64url')`) | MATCH |
| `IMAGE_MAX_INPUT_PIXELS` default 268,435,456 (256 MiB px) | `src/lib/process-image.ts:352-356` (`256 * 1024 * 1024`) | MATCH |
| `IMAGE_MAX_INPUT_PIXELS_TOPIC` default 67,108,864 (64 MiB px) | `src/lib/process-image.ts:362-368` (`64 * 1024 * 1024`) | MATCH |
| `UPLOAD_MAX_TOTAL_BYTES` default 2,147,483,648 (2 GiB) | `src/lib/upload-limits.ts:9` (`2 * 1024 * 1024 * 1024`) | MATCH |
| `UPLOAD_MAX_FILES_PER_WINDOW` default 100 | `src/lib/upload-limits.ts:10` | MATCH |
| `NEXT_UPLOAD_BODY_MAX_BYTES` default 278,921,216 | `src/lib/upload-limits.ts:11-15` (`max(200 MiB, 250 MiB) + 16 MiB` = `262,144,000 + 16,777,216`) | MATCH |
| `IMAGE_CLEANUP_CONCURRENCY` default 5, max 32 | `src/app/actions/images.ts:869-872` | MATCH |
| `BACKFILL_CONCURRENCY` default 2, max 8 | `scripts/backfill-color-pipeline.ts:383-386` | MATCH |
| `CLIP_INFERENCE_CONCURRENCY` default 1, capped at 4 | `src/lib/clip-model.ts:53-56` | MATCH |
| `CLIP_INFERENCE_QUEUE_TIMEOUT_MS` default 30000, capped at 300000 | `src/lib/clip-model.ts:61-64` | MATCH |
| `SEMANTIC_TOP_K_MAX` default 50, hard cap 100 | `src/lib/clip-embeddings.ts:37,47` (`SEMANTIC_TOP_K_HARD_MAX=100`) | MATCH |
| `SEMANTIC_SCAN_LIMIT` default 2000, hard cap 25000 | `src/lib/clip-embeddings.ts:36,48` | MATCH |
| `RESTORE_MAINTENANCE_DIR` default `/app/data` (prod) / `data` (dev) | `src/lib/restore-maintenance-durable.ts:23-25` | MATCH |
| `SHARP_CONCURRENCY` default `max(1, floor((cpuCount-1)/3))`, explicit value capped at `cpuCount-1` | `src/lib/process-image.ts:36-48` | MATCH |
| `TRUSTED_PROXY_HOPS` default 1 | `src/lib/rate-limit.ts:120,165-171` (`DEFAULT_TRUSTED_PROXY_HOPS = 1`) | MATCH |
| SW `HEAD_REVALIDATE_TIMEOUT_MS` = 300 ms | `public/sw.template.js:39` | MATCH |
| `DB_SSL` auto-TLS-for-non-localhost logic (and identical logic in the CLI helper script vs. the runtime pool) | `src/db/index.ts:9-19` vs. `scripts/mysql-connection-options.js:13-19` | MATCH — same localhost set, same `DB_SSL=false` override, same required-CA error message; no drift between the two independent implementations |
| `HEALTH_CHECK_DB` gates DB probe, strict `=== 'true'` | `src/app/api/health/route.ts:62` | MATCH |

## `_PrivacySensitiveKeys` / `publicSelectFields` guard audit

Verified this is not merely a doc claim but a compile-time-enforced invariant, and independently
cross-checked its completeness against the live schema:

- `src/db/schema.ts` `images` table has **51** columns (scripted extraction).
- `src/lib/data.ts` `adminSelectFields` selects **49** of them — the two omissions (`share_key`,
  `blur_data_url`) are deliberate and documented (both are fetched directly by the specific queries
  that need them, not part of the shared listing select).
- `publicSelectFields` is derived from `adminSelectFields` via destructuring-omission of exactly the
  **21** keys in the exported `PrivacySensitiveKeys` union (`latitude, longitude, filename_original,
  user_filename, processed, original_format, original_file_size, color_pipeline_decision, is_hdr,
  has_gain_map, was_downscaled, transfer_function, matrix_coefficients, bit_depth, uploaded_by,
  processing_error, failed_at, processing_settings_json, color_space, icc_profile_name,
  pipeline_version`) — matches the `SENSITIVE_KEYS` fixture in
  `apps/web/src/__tests__/privacy-fields.test.ts:41-79` key-for-key.
- The guard is a real `tsc` failure point (`_SensitiveKeysInPublic extends never ? true : [...]`,
  `data.ts:474-476`), and `npm run typecheck --workspace=apps/web` passed clean (see Gate Results),
  so this is not just "the list looks right" — a mismatch would have failed the gate I ran fresh.
- Sibling public-select mirrors (`data-timeline.ts`, `search-enrichment-fields.ts`) both `grep`-confirmed
  to import and reuse the same canonical `PrivacySensitiveKeys` union rather than hand-copying a second
  list that could drift.
- The remaining non-sensitive EXIF-adjacent columns not in the guard (`white_balance`,
  `metering_mode`, `exposure_compensation`, `exposure_program`, `flash`) are intentionally public
  (consistent with `camera_model`/`lens_model`/`iso`/etc. already being public and with the
  documented JSON-LD camera/lens/exposure exposure) — not a gap against CLAUDE.md, which never
  classifies these as admin-only.

**Verdict: VERIFIED, no leak.** The guard is complete, currently enforced, and its completeness is
independently reproducible (schema column count vs. select-field count vs. type-union count all
cross-checked, not just visually compared).

## Spot-check of two freshly-landed peer commits (per briefing's "least review soak time" note)

- **`d8fcb3d6` (fix(security): prefer host for origin checks)** — `src/lib/request-origin.ts`
  `getExpectedOrigin` now prefers the literal `Host` header over `X-Forwarded-Host`, falling back to
  `X-Forwarded-Host` only when `Host` is absent (previously the reverse when `TRUST_PROXY=true`).
  Checked against the shipped `nginx/default.conf`: every proxied location sets both
  `proxy_set_header Host $host;` and `proxy_set_header X-Forwarded-Host $host;` from the *same*
  nginx variable, so on the shipped topology this reorder is a no-op in practice; it only changes
  behavior for a non-shipped topology where an intermediary passes through the original `Host` header
  unmodified while an attacker-controlled `X-Forwarded-Host` differs from it — in that case, preferring
  `Host` is the safer choice since it's what actually routed the connection through the edge. Focused
  tests (`request-origin.test.ts`) exercise the new precedence including a case where `Host` and
  `X-Forwarded-Host` disagree. No bug found; behavior matches the commit's stated directive.
- **`05fa5cd1` (fix(config): sanitize image base and TLS CA)** — confirmed `IMAGE_BASE_URL` in
  `src/lib/constants.ts:19` is sanitized once at module scope via
  `sanitizeImageBaseUrlSafely(process.env.IMAGE_BASE_URL)` (from the shared
  `content-security-policy.ts` parser: rejects non-http(s), rejects non-https in production, rejects
  credentials/query/hash), and that `src/lib/image-url.ts`'s server-side path
  (`resolveImageBase()` → returns `IMAGE_BASE_URL` directly) relies on that pre-sanitized constant
  rather than re-parsing the raw env var — consistent with the commit's stated goal of sharing one
  parser between CSP and image-URL generation. No bug found.

## Deferred-register cross-check

Searched `deferred-carry-forward.md` and `cycle-{1..6}-2026-07-07-deferred.md` for prior findings
overlapping this pass's checks (pipeline-version, color-impacting keys, advisory locks, nginx body
caps, token format, privacy guard, request-origin/forwarded-host). No overlapping open item found —
this pass's checks are new ground, not a re-litigation of a known-deferred item, and (since everything
matched) there is nothing new to add to the deferred register either.

## Final sweep for commonly-missed issues

Confirmed coverage of files/areas relevant to this angle, beyond what's itemized above:
- `apps/web/src/db/schema.ts` (full `images` table, all 51 columns enumerated programmatically, not
  sampled).
- `apps/web/src/lib/data.ts` (full `adminSelectFields`/`publicSelectFields`/`publicMapSelectFields`
  destructuring chain, lines ~251-430).
- `apps/web/src/lib/settings-hash.ts` (full file context around `COLOR_IMPACTING_KEYS` and its
  config-value mapper, confirming the compile-time `_ColorKeysAreSettingKeys` guard also holds).
- `apps/web/nginx/default.conf` (read the full location-block set, not just the `client_max_body_size`
  grep hits, to confirm each cap is attached to the route CLAUDE.md claims it for).
- `apps/web/drizzle/meta/_journal.json` (parsed all 30 entries programmatically for monotonicity,
  not spot-checked).
- `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/clip-model.ts`,
  `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/upload-limits.ts`,
  `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/rate-limit.ts`,
  `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/db/index.ts`,
  `apps/web/scripts/mysql-connection-options.js`, `apps/web/scripts/backfill-color-pipeline.ts`,
  `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/health/route.ts` — all read directly for
  the specific constant/formula being checked, not inferred from comments.

**No new findings of substance in this pass.** Every numeric/contract claim checked matched the code,
all six requested gates passed fresh, and the privacy-guard completeness is independently verified
(not merely re-asserted). This is a genuinely clean pass — I did not manufacture a finding to have
something to report. The two freshly-landed peer commits inspected for correctness (`d8fcb3d6`,
`05fa5cd1`) also hold up under direct code inspection.
