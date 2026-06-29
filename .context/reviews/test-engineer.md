# Cycle 16 Test-Engineer Review

Date: 2026-06-30 KST
HEAD: `7506661e`
Scope: current HEAD of `/Users/hletrd/flash-shared/gallery`
Lane: test-engineer, cycle 16/100

## Inventory Summary

Reviewed repo-wide test and gate surfaces with exhaustive file enumeration and targeted full reads of the gate/risk code paths, not a sampled subset.

- Vitest: 262 `apps/web/src/__tests__/**/*.test.{ts,tsx}` files.
- Playwright: 5 specs in `apps/web/e2e/`: `admin`, `public`, `origin-guard`, `nav-visual-check`, `test-fixes`.
- Route handlers: 12 `route.*` files, including 2 admin API routes and 6 public API routes.
- Server actions: 13 files in `apps/web/src/app/actions/` plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Scripts: 27 files in `apps/web/scripts/` plus root `scripts/deploy-remote.sh`.
- Blocking custom gates: `check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, `check-js-scripts.mjs`, migration/reconcile source tripwires, touch-target audit, focus-visible scanner, privacy-field guards, client/server boundary scans.
- Highest-density unit coverage areas: image processing/color/HDR, upload actions, public analytics/rate limits, auth/session/rate limits, migrations/reconcile, semantic search, admin actions, UI accessibility scanners, PWA/service worker contracts.

Validation run during this review:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run typecheck:scripts --workspace=apps/web` passed, including JS syntax check of 7 JavaScript scripts.

I did not run full `npm test`, `npm run build`, or Playwright e2e because this lane is a HEAD review/report pass and the requested output is the review artifact. The custom security gates above were run because they are central to the findings.

## Confirmed Issues

### TE16-01. Public API rate-limit scanner misses mutations hidden behind local helpers

Severity: Medium
Confidence: High
Status: confirmed gate correctness issue, no current route instance found

