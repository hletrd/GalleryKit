# Critic — Run-9 Cycle-8 (read-only meta-review)

**Role:** Adversary against BOTH false convergence AND manufactured findings.
**HEAD:** `4e132b03700889e1a937dac16d0d2eae9518d681`
**Mode:** THOROUGH (no escalation to ADVERSARIAL triggered — 0 CRITICAL, 0 MAJOR, no systemic-issue pattern).
**Method:** Independent verification of every high-entropy CLAUDE.md claim against actual code; full enumeration
of all `enqueueImageProcessing` call sites; re-confirmation of prior adjudications; live gate run (typecheck +
3 lint gates + 43 contract tests + i18n parity); gap-analysis for any non-settings drift class.

---

## VERDICT: APPROVE-CONVERGENCE

A truthful zero. Every load-bearing doc claim verifies correct against code. The settings-forwarding defect
class (c5/c6/c7) is independently CONFIRMED EXHAUSTED. The two prior adjudications hold. No NEW defect at any
confidence. The architect's "19 privacy fields" report is itself FALSE and must NOT be filed. One pre-existing
test-coverage asymmetry noted as POLISH (non-blocking, not a live bug).

- **DEFECTS: 0**
- **POLISH: 1** (browser-upload producer-side forwarding lacks a source-contract regression lock; the parallel
  LR path has one)

---

## Pre-commitment predictions vs. actual

1. *Predicted:* CLAUDE.md does NOT literally contain "19 privacy fields"; architect miscounted/misattributed.
   **CONFIRMED.** The only "19" tokens in CLAUDE.md are "React 19" (L11) and line-number citations. No privacy
   count exists in the doc at all.
2. *Predicted:* the numeric doc claims (pipeline=7, COLOR_IMPACTING_KEYS=9, HASH_LENGTH=8, cache()=10, etc.)
   are correct after many cycles. **CONFIRMED — all verified exact.**
3. *Predicted:* settings-drift class genuinely exhausted given 3 cycles + lead confirmation. **CONFIRMED** by
   full enumeration of all 6 enqueue sites + the destination-side seed/consume symmetry.

---

## TASK 1 — FALSE_DOC_CLAIMS spot-check (a false doc-claim is NEVER deferrable)

Every high-entropy claim independently verified against source. **Zero drift found.**

| Claim (CLAUDE.md) | Code (file:line) | Result |
|---|---|---|
| IMAGE_PIPELINE_VERSION = 7 | `gallery-config-shared.ts:21` = `7` | ✓ |
| COLOR_IMPACTING_KEYS = 9 (5 color+3 quality+1 size) | `settings-hash.ts:42-53` array = exactly 9 | ✓ |
| HASH_LENGTH = 8 | `settings-hash.ts:68` = `8` | ✓ |
| cache() wraps 10 fns (9 `*Cached` + getSeoSettings) | `data.ts`: 9 `Cached = cache(` + `getSeoSettings = cache(` (L1660) = 10; doc's 9-name enumeration matches code exactly | ✓ |
| VIEW_RETENTION_DAYS default 395 | `view-retention.ts:29` `395 * 24*60*60*1000` | ✓ |
| 6 advisory locks | `advisory-locks.ts`: 5 static (`db_restore`, `upload_processing_contract`, `topic_route_segments`, `admin_delete`, `color_pipeline_backfill`) + 1 dynamic (`image-processing:${jobId}`) = 6 | ✓ |
| NCLX primaries 1=BT.709, 9=BT.2020, 11=DCI-P3, 12=Display P3 | `color-detection.ts:170-175` NCLX_PRIMARIES_MAP `{1:bt709,9:bt2020,11:dci-p3,12:p3-d65}` | ✓ |
| NCLX matrix 0=identity,1=BT.709,8=YCgCo,9=BT.2020-NCL,10=BT.2020-CL | `color-detection.ts:214-220` exact | ✓ (code 8=YCgCo per AGG-R7C1-01) |
| NCLX transfer 4=gamma22(BT.470M), 5=gamma28(BT.470BG) | `color-detection.ts:185-186` exact | ✓ (AGG-R7C2-01) |
| nginx caps: 2M default / 64K login / 250M db / 216M dashboard / 216M lr-upload / 2M generic /api/admin | `nginx/default.conf` L31/58/75/92/132/149 — all match; `^~ /api/admin/lr/upload` (L131) wins generic `^~ /api/admin/` (L148) by longest-prefix | ✓ |
| admin tunable defaults (webp90/avif85/jpeg90, force_srgb=false, allow_hdr=false, force_show=false, wg_chroma 4:4:4, sdr_chroma 4:2:0, avif_effort 6, wg_max_px 50M) | `gallery-config-shared.ts:92-124` — all 10 match exactly | ✓ |
| schema tables = 18 | `db/schema.ts` 18 `mysqlTable(...)`; `APP_BACKUP_TABLES` (sql-restore-scan.ts) is exact 18-superset (c5 fix) | ✓ |
| SW_VERSION stamp = HEAD short-SHA + -p7 | committed `83780ec9-p7` = prior-commit SHA (one-behind is the established build(sw) norm — see Task 4) | ✓ |

