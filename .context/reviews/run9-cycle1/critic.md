# Critic Review — Run-9 Cycle-1 (HEAD `d3858cfc`)

**Date:** 2026-06-21
**Role:** Adversarial falsification of the convergence claim across the WHOLE change surface, with explicit intent to find what 8 prior runs + 11 agents/cycle MISSED.
**Mode:** THOROUGH (no escalation — no CRITICAL, no 3+ MAJOR, no systemic pattern surfaced).

## VERDICT: ACCEPT — 0 new actionable findings; convergence holds (third consecutive convergence).

---

## Pre-commitment predictions (made before detailed investigation)

Before reading the diffs, I predicted the most likely hiding places for a defect that survived 8 runs:
1. **i18n key drift** — 75 lines removed from BOTH `en.json`/`ko.json`; asymmetric removal would break key-parity, OR leave orphaned dead keys (the FIND-R8C1-01 class). HIGH-value mechanical edit.
2. **Half-removed validation** in `bulkUpdateImages` — dropping a tri-state field touches 5 sites (destructure / isTriState / enum-validate / setClause / audit-metadata); missing one = silent gap.
3. **Config resolution** — `licensePrices` removed from `GalleryConfig`; a surviving `config.licensePrices` reader or a half-removed default would crash SSR.
4. **The disputed H7 comments** (`process-image.ts`) — prior critic (stale) vs test-engineer (accurate) disagreed and the item was left UNRESOLVED/uncounted.
5. **schema/data dangling refs** — removed `license_tier` / `entitlements` could leave a dangling type, `_omit` entry, or stale index.

**Result vs prediction:** Every predicted hiding place was investigated against actual code. #1–#3 and #5 are demonstrably CLEAN. #4 I DECISIVELY RESOLVED (see P4) — it is genuinely stale, but it is the cosmetic tail of an already-adjudicated/scheduled finding with zero behavioral impact, so it is correctly NOT counted as new.

---

## Convergence premise verified (not trusted)

- `git diff f63af3b9..d3858cfc` = **only `.context/reviews/run8-cycle2/*` docs.** Code is byte-identical to the converged `f63af3b9`. Premise holds. [verified]

## Gate snapshot (fresh foreground runs at HEAD `d3858cfc`)

| Gate | Result |
|---|---|
| `npm run typecheck` (app + scripts) | **exit 0** |
| `npm run lint` (eslint) | **exit 0** |
| `lint:api-auth` | **exit 0** |
| `lint:action-origin` | **exit 0** |
| `lint:public-route-rate-limit` | **exit 0** |
| `free-download-contract` + `migrate-reconcile-coverage` | **64/64 pass** |
| `privacy-fields` | **8/8 pass** |
| SW stamp / pipeline version | `SW_VERSION='ea372e41-p7'`, `IMAGE_PIPELINE_VERSION=7` — consistent (see SW-lag note) |

---

## Adversarial probes (the core) — each verified against actual code

### P1 — i18n parity / orphaned keys (prediction #1) -> CLEAN
- `en.json` 779 leaf keys == `ko.json` 779; set-diff EMPTY both directions (no asymmetry). [python flatten+diff]
- All 33 top-level namespaces referenced in code (correct `t('ns.` access-pattern grep). No orphaned namespace. [/tmp/deadns.py]
- Removed license/download keys (`licensePric*`, `downloadPage`, `downloadInterstitial`, `checkout*`) — 0 remaining in either json. [grep]
- Every surviving `viewer.download*` key still referenced in 2 src files each. [grep]
- **Verdict: REFUTED.** The 75-line bilingual removal is symmetric and leaves no dead key.

### P2 — `bulkUpdateImages` half-removed validation (prediction #2) -> CLEAN
- `git diff` of `images.ts` shows `licenseTier` removed at ALL FIVE sites: destructure (`:881`), `isTriState` guard (`:918`), enum-validate block (deleted `:948-953`), `setClause` assignment (deleted `:964`), audit-metadata (`:1056`). `LICENSE_TIERS` import removed. No orphaned `licenseValue`/send. **Verdict: REFUTED.**

### P3 — config resolution dangling reader (prediction #3) -> CLEAN
- `licensePrices` removed from the `GalleryConfig` interface AND both construction sites (normal path `:143` + error/fallback path `:191`). `GALLERY_SETTING_KEYS`/`DEFAULTS`/`VALIDATORS` all drop the 3 `license_price_*_cents` keys symmetrically.
- `validatedNumber` is NOT dead — still used by `image_quality_{webp,avif,jpeg}`, `avif_effort`, `wide_gamut_max_source_pixels`. [grep]
- Zero `config.licensePrices` / `license_price` readers remain in `src/` or `scripts/`. Stranded `admin_settings` DB rows are inert (resolver only reads keys in `GALLERY_SETTING_KEYS`). **Verdict: REFUTED.**

