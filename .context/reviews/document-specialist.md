# Document-Specialist Review — Run-6 Cycle-7

- **HEAD:** `a7758ef0` (run-6 cycle-7; working tree CLEAN)
- **Agent:** document-specialist
- **Date:** 2026-06-17
- **Angle:** Doc/code mismatches — re-verify load-bearing factual claims in the ON-DISK `CLAUDE.md` / `AGENTS.md` against code at HEAD. Code is authoritative.
- **Claims verified:** 37 load-bearing facts checked against code.
- **Findings:** 0 CRIT / 0 HIGH / 0 MED / 0 LOW actionable. 1 carry-forward INFO (non-actionable, repo-disclaimed line-ref drift).

---

## Verdict: 0 actionable mismatches — CONVERGED

The on-disk `CLAUDE.md` contract is accurate at HEAD `a7758ef0`. Findings trend across this loop: 11 → 45 → 14 → 5 → 1 → 2 → **0**. Nine of the prior cycle's findings were closed and the two cycle-6 fixes (HDR badge contrast `5af25dc7`, boundary-test hardening `204e8594`) landed without introducing any doc drift. No developer-misleading doc-vs-code mismatch exists. I did not fabricate nitpicks; the single INFO is the same 4-line internal line-number offset cycle-6 already classified as the "informational only" class the doc itself disclaims.

### Methodological note (source-of-truth discipline)

The `CLAUDE.md` delivered in the agent system-reminder context was AGAIN a STALE snapshot (it says "all **5** COLOR_IMPACTING_KEYS"). The **on-disk `CLAUDE.md` at HEAD is correct** — line 264 reads "covers all **9** `COLOR_IMPACTING_KEYS` … (AGG-R7-08 corrected the count from a stale '5')". I verified strictly against the on-disk HEAD file + the actual array in `settings-hash.ts`, per the orchestrator brief. Did NOT "fix" the count back to 5.

---

## Two cycle-6 code commits cross-checked for doc drift (both CLEAN)

`git diff 4eb83aab^..a7758ef0 -- apps/web/src` touches exactly 6 files (2 test files + 4 component one-liners):

| Commit | Change | Doc-asserted value touched? |
|---|---|---|
| `5af25dc7` (a11y) | `text-white` → `text-amber-950` at 4 HDR-badge sites + new `hdr-badge-contrast.test.ts` | **No.** CLAUDE.md documents the `.hdr-badge` class and the HDR honesty rule, but asserts NO badge text color / contrast value. Current code grep confirms all 4 sites now carry `text-amber-950` on `from-amber-300 to-orange-400`. Nothing in the contract drifts. |
| `204e8594` (test) | dynamic-`import()` + import-equals coverage in `client-server-only-boundary.test.ts` | **No.** Test-only; no doc-asserted value. HARD GUARD #1 respected (does NOT add `server-only` to `@/db`). |

---

## Facts re-verified at HEAD `a7758ef0` (all PASS)

