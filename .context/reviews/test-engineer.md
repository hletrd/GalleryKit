# Cycle 34 Test-Engineer Review

Reviewer: test-engineer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `e1f124a265998ea51297d6716df6c03a2056a96c`
Date: 2026-06-30 KST
Scope: read-only test and lint-gate review. No source, tests, plans, git state, or commits were edited by this lane.

## Inventory

- Read `AGENTS.md`, `CLAUDE.md` testing/lint sections, root/app package scripts, Vitest and Playwright configs, current test layout, Cycle 33 test-engineer notes, and the `168c3837..HEAD` diff.
- Current test surface at review time:
  - Vitest tests under `apps/web/src/__tests__/`
  - Playwright specs under `apps/web/e2e/`
  - Source-reading/source-contract tests
  - Custom lint gates: `check-action-origin`, `check-api-auth`, `check-public-route-rate-limit`, `check-js-scripts`

## Findings

### TE34-01 - LR multipart parse limiter leaks its slot on quota-limit early returns

Severity: High
Confidence: High

Regions:

- `apps/web/src/app/api/admin/lr/upload/route.ts:130`
- `apps/web/src/app/api/admin/lr/upload/route.ts:147`
- `apps/web/src/app/api/admin/lr/upload/route.ts:183`
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:267`

`tryAcquireLrMultipartParseSlot()` is called before upload-tracker quota checks. If `tracker.count + 1 > UPLOAD_MAX_FILES_PER_WINDOW` or `tracker.bytes + declaredUploadBytes > MAX_TOTAL_UPLOAD_BYTES`, the route returns `429` before reaching the `finally { releaseMultipartParseSlot(); }` around `request.formData()`.

Regression scenario: one Lightroom upload already over the per-window count or byte limit acquires the singleton parse slot, returns `429`, and leaves `lrMultipartParseInFlight` at `1`. Every later LR upload receives "Another Lightroom upload is being parsed" until process restart.

Suggested fix: move slot acquisition after all pre-parse quota returns, or wrap every post-acquire return in a shared `try/finally`. Add coverage that the quota-exceeded path cannot leak the slot.

### TE34-02 - Auth action origin scanner accepts inverted `hasTrustedSameOrigin` guards

Severity: High
Confidence: High

Regions:

- `apps/web/scripts/check-action-origin.ts:501`
- `apps/web/scripts/check-action-origin.ts:513`
- `apps/web/src/__tests__/check-action-origin.test.ts:518`
- `apps/web/src/app/actions/auth.ts:99`

`expressionIsTrustedOriginCheck` strips an optional `!` and accepts either `hasTrustedSameOrigin(...)` or `!hasTrustedSameOrigin(...)`; `functionCallsAuthSameOriginGuard` then passes if the `then` branch exits. A fixture shaped as `if (hasTrustedSameOrigin(headers)) return ...; await db.update(...)` passed the scanner even though hostile origins fall through to mutation.

Regression scenario: a future auth refactor accidentally inverts the guard, causing trusted requests to exit and hostile cross-origin requests to fall through to session/user mutation while `npm run lint:action-origin` still passes.

Suggested fix: require the auth guard condition to be explicitly negated for the early-exit branch and add a negative fixture for the inverted positive condition.

## Final Sweep

Full lint/typecheck/build/test/e2e were not run in this read-only lane. Cycle 33 deferred findings were not re-raised except where current HEAD introduced fresh evidence.
