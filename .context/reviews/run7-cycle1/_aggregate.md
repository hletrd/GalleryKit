# Aggregate Review — Run-7 Cycle-1 (HEAD `17f743f7`)

**Date:** 2026-06-18
**Agents fanned out (11/11 returned + persisted):** code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer.
**Gate state (verifier + debugger, fresh foreground runs at HEAD):** ESLint exit 0; typecheck (app + scripts) exit 0; Vitest **2231 passed / 4 skipped / 0 failed** (237 files passed / 2 skipped); lint:api-auth / lint:action-origin / lint:public-route-rate-limit all exit 0; Next.js prod build exit 0. The 4 skips are the model-weight-gated `clip-offline-load` (×2) + `clip-semantic-integration` (×2) suites (gated by design on `CLIP_MODELS_ROOT` weights — NOT failures).

## Context

This is the first cycle of run-7, picking up from run-6 cycle-11 (HEAD `a7de3ebd`) which CONVERGED with 1 LOW test-only finding (AGG-C11-01, **FIXED** in `2fc9a23f`). The delta from `a7de3ebd` to this HEAD (`17f743f7`) is 6 commits: 1 test-only fix (`2fc9a23f` — the AGG-C11-01 selector contract pin) + 5 documentation-only commits (disk-full incident postmortem, CLIP-shipped marking, README/CLAUDE.md updates). **No application-logic change** in any functional surface.

This cycle's new review angle (document-specialist verifying doc claims against **external authoritative specs**, not just internal code-vs-doc consistency) surfaced the first real spec-level finding in several cycles.

**Verdict: 2 actionable findings (1 MEDIUM + 1 LOW), 6 LOW deferrable observations, 1 disproved open question, 2 narrow residuals.** The MEDIUM finding (AGG-R7C1-01 NCLX YCgCo) is independently cross-confirmed by BOTH the document-specialist AND the test-engineer — high cross-agent agreement signal. No security, correctness, or data-loss finding surfaced from any of the 11 agents.

---

## Merged findings (deduped; highest severity/confidence preserved; cross-agent agreement noted)

### AGG-R7C1-01 [MEDIUM, conf HIGH] — NCLX matrix code 8 is YCgCo, not "BT.2020-NCL" (spec error in code + doc)
**Agent:** document-specialist (R7C1-F1). Independently verified by the orchestrator against the ITU-T H.273 spec.

**Where:**
- Code: `apps/web/src/lib/color-detection.ts:207` — `8: 'bt2020-ncl', // R5-M1: ITU-T H.273 Table 4 value 8 = BT.2020 NCL (same as 9)`
- Type: `apps/web/src/lib/color-detection.ts:27` — `matrixCoefficients: 'bt709' | 'bt2020-ncl' | 'bt2020-cl' | 'identity' | 'unknown'` (no `'ycgco'`)
- Doc: `CLAUDE.md:233` — "matrix `0=identity`, `1=BT.709`, `8=BT.2020-NCL` (alias of 9), `9=BT.2020-NCL`, `10=BT.2020-CL` (AGG-D5)"

**Authoritative source (contradicts both code and doc):**
- **ITU-T H.273 Table 4 (MatrixCoefficients):** code 8 = **YCgCo**; code 9 = BT.2020-NCL; code 10 = BT.2020-CL. Code 8 and 9 are NOT aliases.
- **Colour science library** (`colour.models.rgb.itut_h_273`): `8: np.array("YCgCo")`, `9: np.array([0.2627, 0.0593])`.
- **FFmpeg `AVColorSpace` enum:** `AVCOL_SPC_YCGCO = 8`, `AVCOL_SPC_BT2020_NCL = 9`.

**Problem:** Both the code label and the doc claim H.273 code 8 is "BT.2020-NCL (alias of 9)". This is a genuine spec error — code 8 is YCgCo, an entirely different matrix system. A file carrying NCLX matrix code 8 would be stored and displayed to admins as `bt2020-ncl` instead of the correct `YCgCo`.

