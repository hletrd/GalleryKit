# Document-Specialist Review — Doc-vs-Code Correctness (Run 6 / Cycle 5)

**HEAD:** 2f603716 (branch master, working tree clean)
**Date:** 2026-06-16
**Prior cycle baseline:** f8147868 (Cycle 4 — 0 open mismatches, ~40 claims verified)
**Scope:** CLAUDE.md load-bearing factual claims vs the ACTUAL code at HEAD. Authoritative source = the code itself. Precise file:line verification.

---

## HEADLINE: ZERO open doc/code mismatches at HEAD 2f603716. All cycle-4 fixes verified landed; full section-by-section re-pass of CLAUDE.md against current code — every checkable claim accurate. Honest convergence holds.

The f8147868 → 2f603716 delta is small and entirely in already-documented territory: 4 code/test files (backfill-color-pipeline.ts, image-queue-bootstrap.test.ts, switch.tsx, + 2 new test files) plus review docs and plans. I re-verified independently at the CURRENT HEAD (line numbers shift after the cycle-4 +52-line backfill change) rather than trusting the prior snapshot. **Every audited claim (~45 distinct facts) matches the code exactly.**

---

## CYCLE-4 FIXES (delta f8147868→2f603716) — VERIFIED LANDED

- **AGG-C4-05 (switch.tsx:14 comment drift, commit 24159f36):** header comment now cites `translate-x-full` (switch.tsx:14), code uses `data-[state=checked]:translate-x-full` (switch.tsx:50). Comment now matches code. **CLOSED.**
- **AGG-C4-02 (switch geometry regression test, commit 9a262e3f):** `switch-geometry-contract.test.ts` present; track `w-11 px-0.5` (switch.tsx:37), thumb `size-5` (switch.tsx:49), travel `translate-x-full` (switch.tsx:50) — the documented load-bearing triple. **CLOSED.**
- **AGG-C4-03 (sidecar exit-code helper, commit 1fd350be):** `computeBackfillExitCode({errors, detectionFailures})` extracted at backfill-color-pipeline.ts:174. **CLOSED.**
- **AGG-C4-04 (detectionFailures walk-back, commit 1fd350be):** `countDeletedMidReencodeDetectionFailures` at :162; `detectionFailures -= ...` at :455. **CLOSED.**
- **AGG-C4-01 (image-queue bootstrap flake, commit 6ab40644):** bootstrap test updated. **CLOSED.**

---

## FULL SECTION-BY-SECTION VERIFICATION — every load-bearing claim accurate at HEAD

### Versions & constants
| Claim (CLAUDE.md) | Code | Verdict |
|---|---|---|
| `IMAGE_PIPELINE_VERSION = 7`, defined in `gallery-config-shared.ts:21`, re-exported in process-image.ts | gallery-config-shared.ts:21 = `7`; process-image.ts:315 re-exports; :313 comment confirms | ✅ |
| `pipeline_version` current: 7 (line 140) | matches constant | ✅ |
| Default image sizes `[640,1536,2048,4096,5120,7680]` (line 219) | gallery-config-shared.ts:90 `DEFAULT_IMAGE_SIZE_VALUES` | ✅ |
| `avif_effort` default 6 | gallery-config-shared.ts:128 `'6'` | ✅ |
| `wide_gamut_max_source_pixels` 50M | :134 `'50000000'` | ✅ |
| `image_quality_webp/avif/jpeg` 90/85/90 | :97/:98/:99 | ✅ |
| `force_srgb_derivatives`/`allow_hdr_ingest`/`force_show_color_chips` false | :116/:119/:122 | ✅ |
| `wide_gamut_jpeg_chroma` `4:4:4`, `sdr_jpeg_chroma` `4:2:0` | :125/:131 | ✅ |

### COLOR_IMPACTING_KEYS — the "9 keys" claim
- `settings-hash.ts:41-52` = exactly **9** entries (5 color + 3 quality + `image_sizes`). Docstring (:4) says "the 9 settings". `HASH_LENGTH = 8` (:55). CLAUDE.md lines 264 & 285-289 all say 9. ✅

