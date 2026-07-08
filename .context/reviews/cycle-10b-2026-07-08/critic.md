# Cycle 10b Critic Review

Date: 2026-07-08
Reviewed HEAD: `36a79146a7519a267af0c5dbcaf3d9909e727289` ("fix(cycle29): harden server action scanning")
Role: skeptical critic, loop-B. Concurrent peer loop (run-10) is active in the same worktree,
currently just past its own Cycle 29 (commits through `36a79146`).

## Dedup scope note

Confirmed via `git log` + prior review artifacts and NOT re-reported here:
- CRIT9-01 (PAT `last_used_at` marked before restore-maintenance re-checks) — verified FIXED at
  current HEAD: `markAdminAuthTokenUsed` now runs at `apps/web/src/app/api/admin/lr/upload/route.ts:548`,
  strictly after both `isRestoreMaintenanceActive()` checks (lines 94, 259) and inside the
  post-commit try block.
- CRIT9-02 (CLIP embedding backfill early-termination heuristic) — verified FIXED in both
  `apps/web/src/app/actions/embeddings.ts:168` and `apps/web/scripts/backfill-clip-embeddings.ts:189`:
  both now always fetch a full `BACKFILL_BATCH_SIZE`/`BATCH_SIZE` page and gate embedding attempts
  in-loop against `SEMANTIC_SCAN_LIMIT`, instead of clamping the SQL `.limit()` by remaining budget.
- C29-TE-01 / C29-TE-02 (peer's cycle 29: `lint:action-origin` couldn't see inline
  function-level `'use server'` actions; the unscanned-module detector was locked only by
  source-string tests) — addressed by the peer's own just-landed commit `36a79146`
  ("fix(cycle29): harden server action scanning"), which is outside this review's scope per the
  shared-worktree instructions (that file territory, `check-action-origin.ts` /
  `check-action-origin.test.ts` / `cycle-28-source-contracts.test.ts`, was the peer's active
  dirty-file set for most of this session).
- `run10-cycle29/architect-perf-reviewer.md` and `run10-cycle29/test-engineer-verifier.md`:
  reviewed for overlap; no conflicts with the finding below (neither inventories
  `grid-picture-fallback-boundary.*`).

## Confirmed Issues

### CRIT10b-01 — The only regression test for the grid-image error-recovery feature is 100% source-string matching, not behavioral, and the codebase has an established pattern for exactly this problem that this feature does not follow

- Severity: Major
- Confidence: High
- Citations:
  - `apps/web/src/components/grid-picture-fallback-boundary.tsx:10-32` (the entire runtime logic:
    a single delegated `onErrorCapture` handler that walks up to `picture[data-grid-picture]`,
    removes all `<source>` children, and swaps `img.src` to `data-fallback-src`)
  - `apps/web/src/components/grid-picture.tsx:19-35` (`fallbackSrc` prop, `data-fallback-src={fallbackSrc ?? src}`)
  - `apps/web/src/components/masonry-card.tsx:94-121` (consumer: `sizedImageUrl(...)` as the
    primary `src`, base JPEG as `fallbackSrc` — this is the safety net for the documented CRT-D1
    scenario where an admin changes `image_sizes`/quality settings and existing photos are not yet
    backfilled, so a currently-configured thumbnail size may not exist on disk for an older photo)
  - `apps/web/src/__tests__/grid-picture-fallback-boundary.test.ts:1-50` — every one of the four
    `it(...)` blocks does `readFileSync(...)` on the component source and then
    `expect(source).toContain(...)` / `.toMatch(...)`. There is no `render()`, no `fireEvent`/
    `dispatchEvent`, and no assertion that, given a real `<picture data-grid-picture
    data-fallback-src="X">` containing an `<img>` whose load fails, the handler actually mutates
    `img.src` to `X`, removes the `<source>` children, or is idempotent against a second error.
  - Confirmed no other test file exercises this behaviorally either:
    `apps/web/src/__tests__/masonry-card-memo.test.ts:100` only string-slices the component source
    between two literal substrings; `apps/web/src/__tests__/cycle-7-source-contracts.test.ts:100-105`
    is the same `readFileSync` + `.toContain` pattern. No Playwright spec under `apps/web/e2e/`
    references `picture`, `fallback`, `data-grid-picture`, or `fallbackApplied` (checked: none of
    the 10 files in `apps/web/e2e/` match).
  - The codebase has an established, working, zero-new-dependency pattern for testing exactly this
    class of logic (DOM event-handler behavior, without jsdom) — extract the DOM-touching logic
    into a plain function and drive it with hand-rolled fake DOM stand-ins, as documented and
    implemented in `apps/web/src/__tests__/editable-target.test.ts:1-22` (testing
    `apps/web/src/lib/editable-target.ts`) and referenced again in
    `apps/web/src/__tests__/use-restore-focus-after-pending.test.ts` and
    `apps/web/src/__tests__/cycle-r10c1-a11y-contracts.test.ts`. Verified there is genuinely no
    jsdom/happy-dom/`@testing-library/react` available (`apps/web/package.json` has no such
    dependency, confirmed by grep, matching the explicit comments in those three test files), so
    this is not a "just add `render()`" fix — but `grid-picture-fallback-boundary.tsx` does not
    follow the established local workaround either: its DOM-mutation logic is inlined directly in
    the JSX `onErrorCapture` prop instead of being extracted into a plain, unit-testable function
    the way `isEditableTarget` was.
