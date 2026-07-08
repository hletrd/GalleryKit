# Test-Engineer Review — Cycle 10b (loop-B)

Role: test-engineer specialist
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `f4faad29f1b90984e352677c66d832239787b855` (committed tree only)
Scope note: read-only review. No source or test files were edited.

Peer-dirty at review time (not evaluated, per instructions — another loop is actively
editing these): `apps/web/scripts/check-action-origin.ts`,
`apps/web/src/__tests__/check-action-origin.test.ts`,
`apps/web/src/__tests__/cycle-28-source-contracts.test.ts`. These correspond to the
in-flight WP10 mutation-barrier scanner from the loop-B cycle-9b plan; any gap in the
final scanner/test pair should be evaluated next cycle once committed.

## Baseline verification

- `npm test --workspace=apps/web -- --run`: **361 files passed, 2 skipped (363 total);
  3384 tests passed, 4 skipped.** Clean full-suite run at HEAD.
- `.only(` sweep across `src/__tests__/*.test.ts*` and `e2e/*.spec.ts`: zero matches.
- Hardcoded-date sweep (`new Date('202[0-4]`): one hit
  (`src/__tests__/photo-og-metadata.test.ts:55`), a fixed `created_at` fixture value in a
  mock row, not a `now`-relative comparison — not a flakiness risk.

## Prior-cycle reconciliation (avoiding duplicate reporting)

Read `.context/reviews/cycle-9-2026-07-08/test-engineer.md` (TEST9-01..05),
`.context/plans/cycle-9b-2026-07-08-{plan,deferred}.md`, and
`.context/reviews/run10-cycle27/test-engineer.md` before starting. Verified disposition of
every loop-B cycle-9b test-relevant work package against committed HEAD:

| Item | Status at HEAD | Verified |
|---|---|---|
| WP7 / TEST9-01 (restore drain-checklist orchestrator) | Landed (`1ebf5cf7`) | `restore-drain-checklist.ts` + `restore-drain-checklist.test.ts` drive the real `runRestoreDrainChecklist` through all 5 stop-at-first-failure branches plus a thrown-drain path; only the wiring-into-`restoreDatabase` residual stays source-pinned. Good fix, closes TEST9-01 as designed. |
| WP9 / TEST9-03 (`TopicRouteLockTimeoutError` coverage) | Landed (`95ac2358`/`6bf3f6dd`) | `topics-actions.test.ts:828+` adds a real `acquired: 0` mock case. Confirmed present at HEAD. |
| WP1 (PAT mark-on-commit) | Landed | `lr-upload-route-behavior.test.ts` has real cases for committed-mark, 404-no-mark, and the mid-request restore race (AGG9B-01). |
| WP3 (SW LRU atomic eviction) | Landed (`2e902774`) | `sw-cache.test.ts:560` real interleaved-touch test. |
| WP4 (bulk-edit tag overlap) | Landed (`4a55fc3b`) | `bulk-update-images.test.ts:304-323` real overlap + post-normalization overlap cases. |
| WP12 (XFF hop fix, ICC desc wiring, restore-maintenance owned rollback) | Landed | `rate-limit.test.ts` (12 real cases incl. R20C20 scientific-notation), `color-detection.test.ts:131-139` (SMPTE 2084 / HLG desc-branch cases), `restore-maintenance.test.ts:93-100` (allowExisting rollback case) — all real behavior tests, not source-shape. |
| WP13 (dead-code deletion, revocation-set reinstantiation guard) | Landed | Confirmed via git log; no test-gap implications (deletion + existing-pattern reuse). |
| D9b-01 (e2e infra for color/semantic/SW) | Still deferred, unchanged | Correctly not re-opened; infra gap, not a regression. |
| D9b-02 (backfill sidecar lock exit paths) | Still deferred, unchanged | Not re-opened. |
| D9b-03 (toaster reachability) | Still deferred, unchanged | Not re-opened (needs browser validation). |
| D9b-04 (TagFilter single-mount) | Still deferred, unchanged | Not re-opened (design decision, not test gap). |
| D9b-05 (`uploadImages()` GPS fail-closed behavior harness) | Still deferred, unchanged | Verified `images-action-gps-toggle-wiring.test.ts` still carries its own header comment documenting the source-contract trade-off; no new behavior test added this cycle. Correctly left deferred (LR-route half already has a real behavior test per WP8). |
| WP6 (cross-admin PAT visibility/revocation) | **Not shipped** | `apps/web/src/lib/admin-tokens.ts` and `apps/web/src/app/actions/lr-tokens.ts` have no `listAllTokens`/`revokeTokenById`; only owner-scoped `listLrTokens`/`revokeLrToken` exist. This is an unimplemented feature, not an untested one — out of test-engineer's lane (no code path exists yet to lock). Flagging for the executor/architect handoff only, not counted as a finding below. |
| WP10 (mutation-barrier scanner) | In progress (peer-dirty) | Excluded per instructions. |