**Conclusion: 0 false doc-claims.** The doc and code are in lockstep on every checked surface.

---

## TASK 1b — The architect's "19 privacy fields" claim — INDEPENDENTLY DISPROVED

Per the explicit directive, I verified this specific claim three ways:

1. **Does CLAUDE.md contain a "19 privacy fields" claim?** **NO.** `grep -nE "19" CLAUDE.md` returns only:
   `L11` "React **19**" (framework version) and `L219` "process-image.ts:10**19**-1097" (a line-range
   citation). No "nineteen", no "twenty", no `_PrivacySensitiveKeys` count, no privacy-field total anywhere.
   The doc deliberately describes the *guard mechanism* (`_PrivacySensitiveKeys`, `_SensitiveKeysInPublic`,
   `SENSITIVE_KEYS` fixture) and never states a numeric field count. The images color/HDR table lists 11 rows
   (a curated subset of admin-only columns), which is NOT a privacy-field total.

2. **Actual `_PrivacySensitiveKeys` union member count (data.ts):** **20** —
   `data.ts:165` `export type PrivacySensitiveKeys = ...` has exactly 20 distinct string-literal members
   (latitude, longitude, filename_original, user_filename, processed, original_format, original_file_size,
   color_pipeline_decision, is_hdr, has_gain_map, was_downscaled, transfer_function, matrix_coefficients,
   bit_depth, uploaded_by, processing_error, failed_at, color_space, icc_profile_name, pipeline_version).

3. **SENSITIVE_KEYS fixture count (privacy-fields.test.ts):** **20** — same 20 keys; the symmetric-guard test
   (`'admin-only keys form exactly the SENSITIVE_KEYS contract'`) PASSES, so union ≡ fixture ≡ 20.

**Adjudication:** The architect's report is FALSE on the doc side. There is no "19" claim to be wrong. The
code count (20) is correct and internally consistent (union = fixture = 20, compile-time + runtime guarded,
test green). **Filing "doc says 19, code says 20" would be a MANUFACTURED DEFECT** — precisely the false
convergence-blocker a critic exists to stop. Recorded here so the next cycle does not re-litigate it.

**Verdict on the "19 privacy fields" doc claim: NOT a real false-doc-claim DEFECT. It is a phantom — the doc
makes no such claim, and the code's true count (20) is correct and guarded.**

---

## TASK 2 — Prior-cycle adjudications still sound (no decisive new evidence to reopen)

### MED-R7C2-01 (histogram clip denominator) — REFUTED stays REFUTED
Independently re-verified the invariant at `public/histogram-worker.js:29-31`: `r[rv]++; g[gv]++; b[bv]++`
each fire exactly once per pixel, so `sum(r)=sum(g)=sum(b)=N`. Dividing any channel's clip count by the red
total (`totals[0]`) is therefore the correct worst-case fraction. The originally-proposed `total =
totals[0]+totals[1]+totals[2]` fix would 3× under-report and mask real clipping. **No new evidence; not
reopened.**

### "REJ-R7C3-01 / run-7 c3 spec-error sweep" — DISPROVED stays DISPROVED
The run-7 c3 critic's headline prediction (a 3rd NCLX spec error in the un-swept mappings) was REFUTED by
exhaustive ITU-T H.273 check; I re-confirmed the full NCLX primaries/transfer/matrix maps are spec-clean at
HEAD (Task 1 table). The spec-error sweep is converged. **Not reopened.**

---

## TASK 3 — Is the settings-drift class genuinely exhausted? Is there ANY other latent drift class?

### 3a. Settings-forwarding: EXHAUSTED (independently re-derived, not taken on faith)

Enumerated EVERY `enqueueImageProcessing(...)` call site in `src/` (6 total — 2 external producers, 3 internal
re-enqueues, 1 retry action):