### P4 — disputed H7 comments (prediction #4) -> STALE, but cosmetic tail of FIND-R8C1-02 (NOT counted)
The prior critic (run8c2 H7) judged `process-image.ts:1570-1571` + `:1646-1647` ("only the download-original path remains at risk" / "Only the download-original path leaks") **stale**; the test-engineer judged them **accurate** ("admin can still download the original"). The item was left **unresolved and uncounted**. I resolved it empirically:

- **There is NO HTTP route — admin OR public — that streams the on-disk original.** `serve-upload.ts:15` whitelists `ALLOWED_UPLOAD_DIRS = {'jpeg','webp','avif'}` ONLY. Every reader of `UPLOAD_DIR_ORIGINAL` / the original file is internal server-side: `image-queue.ts:293/447` (decode + CLIP), `admin-backfill-runner.ts:443/535` (re-encode + detect), `images.ts:205` (`statfs` disk probe), `upload-paths.ts` (delete/move). The LR-upload route only *writes* the original. No reader returns the bytes in a Response. [grep all readers + serve-upload whitelist]
- **Therefore the comments ARE stale** (the named "download-original path" leak surface no longer exists) — the test-engineer's "admin can download the original" premise was factually wrong; there is no such route.

**Why this is NOT a new finding (the honest call):**
1. It is the exact same finding-class as FIND-R8C1-02 (stale paid-download threat-model comments) which run-8 cycle-1 already ADJUDICATED + scheduled; the fix simply missed these 2 body lines. Run-8 cycle-2 critic already recorded them as H7/INFO.
2. Pure comment text — zero behavior / control-flow / output impact. The at-rest GPS strip still runs and is still correct & required (decode/CLIP read the original on disk).
3. Re-filing it as CONFIRMED-NEW would inflate the count for a 2-line comment typo on an already-dispositioned item — the manufactured-thoroughness failure mode the critic exists to avoid.

**Disposition: RESOLVED-DISAGREEMENT -> INFO (cosmetic tail of FIND-R8C1-02), NOT counted as new.** My new contribution is *decisively settling* the prior open disagreement with the serve-upload-whitelist + reader-inventory evidence. If any future cleanup pass runs, fold "the download-original path" -> "the at-rest original on disk" at `process-image.ts:1570,1646`; otherwise harmless. No re-open criterion needed beyond the existing RES-R7C6-01 trigger (a new route streaming the original).

### P5 — schema/data/type dangling refs (prediction #5) -> CLEAN
- `schema.ts`: `images.license_tier` column + entire `entitlements` table removed; no dangling FK/index. `data.ts`: `license_tier` removed from `adminSelectFields` (public side auto-consistent via destructure-derivation). `image-types.ts` / `bulk-edit-types.ts`: `license_tier?` field + `LICENSE_TIERS`/`LicenseTier` removed.
- 0 non-test hits for any removed symbol (`license_tier`, `LicenseTier`, `entitlement`, `stripe`, `checkout`, `downloadToken`, `licensePrices`) in `src/`. typecheck exit 0 proves zero dangling types. **Verdict: REFUTED.**

