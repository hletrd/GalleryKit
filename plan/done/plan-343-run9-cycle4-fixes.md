# Plan 343 — Run-9 Cycle-4 fixes (orchestrator cycle 7/100)

**Source:** `.context/reviews/_aggregate.md` (cycle-7 fan-out, 11 agents; one read-only perf-reviewer Write recovered — findings preserved). HEAD at planning time: `d0920957`.
**Rule basis:** Every review finding is either scheduled HERE or recorded in `plan-344-run9-cycle4-deferred.md`. No finding silently dropped. Repo policy governs implementation: GPG-signed commits (`-S`), Conventional Commits + gitmoji, `git pull --rebase` before push, fine-grained commits, no `--no-verify`, no force-push, Node 24+/TS6. All 6 gates (lint, typecheck app+scripts, vitest, lint:api-auth, lint:action-origin, lint:public-route-rate-limit) must be green before push.

**Context:** The cycle-6 batch (plan-341, AGG-C6-01..05 + T1) landed clean — all 6 fixes RE-VERIFIED CLOSED at HEAD by 11 agents (verifier 12/12, critic RED-on-revert on both new GPS tests, tracer 9 runtime WebP probes incl. a hand-built animated layout, debugger every-edge re-trace). This cycle's review surfaced: the recurring bare-link 44 px theme's LAST untouched instance (the admin-header brand link, the admin twin of the already-fixed public nav link), a PRIVACY-CRITICAL untested branch (the WebP XMP `JUNK`-retag GPS path — symmetric to the EXIF-path bug fixed last cycle, proven correct today but unpinned), and one more rung of the touch-target-audit blind spot (Link/a/select lack the scale-token catch-all Button has). No CRITICAL/HIGH runtime defect; no live security/privacy/data-loss bug. Total scheduled: 2 MED + 2 LOW + 1 cheap-quality LOW.

---

## Item 1 — AGG-C7-01 (MED): admin-header brand `<Link>` renders ~24 px (recurring bare-link theme, admin side)

- **Severity/Confidence:** MED / High.
- **Where:** `apps/web/src/components/admin-header.tsx:16` — `<Link className="mr-6 flex items-center space-x-2 font-bold" href={…/admin/dashboard}>` wrapping `<span>{t('nav.admin')}</span>`.
- **Why it matters:** No `h-*`/`min-h-*`/`size-*`/`py-*` token; the ancestor `flex items-center` row centers (does not stretch) the link inside the 56 px (`min-h-14`) bar, so it renders at its `text-base` line-box height (~24 px). Below the repo's documented 44 px floor (WCAG 2.5.5 AAA) and fragile at the 24 px WCAG 2.5.8 AA boundary. It is the SOLE escape-to-dashboard affordance in the admin header (mobile-relevant). The public counterpart `nav-client.tsx:85` was fixed to `min-h-[44px]` in `bc7e2584`; this admin twin was never fixed. Two independent orchestrator sweeps confirm it is the ONLY remaining bare sub-44 interactive `<Link>`/`<a>`/`<button>` in the scanned surface (the two `p/[id]/page.tsx` Links are `className="hidden" aria-hidden tabIndex={-1}` decorative prefetch, correctly excluded). It is in the audit's deliberate bare-link blind spot; the file's `KNOWN_VIOLATIONS=1` is the SEPARATE Logout `<Button size="sm">` at `:22`.
- **Fix:** add `min-h-11` to the className (keep the existing `mr-6 flex items-center space-x-2 font-bold` affordance). Optionally add an anchor-scoped positive pin in `touch-target-audit.test.ts` (the pragmatic per-link mitigation taken in plan-339/341).
- **Verification:** typecheck + the touch-target audit must stay green; if a positive pin is added, prove it RED-on-revert (drop `min-h-11` → pin fails) then restore.
- **Status:** DONE (commit `b47cdbb6`). Added `min-h-11` to the admin-header brand `<Link>` className + an anchor-scoped positive pin (`it('admin-header brand <Link> keeps its min-h-11 tap area (AGG-C7-01)')`). PROVEN RED-on-revert (dropping `min-h-11` flips the pin RED, 1 failed | 14 passed); restored GREEN (15/15). typecheck clean.

