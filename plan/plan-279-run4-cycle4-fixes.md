# Plan 279 — Run-4 Cycle 4 fixes

**Source review:** `.context/reviews/run4-cycle4/_aggregate.md` (15 findings:
9 fix items, 6 test gaps folded into their parent fixes, 0 new deferrals).
Per-angle provenance in the same directory. Repo policy: GPG-signed commits,
Conventional Commits + gitmoji, per-iteration push, per-cycle deploy, no
suppressions. HARD-SCOPE: no edit/culling/scoring features.

## Task 1 — PERF-R4C4-01 + TEST-R4C4-10: stale-while-revalidate for the serving-path settings-hash debounce
**Files:** `apps/web/src/lib/serve-upload.ts:42-71`,
`apps/web/src/__tests__/serve-upload-settings-debounce.test.ts`
- [ ] When `servingHashCache` exists (fresh OR stale), return its hash
      immediately; if stale, kick the refresh inflight WITHOUT awaiting it
      (swallow rejections — failure semantics unchanged: keep last hash).
- [ ] Only await the inflight when NO hash has ever been resolved (cold
      start) — preserves the burst=1-SELECT contract.
- [ ] Update the module docstring: the "misbehaving DB cannot stall image
      responses" claim becomes true; document the skew bound (≤ 5 s + one
      refresh latency).
- [ ] Tests: keep burst=1 + ETag-hash cases; rework the TTL case to assert
      the refetch is triggered (call count) while the stale-window response
      resolves immediately; add a resolve-order case with a hung config
      promise proving the response does not await the refresh.