### Advisory locks (all 6 names exact)
- advisory-locks.ts: `gallerykit_db_restore`(:19), `gallerykit_upload_processing_contract`(:22), `gallerykit_topic_route_segments`(:25), `gallerykit_admin_delete`(:34), `gallerykit:image-processing:${jobId}`(:41), `gallerykit_color_pipeline_backfill`(:44). All documented names present. ✅

### Cache-Control trio + ETag
- All three layers emit `public, max-age=3600, must-revalidate`, no `immutable` on derivatives: next.config.ts:71, nginx/default.conf:157, serve-upload.ts:230 & :252. Deliberate non-immutable comments at next.config.ts:64-65, serve-upload.ts:193. ✅
- ETag: `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"` (serve-upload.ts:215) — char-for-char match to CLAUDE.md line 264. ✅

### Recent-commit accuracy (the items called out for drift risk)
- **OG/JSON-LD "strip ALL bidi, not just the first" (commit 170297ed):** og-sanitize.ts uses `stripUnicodeFormatting` (global-flag twin, :29) + `OG_C0_CONTROL_CHARS = /[...]/g` (:25); docstring :18-20 documents the global-vs-first-only fix. Imported by all 3 consumers — og/route.tsx, og/photo/[id]/route.tsx, (public)/p/[id]/page.tsx. Matches CLAUDE.md line 182. ✅
- **Backfill "report real processed + surface fatal errors" (commit 13ae79ca):** admin-backfill-runner.ts surfaces `processed`(:159), `lastError`(:181), `lastRunHadFailures`(:190) in status. Matches commit + CLAUDE.md line 195. ✅
- **Race-guard lineage labels:** sidecar comments cite `AGG-C4-02 (run-9 c1)`(:380) / `AGG-C5-01 (run-9 c2)`(:119); in-app runner cites `AGG-R8c3-03 (run-8 c3)`(:421). CLAUDE.md line 295 ("in-app runner … Run-8 Cycle-3 AGG-R8c3-03; the sidecar flushBatch in Run-9 Cycle-1 AGG-C4-02") matches the code comments. ✅

### Color & HDR pipeline
- `COLOR_PIPELINE_DECISIONS` enum matches the decision-matrix rows (verified prior cycle; enum file unchanged in delta).
- NCLX transfer map: `gamma24` for codes 14/15 (color-detection.ts:197-198), `gamma26` for code 17 (:200), `gamma22`/`gamma18` present; transferFunction union (:25) = `srgb|gamma22|gamma18|gamma24|gamma26|pq|hlg|linear|unknown` — exactly the set CLAUDE.md line 135 lists. Matrix enum includes `bt2020-cl`/`identity` (:27). Matches CLAUDE.md lines 135 & 233. ✅

### Concurrency cap math (admin-backfill-runner.ts)
- `BACKFILL_RESERVED_LIVE_CONNECTIONS = max(3, ceil(poolLimit/2))` (:105-106); `cap = max(1, floor((limit-reserved-1)/2))` (:139) = 2 at pool 10. Matches CLAUDE.md line 298 verbatim. ✅

### Checkout card-only pin
- `payment_method_types: ['card']` (api/checkout/[imageId]/route.ts:207). Matches CLAUDE.md line 122. ✅

### View-event retention
- `DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000` (view-retention.ts:29); negative/non-finite fallback (:43). Matches CLAUDE.md line 120 (395 days / 13 months). ✅

### Service Worker / PWA
- sw.js:26 `SW_VERSION = 'dd26e742-p7'`; build-sw.ts:46 produces `${getCommitOrTimestamp()}-p${IMAGE_PIPELINE_VERSION}`; template placeholder `__SW_VERSION__` at sw.template.js:26. Format matches CLAUDE.md line 371 (committed SHA differs from older commit-message stamps — re-stamped per build, expected). ✅

