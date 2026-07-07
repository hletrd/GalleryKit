# Run-10 Cycle 8 (loop-B) Implementation Plan — 2026-07-07/08

**Review dir:** `.context/reviews/cycle-8-2026-07-07/` (11 lanes; aggregate at
`_aggregate.md` in that dir — NOT the top-level `.context/reviews/_aggregate.md`,
which is peer-loop-owned). **"8b" filename suffix** per the cycle-7b precedent: the
peer loop's own cycle-8 artifacts own the unsuffixed name space.

**Review baseline:** `6256a988`. **Plan baseline:** `a1863405` — the peer loop's
cycles 15-17 landed between review and planning and independently fixed 17 of the 38
deduped findings (each verified in the current tree; see the aggregate's
"Fixed at aggregation HEAD" table). This plan schedules ONLY what remains open at
`a1863405`.

## Work packages

### WP1 — Image-zoom drag pan: fix pixel/percent unit mixing + level-aware pan clamp (AGG8b-07 / CMP-01, HIGH)
- **Files:** `apps/web/src/lib/image-zoom-math.ts`, `apps/web/src/components/image-zoom.tsx`,
  `apps/web/src/__tests__/image-zoom-math.test.ts`, `apps/web/src/__tests__/image-zoom-source-contracts.test.ts`.
- **Defect:** `positionRef` x/y are percent-of-container (visual displacement = x% of
  container width — `translate(${x/level}%)` scaled by `level`), but both drag paths
  (mouse `image-zoom.tsx:127-141`, touch `:254-257,:301-306`) add raw PIXEL deltas into
  percent space. Pan speed scales with container width (~10× too fast at 1000 px), and the
  fixed ±100 clamp makes corners unreachable at 5× zoom (needs ±200) while over-panning at
  low zoom (level 1.5 needs only ±25).
