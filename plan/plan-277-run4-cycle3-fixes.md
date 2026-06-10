# Plan 277 — Run-4 Cycle 3 fixes

**Source review:** `.context/reviews/run4-cycle3/_aggregate.md` (per-angle files
alongside). Every non-deferred finding from the run-4 cycle-3 review is scheduled
here; the sole deferral lives in `plan/plan-278-run4-cycle3-deferred.md`.

Repo policy bindings (CLAUDE.md): GPG-signed commits (`-S`), Conventional
Commits + gitmoji, fine-grained per-fix commits, pull --rebase before push,
per-iteration deploy via `npm run deploy` after green gates, no suppressions.

## Task 1 — Fix HEAD pass-through on the primary uploads route (COR-R4C3-01, MED/High; folds ARCH-R4C3-06 + TEST-R4C3-07)
- File: `apps/web/src/app/uploads/[...path]/route.ts:15-22` — pass `'HEAD'` as
  the third argument in the HEAD export (and `'GET'` explicitly in GET for
  symmetry with the locale twin); replace the stale pre-R20-L1 comment with the
  twin's R20-L1 rationale.
- Add source-contract wiring test `apps/web/src/__tests__/uploads-route-method-wiring.test.ts`
  asserting BOTH route files' HEAD exports invoke `serveUploadFile(..., 'HEAD')`
  and GET exports pass `'GET'` (drift guard for the twin pair — the architect
  angle's chosen alternative to a refactor).

## Task 2 — Restore the settings-hash debounce on the image-serving hot path (PERF-R4C3-05, MED/High)
- File: `apps/web/src/lib/serve-upload.ts:125-127` — stop issuing a per-request
  `admin_settings` SELECT for ETag computation. Add a module-scoped 5 s TTL +
  inflight-dedupe cache around the resolved config + hash pair (preserving
  R8-H1 validated-value hashing): e.g. local `getServingColorSettingsHash()`
  that calls `getGalleryConfig()` → `getColorSettingsHash(config)` behind the
  TTL. On error, fall back to the previous cached value or the no-arg
  `getColorSettingsHash()` (which carries FALLBACK_HASH semantics) so a
  misbehaving DB cannot stall image responses.
- File: `apps/web/src/lib/settings-hash.ts:96-113` — update the docstring to
  describe the actual contract (config-arg path bypasses the internal cache;
  callers on hot paths must debounce — and serve-upload now does).
- Test: extend/add unit coverage asserting the serving helper does not refetch
  within the TTL window and refreshes after it (vi.useFakeTimers pattern, as in
  existing settings-hash tests).

## Task 3 — Gate webhook success logs on true insert (COR-R4C3-02, MED/Medium; folds TEST-R4C3-08)
- File: `apps/web/src/app/api/stripe/webhook/route.ts:336-387` — capture the
  insert result; derive `affectedRows` from the ResultSetHeader; only log
  `Entitlement created` and the `LOG_PLAINTEXT_DOWNLOAD_TOKENS`-gated
  `[manual-distribution]` line when `affectedRows === 1` (fresh insert). On the
  dup-key-loser path log the idempotent-skip info line instead (mirrors the
  SELECT-path skip). MySQL semantics: 1 = insert; 0/2 = dup-key update (no-op
  set lands on 0 without CLIENT_FOUND_ROWS) — never 1 for the loser.
- Test: extend `apps/web/src/__tests__/stripe-webhook-source.test.ts` with
  source-contract assertions that the two log lines are gated on the
  affectedRows check.

## Task 4 — Mirror no-store defaults on the withAdminAuth token path (SEC-R4C3-04, LOW-MED/High; folds TEST-R4C3-09)
- File: `apps/web/src/lib/api-auth.ts:63-79` — on the token-auth success
  response, apply the same defense-in-depth defaults as the cookie path:
  `Cache-Control: no-store, no-cache, must-revalidate` + `Pragma: no-cache`
  when absent (nosniff already applied). Verified non-breaking: the only
  token-scoped route sets its own headers, preserved by the `has()` guard.
- Test: new `apps/web/src/__tests__/api-auth-response-headers.test.ts` unit test
  mocking `verifyToken`/`isAdmin` and asserting the header defaults on BOTH auth
  branches for a handler that returns a bare 200.

## Task 5 — Align the download usedRow heuristic with its documented intent (COR-R4C3-03, LOW/High; folds TEST-R4C3-10)
- File: `apps/web/src/app/api/download/[imageId]/route.ts:92-99` — add
  `isNotNull(entitlements.downloadedAt)` to the usedRow WHERE so
  refunded-never-downloaded rows (hash cleared by `refundEntitlement`,
  `downloadedAt` NULL) no longer mislabel mistyped tokens as 410
  "Token already used"; they fall through to the accurate 404.
- Test: extend `apps/web/src/__tests__/refund-clears-download-token.test.ts`
  with a source-contract assertion that the usedRow SELECT carries both
  `isNull(downloadTokenHash)` and `isNotNull(downloadedAt)`.

## Task 6 — Gates + deploy
- Run ALL gates on the whole repo: eslint, typecheck, vitest, lint:api-auth,
  lint:action-origin, lint:public-route-rate-limit, production build,
  playwright e2e. Fix anything that surfaces; no suppressions.
- Then `npm run deploy` (DEPLOY_MODE=per-cycle), preceded by the SW_VERSION
  refresh convention if the build script requires it (build-sw runs in build).

## Progress
- [x] Task 1 — HEAD pass-through fixed on the primary uploads route + GET made
      explicit on both twins + `uploads-route-method-wiring.test.ts` drift
      guard (commit cd97b4b0)
- [x] Task 2 — module-scoped 5 s TTL + inflight dedupe restores the serving-path
      debounce (R8-H1 semantics preserved); settings-hash docstring now
      describes the two-form contract; locked by
      `serve-upload-settings-debounce.test.ts` (commit e0ce57bb)
- [x] Task 3 — webhook success logs gated on insert `affectedRows === 1`;
      dup-key loser mirrors the SELECT-path idempotent skip; contract locked
      in `stripe-webhook-source.test.ts` (commit 7fa8f18f)
- [x] Task 4 — token-auth branch now applies the C7-SEC-02 no-store/no-cache +
      Pragma defaults (has() guard preserves handler headers); both branches
      locked by `api-auth-response-headers.test.ts` (commit c7d3db1a)
- [x] Task 5 — usedRow heuristic requires `isNotNull(downloadedAt)`; query
      shape locked in `refund-clears-download-token.test.ts` (commit 74d70974)
- [ ] Task 6 — gates + deploy (in progress)