### P6 — `migrate.js` 0023 reconcile drops -> CLEAN (re-verified from code, not the tripwire)
- `dropTableIfPresent` = `DROP TABLE IF EXISTS` (idempotent). `dropColumnIfPresent` checks `columnInfo`/INFORMATION_SCHEMA before `ALTER TABLE DROP COLUMN` (MySQL 8.0 has no `DROP COLUMN IF EXISTS` — correct guard). Both run LAST in `reconcileLegacySchema` (after all CREATE/ALTER), so reconcile converges to post-0023 schema. `license_tier` ensureColumn is now a comment (no re-add -> drop race). Journal `when` for 0023 = `1782000000000` > prior max `1781687094232` (monotonic — won't be silently skipped). 0023 SQL is bare DDL with a correct rationale comment (0008 adds + 0013 creates run/baseline before it). **Verdict: REFUTED — no data-loss, no behavioral bug.**

### P7 — surviving free-download path under edge input -> CLEAN
- `buildDownloadFilename` (`download-filename.ts`) is robust: strips `UNICODE_FORMAT_CHARS` (bidi/zero-width) + C0/C1 control bytes, NFKD + diacritic strip, non-`[a-z0-9-]`->`-`, collapse/trim `-`, 60-char cap, and falls back to `photo-{id}.{ext}` when the slug empties (CJK/empty/whitespace titles). `cleanExt` and `idPart` are sanitized. The download footer (`photo-viewer.tsx:927-975`) is fully null-safe: `downloadHref &&` gate, `isWideGamutSource && avifDownloadHref` AVIF-branch gate, `isP3Pipeline(undefined)->false` (admin field undefined for public -> falls to generic label, no crash/leak). **Verdict: REFUTED.**

### P8 — comment-only edits in surviving routes -> CLEAN
- `lr/upload/route.ts` + `semantic/route.ts` + `rate-limit.ts` docstring: all "checkout"-reference edits are comment-only; the `checkoutRateLimit` Map + 4 helpers removed with zero surviving callers. `db/download/route.ts`, `actions.ts`, `info-bottom-sheet.tsx`, `g/[key]`/`s/[key]` pages: symmetric prop/import removals. **Verdict: REFUTED.**

---

## Observation examined and dismissed (NOT a finding) — SW stamp "lag-by-one"

The committed `SW_VERSION='ea372e41-p7'` is the **parent** of the last code commit `f63af3b9`, not `f63af3b9` itself; the prior run8c2 aggregate/critic wrote "SW_VERSION == HEAD short-sha (`f63af3b9-p7`)." On inspection this is an **intentional, stable lag-by-one across all 8 runs**: the `prebuild` hook runs `git rev-parse --short HEAD` BEFORE the SW-stamp commit exists, so it captures the then-current HEAD, which becomes the *parent* once the stamp commit lands (`f63af3b9` stamps `ea372e41`; `3f687985` stamps `961a7f1f`; `1463f219` stamps `ee2d05ba`; etc. — every `build(sw)` commit stamps its own parent). The cache-busting purpose is fully served (the stamp bumps on every commit and is unique per code-state). The prior aggregate's "== HEAD" phrasing was a minor imprecision in the *writeup*, not a code defect. **NOT a finding** — re-raising it would be manufacturing a finding from a doc-phrasing nuance.

---

## DO-NOT-RE-FILE adjudicated items — confirmed not re-litigated
- **MED-R7C2-01** (histogram clip %) — not examined / not re-filed (REFUTED 3-way; no new evidence).
- **REJ-R7C3-01** (`gps-exif-strip.ts` indexSize) — `gps-exif-strip.ts` unchanged (comment-only -2 in the removal); not re-filed.
- **NCLX matrix/transfer map pin class** — COMPLETE; `IMAGE_PIPELINE_VERSION=7` / `COLOR_IMPACTING_KEYS=9` still consistent; not re-filed.
- **ARCH-R7C2-01 / TE-R7C2-02** (Stripe webhook) — CLOSED-OBSOLETE (route deleted); not re-opened.
- **TRACER `color_pipeline_decision` public-download candidate** — REFUTED null-safe; re-confirmed null-safe; not re-filed.
- **`process-image.ts:1108` "Only paid on the wide-gamut path"** — English idiom for "computationally expensive"; left untouched.
- Carried LOW/INFO deferrals (DEF-C11-01, R7C1-CR-01..04, TE-R7C2-03..05, OBS-R7C2-02..07, INFO-R7C2-08/09) — no new evidence, no exit criterion met; carried unchanged.

---

## Verdict Justification

The convergence claim survived adversarial falsification across the whole change surface. I built a file inventory FIRST (40 modified non-deleted files = the true risk surface, vs the low-risk pure deletions) and examined every mixed-edit file — not a sample. Eight adversarial probes spanning all four prompt angles (dead path / behavioral remnant / bug-behind-passing-test / behavioral doc-drift / newly-reachable error path / race / edge-input) were each PROVED-or-refuted from actual code with file:line + grep + git-diff evidence. Seven were REFUTED outright; the eighth (P4) decisively RESOLVED a previously-open inter-agent disagreement — confirming the H7 comments are stale, but correctly classifying them as the cosmetic, zero-impact tail of an already-scheduled finding (NOT new). The empirical backstop is decisive: every architectural gate is green at the actual HEAD `d3858cfc`, and the removal-specific + privacy contracts pass.

A confident, evidence-backed **0 new findings** is the correct result. This is the third consecutive convergence; the codebase remains at the converged LOW-risk state.

## Open Questions (unscored)
- None requiring code change. The only item of any kind is the P4 comment residual, dispositioned above as an optional fold-in for any future cleanup pass (already covered by FIND-R8C1-02's lineage + RES-R7C6-01's re-open trigger).
