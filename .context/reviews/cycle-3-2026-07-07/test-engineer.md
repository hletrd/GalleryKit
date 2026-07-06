# Test Engineer Review — GalleryKit (apps/web), Run-10 Cycle 3

Date: 2026-07-07
Scope: `apps/web/src/__tests__/` (Vitest), `apps/web/e2e/` (Playwright), `apps/web/scripts/check-*.ts` lint gates and their fixtures.
Method: full `npm test -- --run` execution (green: 326 passed + 2 skipped test files, 3032 passed + 4 skipped tests, ~10s); diff-level review of every commit in `git log 642c5091..e08b6f97` (cycle-2's range) with a focus on the priority commits named in the brief; source-vs-test cross-checks for the new/changed production code in that range; a fresh lib-vs-test inventory pass to catch untested modules the predecessor review's snapshot didn't (or that appeared since); targeted greps for flaky-test anti-patterns (real timers without fake-timer control, `.only(`, floating promises, order-dependent module state).

## Headline

Cycle-2 closed all five prior actionable test-coverage findings (TEST-01 through TEST-05 from `.context/reviews/cycle-2-2026-07-07/test-engineer.md`) with real, non-tautological behavior tests — I read each new/changed test file in full and verified it exercises the actual production code path (not a re-assertion of a mock), see "Verified: cycle-2 predecessor fixes" below. TEST-06 (real CLIP encoder only verified by env-gated tests never run in CI) is unchanged and correctly left as a process-only deferred item (no code fix was claimed).

The overwhelming majority of cycle-2's ~28 commits shipped tests alongside the behavior change, and the new tests are generally strong: they assert on real query-builder call shapes, real byte-level embedding math, real crafted-buffer boundary conditions, and real HTTP status codes (Playwright's `request` fixture, not just DOM assertions). Two commits, however, landed non-trivial interactive-gesture / focus-restore refactors with materially weaker coverage than their siblings in the same cycle, and one commit reintroduces a fresh untested branch in a security/availability-relevant code path (restore-maintenance gating on the new status-bearing 404 layouts). I also found three small, long-lived pure-logic modules that have never had direct test coverage, independent of this cycle.

No test-suite-wide flakiness patterns were found: no `.only(`, no un-`await`ed floating promises other than one deliberately `void`-marked and later-awaited case, no real wall-clock sleeps, and the timer-heavy new test files (`image-queue-processing-retry-backoff.test.ts`, `image-queue-gc-timer-reinit.test.ts`) correctly use `vi.useFakeTimers()` / `.unref()`.

## Findings

| ID | Severity | Confidence | Location | Title |
|----|----------|------------|----------|-------|
| TEST3-01 | MED-HIGH | High (confirmed) | `[topic]/layout.tsx:28`, `p/[id]/layout.tsx:27`, `c/[slug]/layout.tsx:24` | New status-bearing 404 layouts' restore-maintenance skip branch has zero test coverage |
| TEST3-02 | MED | High (confirmed) | `apps/web/src/components/photo-navigation.tsx` (ffc4a06e) | Imperative swipe-gesture refactor has no behavioral test, unlike its sibling refactors this cycle |
| TEST3-03 | LOW-MED | Medium | `apps/web/scripts/migrate.js:812-833` | FDR-01 fix's "mixed" missing-hash case (some above, some below cursor) is untested behaviorally |
| TEST3-04 | LOW-MED | High (confirmed) | `apps/web/src/lib/clip-inference.ts` | Deterministic stub-embedding generator (`embedImageStub`/`embedTextStub`) has zero direct test |
| TEST3-05 | LOW | High (confirmed) | `apps/web/src/lib/csp-nonce.ts`, `apps/web/src/lib/settings-normalization.ts` | Two small, widely-used pure helpers have never had a direct behavioral test |
| TEST3-06 | LOW | Medium | `apps/web/e2e/focus-restore.spec.ts` (test added in 2c82a69c) vs. `info-bottom-sheet.tsx` (mechanism added one commit later, in fc21007a) | A regression e2e test was committed one commit before the implementation it verifies |