| Site | Path | Settings disposition | Correct? |
|---|---|---|---|
| `actions/images.ts:440` | browser upload (c6 fix) | forwards all 6 from `uploadConfig` + quality + imageSizes | ✓ |
| `api/admin/lr/upload/route.ts:420` | Lightroom publish (c7 fix) | forwards all 6 from `config` + quality + imageSizes | ✓ |
| `image-queue.ts:290` | claim-retry | re-enqueues SAME `job` object → settings preserved verbatim | ✓ |
| `image-queue.ts:510` | error-retry | re-enqueues SAME `job` object → settings preserved verbatim | ✓ |
| `image-queue.ts:674` | bootstrap scan | supplies neither quality nor imageSizes → enters config-load gate (L336) → loads all 7 from current config | ✓ |
| `actions/images.ts:1139` | retryFailedImage | supplies neither quality nor imageSizes → config-load gate → current config | ✓ |

The two producers forward an IDENTICAL 6-setting set (`forceSrgbDerivatives`, `wideGamutJpegChroma`,
`avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`). Verified the
**destination-side symmetry** too: the config-load gate (`image-queue.ts:336-355`) seeds all 7 settings, and
the handler passes the 8 byte-impacting ones to `processImageFormats` (param order matches the signature at
`process-image.ts:958-972` exactly) and `autoAltTextEnabled` to `generateCaption` (L415-417). The
`ImageProcessingJob` type (L120-148) declares exactly the fields the handler reads — no declared-but-ignored
field, no read-but-undeclarable field. **Job-type ↔ producer ↔ handler symmetry is complete. The class is
exhausted.** The lead's confirmation is corroborated, not merely accepted.

### 3b. Other latent drift / asymmetry classes — swept, all GUARDED

The defect class signature is "derived snapshot silently drifts from source (no guard)." I checked every other
derived-pair surface in the repo:

- **publicSelectFields derived from adminSelectFields** — compile-time `_SensitiveKeysInPublic` /
  `_MapSensitiveKeys` guards (`data.ts:416, 167`); `tsc` green. Cannot silently drift.
- **COLOR_IMPACTING_KEYS ⊆ GallerySettingKey** — compile-time `_ColorKeysAreSettingKeys` guard
  (`settings-hash.ts:64`); `tsc` green. (Documented residual: can't catch a *forgotten new* byte-impacting
  key — author-checklist gap, already in CLAUDE.md, NOT a code defect.)
- **APP_BACKUP_TABLES ⊇ schema tables** — verified by `comm -23` (empty diff); restore scanner superset holds
  (c5 fix). The `'gi'` token I saw was the regex-flag string literal, not an allowlist entry.
- **sanitizeForOg three-consumer symmetry** — all 3 consumers (`api/og/route.tsx`, `api/og/photo/[id]`,
  `p/[id]/page.tsx`) import the SHARED `@/lib/og-sanitize`; pinned by `sanitize-for-og-global.test.ts`.
- **i18n en/ko key parity** — 779 = 779, zero asymmetry (the documented value-shape asymmetry on plurals is
  intentional, not a key drift).
- **`_PrivacySensitiveKeys` union ≡ SENSITIVE_KEYS fixture** — symmetric-guard test green (both 20).

No unguarded derived-snapshot pair remains. The settings-drift class was the last instance of this pattern
that lacked a structural guard at the producer; even it is now test-pinned on both producers (see Task 3c).

### 3c. ONE pre-existing test-coverage asymmetry → POLISH (not a DEFECT)

**POL-R9C8-01 — browser-upload producer forwarding lacks a source-contract regression lock; the LR path has
one. [POLISH, confidence: HIGH, DEFECT vs POLISH = POLISH]**

- **Where:** the LR enqueue's 6-setting forwarding is source-pinned by
  `lr-upload-hdr-gate.test.ts:318-329` (asserts each of the 6 `X: config.X` against the LR route source). The
  browser enqueue (`actions/images.ts:440`) has **no** equivalent producer-side assertion:
  `images-action-gps-toggle-wiring.test.ts` pins only `uploadConfig.stripGpsOnUpload`, and
  `image-queue-settings-wiring.test.ts` pins only the *handler/consumer* side (it constructs its own job, so
  it passes regardless of what the browser action emits).
- **Why it matters:** a future edit that dropped the 6 settings from `images.ts:440` would silently fall back
  to process-image defaults on every browser upload — the exact c6 defect — and **no test would go red.** The
  LR path is protected against this regression; the (more heavily used) browser path is not. This is the same
  "fix one sibling, miss the next" asymmetry the touch-target audit history documents.
- **Why it is POLISH not DEFECT:** the browser code at `images.ts:440` is CORRECT right now (verified — all 6
  forwarded from `uploadConfig`). This is a missing *regression lock*, not a live bug. Failure scenario is
  latent (requires a future regressing edit), not present.
