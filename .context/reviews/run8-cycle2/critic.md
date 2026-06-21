# Critic Review — Run-8 Cycle-2 (HEAD `f63af3b9`)

**Date:** 2026-06-21
**Role:** Adversarial falsification of the convergence claim "there is nothing new to fix."
**Mode:** THOROUGH (no escalation triggered — no CRITICAL, no 3+ MAJOR, no systemic pattern).

## NEW FINDINGS: 0

Convergence holds. All 5 run-8 cycle-1 findings landed cleanly (commits `7fade6df`..`4e72d0f4`); the paid-download removal remains surgically clean at HEAD; every architectural gate is green; 2036/2036 active tests pass. I formed 7 adversarial hypotheses across the four prompt angles and tried to PROVE each from the actual code. Six were REFUTED with file:line evidence; one surfaced a cosmetic doc-drift residual that is the *tail of an already-adjudicated finding* (FIND-R8C1-02), NOT a new behavioral defect — recorded below as INFO for the planner, deliberately NOT counted as a new finding (counting it would be manufactured-thoroughness padding).

---

## Gate snapshot (fresh foreground runs at HEAD `f63af3b9`, AFTER the 5 cycle-1 fixes landed)

The cycle-1 aggregate ran at `47b1e21f` (before the fixes). I re-ran every gate at the current HEAD to confirm the cleanup commits introduced no regression:

| Gate | Result |
|---|---|
| ESLint (`npm run lint`) | exit 0 (clean) |
| typecheck (app + scripts) | exit 0 — 7 JS scripts + tsc app/scripts both clean |
| lint:api-auth | exit 0 (2 admin routes OK) |
| lint:action-origin | exit 0 (all mutating actions enforce same-origin) |
| lint:public-route-rate-limit | exit 0 (semantic uses helper; OG/similar no mutating handler) |
| Vitest (full) | **2036 passed / 4 skipped / 0 failed** (222 files passed + 2 skipped = 224) |
| SW stamp currency | `SW_VERSION = 'f63af3b9-p7'` == HEAD short-sha + `IMAGE_PIPELINE_VERSION=7` ✓ |

The 4 skips are exclusively the CLIP-weight-gated suites (env-gated by design, NOT removal-induced) — identical to cycle-1. Test count is +12 over cycle-1's 2024 (free-download-contract +10, migrate tripwire +2) — exactly the cycle-1 landings, no other drift.

---

## Hypotheses tested (the adversarial core)

### H1 — Paid-download removal left a genuinely-reachable dead path or a behavioral remnant in surviving download/checkout code
**Angle:** prompt angle (1) + (4).
**Evidence FOR (sought):** a surviving caller of a removed symbol; a half-removed conditional; a client still sending `licenseTier`.
**Evidence AGAINST (found):**
- `grep` for every removed symbol (`checkoutRateLimit`, `preIncrementCheckoutAttempt`, `rollbackCheckoutAttempt`, `CHECKOUT_*`, `licensePrices`, `license_tier`, `LicenseTier`, `LICENSE_TIERS`, `license_price`, `stripe`, `entitlement`, `downloadToken`) → **ZERO non-test hits.** The only test hits are intentional regression-guards: `free-download-contract.test.ts:49-50` (asserting the strings are ABSENT) and `migrate-reconcile-coverage.test.ts` (the drop tripwire). [verified: grep over `apps/web/src/`]
- `photo-viewer.tsx` free-download footer guard correctly simplified from `downloadHref && (!image.license_tier || image.license_tier === 'none')` to `downloadHref &&` — the correct unconditional behavior. The Buy button, `isCheckingOut` state, `checkoutToastFiredRef` effect, and `checkoutStatus` prop are all fully removed. [git diff `311a0815..47b1e21f` `photo-viewer.tsx`]
- `bulk-edit-dialog.tsx` removed `licenseTier` from the `BulkUpdateImagesInput` object literal entirely — no orphaned `licenseValue` send. `bulkUpdateImages` destructure, tri-state validation, enum validation, `setClause`, and audit-metadata all drop `licenseTier` consistently. [git diff `images.ts`, `bulk-edit-dialog.tsx`]
- All three PhotoViewer callers (`p/[id]`, `g/[key]`, `s/[key]`) removed `licensePrices`/`checkoutStatus` props symmetrically. [git diff]
**Verdict: REFUTED.** Removal is complete and behavior-preserving on the surviving free path.