## Item 2 — AGG-C7-02 (MED): WebP XMP-chunk `JUNK`-retag GPS branch has ZERO direct test coverage

- **Severity/Confidence:** MED / High.
- **Where:** prod `apps/web/src/lib/gps-exif-strip.ts:579-588` (the `else if (chunkTag === 'XMP ')` branch: `buf.write('JUNK', offset, 4)` + `buf.fill(0, dataStart, dataEnd)`); test gap in `apps/web/src/__tests__/strip-gps-from-original.test.ts` (all 9 `stripGpsFromWebpBuffer` refs hit only the EXIF chunk / null / GPS-free cases).
- **Why it matters:** The WebP XMP retag is the symmetric twin of the EXIF-path field-order bug fixed last cycle (AGG-C6-01) — the SAME `buf.write('JUNK', offset, …)` offset-arithmetic class. It is proven correct TODAY (test-engineer ran a throwaway probe: retags `XMP `→`JUNK`, zeroes payload, `stripped:true`, GPS gone) but is invisible to the suite. A wrong-offset regression in the `JUNK` write (e.g. `offset+4` instead of `offset`) would leave the GPS-bearing XMP chunk readable in the paid-download ORIGINAL while still reporting `stripped:true` — a SILENT privacy leak on the deliverable, with no test to catch it. The JPEG XMP path is well-tested; the WebP XMP path is JPEG-coverage-orphaned.
- **Fix:** add two direct `stripGpsFromWebpBuffer` tests in the `describe('gps-exif-strip pure scrubbers')` block (mirror the existing WebP EXIF test):
  1. **Positive:** hand-assemble (or Sharp-encode + inject) a WebP with a GPS-bearing `XMP ` chunk → assert `result.stripped === true`, the VP8/VP8L pixel-chunk bytes byte-identical (lossless), the retagged chunk's FourCC is now `JUNK`, and re-parsing the XMP finds no GPS token.
  2. **Negative:** a WebP with a GPS-FREE `XMP ` chunk → assert `result.stripped === false` and the chunk is left intact (input reference or byte-identical, FourCC still `XMP `).
- **Verification:** PROVE RED — perturb the `JUNK` write offset (`offset`→`offset+4`) in the source and confirm the positive test goes RED, then restore the source → GREEN. The negative test must stay GREEN throughout (no destruction of clean XMP).
- **Status:** DONE (commit `5ef545bf`). Added two direct `stripGpsFromWebpBuffer` XMP-branch tests (positive: injected `XMP ` chunk → `stripped:true`, FourCC retagged to `JUNK`, GPS token gone, VP8 pixel chunk byte-identical; negative: GPS-free `XMP ` chunk left intact, `stripped:false`). PROVEN RED: perturbing the `JUNK` write offset (`offset`→`offset+4`) flips the positive test RED (1 failed | 27 passed); negative stayed GREEN; restored → 28/28. Source unchanged (test-only — branch is correct today).
- **Non-deferrability note:** this is a TEST gap, not a live bug (the branch is correct today), so it is NOT a non-deferrable data-loss finding under repo policy. It is scheduled anyway because it guards the paid-download privacy contract and the fix is small.

## Item 3 — AGG-C7-03 (LOW): Link/a/select touch-target patterns lack the scale-token catch-all