Evidence:
- `apps/web/scripts/check-public-route-rate-limit.ts:124-127` defines a mutation only as a property-access call whose method name is in `MUTATING_CALL_METHOD_NAMES`.
- `apps/web/scripts/check-public-route-rate-limit.ts:205-231` scans handler statements for those direct property-access mutations and returns pass when a rate-limit gate was seen and no direct pre-gate mutation was seen.
- The fixture suite checks direct `db.insert(...)` before the helper, nested helper calls, comments, unreachable branches, and ignored rate-limit results at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:196-323`, but there is no fixture for a local function that mutates before the helper.

Failure scenario:
A future public mutating API route can define `async function writeView() { await db.insert(views).values(...) }`, then call `await writeView(); if (preIncrementFoo(ip)) return 429;`. The scanner sees no direct `.insert(...)` before the gate, then sees the approved helper, and the route passes while the durable write is unmetered.

Suggested fix:
TDD first: add a fixture to `check-public-route-rate-limit.test.ts` where an exported `POST` calls a local mutating helper before the rate-limit branch and assert `MISSING RATE LIMIT`. Then reuse the local-mutating-function collection pattern from `check-action-origin.ts` (`nodeContainsMutatingCall` plus identifier-call recognition), or fail closed on pre-gate calls to local functions in mutating public handlers unless their bodies are proven non-mutating.

### TE16-02. Public action origin scanner ignores `catch` and `finally` blocks when accepting exempt public mutations

Severity: Medium
Confidence: High
Status: confirmed gate correctness issue, current catch blocks only log

Evidence:
- `apps/web/scripts/check-action-origin.ts:295-407` implements `publicActionCallsRateLimitBeforeMutation` for exempt public actions.
- `apps/web/scripts/check-action-origin.ts:391-393` special-cases `TryStatement` by processing only `statement.tryBlock.statements` and immediately returning. It never walks `catchClause` or `finallyBlock`.
- Current public analytics actions wrap the rate-limited write path in `try/catch` and the catches only warn: `apps/web/src/app/actions/public.ts:365-388`, `apps/web/src/app/actions/public.ts:392-419`, `apps/web/src/app/actions/public.ts:423-455`.
- The positive fixture explicitly blesses the `try { rate limit; insert } catch {}` shape at `apps/web/src/__tests__/check-action-origin.test.ts:591-604`, but there is no negative fixture where `catch` or `finally` performs a mutation.

Failure scenario:
A future edit to an exempt public analytics action adds fallback persistence in `catch` or cleanup persistence in `finally`, for example `catch { await db.insert(audit).values(...) }`. The scanner would process the `try` body, see the rate-limit gate before the first insert, skip the catch/finally entirely, and report `OK (public rate-limited action)` while the fallback mutation is not proven rate-limited.

Suggested fix:
TDD first: add fixtures for `catch { db.insert(...) }` and `finally { db.insert(...) }` after a rate-limited `try` body and assert failure. Then make `processStatement` traverse `catchClause.block.statements` and `finallyBlock.statements` with the current `sawRateLimitGate` state reset or conservatively require any catch/finally mutation to carry its own rate-limit dominance.

### TE16-03. Touch-target audit budgets by per-file counts, so it can miss replacement violations in the same file

Severity: Low
Confidence: High
Status: confirmed test design weakness

Evidence:
- `apps/web/src/__tests__/touch-target-audit.test.ts:183-199` and `apps/web/src/__tests__/touch-target-audit.test.ts:229-238` allow nonzero violation counts for several files.
- The assertion compares only aggregate issue count per file: `issues.length > allowed` at `apps/web/src/__tests__/touch-target-audit.test.ts:764-775`, and stale budgets only fail when `actual < allowed` at `apps/web/src/__tests__/touch-target-audit.test.ts:778-788`.

Failure scenario:
If `components/admin-user-manager.tsx` has two allowed hits, one allowed button is fixed while a new compact button is introduced elsewhere in the same file. The actual count remains two, so neither `actual > allowed` nor `actual < allowed` fires. The report text says "NEW violation lands as a hard failure", but the predicate only proves count stability.

Suggested fix:
TDD first: add a small in-memory scanner fixture demonstrating "one known issue removed, one new issue added" should fail. Replace count budgets with stable issue signatures: file plus normalized snippet, line-nearby anchor, or a named exemption marker adjacent to the specific JSX node. Keep the stale-budget check, but compare sets rather than counts.

## Likely Issues

### TE16-04. Read-only public server-action rate limits are enforced by individual tests, not by the action-origin gate

Severity: Low
Confidence: Medium
Status: likely coverage/gate-policy gap

Evidence:
- `lint:action-origin` currently skips `loadMoreImages`, `loadMoreSmartCollectionImages`, and `searchImagesAction` because they carry `@action-origin-exempt` and do not directly mutate. The run output showed those three as `SKIP (exempt comment)`.
- The current implementation does rate-limit them: `loadMoreImages` calls `checkLoadMoreRateLimit` before `getImagesLite` at `apps/web/src/app/actions/public.ts:136-148`; `searchImagesAction` increments/checks the search bucket before `searchImages` at `apps/web/src/app/actions/public.ts:251-300`.
- Behavioral tests exist for current functions, for example `apps/web/src/__tests__/public-actions.test.ts:228-239` and `apps/web/src/__tests__/load-more-rate-limit.test.ts:89-143`.

Failure scenario:
A future expensive read-only public action can add `@action-origin-exempt: public read-only ... with its own rate limit` and omit the rate limit entirely. The generic action gate will skip it. It will only be caught if the author also writes a dedicated behavioral/source test, which is not enforced by the custom gate.

Suggested fix:
TDD first: add a scanner fixture for a public exempt read-only action with a "rate limit" exemption reason but no rate-limit call. Then extend `check-action-origin.ts` to parse public-action exemption intent, or add a separate public server-action rate-limit scanner covering expensive public read actions in `actions/public.ts`.

## Manual-Validation Risks

- Lightroom PAT upload path: most coverage is source-contract based because the route is multipart, token-authenticated, Sharp-backed, and queue/DB-heavy. The test itself states this at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-15`, while browser upload has a real Playwright workflow at `apps/web/e2e/admin.spec.ts:132-160`. Risk: route compiles and contracts hold, but a multipart/auth/queue integration break can still escape without a token-auth e2e smoke.
- Database backup/restore: unit/source tests cover dump header validation and restore cleanup ownership at `apps/web/src/__tests__/db-restore.test.ts:42-65`, and Playwright only navigates to the DB page/input at `apps/web/e2e/admin.spec.ts:36-42`. Risk: full restore is intentionally destructive and not covered by default e2e, so mysql CLI, advisory-lock, import, migration, and post-restore UI behavior need a disposable-DB manual/e2e lane.
- CLIP production semantic path: default tests cover config/path/source contracts, but real offline model loading is gated by `CLIP_OFFLINE_LOAD=1` and seeded weights at `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`; semantic ranking is gated by `CLIP_INTEGRATION=1` at `apps/web/src/__tests__/clip-semantic-integration.test.ts:7-31`. Risk: normal CI can pass while the production weight volume or native runtime is broken.
- Admin Playwright coverage is environment-dependent: `apps/web/e2e/admin.spec.ts:6-12` skips admin workflows unless admin E2E credentials are enabled, with a CI assertion. Risk is acceptable if CI always sets the required credentials; local `npm run test:e2e` can otherwise give a public-only signal.

## TDD Opportunities

- Add scanner-regression fixtures before changing the scanner implementations: local-helper public route mutation, catch/finally public action mutation, and touch-target replacement violation.
- Add one token-authenticated Lightroom upload Playwright/API smoke against the disposable E2E DB: create PAT with `lr:upload`, multipart upload the existing fixture, wait for processing, delete the uploaded row/files through existing cleanup paths.
- Add an opt-in disposable restore e2e lane that dumps, restores into an isolated DB name matching the E2E safety pattern, verifies migration postconditions, then tears down.
- Promote CLIP offline/ranking checks to a scheduled or opt-in CI job with seeded model cache, rather than relying on default skipped tests.

## Final Missed-Issues Sweep

- Cross-checked package scripts, Vitest config, Playwright config, TypeScript script gates, custom scanner implementations, scanner fixtures, server actions, route handlers, E2E helpers, seed/destructive guards, migration journal/reconcile tripwires, upload/LR/restore tests, public analytics/search/load-more tests, and UI accessibility scanners.
- No current unguarded admin API route or missing same-origin action was found: the three custom lint gates passed on HEAD.
- No current production behavior defect is asserted from TE16-01 or TE16-02; both are gate false-negative shapes that can let future changes pass incorrectly.
- Remaining risk is concentrated in source-contract-heavy integration paths and gated tests: Lightroom PAT upload, full DB restore, and real CLIP model loading/ranking.
