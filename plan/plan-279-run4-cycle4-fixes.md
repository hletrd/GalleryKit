# Plan 279 — Run-4 Cycle 4 fixes

**Source review:** `.context/reviews/run4-cycle4/_aggregate.md` (15 findings:
9 fix items, 6 test gaps folded into their parent fixes, 0 new deferrals).
Per-angle provenance in the same directory. Repo policy: GPG-signed commits,
Conventional Commits + gitmoji, per-iteration push, per-cycle deploy, no
suppressions. HARD-SCOPE: no edit/culling/scoring features.

## Task 1 — PERF-R4C4-01 + TEST-R4C4-10: stale-while-revalidate for the serving-path settings-hash debounce
**Files:** `apps/web/src/lib/serve-upload.ts:42-71`,
`apps/web/src/__tests__/serve-upload-settings-debounce.test.ts`
- [x] When `servingHashCache` exists (fresh OR stale), return its hash
      immediately; if stale, kick the refresh inflight WITHOUT awaiting it
      (swallow rejections — failure semantics unchanged: keep last hash).
- [x] Only await the inflight when NO hash has ever been resolved (cold
      start) — preserves the burst=1-SELECT contract.
- [x] Update the module docstring: the "misbehaving DB cannot stall image
      responses" claim becomes true; document the skew bound (≤ 5 s + one
      refresh latency).
- [x] Tests: kept burst=1 + ETag-hash cases; TTL case now documents that
      the stale request TRIGGERS the refresh; added hung-refresh
      non-blocking + post-release hash-swap case and refresh-dedupe-under-
      hang case.
**Done:** commit `20a20714` — suite 5/5 green.

