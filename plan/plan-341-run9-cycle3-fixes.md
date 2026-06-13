# Plan 341 — Run-9 Cycle-3 fixes (cycle 6/100)

**Source:** `.context/reviews/_aggregate.md` (run-9 cycle-3 fan-out, 11 agents; one recovered test-engineer write-failure — findings preserved). HEAD at planning time: `4c3d5924`.
**Commit discipline (CLAUDE.md / global CLAUDE.md):** GPG-signed (`git commit -S`), Conventional Commits + gitmoji, ONE commit per item, `git pull --rebase` then push after EACH commit, full gate run before cycle close. NO `Co-Authored-By`. No `--no-verify`, no force-push. Run `npm run typecheck --workspace=apps/web` before committing any test/source change.

**Context:** The cycle-5 batch (plan-339, AGG-C5-01..T2) landed clean — all 5 fixes RE-VERIFIED CLOSED at HEAD by all 11 agents (line-by-line + regex-in-Node + RED-on-revert, not on the plan's word). This cycle's review surfaced exactly ONE genuine source bug — a long-latent WebP RIFF field-order inversion in the lossless GPS-strip path — plus its companion test gap (the test that should have caught it is vacuous), two MORE instances of the well-known bare-link 44 px audit blind-spot, the adjacent `max-` audit-regex gap on `<Link>`/`<a>` patterns, and one doc-completeness omission. No CRITICAL/HIGH defect; no security/privacy/data-loss finding (the WebP bug is quality-only — the fallback still strips GPS). Total: 3 MED + 2 LOW + 1 doc.

**GATES this run:** eslint, typecheck, vitest, lint:api-auth, lint:action-origin, lint:public-route-rate-limit. All must be GREEN before cycle close. DEPLOY_MODE = per-cycle (`npm run deploy` once after green).

---

## Item 1 — AGG-C6-01: `stripGpsFromWebpBuffer` RIFF field-order inversion (MED · debugger · the one real source bug)

- **Source:** DBG-C6-01 (debugger, High; field-order verified vs the authoritative Google WebP RIFF-container spec, reachability traced through the dispatcher).
- **Where:** `apps/web/src/lib/gps-exif-strip.ts:564-565` and `:580`.
  ```js
  // CURRENT (WRONG — RIFF is [FourCC:4][size:4 LE][data], tag FIRST):
  const chunkSize = buf.readUInt32LE(offset);            // :564  reads the FourCC bytes as a size
  const chunkTag = buf.toString('ascii', offset + 4, offset + 8); // :565  reads the size bytes as a tag
  ...
  buf.write('JUNK', offset + 4, 4, 'ascii');             // :580  writes over the size field, not the tag
  ```
- **Why it matters:** the WebP RIFF chunk layout is `[FourCC tag: bytes 0-3][chunk size: bytes 4-7 LE][payload]`. The code has tag and size SWAPPED. On the FIRST sub-chunk of EVERY real WebP, the 4-byte FourCC (`VP8X` = 0x58385056 ≈ 1.48 GB) is misread as `chunkSize`, so `dataEnd = dataStart + chunkSize > buf.length` is immediately true and the function returns `null` (`:568`) before ever reaching the `EXIF`/`XMP ` comparisons. The lossless WebP GPS-scrub path is therefore DEAD CODE. `process-image.ts:1536-1537` dispatches `.webp` originals here when `strip_gps_on_upload=true`; the `null` return falls through to the Tier-2 lossy Sharp re-encode (`:1564-1567` — q95 for lossy VP8, lossless only if a `VP8L` substring is present), so every `.webp` original with GPS-strip enabled is needlessly lossy-recompressed (generation loss on the paid-download deliverable) and logs `lossless WebP scrub failed; re-encoding at q95` on every WebP upload. This directly violates the module's stated contract (header comment: "the pixel stream is NEVER decoded, so the original stays bit-identical except for the neutralized GPS regions"). The line-580 XMP-retag write also targets the wrong field, but is unreachable due to the same bug.
- **Privacy/security:** NONE — the fallback re-encode still strips GPS (security-reviewer explicitly assessed AGG-C6-01 out of scope; it is a quality/correctness defect, not a data-loss/privacy leak). This is why it is scheduled here (small fix, broken contract) rather than treated as a non-deferrable security finding.
- **Change:**
  1. Swap the two reads so the FourCC is read first and the size second:
     ```js
     const chunkTag = buf.toString('ascii', offset, offset + 4);
     const chunkSize = buf.readUInt32LE(offset + 4);
     ```
  2. Fix the XMP-retag write to target the tag field: `buf.write('JUNK', offset, 4, 'ascii');` (the `buf.fill(0, dataStart, dataEnd)` payload zero is already correct).
  3. Re-read the surrounding bounds math (`dataStart = offset + 8`, `dataEnd = dataStart + chunkSize`, `paddedSize = chunkSize + (chunkSize % 2)`, the `next <= offset` anti-stall guard at `:587`) to confirm it is all consistent once tag/size are correct — these were already written for the correct layout; only the two reads + the one write were inverted.
- **Acceptance:** with a real WebP-with-GPS input, `stripGpsFromWebpBuffer(input)` returns `{ stripped: true }` and the output's VP8/VP8L pixel chunk bytes are byte-identical to the input (lossless) while the EXIF/XMP chunk is neutralized; a GPS-free WebP returns `{ stripped: false }` with the input reference; non-WebP bytes still return `null`. The new test (Item 2) proves this RED before / GREEN after. `npm test --workspace=apps/web` green; `npm run typecheck --workspace=apps/web` green. **Land WITH Item 2 in the same commit** (the bug fix and its proven-RED test land together, per the repo's established practice).
- **Status:** DONE (commit pending push). Field order swapped at `gps-exif-strip.ts:566-567` (tag@offset, size@offset+4); JUNK write fixed to `offset` (the tag field). End-to-end verified: lossless WebP scrub now returns `{stripped:true}`, VP8 pixel chunk byte-identical, GPS entries→0.