### H2 — Removing `searchParams` from `p/[id]/page.tsx` changed the page's rendering mode or broke a legitimate non-checkout query consumer
**Angle:** prompt angle (4).
**Evidence AGAINST:** `p/[id]/page.tsx:38` already declares `export const revalidate = 0` (force-dynamic) independent of `searchParams`. Removing the unused `searchParams` prop changes no rendering behavior — the page was already dynamic. No other query param is consumed on that page (the only reader was the deleted `?checkout=` parse). [Read `p/[id]/page.tsx`; grep `revalidate|dynamic|searchParams`]
**Verdict: REFUTED.**

### H3 — The GPS-strip-on-original is now dead/unreachable work, making `strip_gps_on_upload`'s on-disk effect a no-op that misleads the admin
**Angle:** prompt angle (1) + (3) — the cycle-1 comment update claims "the retained original doesn't leak protected locations," but is the on-disk strip still genuinely needed once the public streamer is gone?
**Evidence AGAINST:** the on-disk original is STILL read by legitimate internal consumers — `process-image.ts` (decode for derivatives), `embeddings.ts` (CLIP source), the authenticated admin DB-download is unrelated, and the `strip_gps_on_upload` toggle's documented contract is **at-rest** stripping (privacy of the file on disk), which is satisfied regardless of HTTP reachability. The strip is correct, reachable, and the refreshed comment at `images.ts:314` / `lr/upload:313-321` is accurate. [grep all `UPLOAD_DIR_ORIGINAL` readers; Read `images.ts:309-316`]
**Verdict: REFUTED.** The strip is live and the rationale is sound.

### H4 — A surviving HTTP route streams `data/uploads/original/` (would RE-OPEN RES-R7C6-01 at HIGH/CRITICAL)
**Angle:** prompt angle (1) + (4) — the cycle-1 CLOSE of RES-R7C6-01 hinges on "no public streamer remains."
**Evidence AGAINST:** every runtime reader of the original is internal server-side (decode/CLIP/delete/move) — NONE returns the bytes in an HTTP response. The `@/lib/storage` abstraction (the only other thing that touches `original/`) has **ZERO non-self consumers** — it is a fully dead module (already documented "Not Yet Integrated" in CLAUDE.md). The re-open exit criterion (a new route streaming the original) is NOT met. [grep `from '@/lib/storage'` / `getStorage` → 0 hits; grep all `UPLOAD_DIR_ORIGINAL` consumers]
**Verdict: REFUTED — RES-R7C6-01 stays CLOSED.**

### H5 — The migration 0023 reconcile drops are a data-loss/behavioral bug hiding behind a tripwire test that only checks the strings exist
**Angle:** prompt angle (2) — validate from code, not the test's own assertions.
**Evidence AGAINST:** read the actual drop helpers — `dropTableIfPresent` uses `DROP TABLE IF EXISTS` (idempotent); `dropColumnIfPresent` checks `columnInfo` (INFORMATION_SCHEMA) before `ALTER TABLE DROP COLUMN` (idempotent, no error if gone). Both run LAST in `reconcileLegacySchema` (after all CREATE/ALTER) so reconcile converges to current schema. The `entitlements` FK to `images(id)` is dropped implicitly by `DROP TABLE` (comment accurate). No collateral table/column is targeted. [Read `migrate.js:215-228, 621-628`]
**Verdict: REFUTED.** Drops are correctly guarded; no data loss; behavior matches the tripwire's claim.

### H6 — The free-download-contract test passes vacuously (a real behavioral remnant the substring test can't see)
**Angle:** prompt angle (2).
**Evidence AGAINST:** the test asserts `src.includes('checkout')===false` for BOTH `photo-viewer.tsx` and `info-bottom-sheet.tsx`, plus 4 positive contracts (`buildDownloadFilename` import+call, `filename_jpeg`→`/uploads/jpeg/`, `filename_avif`→`/uploads/avif/` for the gamut-aware AVIF branch). I independently confirmed via git diff that the photo-viewer checkout code is fully gone, and ran the test (97 tests across the 4 touched files, all green; full suite 2036 green). The contract is non-vacuous — it would turn RED on a re-introduced license gate or an aliased AVIF href. [Read `free-download-contract.test.ts`; ran vitest]
**Verdict: REFUTED.** Test is sound and the behavior it pins is real.