- **Fix (optional, non-blocking):** add a browser-path source-contract test mirroring
  `lr-upload-hdr-gate.test.ts:318` — read `actions/images.ts`, match the `enqueueImageProcessing({...})` block,
  assert each `X: uploadConfig.X` for the 6 settings. ~15 lines.
- **Confidence:** HIGH that the asymmetry exists (grep-exhaustive). It does NOT block convergence: a truthful
  zero-DEFECT cycle can record this as a deferred test-hardening polish.

---

## TASK 4 — Gate state will hold (live evidence at HEAD 4e132b03)

- `npm run typecheck` (app + scripts) → **clean, 0 errors** (all compile-time guards hold).
- `npm run lint:api-auth` → OK (every admin route wraps `withAdminAuth`).
- `npm run lint:action-origin` → "All mutating server actions enforce same-origin provenance."
- `npm run lint:public-route-rate-limit` → OK (all public mutating handlers covered).
- `vitest run image-queue-settings-wiring + privacy-fields + lr-upload-hdr-gate` → **43 passed (43)**.
- i18n parity 779=779.
- **`git status` note:** the only working-tree change is `M apps/web/public/sw.js`, re-stamped from
  `83780ec9-p7` → `4e132b03-p7` by the `prebuild`/`build-sw.ts` hook that MY `npm run typecheck` invoked. This
  is a build artifact I caused, NOT a committed source drift, and it is the *correct* next value. Verified the
  one-behind stamp is the established norm: build(sw) commits `4e132b03`/`f0157004`/`aae915b6` committed
  `83780ec9-p7`/`2078e43f-p7`/`c2d3857a-p7` respectively (each stamps its prior commit's SHA at build time).
  **Not a finding.** No other source file is dirty.

The gate state is green and stable.

---

## Multi-perspective notes (plan/meta-review lenses)

- **Skeptic:** The strongest argument for a hidden defect was "3 consecutive same-class MEDIUMs implies a 4th."
  Disproved — the class had a finite, enumerable surface (6 enqueue sites), all now correct + (mostly)
  pinned. The pattern terminated because the surface is bounded, not because the search gave up.
- **Stakeholder:** Convergence here means the photographer-intent color pipeline honors admin settings on
  BOTH upload paths immediately (no backfill needed), which was the user-visible payoff of the c5→c7 series.
- **Executor (next-cycle planner):** If anything is scheduled, it is POL-R9C8-01 (a ~15-line test) and
  optionally the c8 `build(sw)` commit to record `4e132b03-p7`. Neither is required for a truthful zero.

---

## Realist Check

No CRITICAL/MAJOR findings to recalibrate. POL-R9C8-01's realistic worst case is "a future regressing edit to
the browser upload path ships silent default-fallback color encoding undetected until a manual audit" —
real but latent and contingent on a future mistake; correctly rated POLISH, not inflated to a defect.

---

## Open Questions (unscored)
None at actionable confidence. Every candidate resolved decisively against the code.

---

## Self-Audit
- "19 privacy fields" phantom: HIGH confidence it is NOT a doc claim (grep-exhaustive, 3 incidental "19"
  tokens only). Cannot be refuted by missing context — the full doc was searched.
- Settings exhaustion: HIGH confidence (full call-site enumeration + destination symmetry + green contract
  tests). The lead's claim is corroborated independently.
- POL-R9C8-01: HIGH confidence the asymmetry exists; correctly downgraded to POLISH because the live code is
  correct (missing lock, not live bug). Stays out of the DEFECT count.
- No low-confidence finding was promoted to a scored line. No finding manufactured.

---

## DISPOSITION: APPROVE-CONVERGENCE
- **DEFECTS: 0**
- **POLISH: 1** (POL-R9C8-01 — browser-upload producer forwarding lacks a source-contract regression lock;
  LR path has one; non-blocking, code is correct today)
- **"19 privacy fields" doc claim:** **NOT a real false-doc-claim DEFECT — it is a phantom.** CLAUDE.md makes
  no "19" (or any) privacy-field count claim; the code's true count is 20 (union ≡ fixture ≡ 20, guarded,
  test-green). Filing it would be a manufactured finding and is explicitly rejected here.

The settings-drift class is genuinely EXHAUSTED, no other unguarded derived-snapshot class remains, all gates
are green at HEAD, and every load-bearing doc claim is accurate. This is the correct steady state of a
converged system. A truthful NEW_FINDINGS:0 / COMMITS:0 is the right outcome.