## Item 2 — AGG-C6-02: the WebP GPS-strip test is vacuous (MED test depth · test-engineer + debugger · same root as Item 1)

- **Source:** TE-C6-1 (test-engineer, High) + DBG-C6-01b (debugger, High — independent, same root). The two-agent agreement makes this high-signal.
- **Where:** `apps/web/src/__tests__/strip-gps-from-original.test.ts:116-126` — `it('removes GPS from a WebP original via the RIFF scrub (pixels byte-identical)')`. Also note the `describe('gps-exif-strip pure scrubbers')` block at `:175` tests `stripGpsFromJpegBuffer` directly but has NO `stripGpsFromWebpBuffer` entry.
- **Why it matters:** the existing WebP test (a) calls the top-level dispatcher `stripGpsFromOriginal`, never `stripGpsFromWebpBuffer` directly; (b) builds a lossy fixture (`pipeline.webp({ quality: 95 })`); (c) asserts equality of DECODED raw pixels (`sharp(file).raw().toBuffer()`), NOT file bytes. A q95→q95 WebP re-encode of an already-q95 decode yields the identical decode, so the assertion passes through the Tier-2 fallback whether or not the lossless path ran — which is EXACTLY why the Item-1 bug shipped green. The test name asserts a path it does not exercise.
- **Change:** add a direct pure-scrubber test to the `'gps-exif-strip pure scrubbers'` block (import `stripGpsFromWebpBuffer` — confirm it is exported, it is at `:554`):
  1. Build a real WebP carrying GPS EXIF (Sharp `.webp().withExif({ IFD0/GPS… })`, or hand-assemble a minimal `RIFF…WEBP` + `VP8 ` pixel chunk + an `EXIF` chunk with a GPS-bearing TIFF block — mirror how the JPEG pure-scrubber fixtures are built at `:189-207`).
  2. Assert `stripGpsFromWebpBuffer(input)` returns non-null, `result.stripped === true`, and the VP8/VP8L pixel-chunk bytes are byte-identical between input and output (lossless contract — slice the pixel chunk by walking the corrected chunk layout, or assert the whole file is identical outside the EXIF/XMP chunk byte range).
  3. Assert a GPS-FREE WebP returns `{ stripped: false }` with the input reference (mirror the JPEG `stripped=false` test at `:176-183`).
  4. Assert non-WebP bytes return `null` (mirror `:185-189`).
- **Acceptance:** the new test goes RED against the CURRENT (buggy) `gps-exif-strip.ts` and GREEN after Item 1's field-order fix — capture this RED-before/GREEN-after in the commit body (the repo's established proof practice). `npm test --workspace=apps/web` green; `npm run typecheck --workspace=apps/web` green. Land in the SAME commit as Item 1.
- **Status:** DONE (commit pending push). 3 direct `stripGpsFromWebpBuffer` pure-scrubber tests added to `strip-gps-from-original.test.ts` (lossless byte-identity + EXIF-neutralized, GPS-free stripped:false+input-ref, non-WebP null). PROVEN RED: reverting the field-order fix flips the 2 lossless-contract tests RED (2 failed | 22 passed), restored GREEN (24/24). Sharp WebP fixture confirmed to carry a real RIFF EXIF chunk (VP8X/VP8 /EXIF).

