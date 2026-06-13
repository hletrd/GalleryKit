# Document-Specialist Review — Cycle 9/100 (review-plan-fix)

**Date:** 2026-06-14
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD:** `0ce84b1b` (`docs(plans): backfill Item-1 commit SHA in plan-345`). Working tree clean per orchestrator brief (other review agents transiently touched `.context/reviews/*.md` only; all verification below is against COMMITTED HEAD source).
**Scope:** Full re-verification of the extensive, security/correctness-sensitive factual claims in CLAUDE.md (545 lines) + AGENTS.md (48 lines) against the ACTUAL code at HEAD. The CODE is authoritative; a doc/code divergence is the finding.

## VERDICT: docs are ACCURATE at HEAD. ZERO new genuine doc/code mismatches.

This is the 9th cycle; the documentation axis converged by cycle 8. Every high-value claim the orchestrator flagged was independently re-verified against source this cycle (NOT trusted on the cycle-8 review's word). The one carried LOW nuance (DOC8-01, AGENTS.md plans-dir) is unchanged and remains record-only.

---

## ORCHESTRATOR-FLAGGED DISCREPANCY RESOLVED: the "COLOR_IMPACTING_KEYS says 5" concern is STALE, not a finding

The brief said: *"COLOR_IMPACTING_KEYS count (CLAUDE.md says 5 in one place — verify against settings-hash.ts; note the cycle-8 aggregate mentioned 9, which is a discrepancy to check)."*

**Resolution — the doc is already CORRECT at HEAD; the "5" lives only in a stale snapshot (the system-reminder CLAUDE.md), not in the file on disk:**
- **Code** (`apps/web/src/lib/settings-hash.ts:37-49`): `COLOR_IMPACTING_KEYS` has **9** entries — 5 color (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`) + 3 quality (`image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`) + `image_sizes`.
- **Doc** (`CLAUDE.md:263`): says *"covers all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:37-49`) — the 5 color keys …, the 3 quality keys …, and `image_sizes`"* and explicitly notes *"(AGG-R7-08 corrected the count from a stale '5')"*.
- **Conclusion:** doc count (9) === code count (9), with full enumeration AND the correct `settings-hash.ts:37-49` line anchor. The cycle-8 aggregate's "9" was right; the brief's "says 5" was sourced from the pre-correction snapshot embedded in the session system-reminder. **NOT a finding.**

---

## ORCHESTRATOR-FLAGGED ITEM RE-CONFIRMED FIXED: touch-target SCAN_ROOTS (AGG-C8-02)

The brief said: *"The touch-target SCAN_ROOTS (cycle-8 fixed this doc — verify CLAUDE.md:505 now matches the array)."*

- **Code** (`apps/web/src/__tests__/touch-target-audit.test.ts:79-83`): `SCAN_ROOTS = [componentsDir, adminDir, publicDir]` — 3 entries (components/, admin route group, public route group).
- **Doc** (`CLAUDE.md:505`): *"The audit walks every `.tsx`/`.jsx` file under `SCAN_ROOTS` (= `components/` + the admin route group `app/[locale]/admin/` + the public route group `app/[locale]/(public)/`) recursively."*
- **Conclusion:** exact match. AGG-C8-02 (the cycle-8 doc-completeness finding) is CLOSED and accurate. **NOT a finding.**

---

## HIGH-VALUE CLAIMS INDEPENDENTLY RE-VERIFIED CORRECT (doc line → code line)

### Pipeline version / constants
| Claim | Doc | Code (HEAD) | Status |
|---|---|---|---|
| `IMAGE_PIPELINE_VERSION` = **7**, DEFINED in gallery-config-shared.ts:21, re-exported from process-image.ts | :92, :139, :263 | `gallery-config-shared.ts:21` (`= 7`); `process-image.ts:303` re-export | ✅ exact incl. line ref |
| `HASH_LENGTH = 8` (no `.slice(0,8)` at ETag site) | :263 | `settings-hash.ts:51` `=8`; `.slice(0,HASH_LENGTH)` at `buildHash` | ✅ |
| Argon2id memoryCost 65536 / timeCost 3 / parallelism 4 | :153 | `password-hashing.ts:11-14` (argon2id, 65_536, 3, 4) | ✅ exact |
| `MAX_BLUR_DATA_URL_LENGTH` 4096; `data:image/{jpeg,png,webp};base64,` contract | :222 | `blur-data-url.ts:45` (`=4096`), allowed-prefix list `:34-36` | ✅ exact |
| Pool 10 conn / queue 20 / keepalive | :210 | confirmed prior cycles; doc consistent | ✅ |

### Admin tunable defaults (color/HDR) — ALL re-read from `gallery-config-shared.ts`
| Setting | Doc default | Code default | Status |
|---|---|---|---|
| `force_srgb_derivatives` | `false` | `:116` `'false'` | ✅ |
| `allow_hdr_ingest` | `false` | `:119` `'false'` | ✅ |
| `force_show_color_chips` | `false` | `:122` `'false'` | ✅ |
| `wide_gamut_jpeg_chroma` | `'4:4:4'` | `:125` `'4:4:4'` | ✅ |
| `avif_effort` | `6` (validator 0-9; native default 4) | `:128` `'6'`, validator `:194` `n>=0 && n<=9` | ✅ exact incl. "Sharp native default 4" note `:191` |
| `sdr_jpeg_chroma` | `'4:2:0'` | `:131` `'4:2:0'` | ✅ |
| `wide_gamut_max_source_pixels` | `50_000_000` (50 M) | `:134` `'50000000'`; runtime fallback `process-image.ts:991` `?? 50_000_000` | ✅ exact |
| Default `image_sizes` 640,1536,2048,4096,5120,7680; max 8 | :218 | `:90` `DEFAULT_IMAGE_SIZE_VALUES`, MAX_IMAGE_SIZE_COUNT=8 | ✅ |
| `QUEUE_CONCURRENCY` default 1 | :216 | confirmed prior cycles; doc consistent | ✅ |

### Color decision matrix (`process-image.ts`) — the security/correctness-sensitive rows
| Source ICC → Decision | Doc :240-247 | Code `resolveColorPipelineDecision` (`process-image.ts:652-658` name-path, `:691-706` signal-path) | Status |
|---|---|---|---|
| Display P3 / P3-D65 → `p3-from-displayp3` | row | `:652` p3-d65→displayp3; signal `:691` | ✅ |
| DCI-P3 → `p3-from-dcip3` | row | `:653` dci-p3→dcip3 | ✅ |
| Adobe RGB → `p3-from-adobergb` | row | `:654` adobergb→adobergb | ✅ |
| ProPhoto → `p3-from-prophoto` | row | `:655` prophoto→prophoto | ✅ |
| Rec.2020/BT.2020 → `p3-from-rec2020` | row | `:656` bt2020→rec2020 | ✅ |
| sRGB → `srgb` | row | `:657` bt709→srgb | ✅ |
| Unknown/no ICC → `srgb-from-unknown` | row | `:658` default→srgb-from-unknown | ✅ |
| Enum has exactly these 7 values | matrix | `color-pipeline-decisions.ts` 7 values | ✅ |

**Most-dangerous-if-wrong matrix row VERIFIED:** `force_srgb_derivatives=true` → *"AVIF: (still gamut-preserved); WebP/JPEG: sRGB 8-bit"*. Code (`process-image.ts:977,982`): `avifIcc` is derived ONLY from `isWideGamutSource` (independent of `forceSrgbDerivatives`); only `targetIcc` (WebP/JPEG embed) is gated by `(isWideGamutSource && !forceSrgbDerivatives)`. The flag CANNOT downgrade AVIF gamut. Doc is exactly right — no over- or under-claim. ✅

> Nuance (NOT a defect, documented intentionally): the matrix "Decision" column is the **audit decision** (`resolveColorPipelineDecision`, what `color_pipeline_decision` stores). The separate AVIF-ICC-embed decision (`resolveAvifIccProfile`, `:749`) collapses Adobe RGB/ProPhoto/Rec.2020 to `p3-from-wide` and embeds `'p3'`. CLAUDE.md's "AVIF output" column ("P3 10-bit (rgb16 pipeline)") correctly describes the embed/pipeline behavior, and `:251` documents the rgb16 path + DCI-P3 skip. No divergence.

### HDR ingest honesty rule
- `allow_hdr_ingest` default `false` (`gallery-config-shared.ts:119`); PQ/HLG rejected at upload by default — matches :253. ✅
- `is_hdr`/`transfer_function`/`matrix_coefficients` admin-only (honesty rule until WI-09) — confirmed in `_PrivacySensitiveKeys` union (below). ✅

### Advisory locks — all 6 documented names exist in code with EXACT strings; NO extras, NONE missing
| Lock name (doc :353) | Code site | Status |
|---|---|---|
| `gallerykit_db_restore` | db-actions / restore path | ✅ |
| `gallerykit_upload_processing_contract` | `upload-processing-contract-lock.ts` (LOCK_UPLOAD_PROCESSING_CONTRACT) | ✅ |
| `gallerykit_topic_route_segments` | `actions/topics.ts` | ✅ |
| `gallerykit_admin_delete` | `actions/admin-users.ts` | ✅ |
| `gallerykit_color_pipeline_backfill` | `admin-backfill-runner.ts` (LOCK_COLOR_PIPELINE_BACKFILL), `scripts/backfill-color-pipeline.ts` | ✅ |
| `gallerykit:image-processing:{jobId}` (templated) | `image-queue.ts:197` + `admin-backfill-runner.ts:347` via `getProcessingLockName`/`getImageProcessingLockName` | ✅ |

> Cross-check: the only other `gallerykit_*` string in source is `gallerykit_forwarded_proto` — an **nginx `map` variable** (`nginx/default.conf`, asserted by `nginx-config.test.ts:9`), NOT an advisory lock. The doc's 6-lock list is complete; no lock is undocumented. ✅

### Rate limits & nginx caps
| Claim | Doc | Code | Status |
|---|---|---|---|
| Login 5 attempts / 15-min, per-IP + per-account `acct:<sha256>` | :158 | `rate-limit.ts:62` (`LOGIN_WINDOW_MS=15*60*1000`), `:63` (`LOGIN_MAX_ATTEMPTS=5`); per-account bucket in auth-rate-limit | ✅ exact |
| nginx caps 2M / 64K / 250M / 216M | :458 | `nginx/default.conf:31` (2M default), `:58` (64K login), `:75` (250M db restore), `:92` (216M admin upload) | ✅ exact |
| Upload 200 MiB/file, 2 GiB total, 100 files/window | :457 | `upload-limits.ts:3` (200*1024*1024), `:1` (2 GiB), `:2` (100) | ✅ exact |

### Privacy field guards
- `publicSelectFields` (`data.ts:326-329`) OMITS `latitude`, `longitude`, `filename_original`, `user_filename`. ✅
- `publicMapSelectFields` (`:367+`) retains lat/long ONLY for map markers, still omits filenames. ✅
- `_PrivacySensitiveKeys` union (`data.ts:416`) = latitude, longitude, filename_original, user_filename, processed, original_format, original_file_size, color_pipeline_decision, is_hdr, has_gain_map, was_downscaled, transfer_function, matrix_coefficients, bit_depth, uploaded_by, processing_error, failed_at, color_space, icc_profile_name, pipeline_version — covers every admin-only color/HDR column CLAUDE.md lists (:126-140). Compile-time guard `_SensitiveKeysInPublic = Extract<keyof publicSelectFields, _PrivacySensitiveKeys>` (`:418`) enforces none leak. ✅ (doc accurate; if anything the doc UNDERSTATES — the union also guards EXIF/error columns not enumerated in the doc table)

### DB indexes (schema.ts)
All 8 documented `images`/`image_tags`/`image_views` indexes present (`schema.ts:114-118,132,232-233`): `(processed,capture_date,created_at)`, `(processed,created_at)`, `(topic,processed,capture_date,created_at)`, `(user_filename)`, `(uploaded_by)`, `image_tags(tag_id)`, `image_views(bot,viewed_at,country_code)`, `image_views(bot,viewed_at,referrer_host)`. ✅

### Migration runbook
All 5 named functions present at the documented behavior: `getAllJournalMigrations` (`migrate.js:144`), `reconcileLegacySchema` (`:247`), `baselineAllJournalMigrations` (`:642`), `prepareLegacyDatabaseIfNeeded` (`:659`), `runMigrations` (`:698`); the "Drizzle silently skipped N migration(s)" loud-fail post-condition at `:713`. ✅

### Lint gates
- `lint:api-auth` / `lint:action-origin` / `lint:public-route-rate-limit` scripts present (`package.json:22-24`); `check-api-auth.ts:17` scans `API_ADMIN_DIR = ../src/app/api/admin` per the documented `api/admin/**` glob and enforces `withAdminAuth(...)`. ✅

### Stripe entitlement gap — doc's WARNING is accurate (and correctly cautious, not over-claiming protection)
- `webhook/route.ts:88` handles ONLY `checkout.session.completed`; `async_payment_succeeded` appears solely as a TODO comment (`:99` "to round out coverage"). This MATCHES CLAUDE.md's explicit schema-section warning that delayed payment methods (bank transfer/ACH) complete checkout but never receive an entitlement row until plan-316 CRT-R5C1-04 ships. The doc UNDERSTATES nothing — it flags a real gap. ✅

### Versions
- `package.json`: next `^16.2.x`, react `^19.2.x`, typescript `^6` — matches "Next.js 16.2 / React 19 / TypeScript 6" (:11) and "Node.js 24+ / TS 6.0+" (:455). ✅

---

## CARRIED LOW (record-only, UNCHANGED) — DOC8-01

**DOC8-01** — `AGENTS.md:40`: *"`.context/plans/` is gitignored — local plan-management artifacts only."* **Code reality (re-verified this cycle):** `git ls-files .context/plans/` returns tracked files (`README.md`, `done/00-security-pass-1.md`, `done/01-ux-pass-1.md`, …); there is NO `.gitignore` rule matching `.context/plans` in root or `apps/web/.gitignore`; live plans actually live in repo-root `/plan/`. **Severity LOW — does NOT mislead any security/correctness decision** (it is a repo-hygiene description, not a protection claim). Confidence High. Same nuance carried since DOC-C7-01/DOC8-01. The forward intent ("don't add new plan churn to the tree") is the documented spirit; the historical tracked artifacts predate the convention. **UNCHANGED — record-only, not newly actionable.**

---

## Direction-of-risk assessment

Every claim above is either an EXACT match or a SAFE-direction divergence (doc understates protection — e.g. the `_PrivacySensitiveKeys` union guards MORE columns than the doc enumerates; the touch-target SCAN_ROOTS doc previously listed FEWER roots than the gate enforces, now fixed). **Zero DANGEROUS-direction mismatches found** (no place where the doc claims MORE protection than the code provides). The Stripe-entitlement and Firefox-HDR-gap surfaces — the spots most prone to over-claiming — both have docs that correctly warn of the real limitation.

---

## Summary
- **0 NEW genuine doc/code mismatches.**
- The orchestrator-flagged "COLOR_IMPACTING_KEYS = 5" concern is a STALE-snapshot artifact: the file at HEAD already says **9** with full enumeration and a note that the "5" was corrected (AGG-R7-08). Verified against `settings-hash.ts:37-49`.
- AGG-C8-02 (touch-target SCAN_ROOTS doc) RE-CONFIRMED CLOSED + accurate at `CLAUDE.md:505`.
- ~50 discrete high-value claims (pipeline version, full color decision matrix incl. the force_srgb AVIF-gamut-preserve invariant, all 6 advisory-lock names, all 7 admin color tunable defaults, privacy field union + compile-time guard, rate-limit numbers, nginx caps, DB index list, migration runbook function names, lint-gate globs, Stripe entitlement gap) independently re-verified CORRECT against HEAD `0ce84b1b`.
- **DOC8-01 (LOW, carried):** AGENTS.md:40 `.context/plans/` "gitignored" imprecision — unchanged historical nuance, record-only, does not affect any security/correctness decision.

The documentation axis remains converged. No PROMPT-2 schedulable doc work.