### React cache() count
- data.ts has exactly **10** `= cache(` call sites: the 9 `*Cached` fns + `getSeoSettings`(:1662), including `getLatestImageForOgCached`(:1610). Matches CLAUDE.md line 361 ("wraps 10"). ✅

### Touch-target SCAN_ROOTS
- touch-target-audit.test.ts: `componentsDir`(:43) + `adminDir = app/[locale]/admin/`(:44) + `publicDir = app/[locale]/(public)/`(:51). Exactly the three roots CLAUDE.md line 561 claims. ✅

### Key Files & Patterns table — path existence
- 39/40 cited paths exist exactly as written. The one nominal "miss" is INFO-only, below.

### i18n key-parity (DOC-R5C3-07)
- Programmatic flat-key diff: **en = 840, ko = 840**, `only in en: []`, `only in ko: []`. en has **5** ICU `plural` blocks, ko has **0** — exactly the documented intentional asymmetry. Do NOT add a `plural` block to ko. ✅

### CLIP semantic search (HARD GUARD honored)
- Reviewed docs (CLAUDE.md lines 121, 448-494) for accuracy only — `semantic_search_mode` defaults disabled, resolver heals `production`→`disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`. Did NOT propose activation. ✅

---

## INFO (not a mismatch — recorded for transparency, NO fix proposed)

### DOC-C5-INFO-01 — `p/[id]/page.tsx` shorthand vs the actual `(public)/p/[id]/page.tsx` location
- **Where:** CLAUDE.md line 182 references the JSON-LD photo page as `p/[id]/page.tsx` (relative shorthand, no full path); the Repository Structure tree (lines 28-30) shows `p/[id]/`, `g/[key]/`, `s/[key]/` as direct children of `[locale]/`.
- **Actual code:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` — the public pages live inside a `(public)` route group.
- **Why this is NOT a mismatch:** (a) `p/[id]/page.tsx` is a correct path SUFFIX and the file unambiguously exists; the `sanitizeForOg` import confirms it is the documented third consumer. (b) Route groups `(public)` are URL-transparent (no effect on routes), and the Repository Structure block is explicitly an illustrative tree, not a precise path map. (c) The same `(public)` segment is already shown WITH the group elsewhere in CLAUDE.md (line 262, the serve-upload twin), so the doc is internally consistent in treating it as optional shorthand. The prior cycle implicitly accepted this. **Confidence: High (fact) / cosmetic (impact). No action.**

---

## SUMMARY

- **Open doc/code mismatches: 0.**
- **Cycle-4 doc/code fixes (AGG-C4-01..05): all 5 verified landed at HEAD 2f603716.**
- **~45 distinct load-bearing CLAUDE.md claims re-verified against current code** (pipeline version, image sizes, all 11 admin tunable defaults, 9 COLOR_IMPACTING_KEYS, 6 advisory locks, cache-control trio, ETag format, NCLX gamma map, concurrency-cap arithmetic, checkout card-only pin, view-retention default, SW stamp, cache() count, touch-target scan roots, 39/40 Key-Files paths) — every one accurate.
- **i18n: en = 840, ko = 840 keys, zero asymmetry; en 5 plural blocks, ko 0** — DOC-R5C3-07 convention intact.
- **1 INFO note (DOC-C5-INFO-01):** `p/[id]/page.tsx` shorthand resolves correctly; not a false claim; no fix.
- **HARD GUARD honored:** CLIP docs reviewed for accuracy only; activation NOT proposed.

**Verdict: honest convergence on the documentation surface holds at HEAD 2f603716. Nothing to plan this cycle from doc/code mismatch.**

### i18n key counts
- en.json: **840** keys | ko.json: **840** keys | asymmetry: **0** | en plural blocks: **5** | ko plural blocks: **0**

### Mismatch count by severity
- CRITICAL: 0 | HIGH: 0 | MEDIUM: 0 | LOW: 0 | INFO (non-actionable): 1
