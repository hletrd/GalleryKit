# Plan 305 — Run-4 Cycle 17 fixes

**Source review:** `.context/reviews/run4-cycle17/_aggregate.md`
**Status:** COMPLETE — all 4 tasks landed; all 8 gates green; deployed
**Gates per repo policy:** eslint, typecheck, vitest, api-auth lint,
action-origin lint, public-route-rate-limit lint, production build,
playwright e2e — all 8 must be green before deploy. GPG-signed
conventional commits + gitmoji; commit+push per task; per-cycle deploy.

## Task 1 — SEC-R4C17-01 (+TEST-R4C17-01, +DOC-R4C17-02): charge post-DB failures on the per-photo OG route
**Severity:** MED/High (security/abuse-resistance). 5/6 cross-angle.
**Files:**
- `apps/web/src/app/api/og/photo/[id]/route.tsx` — DELETE the
  `rollbackOgAttempt(ip)` calls on the `!image` branch (:83), the
  `!fetched` branch (:116), and the catch path (:221). KEEP the two
  pre-DB rollbacks on the syntactic id-validation rejections (:63,
  :68). Add a comment on the `!image` branch mirroring the sibling
  route's charged-404 rationale (enumeration oracle / unmetered DB
  load), citing SEC-R4C17-01.
- `apps/web/src/lib/rate-limit.ts` — rewrite the `rollbackOgAttempt`
  docstring (:224-228): rollback is ONLY for rejections that consumed
  no post-validation work (malformed params before any DB/CPU);
  post-DB failures stay charged per the enumeration-oracle policy
  (AGG8F-01); point at both routes' source-contract tests.
- `apps/web/src/__tests__/og-photo-fallback.test.ts` — flip the
  rollback assertion: exactly 2 `rollbackOgAttempt(ip)` occurrences,
  both BEFORE the `getImageCached` call in source order; negative
  assertions that the `!image` / `!fetched` / catch branches do not
  refund. Keep all runtime helper cases unchanged. Prove failing
  pre-fix (assertion flip first), green post-fix.
**Acceptance:** vitest green incl. flipped lock; both OG routes encode
the same charged-post-DB policy; docstring no longer cites
"topic not found" as a rollback example.
**Progress:** DONE — commit `c6091f2f`. Rollbacks deleted on the three
post-DB paths (the two pre-DB validation rollbacks kept), charged
rationale comments added per branch, docstring rewritten to the
pre-DB-only / Pattern-1 contract. Flipped lock proven failing against
the pre-fix route (expected 2, got 5), green post-fix; og contract
suite 14/14.

## Task 2 — DES-R4C17-03: accessible names for dashboard pagination controls
**Severity:** LOW/High (a11y).
**Files:**
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
  — add `aria-label` to the two disabled chevron-only placeholder
  Buttons AND the two enabled prev/next Buttons (page number alone is
  a weak name): `t('dashboard.previousPage')` / `t('dashboard.nextPage')`.
- `apps/web/messages/en.json` + `ko.json` — add
  `dashboard.previousPage` ("Previous page") / `dashboard.nextPage`
  ("Next page") and Korean equivalents ("이전 페이지" / "다음 페이지").
**Acceptance:** no icon-only button without an accessible name on the
dashboard; eslint/typecheck green.
**Progress:** DONE — commit `3b88cf97` (combined with Task 3). All
four pagination controls carry localized aria-labels (Link for
asChild, Button for disabled placeholders); keys added en+ko.

## Task 3 — DES-R4C17-04: announce retry success
**Severity:** LOW/Medium (a11y/feedback parity).
**Files:**
- same dashboard client — `toast.success(t('dashboard.retrySuccess'))`
  in the success branch of `handleRetry`.
- `en.json`/`ko.json` — `dashboard.retrySuccess`
  ("Queued for re-processing." / "재처리 대기열에 추가되었습니다.").
**Acceptance:** success and failure paths both announce via the
established sonner live-region channel.
**Progress:** DONE — commit `3b88cf97` (with Task 2, as planned).
`dashboard.retrySuccess` toast on the success branch; keys en+ko.

## Task 4 — COR-R4C17-05: warning parity for control-char-rejected tag names in bulk tag update
**Severity:** LOW/Medium (correctness of partial-success reporting).
**Files:**
- `apps/web/src/app/actions/tags.ts` — in `batchUpdateImageTags`'s add
  loop (:397-408) and remove loop (:423-428), push
  `warnings.push(t('invalidTagName'))` on the `nameRejected` path
  before `continue` (generic key only — NEVER echo the rejected value;
  `requireCleanInput` returns null by contract on rejection).
**Acceptance:** a rejected name now surfaces in `warnings[]` exactly
like a format-invalid name; no dirty value echoed; action-origin lint
green (no signature change). TEST-R4C17-03 disposition: no DB-coupled
harness exists for this action — document the exercised path in the
commit body per the test-engineer note.
**Progress:** DONE — commit `68c9eb0c`. Both loops warn with the
generic key on the rejected path; TEST-R4C17-03 disposition documented
in the commit body; action-origin lint green.

## Gate run + deploy record (cycle close)
- Gates (all 8 green): eslint ✓ (exit 0), typecheck ✓ (exit 0),
  api-auth lint ✓, action-origin lint ✓, public-route-rate-limit
  lint ✓, vitest ✓ 186 files / 1788 tests (full-suite green run;
  baseline 186/1788 — the flipped OG lock replaced assertions
  in-place, no count change), production build ✓ (exit 0; sw.js
  stamped 68c9eb0c-p7, committed b7a51b14), playwright e2e ✓
  (20 passed / 2 skipped, 5.6m).
- Vitest flake note (root-caused, not masked): two earlier full-suite
  attempts each saw ONE load-induced 15 s timeout in
  `backfill-detection-failure-contract.test.ts` (Sharp fixture
  generation; untouched by this cycle — the first attempt ran
  concurrently with tsc + lint stages, the second overlapped the
  isolation re-run). The test passes in isolation (1.67 s) and the
  quiet-machine full run is green 1788/1788 with exit 0. No test or
  threshold was modified.
- GATE_FIXES: zero pre-existing gate errors/warnings encountered this
  cycle (clean baseline); the flipped OG rollback lock landed WITH
  its fix per the prove-failing-first protocol (failing: expected 2,
  got 5).
- DEPLOY: per-cycle-success — `npm run deploy` exit 0 against HEAD
  b7a51b14; host rebuilt the image (sha256:185117b7…) and recreated
  `gallerykit-web` (Started); live probes `/en` 200, `/api/live` 200,
  `/sw.js` 200 serving `SW_VERSION = '68c9eb0c-p7'` in production.
