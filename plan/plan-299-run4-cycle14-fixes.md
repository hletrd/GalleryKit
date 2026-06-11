# Plan 299 — Run-4 Cycle 14 fixes

**Source review:** `.context/reviews/run4-cycle14/_aggregate.md`
**Status:** IMPLEMENTED — all three tasks landed (see Progress log)

Gates for this cycle (all must be green before each push): eslint,
typecheck, vitest, api-auth lint, action-origin lint,
public-route-rate-limit lint, production build, playwright e2e.
Per-cycle deploy (`npm run deploy`) after all work lands.

## Task 1 — COR-R4C14-01: gate wide-gamut UI decisions through `isWideGamutPrimary` (MED/High, 6/6 cross-angle)

**Files:**
- `apps/web/src/components/color-details-section.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/lightbox-color-pip.tsx`
- new `apps/web/src/__tests__/wide-gamut-predicate-wiring.test.ts`

**Changes:**
1. `color-details-section.tsx`: import `isWideGamutPrimary` from
   `@/lib/color-primaries`;
   - `:170` isNonTrivialColor primaries-arm →
     `isWideGamutPrimary(image.color_primaries)`;
   - `:221` `const isWideGamut = isWideGamutPrimary(image.color_primaries)`
     (label gate — kills the raw "Color: unknown" headline);
   - `:454` delivered-row derivation →
     `isWideGamutPrimary(image.color_primaries) ? 'p3-from-displayp3' : 'srgb'`
     (semantically identical; keeps the locked
     `isP3Pipeline(decision)` structure intact).
2. `info-bottom-sheet.tsx:184`: same primaries-arm swap inside
   isNonTrivialColor.
3. `lightbox-color-pip.tsx:207`: same delivered-row derivation swap.
4. New source-inspection fixture (repo convention, see
   `color-details-section-delivered.test.ts` header):
   - all three files import `isWideGamutPrimary` from
     `@/lib/color-primaries`;
   - `color-details-section.tsx` / `info-bottom-sheet.tsx` /
     `lightbox-color-pip.tsx` contain ZERO surviving ad-hoc
     `color_primaries !== 'bt709'` comparisons;
   - the label gate (`isWideGamut =`) and both isNonTrivialColor
     primaries-arms call the helper.
   Prove the fixture fails against pre-fix source (run it before
   applying the component edits or via git stash check).
5. Commit body cites CLAUDE.md's `isNonTrivialColor` definition as the
   authoritative contract (DOC-R4C14-01) and notes the delivered-row
   behavior is unchanged (pure predicate dedup).

**Acceptance:** unknown-primaries photo renders static
"Color details" / "색상 정보" label, default-closed for public; inner
"Color primaries: Unknown" row unchanged; existing
`color-details-section-delivered.test.ts` locks stay green; new fixture
green; full vitest green.

**Folds in:** TEST-R4C14-01, DOC-R4C14-01, ARCH-R4C14-01, DES-R4C14-A.

## Task 2 — COR-R4C14-02: make gain-map heuristic-1 `tmap`+URN branch reachable (LOW/High)

**Files:**
- `apps/web/src/lib/gain-map-detection.ts`
- `apps/web/src/__tests__/gain-map-detection.test.ts`

**Changes:**
1. `parseInfe:133`: parse `item_uri` for `tmap` items as well —
   `if ((itemType === 'urim' || itemType === 'tmap') && pos < dataEnd)`.
   This makes the R5-M3 documented intent ("flag tmap immediately when
   it carries the Apple HDR gain-map URN") actually executable
   (DOC-R4C14-02). Per ISO 21496-1 `tmap` items don't carry URI strings
   in practice, so shipping behavior is unchanged for real files.
2. Add fixture case: `tmap` infe carrying the Apple URN (no auxl iref)
   → detected via heuristic 1. Existing locks (standalone tmap without
   URN/auxl NOT detected; tmap+auxl detected) must stay green.

**Acceptance:** new case green; all existing gain-map cases green.

## Task 3 — DES-R4C14-B: tag delete dialog feedback (LOW/High)

**Files:**
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`

**Changes:**
1. `AlertDialogAction onClick`: `e.preventDefault()` (suppresses the
   Radix auto-close), guard `deleteId !== null`, `await
   handleDelete(deleteId)`, then `setDeleteId(null)` — making the
   existing `isDeleting` spinner / "Deleting…" label / `disabled`
   states reachable for the first time.
2. Guard `onOpenChange` so ESC/overlay cannot orphan the in-flight
   state: only `setDeleteId(null)` when `!isDeleting`.
3. Disable `AlertDialogCancel` while `isDeleting`.

**Acceptance:** dialog stays open with spinner during delete; closes on
completion (success or error — `handleDelete`'s finally already resets
`isDeleting`); eslint/typecheck green; touch-target audit counts for the
file unchanged (no Button size changes).

## Deferred this cycle
See `plan/plan-300-run4-cycle14-deferred.md` (RISK-R4C14-03,
OBS-R4C14-A/DOC-R4C14-03, TEST-R4C14-02, plus standing-deferral
re-audit).

## Progress log
- Task 1 DONE — `b7877c8c` fix(viewer): gate wide-gamut UI through
  isWideGamutPrimary. New fixture
  `wide-gamut-predicate-wiring.test.ts` proven failing 9/10 pre-fix;
  all existing color-surface locks green post-fix
  (color-details-section-delivered, primaries-match-icc,
  lightbox-color-pip-hdr: 52/52).
- Task 2 DONE — `beb5c64f` fix(gain-map): tmap+URN heuristic-1 branch
  reachable. New carve-out case proven failing against pre-fix parser
  (git-stash check); 12/12 gain-map cases green post-fix.
- Task 3 DONE — `82e35324` fix(admin): tag delete dialog stays open
  until the action settles; spinner/disabled states now reachable;
  ESC/overlay/Cancel inert mid-flight.
- Gates (all 8 green): eslint ✓ (exit 0), typecheck ✓ (exit 0),
  vitest ✓ 184 files / 1759 tests (baseline was 183/1748 — +1 file,
  +11 tests), api-auth lint ✓, action-origin lint ✓,
  public-route-rate-limit lint ✓, production build ✓ (exit 0; sw.js
  stamped 82e35324-p7, committed 343eb9ae), playwright e2e ✓
  (20 passed / 2 skipped, 5.5m).
- GATE_FIXES note: zero pre-existing gate errors/warnings encountered
  this cycle (clean baseline); the 9+1 pre-fix-failing tests are
  new locks landed WITH their fixes, not gate regressions.