**Impact:** LOW in practice — YCgCo essentially never appears in real photo NCLX boxes (it's a screen-content / codec-internal format). But it is a factual spec error propagating into code + doc + test (the existing test at `color-detection.test.ts:295` asserts the WRONG spec behavior: `matrix=8 → 'bt2020-ncl'`).

**Fix (multi-site):**
1. `color-detection.ts:27` — add `'ycgco'` to the `matrixCoefficients` union type.
2. `color-detection.ts:207` — map `8: 'ycgco'` with corrected comment citing H.273 correctly.
3. `color-details-section.tsx:~103` — add `case 'ycgco': return 'YCgCo';` to `humanizeMatrixCoefficients`.
4. `color-detection.test.ts:295-297` — update the test from `matrix=8 → 'bt2020-ncl'` to `matrix=8 → 'ycgco'`.
5. `color-details-section-delivered.test.ts` — add assertion for the new `ycgco` case.
6. `CLAUDE.md:233` — change "`8=BT.2020-NCL` (alias of 9)" to "`8=YCgCo`".

### AGG-R7C1-02 [LOW, conf HIGH] — CLAUDE.md + code comment overstate Firefox `(color-gamut: p3)` MQ behavior
**Agent:** document-specialist (R7C1-F2). Independently verified by the orchestrator via web search.

**Where:**
- Doc: `CLAUDE.md` browser matrix + Firefox photographer-visible impact section — claims "Firefox 110+ supports the `(color-gamut: p3)` MQ ... P3 badges and `WideGamutHint` behave like Chrome's MQ path on Firefox 110+."
- Code comment: `apps/web/src/lib/use-display-capability.ts:64` — "Firefox 110+ supports (color-gamut: p3) MQ and reaches this branch."

**Authoritative source:** caniuse carries the verbatim note: "`color-gamut: p3` is **always false** because Firefox does not support wide-gamut color. See bug 1626624." Mozilla Bugzilla 1626624 is OPEN — Firefox parses the MQ syntax (since v110) but always reports sRGB because it doesn't implement wide-gamut rendering.

**Code impact:** NONE — `use-display-capability.ts` behaviorally does the right thing (the MQ always returns false on Firefox → conservative `'srgb'` fallback). Only the doc/comment *characterization* ("behaves like Chrome") is wrong. Doc/comment-only fix.

**Fix:**
1. `use-display-capability.ts:64-66` — reword comment: "Firefox 110+ parses the MQ syntax but `(color-gamut: p3)` always returns false (Mozilla bug 1626624 — wide-gamut rendering not implemented). Firefox ≤109 lacks the MQ entirely."
2. `CLAUDE.md` Firefox photographer-visible impact section — reword to reflect that the MQ always returns false on all Firefox versions.

---

## Narrow residuals (not scheduled — reachability unverified or documented design)

### RES-R7C1-01 [INFO/narrow residual] — Structurally anomalous HEIC GPS strip fall-through (reachability unverified)
**Agent:** tracer (Flow 5, Residual A).

**Where:** `apps/web/src/lib/process-image.ts:1628-1634`.

**Description:** When `strip_gps_on_upload=true` and a structurally anomalous HEIC defeats the lossless ISOBMFF byte-level scrubber (`stripGpsFromIsobmffBuffer` returns `null`), prebuilt Sharp lacks the HEVC encoder and cannot re-encode the file. The function logs an error and returns WITHOUT stripping — the original retains GPS, which the paid-download route streams. Public DB columns ARE nulled, so the gallery UI shows no GPS (UI/file divergence).

**Why NOT a confirmed bug:** Normal iPhone HEIC files have well-formed meta/iinf/iloc boxes and ARE handled correctly by the lossless scrubber (confirmed by tests in `strip-gps-from-original.test.ts:341-366`). Only genuinely corrupt/hostile HEIC files trip the walker's strict guards (missing meta box, iloc version > 2, etc.). The code at 1629-1632 explicitly documents the patent-licensing constraint and logs loudly. This is a known, documented limitation — not a silent bug.

**Recommended probe (not blocking):** Take 5 real iPhone 14/15/16 HEIC originals known to carry GPS, run through `stripGpsFromIsobmffBuffer` in isolation, assert `result !== null && result.stripped === true`. Any `null` is a confirmed in-the-wild leak. Requires real test files not available in this environment.

### OBS-R7C1-01 [LOW observation, NOT scheduled] — Best-effort delete-image file cleanup can orphan derivatives on transient disk error
**Agent:** debugger.

**Where:** `apps/web/src/app/actions/images.ts:618-632`.

**Description:** `deleteImage` best-effort file cleanup can orphan derivatives on transient disk error (NFS hiccup, EIO). The DB transaction commits first; if `deleteImageVariants` fails all retries, the on-disk files remain with no DB row referencing them. This is the **documented** "best-effort" contract (`cleanupFailureCount` is returned to the admin), not a regression. The 2026-06-17 disk-full incident was Docker image/cache accumulation, not orphaned upload variants.

---

## Low findings (deferrable — all 4 from code-reviewer, all LOW)

### R7C1-CR-01 [LOW] — restore-maintenance flag is process-local
**Agent:** code-reviewer (R7C1-01). `restore-maintenance.ts:1-56`: a hard crash mid-restore (OOM during mysqldump import) leaves no durable marker, so the next container accepts uploads into a possibly-half-restored schema. Documented single-writer constraint; the restart-after-crash-mid-restore window is the one genuinely under-protected path. **Deferrable** — single-writer scope, restart-after-crash is a rare operational scenario, and the DB restore advisory lock serializes concurrent restore attempts.

### R7C1-CR-02 [LOW] — 1000-literal `NOT IN` clause in bootstrap
**Agent:** code-reviewer (R7C1-02). `image-queue.ts:626-628`: `notInArray` bootstrap exclusion can generate a 1000-literal `NOT IN` clause when `permanentlyFailedIds` is at its FIFO cap. Latency impact only; bounded. **Deferrable** — MySQL handles 1000-literal `NOT IN` without error; the bootstrap scan is not on a hot path.

### R7C1-CR-03 [LOW] — `'XX'` sentinel in country breakdown
**Agent:** code-reviewer (R7C1-03). `analytics-data.ts:112-133`: `getCountryBreakdown` includes the `'XX'` sentinel (un-geolocated IPs) in admin results. Display-quality nit. **Deferrable** — admin-only surface, cosmetic.

### R7C1-CR-04 [LOW] — No input bounds validation on timeline month/day/year
**Agent:** code-reviewer (R7C1-04). `data-timeline.ts:95-117`: no input bounds validation on `month`/`day`/`year` (latent contract gap; current callers validate upstream). **Deferrable** — current callers validate; defensive hardening opportunity.

---

## Rejected candidates (verified against code — NOT scheduled, NOT deferred)

### REJ-R7C1-01 — HEIC format gate misses `'heic'` (code-reviewer OQ-R7C1-01)
**Agent:** code-reviewer (OQ-R7C1-01, flagged as highest-value open question).
**Claim:** `color-detection.ts:326` format gate is `format === 'heif' || format === 'avif'` and does not include `'heic'`. If Sharp reports Apple HEIC as `'heic'`, NCLX + gain-map detection are silently skipped on the most common Apple HDR source.
**Disproof:** Per Sharp GitHub issue #2504 and libvips behavior, **Sharp reports `metadata.format` as `'heif'` for iPhone HEIC files** — not `'heic'`. This is because libvips uses the HEIF container format name regardless of the specific codec. The gate already includes `'heif'`, so iPhone HEIC files ARE captured. The code is correct. No fix needed.

### REJ-R7C1-02 — `retryFailedImage` missing `enqueued.delete` (code-reviewer RF-R7C1-01)
The `finally` at `image-queue.ts:549` clears `enqueued` on permanent failure (`retried===false`), so retry does NOT short-circuit. Verified against code.

### REJ-R7C1-03 — Backfill `processed++` race (code-reviewer RF-R7C1-02)
Impossible under JS single-threading (synchronous `++` after `await` cannot interleave).

### REJ-R7C1-04 — `decimalToRational` 0.0079→1/127 (code-reviewer RF-R7C1-03)
Mathematically correct nearest reciprocal within tolerance.

### REJ-R7C1-05 — `verifyAvifNclxInBuffer` loop bound (code-reviewer RF-R7C1-04)
Audit-only verifier, interior guards protect reads.

---

## Deferred (existing findings; severity/confidence preserved per deferred-fix rules)

### DEF-C11-01 [LOW] — Search dialog `<Input>` is 32 px tall (`h-8`) — carried forward from run-6
Unchanged from run-6 cycle-11. `apps/web/src/components/search.tsx:374`. Carried forward in `.context/plans/run7-cycle1/deferred.md`.

---

## Documentation-accuracy notes (non-findings — no behavioral defect)

- The tracer noted two CLAUDE.md accuracy refinements (non-bugs): (a) the "derivatives use atomic temp+rename" claim applies only to the base filename, not sized variants — but the control flow prevents the corrupt-read window from opening; (b) there is no GPS backfill — toggling `strip_gps_on_upload` via direct DB edit on a populated DB leaves pre-toggle originals with GPS (the UI already blocks this).
- The architect noted one optional comment reword (NON-FINDING): the `image-queue.ts:431-433` comment implies stub + production embedding rows coexist per image, but the table is `PRIMARY KEY (image_id)` — the actual behavior is correct (overwrite-then-filter on `model_version`).

---

## Per-agent finding counts

| Agent | New findings | Notes |
|---|---|---|
| code-reviewer | 4 LOW + 1 OQ (disproved) | COMMENT — 55 files; 4 LOW all deferrable; OQ-R7C1-01 (HEIC gate) disproved: Sharp reports heif for HEIC; 4 false positives disproved. |
| perf-reviewer | 0 | APPROVE — 30 files; all bounded buffers/locks/queues verified from source. |
| security-reviewer | 0 | LOW risk — every attack surface re-read at HEAD; no SQLi/SSRF/path/privesc/PII-leak; npm audit 0 crit/high (2 moderate PostCSS false-positives). |
| critic | 0 | ACCEPT — 5 self-hunted candidates all disproved; CLIP trichotomy, settings-hash, rate-limit Maps, shutdown race, CLAUDE.md drift all verified sound. |
| verifier | 0 blockers | PASS — full suite 2231 pass / 4 design-gated skips / 0 fail; all gates exit 0; all 3 carry-over fixes verified. |
| test-engineer | 1 MEDIUM + 2 LOW | TE-R7C1-01 cross-confirms AGG-R7C1-01 (NCLX code 8 = YCgCo; test actively harmful); TE-R7C1-02 (Stripe webhook POST has no behavioral test, LOW); TE-R7C1-03 (semantic route malformed-embedding skip untested at route level, LOW). |
| tracer | 0 confirmed | All 6 flows CLEAN; HEIC GPS residual A (reachability unverified); CRT-D1 accurate; card-only pin verified; model_version filter verified. |
| architect | 0 | SOUND at single-writer scale — all 8 concerns verified; storage abstraction honest dead code; config chain fail-closed. |
| debugger | 0 confirmed | 1 LOW observation (OBS-R7C1-01, documented best-effort cleanup design, not scheduled); 15+ failure-mode paths all clean. |
| document-specialist | 2 | R7C1-F1 (MEDIUM — NCLX code 8 = YCgCo spec error in code+doc+test); R7C1-F2 (LOW — Firefox MQ doc overstatement). Both verified against authoritative sources. |
| designer | 0 | ZERO new findings — full a11y surface verified clean; contrast ratios computed from HSL tokens (all pass AA/AAA); i18n key parity exact (841=841). |

**Net schedulable findings this cycle: 2** (AGG-R7C1-01 MEDIUM — NCLX YCgCo fix, cross-confirmed by document-specialist + test-engineer; AGG-R7C1-02 LOW — Firefox MQ doc fix).
**Deferrable LOW observations: 6** (R7C1-CR-01 through CR-04, TE-R7C1-02, TE-R7C1-03) + 1 carried-forward (DEF-C11-01).
**Rejected: 5** (REJ-R7C1-01 through REJ-R7C1-05).
**Narrow residuals: 1** (RES-R7C1-01 HEIC GPS, reachability unverified) + 1 LOW observation (OBS-R7C1-01, documented design).

## AGENT FAILURES

None permanently. All 11 agents returned and persisted their reports. Operational notes:
- Rate-limit (429) headwinds affected the fleet during fan-out. Multiple agents required 1-2 retries. The security-reviewer and critic agents ran read-only (Write blocked in their toolsets) and delivered complete reports in their final messages; the orchestrator persisted them verbatim to `run7-cycle1/{security-reviewer,critic}.md`. The document-specialist and test-engineer successfully wrote their own files on retry.