| # | CLAUDE.md / AGENTS.md claim | Code (file:line) | Result |
|---|---|---|---|
| 1 | `IMAGE_PIPELINE_VERSION = 7` | `gallery-config-shared.ts:21` `= 7`; re-exported `process-image.ts:315` | ✓ |
| 2 | 6 default image sizes `[640, 1536, 2048, 4096, 5120, 7680]` | `gallery-config-shared.ts:90` `DEFAULT_IMAGE_SIZE_VALUES` | ✓ exact |
| 3 | `COLOR_IMPACTING_KEYS` = **9 keys** (5 color + 3 quality + `image_sizes`) | `settings-hash.ts:41-53` — array has exactly 9 entries | ✓ doc=9, code=9 |
| 4 | settings-hash inline comment says "the **9** settings" | `settings-hash.ts:6` references "the authoritative list; AGG-R7-08" | ✓ comment, doc, array all agree on 9 |
| 5 | `force_srgb_derivatives` default `false` | `gallery-config-shared.ts:116` | ✓ |
| 6 | `allow_hdr_ingest` default `false` | `:119` | ✓ |
| 7 | `force_show_color_chips` default `false` | `:122` | ✓ |
| 8 | `wide_gamut_jpeg_chroma` default `'4:4:4'` | `:125` | ✓ |
| 9 | `avif_effort` default `6` | `:128` | ✓ |
| 10 | `sdr_jpeg_chroma` default `'4:2:0'` | `:131` | ✓ |
| 11 | `wide_gamut_max_source_pixels` default `50_000_000` | `:134` (`'50000000'`) | ✓ |
| 12 | `image_quality_webp=90`, `avif=85`, `jpeg=90` | `:97-99` | ✓ exact |
| 13 | `strip_gps_on_upload` default `false` | `:101` | ✓ |
| 14 | avif_effort validator range 0-9; chroma enum `4:4:4 \| 4:2:2 \| 4:2:0` | `:190,196,199` | ✓ |
| 15 | **6** advisory-lock names (`gallerykit_db_restore`, `_upload_processing_contract`, `_topic_route_segments`, `_admin_delete`, `_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`) | `advisory-locks.ts` registry + `GET_LOCK` call sites in image-queue/admin-backfill-runner/upload-processing-contract-lock/admin-users/topics | ✓ all 6 present |
| 16 | (`gallerykit_forwarded_proto` is NOT a 7th lock) | nginx `map` variable only (`nginx-config.test.ts:9`), not a `GET_LOCK` arg | ✓ not a lock; doc count of 6 correct |
| 17 | Cache-Control `public, max-age=3600, must-revalidate`, NOT `immutable` — 3 files | `serve-upload.ts:230,252`; `next.config.ts:71`; `nginx/default.conf` | ✓ all 3 agree, none `immutable` |
| 18 | serve-upload ETag `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` | `serve-upload.ts:215` exact | ✓ |
| 19 | `HASH_LENGTH = 8` (no `.slice(0,8)` at ETag site) | `settings-hash.ts:55`, `:68` slices to HASH_LENGTH at the hash producer | ✓ |
| 20 | CRT-D1 static-path invalidation gotcha (setting flip does NOT rewrite static bytes; needs backfill) | matches serve-upload-vs-static split in `serve-upload.ts:193` comment + next.config headers | ✓ accurate |
| 21 | Argon2id memoryCost=65536, timeCost=3, parallelism=4 | `password-hashing.ts:11-14` | ✓ exact |
| 22 | Login rate-limit 5 attempts / 15-min (per-IP + per-account) | `rate-limit.ts:62-63` (`15*60*1000`, `5`) | ✓ |
| 23 | Upload caps: 200 MiB/file, 2 GiB total, 100 files/window | `upload-limits.ts:1-3` (`200*1024*1024`, `2*1024^3`, `100`) | ✓ exact |
| 24 | Restore cap 250 MiB | `upload-limits.ts:4` (`250*1024*1024`) | ✓ |
| 25 | SW image-derivative LRU cap 50 MB | `sw-cache.ts:19` `MAX_IMAGE_CACHE_BYTES = 50*1024*1024` | ✓ |
| 26 | Queue concurrency default 1, `QUEUE_CONCURRENCY` override | `image-queue.ts:168` `Number(process.env.QUEUE_CONCURRENCY) || 1` | ✓ |
| 27 | React `cache()` wraps **10** data-access fns | `data.ts`: 10 `= cache(` sites | ✓ doc=10, code=10 |
| 28 | `tagNamesAgg` = `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` reused across masonry-list queries | `data.ts:605` def; reused :734/:783/:833/:899/:923/:1359 | ✓ exact |
| 29 | Next.js 16.2 | `package.json` `next: ^16.2.3` | ✓ |
| 30 | React 19 | `react: ^19.2.5` | ✓ |
| 31 | TypeScript 6 | `typescript: ^6` | ✓ |
| 32 | Node 24+ | `engines.node: ">=24"` | ✓ |
| 33 | i18n: `en.json`/`ko.json` SAME key set; ko no `plural` (DOC-R5C3-07) | en 840 leaf keys = ko 840; 0 keys differ either direction | ✓ parity, asymmetry intentional, NOT flagged |
| 34 | 4 lint gates (`lint`, `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`) | `package.json:14,22,23,24` | ✓ |
| 35 | Migration journal non-monotonic `when` (2025 + 2026) | `_journal.json`: 22 entries, monotonic=false, years {2025, 2026} | ✓ exact |
| 36 | SW version stamp = git short-SHA + `-p{IMAGE_PIPELINE_VERSION}` | `build-sw.ts:46` `${getCommitOrTimestamp()}-p${IMAGE_PIPELINE_VERSION}` | ✓ |
| 37 | HDR badge text now `text-amber-950` (post-`5af25dc7`); CLAUDE.md asserts no badge color | 4 component sites grep-confirmed `text-amber-950`; no contract claim about it | ✓ no drift |

---

## INFO-1 (non-actionable, carry-forward): `settings-hash.ts` line-range citation is 4 lines stale

- **Location:** `CLAUDE.md` line 264 — "covers all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:37-49`)".
- **Actual:** the `const COLOR_IMPACTING_KEYS = [ … ] as const;` array spans **lines 41-53**. The cited `37-49` points at the docstring tail + array start, not the full array.
- **Why NOT actionable:** the symbol name `COLOR_IMPACTING_KEYS` is unambiguous (a developer lands on it instantly via grep regardless of the 4-line offset). The count (9) and the key breakdown in the prose are CORRECT. The repo's own convention treats embedded line numbers as drift-prone and informational (cf. the migrator note: "file/line drifts across drizzle-orm versions; informational only"). Does not mislead anyone into an incorrect/unsafe change. Identical to cycle-6 INFO-1 — left unchanged, correctly.
- **Optional cosmetic fix (only if a maintainer is already editing that paragraph):** `settings-hash.ts:37-49` → `:41-53`. Not worth a standalone commit.
- **Confidence:** High (verified by direct `sed` of the array).

---

## Hard guards — respected
- Did NOT propose `import 'server-only'` on `@/db` (cycle-5 proved it breaks the tsx backfill sidecar; multi-agent corroborated).
- Did NOT propose activating CLIP / semantic_search.
- Did NOT "fix" the COLOR_IMPACTING_KEYS count back to 5 (the on-disk file already says 9).
- Did NOT flag the intentional ko-no-plural i18n asymmetry (DOC-R5C3-07).

## Bottom line
The on-disk `CLAUDE.md` / `AGENTS.md` contract faithfully describes the code at HEAD `a7758ef0`. **37 load-bearing facts re-verified, all PASS.** The two cycle-6 code commits (`5af25dc7`, `204e8594`) introduced zero doc drift. One harmless carry-forward line-number citation (INFO-1), no fix required. **0 actionable doc-vs-code mismatches** — the expected converged outcome.