- **Fix:**
  1. `clampPan(x, y, level)` — level-aware bound `maxPan = Math.max(0, (level - 1) * 50)`
     (image edge lands exactly at container edge). `anchoredZoomPosition` passes `newLevel`.
  2. Drag paths store `{ startClientX/Y, basePosition }` and convert deltas px→percent via
     the container rect: `base + (client - start) * 100 / rect.{width,height}` — 1:1 pointer
     tracking; guard zero-size rect.
  3. Update math tests to pin the new semantics (level 1 → 0,0; level 5 → ±200; anchored
     zoom clamps at the NEW level's bound); update source-contract pins for the drag paths.
- **Status:** DONE — px→pct conversion via container rect + level-aware clampPan(maxPan=(level-1)*50); math tests updated (level-1 pin, MAX_ZOOM ±200, 1:1 tracking derivation, dragDeltaToPanPct suite) + drag-path source contracts (`396f5a68`)

### WP2 — Root feed.xml rate-limit parity with topic feed (AGG8b-08 / API-01+PAGE-01, MED, 2-lane)
- **Files:** `apps/web/src/app/feed.xml/route.ts` (+ its test if one pins the exemption).
- **Defect:** root feed carries `@public-no-rate-limit-required` while the same-shaped,
  same-DB-cost topic feed pre-increments `preIncrementFeedAttempt` and 429s. Inconsistent
  with the product decision already made for the sibling; root feed is the more-crawled URL.
- **Fix:** mirror the topic feed's limiter (same helper, same 429 + Retry-After shape);
  drop the exemption comment.
- **Status:** DONE — root feed mirrors the topic feed limiter (preIncrementFeedAttempt + 429 + Retry-After), exemption removed, parity pinned for BOTH routes (`5c27d984`)

### WP3 — Histogram: set `crossOrigin` only for genuinely cross-origin URLs (AGG8b-29 / PERF-REACT-01, LOW-MED)
- **Files:** `apps/web/src/components/histogram.tsx` (~line 555).
- **Fix:** same-origin derivative URLs load without `crossOrigin` (no canvas taint
  same-origin; reuses the gallery's HTTP-cached bytes); keep `anonymous` for absolute
  URLs on another origin (IMAGE_BASE_URL CDN case).
- **Status:** DONE — needsCrossOriginForCanvas() gates the attribute on genuine cross-origin URLs (`310970e1`)

### WP4 — TagInput: memoize NFKC normalization of availableTags (AGG8b-30 / PERF-REACT-02, LOW)
- **Files:** `apps/web/src/components/tag-input.tsx`.
- **Fix:** `useMemo` a normalized list (`{ tag, normalized }`) keyed on `availableTags`;
  filter passes reuse it; input normalized once per keystroke. No behavior change.
- **Status:** DONE — normalizedAvailableTags/normalizedSelectedTags memos power filter + exact-match + create-option; exported helpers untouched (`1b6f178b`)

### WP5 — Behavioral tests for logout revocation queue (AGG8b-21 / TEST8-01, HIGH test-design)
- **Files:** `apps/web/src/__tests__/auth-actions-behavior.test.ts`.
- **Add:** with a valid session cookie — (a) restore-window active → no `db.delete`, hash
  enqueued, cookie cleared; (b) mutation slot not acquired → same; (c) `db.delete` rejects
  → hash enqueued (pins the peer's try/catch fix); (d) success path → NOT enqueued.
- **Status:** DONE — 4 behavioral cases: restore-window skip, slot refusal, delete-throw (all enqueue + cookie cleared), success-not-enqueued (`de93c535`)

### WP6 — Compiled-SQL pin for searchImages full-tag-set parity (AGG8b-22 / TEST8-02, HIGH test-design)
- **Files:** `apps/web/src/__tests__/data-tag-names-sql.test.ts`.
- **Add:** `.toSQL()`-style compiled assertion (technique already proven in this file) that
  the tag-search branch's WHERE carries the `EXISTS` subquery and the aggregation joins are
  the unfiltered `LEFT JOIN`s — strictly stronger than the current source-slice.
- **Status:** DONE — compiled-SQL shape test: single LIKE inside EXISTS, unfiltered LEFT JOINs, no HAVING, single bound term (`07b21519`)

### WP7 — Strengthen upload-quota TOCTOU pin (AGG8b-23 / TEST8-03, HIGH test-design)
- **Files:** `apps/web/src/__tests__/images-action-toctou-claim.test.ts`.
- **Add:** a window pin that extracts the check→claim source span and asserts it contains
  NO `await` token at all (catches ANY new await inserted in the vulnerability window, not
  just the two named ones). Full concurrency-interleaving harness for `uploadImages()`
  remains chained on the C94-04-class test-infra investment (see deferred register).
- **Status:** DONE — comment-stripped no-await window pin from the limits check to the claim + no .then() chaining (`5e4c365b`)

### WP8 — GPS fail-closed cleanup assertion, browser path (AGG8b-24 / TEST8-04, MED)
- **Files:** `apps/web/src/__tests__/images-action-gps-toggle-wiring.test.ts`.
- **Add:** assert `deleteOriginalUploadFile(` inside the `!gpsStripped` block window
  (LR twin already covered at `lr-upload-hdr-gate.test.ts:58`).
- **Status:** DONE — deleteOriginalUploadFile + savedOriginalFilename=null pinned inside the !gpsStripped block window (`5e4c365b`)

### WP9 — Staged releaser partial-failure test (AGG8b-27 / TEST8-07, LOW)
- **Files:** `apps/web/src/__tests__/advisory-lock-release.test.ts`.
- **Add:** lock A release rejects, lock B still attempted, `finish()` destroys (not
  releases) exactly once.
- **Status:** DONE — partial-failure staged case: lock B still attempted, sticky releaseFailed, finish() destroys exactly once (`833de1b0`)

### WP10 — db-child-watchdog: keep settle listeners attached after timeout (AGG8b-14 / CRIT8-04, LOW)
- **Files:** `apps/web/src/lib/db-child-watchdog.ts`, `apps/web/src/__tests__/db-child-watchdog.test.ts`.
- **Fix:** in the returned cleanup, only `child.off(...)` when `!fired` — after the timeout
  fired, a late child exit must still cancel the SIGKILL grace timer even if a (future)
  caller ran cleanup unconditionally. Update the pinning test to the strengthened semantics.
- **Status:** DONE — cleanup is a no-op after the timeout fired (listeners retained); new exit-during-grace-after-cleanup case (`71b77599`)

### WP11 — CLAUDE.md: document the destroy-don't-release advisory-lock discipline (AGG8b-15 residual / CRIT8-05, LOW doc)
- **Files:** `CLAUDE.md` (Race Condition Protections, next to the advisory-lock scope note).
- **Status:** DONE — destroy-don't-release discipline bullet added under Race Condition Protections; watchdog bullet updated for the WP10 semantics

### WP12 — Registers & plan index (AGG8b-38 + PROMPT-2 bookkeeping)
- **Files:** `.context/plans/deferred-carry-forward.md`, `.context/plans/README.md`,
  `.context/plans/cycle-8b-2026-07-07-deferred.md` (new).
- **Do:** drop C4-17 (implemented cycle 5 — architect verified `instrumentation.ts` owns the
  scheduler); age-budget check (no open High rows → 8-cycle budget satisfied; C80-06 MED
  re-justified at the 16-cycle checkpoint); add this cycle's 6 deferral rows; index the new
  plan/deferred pair.
- **Status:** DONE — C4-17 removed with lineage note, cycle-8 age-budget check recorded (no High crosses budget; C80-06 re-justified at ~16), 4 new C8b rows + fold notes, README index updated

### WP13 — Gates + deploy + ledger
- All 8 gates green repo-wide, GPG-signed gitmoji commits (no Co-Authored-By), pull
  --rebase before push, stage only cycle-8b files, single `npm run deploy` from repo root.
- **Status:** PLANNED

## Findings honesty ledger (every aggregate ID accounted for)

- Fixed at plan baseline by peer (no WP): AGG8b-01..06, -10, -11, -13, -16..20, -33, -34 (17).
- Scheduled here: AGG8b-07 (WP1), -08 (WP2), -29 (WP3), -30 (WP4), -21 (WP5), -22 (WP6),
  -23 (WP7, strengthened-pin half), -24 (WP8), -27 (WP9), -14 (WP10), -15 (WP11), -38 (WP12).
- Deferred with records: AGG8b-09, -23 (behavioral-harness half), -25, -26, -28, -31, -32
  (see `cycle-8b-2026-07-07-deferred.md`).
- No-action informational: AGG8b-12 (empty peer commit — pushed shared history, rewriting
  prohibited by repo git-safety rules), -35 (bounded retry log noise), -36 (superseded by
  peer's acquire-error destroy helper), -37 (process observation).

## Gate evidence (implementation HEAD `a1620767` + peer-converged tree, 2026-07-08)

| Gate | Result |
|------|--------|
| eslint (`npm run lint --workspace=apps/web`) | PASS (0 errors, 0 warnings) |
| typecheck (`npm run typecheck --workspace=apps/web`) | PASS (app + scripts) |
| vitest (`npm test --workspace=apps/web`) | PASS — 354 files + 2 skipped, 3291 passed / 4 skipped (documented CLIP/admin env-gated skips) |
| build (`npm run build`) | PASS (production build, full route table emitted) |
| lint:api-auth | PASS |
| lint:action-origin | PASS |
| lint:public-route-rate-limit | PASS (root feed.xml now under the limiter) |
| playwright e2e (`npm run test:e2e --workspace=apps/web`) | PASS — 45 passed, 2 skipped (admin/CI-gated), run synchronously |

**Shared-worktree gate incident (recorded per the caveat):** the first full vitest run
showed 9 failures in 4 files. Ownership was verified with a clean `git worktree` at HEAD:
`cycle-20-source-contracts.test.ts` failed because THIS cycle's WP10 rewrote the pinned
watchdog cleanup text — fixed by aligning the pin (`a1620767`, intent preserved).
`api-auth-response-headers` / `embeddings-action-behavior` failures reproduced ONLY with
the peer session's uncommitted edits (clean worktree at my HEAD passed both), and
`lr-upload-route-behavior` was already 7/7 red at the peer's own baseline commit
`a1863405` — a peer test committed ahead of its in-flight route fix. Per the
shared-worktree rule the peer's in-flight files were not touched; by the final gate run
the peer's edits had converged and the whole suite was green in the shared tree.

## Deploy record

- Pre-deploy checks: `git pull --rebase` clean, no concurrent peer deploy in `ps aux`.
- `npm run deploy` (repo root, 2026-07-08): SUCCESS — remote build + compose up
  completed ("Deployment Complete!"), post-deploy auto-prune ran, deploy-host disk
  healthy (14% used). Production smoke: `/` 307 (locale redirect), `/feed.xml` 200
  (new limiter live), `/api/health` 200.
- DEPLOY: per-cycle-success.
