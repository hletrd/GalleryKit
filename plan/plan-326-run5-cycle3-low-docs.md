# Plan 326 — LOW + docs (Run-5 Cycle 3)

**Source:** `.context/reviews/run5-cycle3/_aggregate.md`
**Commit discipline:** identical to plan-324.

---

## Unit A — CLAUDE.md truth batch (one docs commit)

| Finding | Where (CLAUDE.md) | Correction |
|---|---|---|
| VER-R5C3-01 (LOW) | line 229 NCLX table | `14/15=BT.2020→gamma22` → `14/15=BT.2020→gamma24 (BT.1886)` (matches `color-detection.ts` NCLX_TRANSFER_MAP) |
| DOC-R5C3-02 (MED) | line 266 WideGamutHint bullet | "so Firefox 124+ doesn't false-positive" → "so Firefox ≤ 109 (no color-gamut MQ) doesn't false-positive; FF 110+ uses the MQ path" |
| DOC-R5C3-06 (LOW) | SW section heading | "deliberate `no-store` exemption" → "deliberate Cache-Control (`no-cache`) exemption" (heading must match body + sw.template.js) |
| DOC-R5C3-01 (MED, = plan-316 VER-R5C1-01) | ETag section | drop spurious `.slice(0,8)` (hash is already 8 chars from `settings-hash.ts` HASH_LENGTH); list all **5** COLOR_IMPACTING_KEYS (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`) |
| DOC-R5C3-03 (MED, = plan-316 DOC-R5C1-05) | Performance section | "React cache() wraps getImage, getTopicBySlug, getTopicsWithAliases" → "wraps 9 data-access functions (exports ending in `Cached` + `getSeoSettings`; see data.ts)" |
| DOC-R5C3-04 (LOW, = plan-316 DOC-R5C1-03) | Deployment Checklist step 3 | add `apps/web/src/` prefix to both site-config paths |
| DOC-R5C3-05 (LOW, = plan-316 DOC-R5C1-24) | Image pipeline step 9 | "capped at 4 KB" → "capped at 4096 chars (~3 KB decoded)" |
| DOC-R5C3-07 (LOW) | Testing or i18n note | add one line documenting the en-ICU-plural vs ko-fixed-form convention (intentional per Korean grammar) |

## Unit B — code-comment honesty batch (one commit)

| Finding | Where | Change |
|---|---|---|
| AGG-R5C3-15 / COR-R5C3-06 (LOW) | `apps/web/src/app/api/search/semantic/route.ts:81-86` | document at the `clampSemanticTopK` export: `raw` must be a parsed-JSON number; query-string callers must pre-coerce (numeric strings now return the default by design) |
| AGG-R5C3-23 / CRT-R5C3-02 (LOW) | `apps/web/src/app/api/checkout/[imageId]/route.ts:182-185` | amend comment: omitting the key also forfeits single-buyer double-click dedup on unknown-IP deployments (two pending sessions until ~24 h expiry; self-healing, no double charge) |
| TEST-R5C3-08 short-term half (MED) | `apps/web/e2e/public.spec.ts:125-140` + fixtures | TODO comment stating the valid-key spec skips until a share key is seeded; reference plan-327 entry 1 exit criterion |

## Unit C — plan-doc correction

- CRT-R5C3-01 sub-item (c): correct the stale coverage claim in `plan/done/plan-320-run5-cycle2-medium.md:31` — `(public)` IS in SCAN_ROOTS; the real gaps were element-type (`<Link>`/`<a>`) and `app/[locale]` root files (fixed by plan-325 item 8). Annotate, don't rewrite history: add a `[CORRECTION cycle-3]` note.

---

## Progress

| Unit | Commit | Status |
|---|---|---|
| A | a4307143 | DONE |
| B | c5d6b0d8 | DONE |
| C | c5d6b0d8 | DONE |