- Why this matters: this component is the *entire* safety net preventing a broken-image icon from
  appearing across every public masonry-grid surface in the product (home page, shared groups
  `g/[key]`, `timeline`, `year/[year]`) whenever a photo's currently-selected thumbnail derivative
  doesn't exist on disk — a real, already-documented, non-hypothetical scenario (CLAUDE.md's own
  "CRT-D1" operational gotcha: an admin changes `image_sizes`/quality settings and existing
  derivatives are not rewritten until a backfill re-encode runs). The current test suite would stay
  green through a refactor that broke the actual runtime behavior — e.g., reordering the
  `dataset.fallbackApplied` guard relative to the `src` swap (reintroducing an error-loop risk),
  changing the `.closest()` selector, or only removing `source` elements without also swapping
  `src` — as long as the literal strings the tests search for remain present anywhere in the file,
  including in a comment.
- Concrete failure scenario: a future cycle refactors `GridPictureFallbackBoundary` (e.g., to
  extract the handler for reuse, or to add a new source type) and, in doing so, reorders the guard
  check after the `src` assignment, or forgets to clear `dataset.fallbackApplied` semantics
  correctly. `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all stay green
  (this is exactly the gate set the recent Cycle 28/29 commits ran), because none of them exercise
  the actual event-handling behavior. The regression ships; legacy photos whose configured
  thumbnail size isn't on disk now render broken-image icons across the whole public gallery grid
  instead of recovering to the base JPEG, and it is caught only by a human noticing broken
  thumbnails in the deployed gallery, not by any automated gate.
- Suggested fix: extract the handler body into a plain, exported function, e.g.
  `applyGridPictureFallback(img: HTMLImageElement): void` in a new `lib/grid-picture-fallback.ts`
  (mirroring `lib/editable-target.ts`), with `GridPictureFallbackBoundary`'s `onErrorCapture`
  reduced to `applyGridPictureFallback(event.target as HTMLImageElement)` guarded by an
  `instanceof` check. Then add a behavioral test using the same hand-rolled fake-DOM-element
  pattern as `editable-target.test.ts` (a `FakeImageElement`/`FakePictureElement` with `dataset`,
  `closest()`, and `querySelectorAll('source')`) that proves: (1) on first error, `source` children
  are removed and `src` is set to the fallback; (2) a second error after `fallbackApplied` is set
  is a no-op (proving the loop-guard actually works); (3) an `<img>` with no ancestor
  `picture[data-grid-picture]` or no `data-fallback-src` is left untouched. Keep the existing
  source-contract tests as a secondary check if desired (they are harmless as a *belt* — the
  problem is having them as the *only* net).

## Risks Needing Manual Validation (not confirmed defects)

- The `<picture>` element's browser-native source-selection algorithm chooses a `<source>` based on
  `type`/`media` support *before* attempting the fetch; it does not retry a sibling `<source>` on a
  404/load failure. This means the "recovery" path for AVIF/WebP 404s depends entirely on the
  `<img>` firing a bubcapture-visible `error` event and the delegated boundary catching it — which
  I traced and believe is correct today (verified the guard logic prevents an infinite retry loop
  even if the fallback JPEG were also missing), but I did not runtime-verify actual browser
  `<picture>` fallback-selection edge cases (e.g., a browser that partially supports `type=image/avif`
  detection oddities) beyond static reasoning. Flagging as unconfirmed because it is exactly the
  kind of gap only a real browser/jsdom test would catch, which is the point of the finding above.
- `apps/web/src/lib/storage/index.ts`'s `switchStorageBackend(type: StorageBackendType)` contains a
  full save/rollback-on-failure implementation for a `StorageBackendType` union that currently has
  exactly one member (`'local'`), so its rollback branch is presently unreachable dead code. This
  matches CLAUDE.md's explicit "not yet integrated" framing and the module is fully unreferenced
  outside its own file and `storage-quarantine.test.ts` (verified via grep across
  `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib` excluding `lib/storage/`) — not
  filing this as a defect, just noting it as speculative code with a currently-unexercisable branch
  in case a future contributor extends the union without adding coverage for the rollback path.

## Areas Investigated With No New Finding

- `hdr-filenames.ts`: confirmed genuinely unwired (only import is its own test); matches CLAUDE.md.
- `smart-collections` mutation actions (`createSmartCollection`/`updateSmartCollection`/
  `deleteSmartCollection`): confirmed no caller outside `lib/smart-collections.ts`'s own doc comment
  and the actions file itself; matches CLAUDE.md's "no admin UI/API surface invokes them yet" claim.
- `COLOR_IMPACTING_KEYS` / `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS` (`settings-hash.ts`,
  `gallery-config-shared.ts`): count and membership match the documented 9-key list; no missing
  byte-impacting setting found among `GALLERY_SETTING_KEYS`.
  `IMAGE_PIPELINE_VERSION` matches the documented value 7.
- `csv-escape.ts` vs `validation.ts`'s `UNICODE_FORMAT_CHARS`: confirmed a single shared regex
  source (no producer/consumer drift) — `csv-escape.ts` imports and only adds the `g` flag.
- Cycle 28's grid-fallback JPEG-sizing change (`masonry-card.tsx`, `grid-picture.tsx`): traced the
  actual runtime logic (not just tests) for the scenario where AVIF/WebP/JPEG derivatives at the
  currently-configured `smallSize`/`mediumSize` don't exist for an older photo; the delegated
  boundary genuinely does catch and recover from this today. The bug is in test coverage, not
  current behavior (see CRIT10b-01).
- `run10-cycle29/architect-perf-reviewer.md`'s "None" verdict and its 5 deferred/carried-forward
  items were spot-checked for staleness; nothing has changed at current HEAD that would flip any of
  them to a live finding.

## Self-Audit

- CRIT10b-01: Confidence HIGH. Could the author immediately refute this with context I'm missing?
  Unlikely — I directly confirmed (a) the test file's only assertions are `readFileSync` +
  `.toContain`/`.toMatch`, (b) no jsdom/testing-library dependency exists in `package.json`, and (c)
  three other test files in this exact repo document and use a working alternative (hand-rolled
  fake-DOM unit tests) for the identical "no jsdom" constraint. This is a FLAW (weak regression
  coverage for real runtime behavior), not a stylistic preference — the established local
  convention for solving this exact problem exists and wasn't used.
- Realist check: realistic worst case is a broken-image regression across public gallery grid
  pages, not data loss or a security issue — appropriately capped at Major, not Critical. Mitigated
  somewhat by: the feature's current logic is correct (verified by direct trace, not just tests),
  and the scenario requires a *second*, independent precondition (an admin settings change without
  a completed backfill) to actually manifest visibly. Not mitigated by CI: lint/typecheck/build/unit
  tests all pass regardless of whether the runtime behavior is correct, and there is no e2e coverage
  either, so detection would be manual/visual, not automatic. Kept at Major given the breadth of
  affected public-facing surfaces (home, shared groups, timeline, year-in-review) and that a green
  test suite here creates false confidence for future refactors of this exact file.

## Summary

New findings: 1 (Major, confidence High). No Critical findings. Investigated and found no new
issues in: reserved/unwired code inventory (`hdr-filenames.ts`, `smart-collections` mutations,
storage backend module), settings/ETag byte-impacting-key consistency, CSV/OG sanitizer producer-
consumer drift, and the actual runtime correctness (not just tests) of the Cycle 28 grid-fallback
change. This is consistent with a highly converged codebase at cycle 29+; the one finding filed here
is a test-methodology gap on freshly landed code (Cycle 28) rather than a functional defect.