## Item 3 — AGG-C6-03: two more public back-nav `<Link>`s render ~20 px (MED a11y · designer · adjacent gap of AGG-C5-03)

- **Source:** DES-C6-1 (designer, High; className verbatim + line-box math + audit-gap confirmed).
- **Where (both PUBLIC surfaces):**
  - (a) `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:105` — `className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"` (~20 px line-box, no height token; the SOLE escape from the shared single-photo view).
  - (b) `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:109` — `className="text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1"` (~20 px; the return path from a public year-timeline page).
- **Why it matters:** each renders at its line-box height (no `h-*`/`min-h-*`/`py-*` token), below the repo's documented 44 px floor (WCAG 2.5.5 Target Size Enhanced, AAA) and the 24 px floor (WCAG 2.5.8 Target Size Minimum, AA). Both are PUBLIC back-nav actions on touch-first routes — fat-finger miss risk, exactly what the 44 px gate exists to prevent. They ship green only because they sit in the touch-target audit's DELIBERATE bare-link gap (the `<Link>`/`<a>` patterns at `:440-466` fire only on an EXPLICIT sub-44 sizing token; `KNOWN_VIOLATIONS` correctly lists neither). Same shape as the three AGG-C5-03 fixed last cycle — the recurring "fix one sibling, miss the next."
- **Change:** add `min-h-11` to both classNames so each presents a >=44 px tap target while keeping the existing flex layout + underline/hover affordance:
  - (a) `s/[key]/page.tsx:105` → add `min-h-11` to the existing classes (e.g. `"... transition-colors flex items-center gap-1 min-h-11"`). The parent is `flex items-center justify-between mb-4 px-4 pt-4` — an `min-h-11` child sits cleanly.
  - (b) `year/[year]/page.tsx:109` → add `min-h-11` to the existing classes (it already has `inline-flex items-center`).
  - Optional (pragmatic middle path, mirrors plan-340 Deferred-1's resolution for the cycle-5 links): extend the positive-assertion `it` block in `touch-target-audit.test.ts` to also pin these two links keep `min-h-11`, so a future drop is caught. The full layout-aware bare-link heuristic stays DEFERRED in plan-342.
- **Acceptance:** both links present a >=44 px tap target (`min-h-11`); no visual regression (flex layout + underline/hover preserved); no hardcoded English (strings still via `t()`). Because the audit cannot SEE bare links, verification is reading the rendered classes + the optional positive pin. lint + typecheck + full gate run green.
- **Status:** DONE (commit pending push). Added `min-h-11` to both back-nav `<Link>`s (`s/[key]/page.tsx:105`, `year/[year]/page.tsx:109`) keeping the existing flex/underline. Took the pragmatic positive-pin: new `it('public back-nav <Link>s keep their min-h-11 tap area (AGG-C6-03)')` block in `touch-target-audit.test.ts`, scoped per-link by anchor key (`viewGallery`/`backToTimeline`). PROVEN non-vacuous: dropping `min-h-11` from one link flips it RED, restored GREEN (14/14). typecheck clean.

## Item 4 — AGG-C6-04: `<Link>`/`<a>` touch-target patterns missed the `max-` lookbehind (LOW · critic · adjacent gap of AGG-C5-02)

- **Source:** NF-1 (critic, High; ORCHESTRATOR-VERIFIED empirically in Node — `<Link className="max-h-10">` and `<a className="max-h-9">` both falsely flag).
- **Where:** `apps/web/src/__tests__/touch-target-audit.test.ts:440,444,458,462` — the four `<Link>`/`<a>` bare-`(?:h-8|h-9|h-10)` FORBIDDEN patterns. Each has the `(?![^>]*\b(?:h-1[12]|min-h-1[12]|size-1[12])\b)` negative lookahead but lacks the `\b(?<!max-)(?:h-8|h-9|h-10)\b` lookbehind that commit `40a65aef` (Button/button) and `07a838d6` (select) added.
- **Why it matters:** `max-h` is a CEILING and never constrains the tap target, so `<Link className="max-h-10">` flagging "renders below the 44 px floor" is FALSE. It is the very bug class `40a65aef`/`07a838d6` closed, re-introduced one tag-name over — the textbook "fix one sibling, miss the next" theme (Button → select → now a/Link). A complete audit confirms these four are the ONLY remaining bare-h/w patterns missing the lookbehind. Latent (no current Link/a uses `max-h-{8,9,10}`) but it is a BLOCKING gate that would mis-fire with a lying message the moment a legitimate one lands, training a dev to silence it with a bogus `min-h-11`. The does-not-flag self-check block also lacks `<Link>`/`<a>` `max-` negative fixtures.
- **Change:**
  1. Add `(?<!max-)` to the bare-`(?:h-8|h-9|h-10)` portion of all four patterns at `:440,444,458,462`, mirroring EXACTLY how `40a65aef`/`07a838d6` anchored the Button/button/select patterns. Re-read those patterns at HEAD to copy the precise lookbehind form. Confirm the `min-h-[<44px]` patterns (true floors) and the negative lookahead are unaffected.
  2. Add `<Link className="max-h-10">`, `<a className="max-h-9">`, and a `cn()` composite form to the does-not-flag self-check block (mirror the select negative fixtures added by `07a838d6`).
- **Acceptance:** the four `<Link>`/`<a>` patterns no longer match `max-h-{8,9,10}`/`max-w-…` but still match real sub-44 tokens (`h-8`, `min-h-[40px]`); the new self-check fixtures pass; the full `touch-target-audit.test.ts` still passes (no current file regresses — verify with `npx vitest run touch-target-audit`). Run `npm run typecheck --workspace=apps/web` before committing.
- **Status:** PENDING

## Item 5 — AGG-C6-05: document the `<select>`/`<Link>`/`<a>` `max-` lookbehind in CLAUDE.md (LOW doc · document-specialist)

- **Source:** doc-specialist FINDING 1 (LOW; doc completeness, not a code defect).
- **Where:** `CLAUDE.md:512` (the Touch-Target Audit section's native-`<select>` pattern description).
- **Why it matters:** CLAUDE.md:512 describes the `<select>` patterns as catching `h-8/h-9/h-10` but omits that the branch carries `(?<!max-)` (added cycle-5 by `07a838d6`, same as the Button fix the doc DOES describe). A maintainer reading CLAUDE.md would wrongly believe `<select className="max-h-10">` flags. Docs are incomplete, not wrong about live behavior — no code defect.
- **Change:** update the Touch-Target Audit prose to note that the bare-`h-8/h-9/h-10` branch carries `(?<!max-)` across ALL tag classes — `<Button>`/`<button>` (40a65aef), native `<select>` (07a838d6), AND `<Link>`/`<a>` (this cycle's Item 4) — so `max-h-*` ceilings never false-positive. One concise sentence; fold into the Item-4 commit so the doc and the code change land together.
- **Acceptance:** CLAUDE.md accurately describes the current lookbehind coverage across all interactive tag classes. No code change. (Direct-write to CLAUDE.md is allowed per CLAUDE-omc model_routing.)
- **Status:** PENDING

## Item 6 (OPTIONAL) — AGG-C6-T1: direct `stripGpsFromIsobmffBuffer` pure-scrubber test (LOW test depth · test-engineer)

- **Source:** TE-C6-2 (test-engineer, Medium/likely).
- **Where:** `apps/web/src/__tests__/strip-gps-from-original.test.ts:104-114` (AVIF) shares the WebP test's dispatcher-level shape, but is LESS vacuous (the AVIF Tier-2 fallback re-encodes at q90 = lossy, so a silent ISOBMFF-lossless break is more likely to perturb the decoded-pixel assertion than WebP's). Still weaker than a direct pure-scrubber test.
- **Change:** when implementing Item 2, OPTIONALLY add a parallel direct `stripGpsFromIsobmffBuffer(input)` pure-scrubber test (assert non-null + `stripped:true` + file-byte identity outside the EXIF/XMP item, plus a GPS-free `stripped:false` case), for symmetry with the new WebP and existing JPEG pure-scrubber tests.
- **Disposition:** SCHEDULE-cheap if bundled with Item 2; otherwise DEFER to plan-342 (AVIF path not currently known-broken; the decoded-pixel proxy has more teeth than WebP's). Implementer's choice based on remaining cycle budget.
- **Status:** PENDING (optional)

---

## Gate close-out (all items)

After the above commits:
1. `npm run lint --workspace=apps/web` → exit 0
2. `npm run typecheck --workspace=apps/web` → exit 0 (app + scripts)
3. `npm test --workspace=apps/web` → all green (the new WebP test proven RED-before-fix)
4. `npm run lint:api-auth` / `lint:action-origin` / `lint:public-route-rate-limit` → all exit 0
5. Then `npm run deploy` once (DEPLOY_MODE=per-cycle).

## Progress log

- 2026-06-13 — Plan created from `_aggregate.md` cycle-6 (run-9 cycle-3). HEAD `4c3d5924`. 6 items (3 MED + 2 LOW + 1 optional LOW). Items 1+2 land together (bug + proven-RED test).
