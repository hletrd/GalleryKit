# Document-Specialist Review — Doc↔Code Accuracy (run-6 cycle-1 fan-out)

**Repo:** GalleryKit @ /Users/hletrd/flash-shared/gallery (Next.js 16 / React 19 / TS6)
**Date:** 2026-06-13
**Authoritative source = CODE.** Working tree had uncommitted changes (verified via `git diff HEAD`); `.context/reviews/*.md` modifications ignored as input.
**Mandate:** find places where CLAUDE.md / inline comments / plan docs make claims the code contradicts. Focus on high-specificity drift: counts, constants, file:line attributions, defaults, formula descriptions, invariants.

---

## Severity counts

| Severity | Count |
|---|---|
| MUST-FIX (wrong value / self-contradicting file, NOT yet in any plan) | 1 (DOC-05 — working-tree-introduced inline staleness) |
| DOC must-fix (already diagnosed + SCHEDULED in plan-330 Unit A, still wrong at HEAD) | 4 (DOC-01/02/03/04 = AGG-21 / AGG-23 / AGG-22 / AGG-14-doc) |
| Nice-to-fix (loose wording) | 1 (DOC-06 — plan-330's own "3 keys" mis-citation) |
| Verified-correct (no finding) | 3 (i18n parity; error.tsx working-tree comment; page.tsx title:absolute comment) |

**Net:** the 4 doc mismatches my mandate asked me to verify (AGG-21/22/23/14-doc) are ALL real at HEAD and ALL already correctly scheduled in `plan/plan-330` Unit A (status TODO — not yet implemented). The one genuinely NEW issue is DOC-05: the working-tree AGG-5 change to `admin-backfill-runner.ts` updated the function-level comment to the new cap (2) but left the FILE-HEADER comment stating the old cap (4), so the same file now disagrees with itself.

---

## Findings table

| ID | Severity | Doc location | Claim | Code reality | Fix class |
|---|---|---|---|---|---|
| DOC-01 (AGG-21) | LOW must-fix | `CLAUDE.md:260` | "covers all **5** `COLOR_IMPACTING_KEYS`" + lists 5 | `settings-hash.ts:34-46` defines **9** keys | wrong count |
| DOC-02 (AGG-23) | LOW | `CLAUDE.md:92` | `IMAGE_PIPELINE_VERSION = 7` attributed to `process-image.ts` | Defined `gallery-config-shared.ts:21`; re-exported `process-image.ts:303` | wrong location (value OK) |
| DOC-03 (AGG-22) | LOW | `CLAUDE.md:302` (+ Admin tunables / Backfill) | only sidecar `BACKFILL_CONCURRENCY=2` shown | in-app path uses `ADMIN_BACKFILL_CONCURRENCY` (default 1, pool-budget-capped to 2); not documented | missing/incomplete |
| DOC-04 (AGG-14 doc) | LOW | `CLAUDE.md:216` | "Single Sharp instance with `clone()` (avoids triple buffer decode)" | fresh `sharp()` per format+size (WI-14/R8-R8), `process-image.ts:1019-1097`; contradicts CLAUDE.md's own `:246` | overstatement / self-contradiction |
| DOC-05 (NEW) | MED must-fix | `admin-backfill-runner.ts:28-35` (file-header comment) | "effective ceiling is floor((POOL_CONNECTION_LIMIT - 2) / 2) = **4** at the shipped pool size" | working-tree change made cap = **2** (`resolveBackfillConcurrency`, line 134); function-level comment lines 103-122 correctly says **2** | wrong value / file self-contradiction |
| DOC-06 | LOW nice-to-fix | `plan/plan-330:30` | "…has **9** keys, not **3** (CLAUDE.md)…" | CLAUDE.md actually states "**5**" (line 260), not 3 (the "3" lives in the settings-hash.ts module docstring) | wrong reference in plan |

---

## Detail

### DOC-01 (AGG-21) — `COLOR_IMPACTING_KEYS` is 9, not 5 — MUST-FIX

- **Doc:** `CLAUDE.md:260` — "The settings hash (P4-E2) covers all **5** `COLOR_IMPACTING_KEYS` — `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`".
- **Code reality:** `apps/web/src/lib/settings-hash.ts:34-46` — the array has **9** entries:
  1. `wide_gamut_jpeg_chroma`
  2. `sdr_jpeg_chroma`
  3. `avif_effort`
  4. `force_srgb_derivatives`
  5. `wide_gamut_max_source_pixels`
  6. `image_quality_webp` (R7-H2)
  7. `image_quality_avif` (R7-H2)
  8. `image_quality_jpeg` (R7-H2)
  9. `image_sizes` (R8-R6)
  `buildHashFromConfig` (lines 69-81) confirms all 9 are folded into the hash. NOTE: the module's own top docstring (lines 7-9) is ALSO stale — it lists only 3 keys.
- **Corrected wording:** "…covers all **9** `COLOR_IMPACTING_KEYS` — the five color keys above plus `image_quality_webp` / `image_quality_avif` / `image_quality_jpeg` (R7-H2) and `image_sizes` (R8-R6); see `COLOR_IMPACTING_KEYS` in `settings-hash.ts`. Flipping any color-, quality-, OR size-impacting admin setting invalidates cached variants on that path." Also fix the settings-hash.ts module docstring (lines 7-9), which under-lists at 3.
- **Confidence:** High. Already scheduled: `plan/plan-330` Unit A row "AGG-21" (status TODO — still wrong at HEAD).

### DOC-02 (AGG-23) — `IMAGE_PIPELINE_VERSION` defined in gallery-config-shared.ts, not process-image.ts

- **Doc:** `CLAUDE.md:92` — `process-image.ts` row, "…`IMAGE_PIPELINE_VERSION = 7`".
- **Code reality:** Definition lives at `apps/web/src/lib/gallery-config-shared.ts:21` (`export const IMAGE_PIPELINE_VERSION = 7;`). `process-image.ts:301-303` re-exports it: line 301 comment "IMAGE_PIPELINE_VERSION is defined in gallery-config-shared.ts (client-safe)", line 303 `export { IMAGE_PIPELINE_VERSION } from '@/lib/gallery-config-shared';`.
- **Value:** `7` is CORRECT. Only the attribution is loose.
- **Corrected wording:** attribute the definition to `gallery-config-shared.ts` (client-safe) and note process-image.ts re-exports it. E.g. "`IMAGE_PIPELINE_VERSION` (currently 7) is defined in `gallery-config-shared.ts` and re-exported here."
- **Confidence:** High. Scheduled: `plan/plan-330` Unit A row "AGG-23".

### DOC-03 (AGG-22) — backfill env vars not distinguished; cap arithmetic absent from CLAUDE.md

- **Doc:** CLAUDE.md mentions `BACKFILL_CONCURRENCY=2` only at `:302` (the sidecar `--rm` docker run example). There is NO mention anywhere in CLAUDE.md of the in-app `ADMIN_BACKFILL_CONCURRENCY` env var, nor of the pool-budget cap. (`grep` for `ADMIN_BACKFILL_CONCURRENCY` / `BACKFILL_RESERVED` / `resolveBackfillConcurrency` / `pool budget` / `reserving half` on CLAUDE.md returns nothing.)
- **Code reality:** Two distinct knobs:
  - **In-app** (`admin-backfill-runner.ts:583`): `process.env.ADMIN_BACKFILL_CONCURRENCY` (default 1), then **clamped DOWN** by `resolveBackfillConcurrency` (line 124) to a shared-pool-budget cap. At `POOL_CONNECTION_LIMIT=10` the cap is now **2** (post working-tree change — see DOC-05).
  - **Sidecar** (`scripts/backfill-color-pipeline.ts`): `BACKFILL_CONCURRENCY` (default 2), runs in its own `--rm` container with its own connection pool — NOT subject to the live web-pool cap.
- **Corrected wording:** add to the Backfill / Admin-tunables section: "Two concurrency env vars: the in-app trigger reads `ADMIN_BACKFILL_CONCURRENCY` (default 1) and clamps it DOWN to a shared-pool-budget cap = `floor((POOL_LIMIT − RESERVED − 1) / 2)` where `RESERVED = max(3, ceil(POOL_LIMIT/2))` → **2** at the shipped pool of 10, reserving ≥5 connections for a live `getImage()` fan-out; the sidecar `--rm` script reads `BACKFILL_CONCURRENCY` (default 2) uncapped because it runs in its own container with its own pool."
- **Confidence:** High. Scheduled: `plan/plan-330` Unit A row "AGG-22". The plan text already describes the intent; the doc text must reflect the NEW cap (2), not the pre-AGG-5 value (4).

### DOC-04 (AGG-14 doc-half) — "Single Sharp instance with clone()" contradicts the encoder AND CLAUDE.md itself

- **Doc:** `CLAUDE.md:216` (Image Processing Pipeline step 6) — "Single Sharp instance with `clone()` (avoids triple buffer decode)".
- **Code reality:** The shared-instance design was explicitly REMOVED. `apps/web/src/lib/process-image.ts:1019-1021` comment: "R8-R8: shared `image` variable removed — every format now gets a fresh `sharp()` instance inside generateForFormat, eliminating cross-format contamination risk." Lines 1088-1097 (WI-14 / R8-R8): each format-and-size opens its own `sharp(processingInputPath, …)`. The only `clone()` calls are (a) the 16px blur builder at line 842 and (b) the per-image 10-bit→8-bit AVIF fallback at line 1146 (which clones the per-format `base`, NOT a single shared instance). So there is no "single Sharp instance" feeding all three formats.
- **Self-contradiction:** CLAUDE.md `:246` already states the correct architecture: "Per-format fresh `sharp(inputPath, …)` to eliminate shared-state cross-format contamination (WI-14)." Lines 216 and 246 directly disagree.
- **Corrected wording (line 216):** "Each output format gets a fresh `sharp(inputPath, …)` instance (WI-14 / R8-R8) to eliminate cross-format shared-state contamination; same-`resizeWidth` outputs within a format are hard-link-deduped." (Drop the "single instance / avoids triple buffer decode" framing — it describes the pre-WI-14 design.) NOTE: the PERF half (per-size re-decode, ~18 decodes/image) is intentionally DEFERRED in `plan/plan-330` entry 3; only the wording is in scope here.
- **Confidence:** High. Scheduled: `plan/plan-330` Unit A row "AGG-14 doc half".

### DOC-05 (NEW — working-tree-introduced) — backfill runner FILE HEADER still says cap = 4; function comment + code say 2 — MUST-FIX

- **Doc:** `apps/web/src/lib/admin-backfill-runner.ts:28-35` (the module file-header comment): "…the effective ceiling is floor((POOL_CONNECTION_LIMIT - 2) / 2) **= 4** at the shipped pool size. Requests above the cap are clamped DOWN (see resolveBackfillConcurrency)…".
- **Code reality:** The working-tree change (`git diff HEAD` on this file) rewrote `resolveBackfillConcurrency` (line 134): `const cap = Math.max(1, Math.floor((limit - reserved - 1) / 2));` with `reserved = Math.max(3, Math.ceil(poolLimit / 2))` (lines 100-101 / 133). At limit 10 → reserved 5 → cap = floor((10−5−1)/2) = **2**. The function-level docblock (lines 103-122) was correctly updated to "= 2". The companion test `apps/web/src/__tests__/admin-backfill-concurrency-cap.test.ts` (working-tree) pins `resolveBackfillConcurrency(8,10)===2` and `default→2`. So the FILE-HEADER comment is the lone hold-out still asserting the old "= 4" formula `floor((LIMIT-2)/2)` — the same file now contradicts itself.
- **Corrected wording (lines 28-35):** replace "each worker can hold up to 2 … the whole-run advisory lock pins 1 more, so the effective ceiling is floor((POOL_CONNECTION_LIMIT - 2) / 2) = 4 at the shipped pool size" with the new reserved-headroom arithmetic: "…the effective ceiling is `floor((POOL_LIMIT − RESERVED − 1) / 2)` with `RESERVED = max(3, ceil(POOL_LIMIT/2))` = **2** at the shipped pool of 10 (reserving ≥5 connections for a live `getImage()` fan-out). See `resolveBackfillConcurrency` / `BACKFILL_RESERVED_LIVE_CONNECTIONS`." This makes the header agree with lines 103-122 and the code.
- **Why this matters:** it is a code-comment honesty regression introduced by the AGG-5 change itself. plan-329 item 4 explicitly required "The runner header no longer claims '1 free is sufficient'" — that older claim WAS removed, but a SECOND header sentence stating the stale `= 4` ceiling was missed. Distinct from the plan-330 docs batch (which targets CLAUDE.md), so it would otherwise slip through unnoticed.
- **Confidence:** High (mechanical diff evidence).

### DOC-06 (nice-to-fix) — plan-330 mis-cites CLAUDE.md's current key count

- **Doc:** `plan/plan-330:30` — "`COLOR_IMPACTING_KEYS` in `settings-hash.ts:34-46` has **9** keys, not **3** (CLAUDE.md) or 5 (plan-326)."
- **Reality:** CLAUDE.md `:260` currently states "**5**", not 3. The "3" lives in the settings-hash.ts module *docstring* (lines 7-9), which is likely what the plan author conflated, but the citation reads "(CLAUDE.md)". The plan's prescribed FIX (list the real 9) is correct; only its parenthetical diagnosis of the current CLAUDE.md value is off.
- **Corrected wording:** "…not 5 (CLAUDE.md:260) or 5 (plan-326); the settings-hash.ts module docstring additionally under-lists at 3." Low priority — does not change the fix.
- **Confidence:** High.

---

## Verified-correct (no finding)

1. **i18n key parity (CLAUDE.md:470 DOC-R5C3-07).** `en.json` and `ko.json` each have **837** keys; recursive key-set diff is empty both directions (en-only 0, ko-only 0). The documented intentional plural asymmetry is about VALUE shape, not key set — keys match exactly. Plan-329 item 2 (home title) and the backfill summary changes did NOT introduce a key-parity break. No finding.
2. **Admin `error.tsx` working-tree comment.** The new comment (`apps/web/src/app/[locale]/admin/(protected)/error.tsx:22-28`) claims it splits the glyph "the same way the public twin (app/[locale]/error.tsx) does: aria-hidden decorative span … sr-only `<h1>`". Verified against the public twin (`app/[locale]/error.tsx:18-19`): identical pattern (`<span aria-hidden …/30 block>` + `<h1 className="sr-only">`). Comment is now TRUE (it was the FALSE-parity comment AGG-9/DES-01 flagged; the working-tree change corrected both code and comment). No finding.
3. **Home `page.tsx` title:absolute comment.** Comment (`apps/web/src/app/[locale]/(public)/page.tsx:42-50`) explains `{ absolute }` opts the home page out of the layout `%s | ${seo.title}` template; `metadataTitle = { absolute: title }` is applied at `metadata.title` in all return shapes (lines 67, 112), while OpenGraph/Twitter `title` stay plain strings (lines 117, 128) — matching the comment's claim that OG/Twitter titles are not templated by Next. Implements plan-329 item 2 correctly. No finding.

---

## Notes for the implementing agent

- DOC-01/02/03/04 are already correctly captured in `plan/plan-330` **Unit A** (one docs commit, status TODO). This review CONFIRMS they remain wrong at HEAD and the plan's prescriptions are accurate against current code — with two caveats: (a) the AGG-22 doc text must reflect the **post-AGG-5 cap of 2** (not the historical 4); (b) the AGG-21 fix should also correct the `settings-hash.ts` module **docstring** (lines 7-9), which under-lists the keys at 3 — the same staleness in a second location.
- **DOC-05 is NOT in any plan** and was introduced by the working-tree AGG-5 change. Fold it into the same commit as AGG-5 (plan-329 item 4) or the plan-330 Unit B code-comment batch — it is a code-comment honesty fix in `admin-backfill-runner.ts`, parallel in spirit to Unit B's AGG-19/AGG-20.