- **Severity/Confidence:** LOW / High (empirically proven).
- **Where:** `apps/web/src/__tests__/touch-target-audit.test.ts` — `<Link>`/`<a>` FORBIDDEN patterns (`:440-472`) and `<select>` patterns (`:415-428`) enumerate only the LITERAL `h-8|h-9|h-10` + `min-h-[<44px]` arbitrary values; they have NO scale-token branch. `<Button>`/`<button>` carry a scale-token catch-all `(?<!max-)(?:min-h|min-w|size|h|w)-(?:[1-9]|10)` (added AGG-R8c3-06).
- **Why it matters:** Ran the committed Link/a literal patterns in Node against `<Link className="h-7">` (28 px), `size-8` (32 px), `min-h-6` (24 px), `<a className="h-7">`, `size-8` — **all 5 MISSED**, while the equivalent `<Button>` source against the scale-token catch-all FLAGGED all 5. So a sub-44 scale token on an anchor-based or native-select touch target is invisible to the blocking gate. Latent (no current `h-7`/`size-8` on a Link/a/select — same risk profile as AGG-C6-04, which the team scheduled). It is the recurring "fix one sibling, miss the next" theme one rung past last cycle's lookbehind fix: the prior cycle added `(?<!max-)` to Link/a but never added the scale-token catch-all that Button got two cycles earlier.
- **Fix:** add the scale-token catch-all pattern (string-literal + `cn()` composite forms) to `<Link>`, `<a>`, and `<select>` — mirror the `<Button>`/`<button>` pair exactly, including the ≥44 override lookahead (`h-1[12]`/`min-h-1[12]`/`size-1[12]` — match the per-tag lookahead each class already uses) and the `(?<!max-)` lookbehind. Add `h-7`/`size-8` does-not-flag-when-≥44-co-present AND does-flag-when-bare fixtures to the self-check block for each tag class.
- **Verification:** run the new patterns in Node (or via the test's self-check fixtures) proving `<Link className="h-7">` FLAGS, `<Link className="h-7 min-h-11">` does NOT, `<Link className="max-h-10">` does NOT. Full audit + vitest green.
- **Status:** DONE (commit `99071d76`). Added the scale-token catch-all (string + `cn()`) to `<Link>`/`<a>`/`<select>` mirroring the Button pair (Link/a use the full `h/w/min-h/min-w/size-1[12]` override lookahead since the token reaches `w`; `<select>` uses the height-only `{min-h|h}-1..10` reach + `h-1[12]`/`min-h-1[12]` lookahead), with the `(?<!max-)` ceiling lookbehind. Added SHOULD-flag fixtures (`h-7`/`size-8`/`min-h-6` per class) and does-NOT-flag fixtures (`max-h-7` scale ceilings + co-present-44 overrides). Empirically verified in Node (5/5 sub-44 tokens MISSED by the old literal patterns, FLAGGED by the new catch-all). Full audit 15/15; no false-flag on any existing real file.

## Item 4 — AGG-C7-04 (LOW, CONTINGENT on Item 3): document the scale-token catch-all tag-class list

- **Severity/Confidence:** LOW / (doc completeness, contingent).
- **Where:** `CLAUDE.md:514` — the scale-token catch-all coverage line currently reads "on `<Button>`/`<button>`".
- **Why it matters:** With Item 3 unfixed the doc is ACCURATE (the catch-all genuinely is Button-only). IF Item 3 lands, the line must list the new tag classes or it goes stale.
- **Fix:** if Item 3 lands, update `CLAUDE.md:514` to read the scale-token catch-all is on `<Button>`/`<button>`/`<Link>`/`<a>`/`<select>`. Fold into the Item 3 commit. If Item 3 is deferred, this is a NO-OP (doc stays accurate).
- **Status:** DONE (commit `5d7bd2ac` — committed separately as a `docs:` commit rather than folded into Item 3, for fine-grained history). Item 3 landed, so `CLAUDE.md:514` now lists all five tag classes (`<Button>`/`<button>`/`<Link>`/`<a>`/`<select>`), notes the `<select>` height-only reach, the `w-1[12]`/`min-w-1[12]` override addition, the `(?<!max-)` lookbehind, and the run-9 c4 lineage.

## Item 5 — AGG-C7-05 (LOW): unanchored `VP8L` substring scan in the GPS re-encode fallback

- **Severity/Confidence:** LOW / High (2-agent: code-reviewer CR7-LOW-1 + debugger). Pre-existing, NOT introduced this cycle.
- **Where:** `apps/web/src/lib/process-image.ts:1566` — when `stripGpsFromWebpBuffer` returns `null` (malformed/unhandled WebP), the Tier-2 fallback re-encode chooses lossless vs lossy by `input.includes(Buffer.from('VP8L'))` (whole-buffer scan).
- **Why it matters:** A lossy VP8 file whose metadata/payload coincidentally contains the bytes `VP8L` would re-encode LOSSLESS, bloating the stored original. Privacy-SAFE (GPS still stripped by the re-encode either way) — worst case is an oversized file on a rare fallback path.
- **Fix:** check the chunk FourCC at the file's first sub-chunk (offset 12 of a valid RIFF/WEBP: `VP8 ` lossy / `VP8L` lossless / `VP8X` extended → then inspect the first real frame chunk) instead of scanning the whole buffer. Keep it defensive: if the offset-12 FourCC isn't a recognized VP8 variant, default to the current lossy q95 path (the safe choice).
- **Verification:** typecheck + vitest green; if practical, a unit fixture asserting a lossy VP8 with a planted `VP8L` substring no longer re-encodes lossless.
- **Status:** DONE (commit `85bca582`). Added `isLosslessWebpByChunk()` (walks the RIFF sub-chunks — `[FourCC][LE size]`, even-padded, overflow-guarded — returns true only on a genuine `VP8L` pixel chunk, false on `VP8 `, defaults FALSE on malformation), replaced the whole-buffer `input.includes('VP8L')` scan at the call site, and exported the helper as a test seam. New `process-image-webp-lossless-detect.test.ts` (lossy / lossless / planted-`VP8L`-substring regression / malformed-no-loop). PROVEN RED: injecting the old substring scan into the helper flips the planted-substring test RED (1 failed | 3 passed); restored → 4/4. typecheck clean. (Not deferred — the fix was quick and low-risk.)

---

## Out of scope this cycle (recorded in plan-344-run9-cycle4-deferred.md)

- Durable bare-link audit rule (flag bare interactive `<Link>`/`<a>` with no sizing token) — high false-positive risk; per-link positive-pin remains the mitigation. Recurrence is DECREASING (c5=3, c6=2, c7=1) and Item 1 appears to be the last instance.
- AGG-C7-R1 (WI-09 color-pipeline writer consolidation, MED maintainability), R2/R3/R4 (arch), R5 (perf record-only incl. PERF-C7-OBS-1), R6 (designer DES-C5-2/3/4 trio), R7 (SW lost-update + real-encode test isolation + gain-map dead-code), R8 (dev/build-only CVEs SEC-C7-01/02), DOC-C7-01 (AGENTS.md `.context/plans/` imprecision).

## Progress log

- 2026-06-13 — Plan created from `_aggregate.md` cycle-7 (run-9 cycle-4). HEAD `d0920957`. 5 items scheduled (2 MED + 3 LOW, one contingent doc, one possibly-deferrable cheap fix). No CRITICAL/HIGH/live-security finding. Cycle-6 plan-341 confirmed complete at HEAD.
- 2026-06-13 — **ALL 5 ITEMS DONE** (the cycle was interrupted mid-Item-3 by a session/usage limit; resumed and completed after reset). Commits (each GPG-signed, Conventional + gitmoji, pushed individually):
  - Item 1 (AGG-C7-01, admin-header brand link 44px + pin): `b47cdbb6`
  - Item 2 (AGG-C7-02, WebP XMP JUNK-retag GPS test): `5ef545bf`
  - Item 3 (AGG-C7-03, Link/a/select scale-token catch-all): `99071d76`
  - Item 4 (AGG-C7-04, CLAUDE.md scale-token doc): `5d7bd2ac`
  - Item 5 (AGG-C7-05, WebP lossless-by-chunk detection): `85bca582`
  - Item 5 was NOT deferred — the fix was quick and low-risk. All 6 gates green; deployed per-cycle. No finding from the cycle-7 review remains unaddressed (the rest are recorded in plan-344-run9-cycle4-deferred.md).
