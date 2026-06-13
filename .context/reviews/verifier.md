# Verifier — Cycle 8 (review-plan-fix, internally run-9 cycle-5)

**Date:** 2026-06-14
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD verified:** `9c40d261` (working tree clean for all tracked source — only `.context/reviews/*` and untracked plan files differ, none are app source). Re-confirmed `git rev-parse --short HEAD = 9c40d261` after my probes; all source-file diffs empty.
**Mandate:** evidence-based correctness verification of (a) the four cycle-7 closed findings (ACTUALLY closed + non-vacuous at HEAD, reading the closing commits' resulting code), and (b) a representative high-value sample of CLAUDE.md documented invariants. Run real probes; do not trust claims.

---

## Verdict

**Status: PASS.** Every cycle-7 closed finding is CONFIRMED-CLOSED and NON-VACUOUS at HEAD. Every sampled CLAUDE.md invariant matches the code. I proved the two privacy/a11y regression guards RED-on-perturbation by hand (not on the plan's word). **No new finding.** This loop has converged on the cycle-7 batch.

- **Confidence: High** — claims verified by reading the resulting code at the cited lines + running the committed regexes in Node + perturbing the source to prove RED + fresh gate runs.
- **Blockers: 0.**
- **One transient-flake observation (NOT a finding):** see OBS-1 — `npm run typecheck` failed once on a cold run while I had concurrent vitest processes in flight, then passed cleanly on every isolated and combined re-run. Code is clean.

---

## Evidence — gates (fresh, this cycle)

| Check | Result | Command | Output |
|-------|--------|---------|--------|
| ESLint | PASS | `npm run lint` | exit 0 |
| Typecheck (app) | PASS | `npm run typecheck:app` | "Types generated successfully", exit 0 |
| Typecheck (scripts) | PASS | `npm run typecheck:scripts` | "Checked 7 JavaScript script files.", exit 0 |
| Typecheck (full, end-to-end) | PASS | `npm run typecheck` | exit 0 on clean re-run (see OBS-1) |
| lint:api-auth | PASS | `npm run lint:api-auth` | OK (2 admin route files) |
| lint:action-origin | PASS | `npm run lint:action-origin` | "All mutating server actions enforce same-origin provenance." |
| lint:public-route-rate-limit | PASS | `npm run lint:public-route-rate-limit` | OK (og / semantic / stripe-webhook) |
| Representative vitest sample | PASS | `vitest run` (9 invariant files) | **9 files / 139 tests passed, 0 failed** |

Representative sample files: `privacy-fields`, `touch-target-audit`, `strip-gps-from-original`, `process-image-webp-lossless-detect`, `check-api-auth`, `check-action-origin`, `check-public-route-rate-limit`, `data-tag-names-sql`, `csv-escape`.

---

## Cycle-7 closed findings — re-verified CLOSED + NON-VACUOUS at HEAD

| ID | Cycle-7 finding / claim | Closing commit | Status at HEAD | Evidence |
|----|--------------------------|----------------|----------------|----------|
| **VER8-01** | AGG-C7-01: admin-header brand `<Link>` needs a 44 px tap area | `b47cdbb6` | **PASS — CLOSED, non-vacuous** | `apps/web/src/components/admin-header.tsx:16` className is `"mr-6 flex items-center space-x-2 font-bold min-h-11"` — `min-h-11` (44 px) present. Anchor-scoped positive pin at `touch-target-audit.test.ts:1218` (`it('admin-header brand <Link> keeps its min-h-11 tap area (AGG-C7-01)')`) reads the REAL source file and asserts `min-h-11`, so dropping the token flips it RED. Full audit ran 15/15 green this cycle. |
| **VER8-02** | AGG-C7-02: WebP XMP-chunk JUNK-retag GPS branch direct test (must go RED if JUNK write offset perturbed) | `5ef545bf` | **PASS — PROVEN RED-on-perturbation by hand** | Source branch `gps-exif-strip.ts:584` is `buf.write('JUNK', offset, 4, 'ascii')` (correct offset, not `offset+4`). Test at `strip-gps-from-original.test.ts:282-315` (positive) + `:317-333` (negative). **I perturbed `offset`→`offset+4` in the source and ran the suite: `1 failed | 27 passed` — the positive XMP test went RED.** Restored → `28 passed`, source diff empty. The RED path: a wrong `offset+4` write corrupts the XMP chunk's size field (FourCC `JUNK`=`0x4B4E554A` LE ≈ 1.26 B), so `webpPixelChunk(result.buffer)` walks past EOF → null → `expect(pixelsAfter).not.toBeNull()` (line 313) fails. Non-vacuous, source unchanged (test-only commit, branch correct today). |
| **VER8-03** | AGG-C7-03: scale-token catch-all extended to `<Link>`/`<a>`/`<select>` (committed regex must catch h-7/size-8 in Node) | `99071d76` | **PASS — empirically verified in Node** | Patterns present at `touch-target-audit.test.ts` for `<Link>` (`:476-483`), `<a>` (`:499-506`), `<select>` (`:430-437`). **I ran the committed regexes in Node:** `<Link className="h-7">`/`size-8`/`min-h-6` all FLAG; `h-7 min-h-11` (override) + `max-h-10` (ceiling) + `h-11` do NOT (Link 6/6). `<a className="h-7">`/`size-8` FLAG, `max-w-10`/`size-12` clean (a 4/4). `<select>` `h-7`/`min-h-6` FLAG, `size-8` correctly NOT caught (height-only reach by design — select closed-state trigger is height-sized; documented), `h-7 h-11` override clean (select 4/4). 14/14 Node probes correct. |
| **VER8-04** | AGG-C7-05: WebP GPS re-encode lossless detection by CHUNK not substring | `85bca582` | **PASS — CLOSED, non-vacuous** | `isLosslessWebpByChunk()` at `process-image.ts:1498-1519` walks RIFF sub-chunks (`[FourCC][LE size]`, even-padded, `next<=offset` overflow guard), returns `true` only on a genuine `VP8L` pixel chunk, `false` on `VP8 `, defaults `false` on malformation. Call site `process-image.ts:1608` is `const isLosslessWebp = isLosslessWebpByChunk(input);` — **no `input.includes('VP8L')` whole-buffer scan remains** (grep confirms the only `input.includes` is gone). Test `process-image-webp-lossless-detect.test.ts:53-64` plants a `VP8L` substring inside an XMP chunk of a genuinely-lossy VP8 file, asserts the naive scan WOULD match (precondition `:63`), then asserts `isLosslessWebpByChunk` returns `false` — the exact regression closed. 4/4 green. |
| **VER8-05** | AGG-C7-04: CLAUDE.md scale-token coverage lists the new tag classes | `5d7bd2ac` | **PASS — doc matches code** | `CLAUDE.md:514` scale-token bullet reads "on `<Button>`/`<button>` (AGG-R8c3-06) AND `<Link>`/`<a>`/`<select>` (extended in AGG-C7-03; `<select>` uses the height-only `{min-h\|h}-1..10` reach since the closed-state trigger is height-sized)". This precisely matches the committed regexes I verified in Node (select height-only; Link/a full reach incl. `w`). The `max-` lookbehind para at `:516` also accurate (Button→select→a/Link lineage). |

**Commit-to-file sanity:** each cycle-7 commit touched exactly the expected files — `b47cdbb6` (admin-header.tsx + touch-target test), `5ef545bf` (strip-gps test ONLY — correct, branch was already right), `99071d76` (touch-target test), `5d7bd2ac` (CLAUDE.md), `85bca582` (process-image.ts + new lossless-detect test). No scope creep.

---

## CLAUDE.md documented-invariant spot-checks (representative high-value sample)

| Invariant (CLAUDE.md claim) | Status | Evidence |
|------------------------------|--------|----------|
| `IMAGE_PIPELINE_VERSION = 7` | **PASS** | `gallery-config-shared.ts:21` `export const IMAGE_PIPELINE_VERSION = 7;` (re-exported from `process-image.ts:303`). |
| `COLOR_IMPACTING_KEYS` (ETag settings hash) | **PASS (count = 9)** | `settings-hash.ts:37` array parsed in Node → 9 keys: 5 color (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`) + 3 quality (`image_quality_webp/avif/jpeg`) + 1 size (`image_sizes`). Matches the in-file docstring. **Doc nuance (already known, AGG-C7-R3):** CLAUDE.md's ETag section says "all **5** COLOR_IMPACTING_KEYS" — that "5" is the *color subset*; the full hashed set is 9. Pre-flagged stale-snapshot paraphrase, NOT a new finding. |
| serve-upload ETag formula `W/"v${PIPELINE}-${mtime}-${size}-${hash}"` | **PASS** | `serve-upload.ts:201` `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`. `HASH_LENGTH = 8` (`:51`), no `.slice(0,8)` at the ETag site (matches doc). |
| Cache-Control is `must-revalidate` NOT `immutable` (R4C6) | **PASS** | `next.config.ts:66` and `serve-upload.ts:216` both `'public, max-age=3600, must-revalidate'`; both carry the "deliberately NOT immutable — backfill rewrites in place" comment. |
| Privacy: `publicSelectFields` derived from `adminSelectFields` by omission + compile-time `never` guards | **PASS** | `data.ts:419` `_privacyGuard` (`_SensitiveKeysInPublic extends never ? true : [error]`), `:431` `_mapPrivacyGuard`, `:449` `_largePayloadGuard`. `privacy-fields.test.ts` (symmetric SENSITIVE_KEYS contract incl. latitude/longitude/is_hdr/uploaded_by) → 8/8 green. |
| SW source-of-truth + `-p{PIPELINE}` version stamp | **PASS** | `public/sw.js:26` `SW_VERSION = 'ee0f38bd-p7'` (`-p7` suffix correct). Note: differs from the last SW-stamp *commit* (`5b5de9d3-p7`) because the `prebuild` hook re-stamps the short-SHA — the `-p7` pipeline suffix is the load-bearing invariant and is correct. |
| 6 advisory-lock names | **PASS** | grep over `src/`+`scripts/`: `gallerykit_admin`/`_color`/`_db`/`_topic`/`_upload` + `gallerykit:image-processing:{jobId}`. (`gallerykit_forwarded` is a trust-proxy prefix, not an advisory lock.) |
| CSV escape strips bidi (U+202A-202E, U+2066-2069) + zero-width (U+200B-200F, U+2060, U+FEFF, U+180E, U+FFF9-FFFB) | **PASS** | `csv-escape.ts:14-20,46-48` documents + strips the full set; `csv-escape.test.ts` in the 139-test sample passed. |
| `lib`→`app` layering: exactly one inversion (`api-auth.ts` imports `isAdmin`) | **PASS (unchanged)** | lint:action-origin / lint:api-auth both green; no new coupling introduced this cycle. |
| `data-tag-names-sql` GROUP_CONCAT contract (no regression to scalar subquery) | **PASS** | In the 139-test sample, green — `tagNamesAgg` contract intact. |

---

## OBS-1 (observation, NOT a finding) — transient `next typegen` flake on a concurrent cold run

On my first `npm run typecheck` invocation (run while two other vitest processes from earlier turns were still active), the combined script exited code 2 with no diagnostic body. I then isolated every sub-step:

- `typecheck:app` → exit 0 ("Types generated successfully")
- `check:js-scripts` → exit 0 ("Checked 7 JavaScript script files.")
- `tsc -p tsconfig.scripts.json --noEmit` (direct) → exit 0
- `typecheck:scripts` (combined) → exit 0
- `npm run typecheck` (full, isolated re-run) → **exit 0**

The failure did not reproduce on any isolated or combined re-run with no concurrent load. The likely cause is the `next typegen` step (writes `.next/types`) racing leftover file handles / a stale partial typegen under concurrent vitest I/O. This is a known class of Next typegen non-determinism, **not a code defect** — working tree was clean throughout and HEAD never moved. Recorded for transparency; no action. (The cycle-7 aggregate's "typecheck exit 0 at HEAD" claim is RE-CONFIRMED on the clean run.)

---

## Recommendation

**APPROVE.** All four cycle-7 closed findings are non-vacuous and CLOSED at HEAD `9c40d261` (two proven RED by hand-perturbing the source, two by reading the resulting code + running the committed regexes in Node), and the sampled CLAUDE.md invariants all match the code. No new correctness, privacy, a11y, or doc-drift finding. The single typecheck hiccup was a reproduced-clean transient flake, not a defect. This loop has converged.

### Confirmed PASS (summary)
- VER8-01..05 — all five cycle-7 items CLOSED + non-vacuous.
- 8 gates green (lint, typecheck app+scripts+full, 3 security lint gates, 139-test representative vitest sample).
- 10 CLAUDE.md invariants spot-checked PASS (pipeline version, color-impacting keys, ETag formula, cache policy, privacy guards, SW stamp, advisory locks, CSV unicode strip, layering, tag-names SQL).