---

### TEST3-01 — restore-maintenance skip branch in the new status-bearing 404 layouts is completely untested

**Severity:** MED-HIGH · **Confidence:** High (confirmed)

Commit `911cb0f5` (fix(seo): real HTTP 404s for public not-found routes) added four new `layout.tsx` files that move existence checks outside the streaming `loading.tsx` boundary so `notFound()` can set a real HTTP 404. Three of the four guard the check behind `isRestoreMaintenanceActive()`:

- `apps/web/src/app/[locale]/(public)/[topic]/layout.tsx:28` — `if (!isRestoreMaintenanceActive()) { ...; if (!topicData) notFound(); }`
- `apps/web/src/app/[locale]/(public)/p/[id]/layout.tsx:27` — same shape for photo id/existence
- `apps/web/src/app/[locale]/(public)/c/[slug]/layout.tsx:24` — same shape for smart-collection existence + `is_public`

The stated intent (per each file's own comment) is: "During restore maintenance the DB is not authoritative — skip the check and let the page render its maintenance panel (200, matching all public pages during a restore window)." This is exactly the class of behavior the repo cares deeply about elsewhere (CLAUDE.md documents a dedicated durable-marker restore-maintenance system with its own thorough test file, `restore-maintenance.test.ts`).

**What's tested today:** `apps/web/e2e/not-found-status.spec.ts` (added in the same commit) exercises the *normal* path only — it asserts 404s for missing photo/topic/collection/year and a 200 control for the home page, but never puts the app into restore-maintenance mode. `apps/web/src/__tests__/client-source-contracts.test.ts` and `photo-og-metadata.test.ts` only source-string-match `notFound()`/digest presence for `generateMetadata`, never import or exercise the layout files. A full-repo search (`grep -rl "p/\[id\]/layout\|\[topic\]/layout\|c/\[slug\]/layout" apps/web/src/__tests__/`) confirms no test file imports any of the three layout components directly.

**Failure scenario:** a future refactor that consolidates the three near-identical layout bodies into a shared helper, reorders the guard, or simply typos `!isRestoreMaintenanceActive()` to `isRestoreMaintenanceActive()` in one of the three files would either (a) 404 every photo/topic/collection page during every restore-maintenance window — a broad public-availability regression exactly during the window CLAUDE.md says should stay browsable at 200 — or (b) skip the check even outside maintenance, silently reverting to the soft-404 bug this commit was written to fix. Neither direction is caught by any test today.

**Why this is easy to fix (feasibility already proven in-repo):** `apps/web/src/__tests__/photo-og-metadata.test.ts` already establishes the exact pattern needed — it imports `generateMetadata` directly from `p/[id]/page.tsx` and mocks `@/lib/data`. The three layout components have the identical shape (`async function Layout({ children, params })`, a mockable data-lookup import, and a mockable `@/lib/restore-maintenance` import), so a new `apps/web/src/__tests__/not-found-layout-restore-maintenance.test.ts` could directly import each layout, mock `isRestoreMaintenanceActive` to return `true`, and assert `children` renders (no `notFound()` throw) even when the mocked lookup returns `null`/missing — then assert the inverse (throws) when maintenance is `false`. This closes the gap without any new test infrastructure.

**Suggested fix:** add direct unit tests for all three layouts covering the 2×2 matrix (maintenance active/inactive × entity missing/present), asserting `notFound()` is/isn't thrown via `next/navigation`'s real `notFound` (which throws a digest-bearing error, same technique already used in `photo-og-metadata.test.ts`'s `isNotFoundError` helper from `faa6f0e5`).

---

### TEST3-02 — `photo-navigation.tsx`'s imperative swipe-gesture refactor has no behavioral test

**Severity:** MED · **Confidence:** High (confirmed)

Commit `ffc4a06e` (perf(viewer): ref-based swipe transforms in photo navigation) rewrote the touch-swipe feedback system from React state (`swipeOffset`/`isSnapping`) to direct ref/DOM writes (`applySwipeVisuals`), and changed the progress-bar `<div>` from conditionally-mounted (`{swipeOffset !== 0 && ...}`) to always-mounted-but-invisible. This is a real behavior surface: swipe-threshold detection, indicator opacity/transform math, and navigation-triggering logic all still live in the rewritten `handleTouchMove`/`handleTouchEnd` closures.

Contrast with sibling refactors in the exact same cycle that DID get dedicated behavior tests for equivalent imperative-DOM rewrites:
- `bf5a4da9` (sw-cache 304 handling) added `apps/web/src/__tests__/sw-cache.test.ts` (126 new lines) plus updated the contract test.
- `e5504bc8` (masonry card memoization) added `apps/web/src/__tests__/masonry-card-memo.test.ts` (186 new lines).
- `fc21007a` (info-bottom-sheet ref-based drag, the same `image-zoom.tsx` idiom `ffc4a06e`'s commit message explicitly cites) has e2e coverage for its focus-restore half (see TEST3-06) though not for its drag-transform half.

`ffc4a06e` itself added zero test-file changes (`git show --stat ffc4a06e` touches only `photo-navigation.tsx`). The only existing references to `photo-navigation.tsx` in the test suite are source-string checks for unrelated properties: `cycle-19-source-contracts.test.ts` (checks `swipeTargetRef` wiring), `cycle-20-source-contracts.test.ts` (checks `prefetch={false}`), `cycle-72-source-contracts.test.ts` (checks the `vibrateForSwipe` string), and `touch-target-audit.test.ts` (a documented-zero-violations entry for an unrelated 44px button check). None of these would catch a regression in `applySwipeVisuals`'s offset math, a wrong ref target, a missed `.style.transition` reset leaving a stuck transition on the next drag, or a `SWIPE_THRESHOLD` sign error that inverts which edge indicator lights up.

**Failure scenario:** a future edit to `applySwipeVisuals` (e.g., swapping `prevEl`/`nextEl` assignments, or forgetting to clear `transition` on drag-start so the settle animation lingers into the next gesture) ships green, and only surfaces as visually wrong swipe feedback on a real mobile device — exactly the class of bug this refactor is prone to, since it traded declarative React state (which a snapshot/render test could catch) for imperative style writes (which only a DOM-inspecting or e2e test can catch).

**Suggested fix:** either (a) a jsdom/RTL-style unit test that fires synthetic `touchstart`/`touchmove`/`touchend` events on a rendered `PhotoNavigation` and asserts `style.opacity`/`style.transform` on the indicator refs at each step, or (b) a Playwright e2e test using `page.touchscreen` / CDP touch emulation asserting the same, following the pattern `focus-restore.spec.ts` already established for sibling gesture-adjacent behavior this same cycle.

---

### TEST3-03 — FDR-01 migration fix's "mixed missing-hash" edge case is untested behaviorally

**Severity:** LOW-MED · **Confidence:** Medium

Commit `b4e986c3` (fix(migrate): apply pending new migrations instead of baselining them) is the highest-stakes fix in this cycle's range — it corrects a bug that silently made every future migration's SQL never execute (see CLAUDE.md's "Migration & Schema-Drift Runbook", which documents this exact class of incident having "burned production once" before). The new logic in `apps/web/scripts/migrate.js:812` is:

```js
if (cursor !== null && missing.every((m) => Number(m.folderMillis) > Number(cursor))) {
    // pure "new migrations pending" — return without baselining
}
```

When the condition is false, it falls through to the drift-repair path, which computes `swallowedTail` (`apps/web/scripts/migrate.js:828`, `missing.filter((m) => folderMillis > cursor)`) — entries that get baselined-without-executing and only "loudly named" via a `console.log`/warning, not a thrown error.

`apps/web/src/__tests__/migrate-pending-migrations.test.ts` (added by this commit) has three real behavioral tests: all-missing-above-cursor (pending path), fully-covered (no-op), and single-missing-below-cursor (drift path) — all genuinely exercise `prepareLegacyDatabaseIfNeeded` against a fake connection that answers real SQL shapes, which is good, meaningful coverage of the primary fix. But there is no test for the **mixed** case — a journal where some missing hashes sit below the cursor (genuine drift) AND others sit above it (genuine new-pending) in the same run. That is exactly the scenario `swallowedTail` exists to handle, and it is only indirectly touched by a source-string assertion (`expect(src).toContain('WITHOUT executing their SQL')`) in the same file's second `describe` block, not by asserting the actual `calls` array shows a baseline INSERT for the above-cursor entries and a reconcile pass for the below-cursor ones together.

**Failure scenario:** an operator who manually deletes one old hash row (e.g., correcting bad data) while a new migration is also genuinely pending would hit the mixed path; if `swallowedTail`'s filtering logic regressed (e.g., an off-by-one on the cursor comparison, or baselining the wrong subset), the newest pending migration's SQL could again silently fail to execute — the exact failure mode this commit fixed — and no test would catch it.

**Suggested fix:** add a fourth behavioral test case to `migrate-pending-migrations.test.ts`: a 3-entry journal with one missing hash below the cursor and one missing hash above it, asserting exactly one `INSERT INTO __drizzle_migrations` for the below-cursor entry (drift baseline) and none for the above-cursor entry (left for drizzle to apply/record), plus a console warning mentioning the above-cursor tag.

---

### TEST3-04 — `clip-inference.ts` stub-embedding generator has zero direct test

**Severity:** LOW-MED · **Confidence:** High (confirmed)

`apps/web/src/lib/clip-inference.ts` exports `embedImageStub(imageId)` and `embedTextStub(query)`, both backed by a `deterministicEmbedding(seed)` helper that does real bit-manipulation (cycling SHA-256 digests into a 512-dim `Float32Array`, mapping each `uint32` into `[-1, 1]`). The module's own doc comment states an explicit invariant: "Both functions are pure and deterministic: the same input always produces the same 512-dim Float32Array, so backfill is idempotent and tests are reproducible." No test in the repository imports `@/lib/clip-inference` directly (confirmed via `grep -rl "from '@/lib/clip-inference'" apps/web/src/__tests__/` — zero hits); every consumer (`image-queue.ts`, `api/search/semantic/route.ts`, `actions/embeddings.ts`) mocks the module away in its own tests.

This is the one CLIP-adjacent module actually reachable in default ('stub') semantic-search mode without any production-only gate — unlike the real jina-clip-v2 encoder (already flagged as TEST-06/deferred, appropriately, since it needs real model weights), this stub path runs in CI-reachable, dependency-free code every time semantic search is stub-enabled.

**Failure scenario:** a refactor that breaks the digest-cycling loop (e.g., an off-by-one in `remaining -= chunk` that leaves trailing zeros, or a bug that makes `embedImageStub(1)` and `embedTextStub('1')` collide because the `image:`/`text:` seed-prefix separation is dropped) would silently make the documented "idempotent backfill" and "distinct image vs. text embeddings" invariants false, while every existing test (which mocks this module) stays green.

**Suggested fix:** a small `clip-inference.test.ts` asserting: (a) `embedImageStub(imageId)` returns a 512-length `Float32Array` with all values in `[-1, 1]`; (b) calling it twice with the same id yields bit-identical output (`toEqual`); (c) two different ids/queries yield different output; (d) `embedImageStub(1)` and `embedTextStub('1')` are NOT equal (seed-namespace separation holds).

---

### TEST3-05 — two small, widely-used pure helpers have never had a direct test

**Severity:** LOW · **Confidence:** High (confirmed)

- `apps/web/src/lib/csp-nonce.ts` — `getCspNonce()` is a 9-line function with a security-relevant branch (`process.env.NODE_ENV !== 'production'` returns `undefined`; otherwise reads the `x-nonce` response header). It is imported by `[locale]/layout.tsx` plus 6 public `page.tsx` files (home, timeline, year, smart collection, topic, photo) — i.e., it runs on effectively every public page render in production. The only test file referencing it, `client-server-only-boundary.test.ts`, is a source-string import-boundary check (proving it's not imported client-side) and never calls `getCspNonce()` or exercises either branch.
- `apps/web/src/lib/settings-normalization.ts` — `normalizeGallerySettingValue(key, value)` (trims, and delegates `image_sizes` specifically to `normalizeConfiguredImageSizes`) is imported by `settings-submit-payload.ts`, `settings-backfill-warning.ts`, and `actions/settings.ts` directly. No test file calls it directly or asserts trimming/empty-string/`image_sizes`-delegation behavior (`grep -rl "normalizeGallerySettingValue" apps/web/src/__tests__/` — zero hits); the settings-action tests that exist (e.g., `settings-backfill-required-action.test.ts` reviewed above) mock the DB layer and never assert on the normalized value shape itself for a non-trivial input like `"  640, 1536 "`.

Neither is high-risk on its own (small, low-complexity functions), but both sit on security/config-integrity-adjacent surfaces exercised on every request/every settings save, and both are one-line-regression-away from a silent wrong-branch bug (e.g., inverting the `NODE_ENV` check would leak the nonce header check in dev and silently omit it in prod, or a broken `trimmed === ''` short-circuit could let whitespace-only settings values persist).

**Suggested fix:** two or three `it()` cases each, in a shared small `misc-pure-helpers.test.ts` or appended to an existing nearby file — not worth a large dedicated investment given the size/risk, but currently at zero.

---

### TEST3-06 — an e2e regression test was committed one commit before the implementation it verifies

**Severity:** LOW · **Confidence:** Medium

`apps/web/e2e/focus-restore.spec.ts` was added whole (all 3 tests, including `'mobile info sheet returns focus to its opener after Close'`) in commit `2c82a69c`. The mechanism that test depends on — the `restoreFocusRef` prop and its rAF-deferred focus-restore effect in `info-bottom-sheet.tsx` — was not added until the *next* commit, `fc21007a` (confirmed: `git log --oneline 642c5091..e08b6f97 -- apps/web/e2e/focus-restore.spec.ts` shows only `2c82a69c` touching this file, and `fc21007a`'s diff to `info-bottom-sheet.tsx` is where `restoreFocusRef` first appears). Both commits share the identical author timestamp, suggesting they were authored together as one logical change and only split across two commits by file/topic, not by an intervening verification step.

This means the repository briefly held a commit (`2c82a69c`) at which the full e2e suite, if run, would very likely fail one of its own new tests (the info-sheet case) — the same commit's own comment attributes the underlying bug to a real *race* in `focus-trap-react`'s `returnFocusOnDeactivate` vs. the `return null` unmount, so whether the pre-fix code happens to pass or fail that specific assertion is timing-dependent and not something I verified by running it (would require checking out `2c82a69c` standalone and running Playwright against it, which I did not do). This is a minor commit-atomicity/bisectability concern, not a coverage gap at HEAD — at the current HEAD, the behavior IS covered by this e2e test, and per repo policy each commit is normally expected to be gate-clean.

**Suggested fix:** no code change needed. Going forward, prefer landing a new/renamed e2e assertion in the same commit as (or after) the implementation it exercises, so any accidental bisect between the two lands on a green commit; if the two must be split (e.g., large diffs), a one-line note in the earlier commit's message flagging the temporary red state would aid future bisection.

## Final sweep

- **Full suite run:** `npm test -- --run` → 326 passed + 2 skipped test files (328 total), 3032 passed + 4 skipped tests, ~10s. Clean.
- **`.only(` scan:** zero hits repo-wide.
- **Floating-promise scan:** one hit (`histogram.test.ts:90`, `void secondPromise.then(...)`) — deliberate, and the same promise is properly `await`ed three lines later (line 97); not a bug.
- **Real-timer scan:** `image-queue-gc-timer-reinit.test.ts` creates one real `setInterval` but immediately `.unref()`s it and it's the assertion target itself (cleared by the code under test); `image-queue-processing-retry-backoff.test.ts` correctly uses `vi.useFakeTimers()`/`advanceTimersByTimeAsync`. The other files with bare `setTimeout`/`setInterval` text (`data-view-count-flush.test.ts`, `clip-model-contract.test.ts`, `image-queue-quiesce.test.ts`, `admin-backfill-runner-batching.test.ts`, `lightbox-controls-contract.test.ts`) are unchanged from the prior cycle's review, which verified them as source-string/deterministic-timestamp patterns, not real sleeps.
- **New admin surface vs. lint gates:** cycle-2 modified `actions/settings.ts` and `actions/tags.ts` but added no *new* admin API routes or server action files, so `check-api-auth`/`check-action-origin` fixture coverage needed no updates — confirmed via `git diff --name-status 642c5091..e08b6f97 -- apps/web/src/app/api/admin apps/web/src/app/actions` (no `A` status lines).
- **Weak-assertion scan (this cycle's new tests):** none of the ~14 new test files added in the c2 range rely solely on `toBeDefined`/`toBeTruthy`; all assert concrete shapes/values.

## Verified: cycle-2 predecessor fixes (TEST-01 through TEST-05) are real, not tautological

I read each new test in full against the real production source, not just the commit message:

- **TEST-01/`checkRateLimit`** (`rate-limit-db.test.ts`): asserts the exact `and(eq(ip), eq(bucketType), eq(bucketStart))` clause shape and boundary/empty-result behavior against the real `checkRateLimit` implementation at `apps/web/src/lib/rate-limit.ts:451-474` — clause order and field names match precisely.
- **TEST-02/`isEditableTarget`** (`editable-target.test.ts`): builds a hand-rolled `FakeHTMLElement`/`closest()` and installs it as the real global before calling the actual imported `isEditableTarget`, not a mock of it — confirmed the `instanceof` checks in `editable-target.ts:11-12` correctly resolve against the reassigned globals at call time (bare identifiers re-resolve per-call, not at import time), so the technique is valid. All 13 selector branches plus the `HTMLInputElement`/`HTMLTextAreaElement` fast path are covered.
- **TEST-03/`humanizeColorPrimariesOrLabel`**, **TEST-04/`useRestoreFocusAfterPending`**: reviewed at commit-diff level; both add concrete assertions on the specific documented fallback/guard behavior, not source-string checks.
- **TEST-05/storage rollback**: correctly left untouched — the quarantine decision (C2-27) is still pending, and the deferred register (`cycle-2-2026-07-07-deferred.md`, C2-50) correctly notes testing dead code would contradict repo policy until the quarantine lifts.
- **TEST-06** (real CLIP encoder in CI): unchanged, correctly left deferred as a process/documentation item, not a code gap.

## What's already excellent (worth preserving, not re-litigating)

- `migrate-pending-migrations.test.ts`'s fake connection answers real SQL query shapes and records every call — the right level of realism for a migration-safety test, same caliber as `serve-upload.test.ts`'s real-symlink approach praised in the prior cycle's review.
- `isobmff-parent-bounds.test.ts` (9ce5cf96) and `not-found-status.spec.ts` (911cb0f5) both test at the right altitude: crafted byte buffers for the ISOBMFF walker, real HTTP status codes via Playwright's `request` fixture (not a browser-DOM proxy) for the 404 fix.
- `photo-og-metadata.test.ts`'s `isNotFoundError` digest-matching helper (faa6f0e5) correctly pins on the framework-internal digest contract rather than a user-facing message string, and defensively matches both the current and prior Next.js digest formats.
- The settings `requiresBackfill` test matrix (`settings-backfill-required-action.test.ts`) is a model of thorough boundary coverage: change+images, no-change, zero-images, non-byte-impacting, and both existing hard-fence interactions (`image_sizes`, `strip_gps_on_upload`) — five real scenarios, zero throwaway assertions.

REVIEW COMPLETE: 6 findings