## Task 2 — COR-R4C4-02 + TEST-R4C4-11: converge DB state on `charge_already_refunded`
**Files:** `apps/web/src/app/actions/sales.ts:215-233`, test file that owns
the refund surface (`refund-clears-download-token.test.ts` or a new
behavioral sales test)
- [ ] In `refundEntitlement`'s catch: when `mapStripeRefundError(err) ===
      'already-refunded'`, run the same convergence UPDATE (`refunded: true,
      downloadTokenHash: null` WHERE id) in a nested try; on success return
      `{ success: true }`; if the convergence UPDATE fails, fall through to
      the existing error return (severity preserved).
- [ ] Structured log line for the convergence (entitlementId key) so
      operators see the reconciliation happened via the error path.
- [ ] Tests: charge_already_refunded → convergence UPDATE issued + success
      returned; convergence-UPDATE-failure → original errorCode preserved;
      happy path unchanged.

## Task 3 — COR-R4C4-03 + TEST-R4C4-12: contain the LR route's post-save throw window
**Files:** `apps/web/src/app/api/admin/lr/upload/route.ts:286-392`, extend
`lr-upload-hdr-gate.test.ts` or add `lr-upload-containment.test.ts`
- [ ] Widen the existing insert try block to open BEFORE
      `extractExifForDb(...)` so its catch (delete original + settle(false)
      + JSON 500 'Upload failed') contains `extractExifForDb`,
      `stripGpsFromOriginal`, `cleanupOriginalIfRestoreMaintenanceBegan`,
      `assertBlurDataUrl`, and the insert. The HDR-reject / restore-503
      early-returns inside the widened block settle themselves and return —
      verify they stay correct (no double-settle from the catch).
- [ ] Rename the catch log to reflect the wider scope ('LR upload:
      post-save processing failed').
- [ ] Test: force a throw inside the widened window (e.g. blur-data-url
      producer drift) → expect JSON `{error:'Upload failed'}` 500, original
      deleted, tracker settled back to zero.

## Task 4 — UX-R4C4-04 + TEST-R4C4-13: tokens-client Enter-key pending guard
**Files:**
`apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:44,155`,
`apps/web/src/__tests__/client-source-contracts.test.ts`
- [ ] `if (isPending) return;` first line of `handleCreate`; Enter handler
      gains `e.preventDefault()` (match image-manager/topic-manager
      siblings).
- [ ] Source-contract test pinning both (pending check + preventDefault) in
      the tokens-client Enter path.

## Task 5 — I18N-R4C4-05: localize lr-tokens action error strings
**Files:** `apps/web/src/app/actions/lr-tokens.ts`,
`apps/web/messages/en.json`, `apps/web/messages/ko.json`,
`apps/web/src/__tests__/lr-tokens-action.test.ts`
- [ ] Add `serverActions` keys (en + ko): scope-required, invalid-label,
      invalid-expiry, expiry-in-past, create-failed, token-not-found;
      replace the seven hardcoded literals with `t(...)`.
- [ ] Keep the generic-error posture (no driver detail added).
- [ ] Update test expectations (the suite's `getTranslations` mock returns
      the key, so assertions become key strings — mechanical).

## Task 6 — COR-R4C4-06 + TEST-R4C4-15: download route — open the file handle BEFORE the single-use claim
**Files:** `apps/web/src/app/api/download/[imageId]/route.ts:169-282`,
extend the test file that owns this surface or add
`download-route-claim-order.test.ts`
- [ ] After the realpath containment check, `fsp.open(resolvedFilePath,
      'r')` — ENOENT → 404 'File not found' with the token UNCONSUMED
      (replaces the unreachable post-claim ENOENT mapping; completes the
      C3-RPF-05 intent).
- [ ] Perform the atomic claim; on `affected === 0` (already used) CLOSE
      the handle before returning 410.
- [ ] Stream via the handle's `createReadStream()` so the bytes come from
      the validated open file (also closes the residual lstat→open swap
      window); ensure the handle cannot leak on any path.
- [ ] Update the now-stale catch comment; keep the structured error log.
- [ ] Test: lock the ordering (open precedes claim; ENOENT-at-open leaves
      downloadedAt NULL / token unconsumed; 410 path closes the handle).

## Task 7 — HARD-R4C4-07 + TEST-R4C4-14: smart-collections scalar value validation
**Files:** `apps/web/src/lib/smart-collections.ts:301-346`, existing
smart-collections test suite
- [ ] In `validateNode`: `value` must be `string` or finite `number` for
      scalar/contains/tag predicates; `lo`/`hi` likewise for between; every
      `values[]` element likewise for in. Reject otherwise with
      `SmartCollectionQueryError` (typed, already handled by callers).
- [ ] Tests: reject object/array/null/NaN forms for value, lo/hi, and
      values[] elements; accept string + number forms.

## Task 8 — DOC-R4C4-08: document the blocking typecheck gate
**Files:** `CLAUDE.md` (Testing section), `AGENTS.md` (quality gates)
- [ ] Add `npm run typecheck --workspace=apps/web` to both lists, noting it
      runs `typecheck:app` (tsconfig.typecheck.json — includes `__tests__`)
      + `typecheck:scripts`.

## Task 9 — LOW-R4C4-09: trailing-dot FQDN referrer normalization
**Files:** `apps/web/src/lib/analytics.ts:102-115`, existing analytics test
suite
- [ ] Strip a single trailing dot from the host before the TLD+1 split; add
      `github.com.` → `github.com` and `sub.bbc.co.uk.` → `bbc.co.uk` cases.

## Task 10 — Gates + deploy (per-cycle)
- [ ] Run ALL gates on the final tree: eslint, typecheck, vitest,
      lint:api-auth, lint:action-origin, lint:public-route-rate-limit,
      production build, playwright e2e. Fix anything red at root cause (no
      suppressions).
- [ ] Refresh SW_VERSION if any commit landed (repo convention: build(sw)
      refresh after substantive commits).
- [ ] `npm run deploy` once after gates are green (DEPLOY_MODE per-cycle).

**Status:** plan written from the run4-cycle4 reviews; implementation not
yet started. Progress will be updated per task with real commit hashes.