Clean areas re-confirmed (spot-checked, no new gaps): `tokenHasScope`/`allowTokenScope`
scope enforcement and `expires_at` (`admin-tokens.test.ts`), CLIP inference queue bounds
(`clip-model-contract.test.ts`), `single-writer-guard.ts`, `rate-limit.ts`/
`auth-rate-limit.ts`, `migrate.js` pending-vs-drift logic. No new gaps found in any of
these this cycle.

## Findings

### C10b-TEST-01 — The entire WP11 UX/a11y batch (5 fixes, incl. one High/High regression fix) landed with zero new test coverage

- Severity: **High** (for the AGG9B-23 sub-item specifically; Medium in aggregate for the batch)
- Confidence: High
- Region:
  - `apps/web/src/components/lightbox.tsx:247-276` (`handleTouchEnd` interactive-target
    guard, AGG9B-23, High/High per the cycle-9b plan) — the fix that stops a touch on the
    Pause/Play button from being misread as swipe input and re-toggling the slideshow to the
    wrong state.
  - `apps/web/src/components/image-zoom.tsx:380-384` (`touchAction: isZoomed ? 'none' :
    'manipulation'`, AGG9B-24).
  - `apps/web/src/components/photo-viewer.tsx:611-672` and
    `apps/web/src/components/info-bottom-sheet.tsx:268-304` (`aria-pressed={isPinned}`,
    `aria-expanded`/`aria-controls` on the mobile Info trigger, AGG9B-15).
  - `apps/web/src/components/image-manager.tsx:505-513+` (optimistic per-row tag state,
    seeded/updated/reconciled/reverted-on-failure, AGG9B-27).
  - `apps/web/src/components/search.tsx:328` (Cmd/Ctrl+K toggle-close-when-focused-in-own-input
    guard, AGG9B-28).
- Evidence (verified by direct grep, not assumption):
  - `grep -rln "handleTouchEnd|closest('button'|AGG9B-23|touchEnd" src/__tests__ e2e` → **zero
    matches**. `src/__tests__/lightbox.test.ts` (the only lightbox test file that isn't
    HDR-pip/controls-contract/auto-lightbox-source) tests exactly one exported helper,
    `shouldAutoHideLightboxControls` — never `handleTouchEnd`.
  - `grep -rn "touchAction|AGG9B-24" src/__tests__` → zero matches for the image-zoom
    `touchAction` fix.
  - `src/__tests__/a11y-us-p15.test.ts` (the file most likely to own this) asserts only the
    pre-existing `aria-pressed={isSlideshowActive}` on the slideshow button — it does **not**
    assert the new `isPinned`/`showBottomSheet`/`aria-controls` attributes added by AGG9B-15.
  - No `image-manager` test file exists at all (`find src/__tests__ -iname
    "*image-manager*"` → empty); `optimistic-image-retry.test.ts` is unrelated (it covers a
    different, pre-existing `OptimisticImage` retry-base contract, C3-24).
  - `grep -rln "AGG9B-28|Cmd\+K|toggle-close" src/__tests__` → zero matches.
  - Root cause visible in the plan itself: `cycle-9b-2026-07-08-plan.md` WP11's own
    acceptance criteria (item 6) reads "Touch-target audit and i18n parity gates must stay
    green" — i.e., the work package's test bar was "don't break the two existing structural
    gates," not "lock the five new behaviors." This was a plan-level test-scope gap, not
    merely an execution slip.