### H7 — Doc-code contract drift that is BEHAVIORAL, not cosmetic
**Angle:** prompt angle (3).
**Evidence FOR (found, but cosmetic):** the cycle-1 cleanup commit `1d1cc118` (FIND-R8C1-02) refreshed only 4 lines of `process-image.ts` (the `stripGpsFromOriginal` docblock header). It MISSED two surviving references to the deleted route's risk model:
- `process-image.ts:1570-1571` — `"...the public gallery does not leak GPS; only the download-original path remains at risk in that case."`
- `process-image.ts:1646-1647` — `"...Only the download-original path leaks, and failing the upload entirely would be worse."`
Both reference the deleted `/api/download/[imageId]` paid-download route as the residual leak surface. With that route gone, the "download-original path" no longer exists as an HTTP leak vector.
**Why this is NOT a new finding (the honest call):**
1. It is the SAME finding class as FIND-R8C1-02 ("stale paid-download threat-model rationale in comments"), which cycle-1 already ADJUDICATED and scheduled. The fix was simply incomplete (header refreshed, two body lines missed).
2. It is pure comment text — changes NO behavior, NO control flow, NO output. The strip logic and its best-effort error handling are correct and unchanged.
3. It does not mislead in any actionable way: the at-rest strip is still required and still runs; the only inaccuracy is naming a now-deleted route as the residual-risk surface.
4. Filing it as a fresh CONFIRMED finding would inflate the count for a comment typo on an already-dispositioned item — exactly the manufactured-thoroughness failure mode the critic exists to avoid.
**Verdict: COSMETIC RESIDUAL of FIND-R8C1-02 — recorded as INFO, NOT counted as new.** If the planner runs any further cleanup pass, it may fold these two lines in (replace "the download-original path" → "the admin-downloadable original / at-rest original"); otherwise it is harmless to leave. No re-open criterion needed — it can only become relevant again if a route re-streams the original, which is already covered by the RES-R7C6-01 re-open trigger.

---

## DO-NOT-RE-FILE adjudicated items — re-confirmed not re-litigated
- **MED-R7C2-01** (histogram clip %) — not examined / not re-filed (REFUTED 3-way; no decisive new evidence).
- **REJ-R7C3-01** (`gps-exif-strip.ts` `indexSize`) — `gps-exif-strip.ts` untouched since the −2 comment edit; logic byte-identical; not re-filed.
- **NCLX map pin class** — `IMAGE_PIPELINE_VERSION=7` / `COLOR_IMPACTING_KEYS=9` still consistent; not re-filed.
- **process-image.ts:1108 "Only paid on the wide-gamut path"** — left untouched (English idiom; cleanup commit `1d1cc118` explicitly preserved it).
- All cycle-1 cleanup (FIND-R8C1-01..05) — confirmed LANDED (commits `7fade6df`..`4e72d0f4`).

---

## Verdict Justification

**VERDICT: ACCEPT — 0 new findings; convergence holds.**

The convergence claim survived adversarial falsification. Of 7 hypotheses spanning all four prompt angles (dead path / behavioral remnant, bug-behind-passing-test, behavioral doc drift, newly-reachable error path), six were REFUTED with concrete file:line + git-diff + grep + executed-gate evidence, and the seventh surfaced only a 2-line comment residual that is the cosmetic tail of an already-adjudicated finding — correctly NOT counted as new. The empirical backstop is decisive: every architectural gate is green at the current HEAD (which the cycle-1 aggregate did not cover, since it ran one HEAD earlier), 2036/2036 active tests pass, and the SW stamp + pipeline version are consistent.

This is genuine convergence-quality state. The mature codebase + the surgically-clean subtractive removal leave no behavioral, correctness, security, or data-loss surface for this cycle. A confident, evidence-backed "0 new" is the correct result.

## Open Questions (unscored)
- None requiring code change. The only item of any kind is the H7 comment residual, dispositioned above as a leave-or-fold optional for the planner.