## Task 2 — COR-R4C4-02 + TEST-R4C4-11: converge DB state on `charge_already_refunded`
**Files:** `apps/web/src/app/actions/sales.ts:215-233`, test file that owns
the refund surface (`refund-clears-download-token.test.ts` or a new
behavioral sales test)
- [x] In `refundEntitlement`'s catch: when `mapStripeRefundError(err) ===
      'already-refunded'`, run the same convergence UPDATE (`refunded: true,
      downloadTokenHash: null` WHERE id) in a nested try; on success return
      `{ success: true }`; if the convergence UPDATE fails, fall through to
      the existing error return (severity preserved).
- [x] Structured log line for the convergence (entitlementId key) so
      operators see the reconciliation happened via the error path.
- [x] Tests: 4 behavioral cases in `sales-refund-convergence.test.ts`
      (happy path, convergence+success, convergence-UPDATE-failure →
      errorCode preserved, non-already-refunded errors do NOT converge).
**Done:** commits `7887395b` (fix+tests) + `c66fed47` (mock typing for the
typecheck gate).

## Task 3 — COR-R4C4-03 + TEST-R4C4-12: contain the LR route's post-save throw window
**Files:** `apps/web/src/app/api/admin/lr/upload/route.ts:286-392`, extend
`lr-upload-hdr-gate.test.ts` or add `lr-upload-containment.test.ts`
- [x] Widened the try to open BEFORE the HDR gate (also containing
      `extractExifForDb`, `stripGpsFromOriginal`,
      `cleanupOriginalIfRestoreMaintenanceBegan`, `assertBlurDataUrl`, and
      the insert). The settle closure is now IDEMPOTENT (guard flag) so the
      containment catch cannot double-settle after a reject branch settled —
      double settle would steal quota from concurrent claims.
- [x] Catch log renamed to 'LR upload: post-save processing failed'.
- [x] Test: 4 new source-contract cases in `lr-upload-hdr-gate.test.ts`
      (window coverage, catch behavior, post-insert work outside the try,
      settle idempotency) — source-contract style per that file's documented
      convention for this heavy multipart route (deviation from the plan's
      suggested behavioral throw-injection recorded here); the R4C1
      COR-R4C1-02 contract test was updated to the widened shape.
**Done:** commit `f3d68197`.

## Task 4 — UX-R4C4-04 + TEST-R4C4-13: tokens-client Enter-key pending guard
**Files:**
`apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:44,155`,
`apps/web/src/__tests__/client-source-contracts.test.ts`
- [x] `if (isPending) return;` first line of `handleCreate`; Enter handler
      gains `e.preventDefault()` (match image-manager/topic-manager
      siblings).
- [x] Source-contract test pinning both in `client-source-contracts.test.ts`.
**Done:** commit `60fca60e`.

## Task 5 — I18N-R4C4-05: localize lr-tokens action error strings
**Files:** `apps/web/src/app/actions/lr-tokens.ts`,
`apps/web/messages/en.json`, `apps/web/messages/ko.json`,
`apps/web/src/__tests__/lr-tokens-action.test.ts`
- [x] Added `serverActions.lrToken*` keys (en + ko): ScopeRequired,
      InvalidLabel, InvalidExpiry, ExpiryInPast, CreateFailed, NotFound;
      all seven literals now flow through `t(...)`.
- [x] Generic-error posture unchanged.
- [x] Test expectations moved to key-equality.
**Done:** commit `133d51fe`.

## Task 6 — COR-R4C4-06 + TEST-R4C4-15: download route — open the file handle BEFORE the single-use claim
**Files:** `apps/web/src/app/api/download/[imageId]/route.ts:169-282`,
extend the test file that owns this surface or add
`download-route-claim-order.test.ts`
- [x] `open(resolvedFilePath, 'r')` inside the existing ENOENT→404 try,
      BEFORE the claim — vanished file no longer consumes the token.
- [x] Claim wrapped (close handle + 500 on UPDATE failure); `affected === 0`
      closes the handle before the 410.
- [x] Streams via `fileHandle.createReadStream()` (autoClose on success);
      Content-Length now comes from `handle.stat()` (opened inode);
      stream-setup catch closes the handle; route header doc updated.
- [x] 5 new ordering/leak contract cases in
      `refund-clears-download-token.test.ts`; the legacy
      `createReadStream(path)` matcher updated.
**Done:** commit `5f4f1e4b`.

## Task 7 — HARD-R4C4-07 + TEST-R4C4-14: smart-collections scalar value validation
**Files:** `apps/web/src/lib/smart-collections.ts:301-346`, existing
smart-collections test suite
- [x] `isScalarValue` helper enforced on `value` (scalar/contains/tag),
      `lo`/`hi` (between), and every `values[]` element (in); rejects with
      the typed `SmartCollectionQueryError`.
- [x] 8 new reject/accept cases in `smart-collections.test.ts`.
**Done:** commit `2cf56d8f`.

## Task 8 — DOC-R4C4-08: document the blocking typecheck gate
**Files:** `CLAUDE.md` (Testing section), `AGENTS.md` (quality gates)
- [x] Added to CLAUDE.md Testing + AGENTS.md quality gates with the
      includes-__tests__ caveat.
**Done:** commit `8c03c7d9`.

## Task 9 — LOW-R4C4-09: trailing-dot FQDN referrer normalization
**Files:** `apps/web/src/lib/analytics.ts:102-115`, existing analytics test
suite
- [x] Trailing root-dot stripped before the split (both return paths use
      the normalized host); 4 new cases in `analytics.test.ts`.
**Done:** commit `5908f3f9`.

## Task 10 — Gates + deploy (per-cycle)
- [x] ALL gates green on the final tree: eslint 0/0 · typecheck (app +
      scripts) PASS · vitest 1616/1616 (165 files) · lint:api-auth PASS ·
      lint:action-origin PASS · lint:public-route-rate-limit PASS ·
      production build exit 0 (Compiled successfully) · playwright e2e
      20 passed / 2 skipped (admin-spec + CI-only origin-guard skips by
      design). Two gate failures surfaced and fixed at root: the cycle6
      P390-03 and cycle8 P394-01 source contracts pinned the exact pre-fix
      source shapes that R4C4-02/R4C4-06 deliberately changed — both
      updated to the new shapes with intent preserved (commit `0fd0c53d`).
- [x] SW_VERSION refreshed (`e8d8d6ec` + trailing stamp).
- [x] Ralph reviewer pass: APPROVED (full session-diff re-read against
      acceptance criteria; nested reviewer agents unavailable in the
      subagent context — documented constraint). Deslop pass run via
      ai-slop-cleaner --review: APPROVED, zero follow-ups (no dead code /
      unused exports / wrappers introduced; close() one-liners deliberately
      not abstracted). Post-deslop regression = the full green gate run
      above (deslop made no edits).
- [x] `npm run deploy` (per-cycle) — see final status.

**Status update (end of cycle):** all 10 tasks complete — 9 findings fixed
with 30 new/updated test cases across 10 suites; gates green; deployed
per-cycle.