- Why this is real and not padding: AGG9B-23 fixed a **documented, already-shipped-once
  regression** — the fix's own comment explains that the old unconditional touch-stop raced
  the Pause button's click handler on touch devices, so tapping Pause silently re-started the
  slideshow. That exact bug class (event-ordering race between a bubbling touch handler and a
  button's own click handler) is exactly the kind of thing that regresses silently on a
  refactor (e.g., changing `closest('button, a')` to `closest('button')` only, hoisting the
  touch listener to a different DOM level, or reordering the guard after the `setIsSlideshowActive`
  call) — and today nothing catches it. The other four are lower-severity but share the same
  "shipped with no lock" shape.
- Concrete regression that would slip through today: someone touches up `handleTouchEnd` (e.g.
  while adding a new gesture), the `closest('button, a')` early-return is dropped or narrowed,
  and touch-device users hit the exact AGG9B-23 bug again — full CI (`npm test`, lint,
  typecheck, e2e) stays green because no test references this code path at all.
- Suggested fix (matches the repo's own established, precedented pattern — this codebase does
  not use `@testing-library/react`/render-based component tests anywhere; confirmed
  `grep -rl "@testing-library/react" src/__tests__/*.test.tsx` → 0 files, and the two existing
  `.test.tsx` files call async Server Component functions directly rather than rendering
  Client Components):
  1. **AGG9B-23 / AGG9B-28** (both are pure boolean guards): extract each into an exported,
     pure predicate — e.g. `shouldIgnoreLightboxTouchEnd(target: EventTarget | null): boolean`
     next to the already-precedented `shouldAutoHideLightboxControls` in the same file/test
     (`lightbox.tsx` / `lightbox.test.ts`), and an equivalent extraction for the search
     dialog's focused-input check. Unit test both directly — cheapest, most consistent fix,
     zero new test infrastructure needed.
  2. **AGG9B-15 / AGG9B-24**: add source-contract regex assertions in
     `a11y-us-p15.test.ts` (matches its own existing style, e.g.
     `expect(src).toMatch(/aria-pressed=\{isPinned\}/)`,
     `expect(src).toMatch(/aria-expanded=\{showBottomSheet\}/)`) and one line in a touch/style
     contract test for `touchAction: isZoomed ? 'none' : 'manipulation'`. Weaker than a
     behavior test but consistent with how the rest of the repo locks JSX-attribute
     regressions cheaply, and closes the "nothing at all" gap immediately.
  3. **AGG9B-27** (highest remaining value): this one has real state-machine behavior
     (optimistic set → reconcile on prop change → revert on mutation failure), not just a
     static attribute. Recommend extracting the tag-list reducer logic (seed from
     `image.tag_names`, apply optimistic update, revert on failure) into a small pure/typed
     helper that a unit test can drive directly with a rejected promise, mirroring how
     `restore-drain-checklist.ts` and `computeBackfillExitCode` were extracted specifically
     for testability. A behavior regression here (e.g. failing to revert the optimistic tags
     on a rejected `onTagsChange`) would leave an admin looking at tags that don't match the
     server, with nothing today to catch it.

## Coverage Notes

- The loop-B cycle-9b work packages that touched safety/correctness-critical control flow
  (restore drain-checklist, GPS-strip LR half, topic lock-timeout, XFF hop selection, ICC
  HDR desc detection, restore-maintenance rollback ownership, bulk-tag overlap, SW LRU
  atomicity, PAT mark-on-commit) were **all** given genuine behavior tests this cycle — a
  marked improvement in test discipline over the source-contract-only pattern flagged
  repeatedly in cycles 1-9b. The one work package that regressed on this discipline is WP11
  (UX/a11y), likely because none of its five fixes touch a currently-unit-testable seam
  (React event handlers / JSX attributes in Client Components) and the repo has no
  render-testing harness to fall back on — see the suggested extraction pattern above.
- Zero new HIGH-value gaps found in the areas explicitly called out by the task brief
  (advisory locks, privacy field guards, rate-limit buckets, migration drift
  post-conditions, ETag/settings-hash, restore-maintenance fence, token scope enforcement)
  beyond the already-tracked and validly-deferred D9b-01/02/05 rows. This is consistent
  with a highly converged codebase after 29+ review cycles; padding these with low-value
  nice-to-haves was avoided per the task brief.

## Summary

1 new finding this cycle (C10b-TEST-01), covering 5 untested fixes from the same
work package (WP11). High confidence, High severity for the AGG9B-23 sub-item (a
previously-shipped, now-refixed touch/click race with zero regression lock), Medium
for the batch overall. All other loop-B cycle-9b work packages (WP1, WP3, WP4, WP7, WP9,
WP12, WP13) verified to have landed with genuine, executed-behavior test coverage — no
further action needed on those. All previously-deferred rows (D9b-01 through D9b-05)
remain correctly deferred and unchanged. Full suite green (361 files / 3384 tests), no
`.only`, no flaky-date patterns found.
