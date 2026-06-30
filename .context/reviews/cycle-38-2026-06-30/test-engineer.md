# Cycle 38 Test/Verifier Review

Cycle: 38/100
Date: 2026-06-30 KST
Reviewed HEAD: `564a7679`

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, custom gates, scanner fixtures, typecheck/test config, E2E surface, prior review artifacts, and high-risk action/route contracts.

Evidence run by the lane:

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- Targeted Vitest: 5 files, 169 tests passed.

## Findings

### C38-TEST-01 - Exempt read-only admin actions can skip auth in the lint gate

Severity: Medium
Confidence: High

File/line:

- `apps/web/scripts/check-action-origin.ts:710`
- `apps/web/src/__tests__/check-action-origin.test.ts:462`

The action-origin scanner accepts any non-mutating `@action-origin-exempt` export as a skip. The fixture explicitly locks a `db.select()` getter with no auth as valid. Current source getters do call `isAdmin()` or `getCurrentUser()`, but the gate does not enforce that.

Failure scenario: a future read-only admin getter returns admin data from `db.select()` without an auth check and still passes `lint:action-origin`.

Suggested fix: require exempt admin getters to call `isAdmin()`, `getCurrentUser()`, or `requireSameOriginAdmin()` before protected reads, with carve-outs for auth primitives and intentional public actions.

### C38-TEST-02 - Imported side-effect detection is prefix-based and misses real helper names

Severity: Medium
Confidence: High

File/line:

- `apps/web/scripts/check-action-origin.ts:294`
- `apps/web/scripts/check-public-route-rate-limit.ts:58`
- `apps/web/src/app/actions/images.ts:7`
- `apps/web/src/app/actions/images.ts:370`

Both scanners classify imported side-effect calls through a name-prefix regex. A probe using `persistThing()` before `requireSameOriginAdmin()` passed, and a real helper outside the prefix set exists: `saveOriginalAndGetMetadata`, which performs file writes but is currently called after the guard.

Failure scenario: a future refactor moves an imported side-effect helper with a non-matching name before a same-origin guard or public limiter, and the gate stays green.

Suggested fix: defer a broader fail-closed imported-call model or reviewed pure-import allowlist. A prefix-only tweak is likely to keep missing siblings.

### C38-TEST-03 - Public route scanner ignores exported handler identifier aliases

Severity: Medium
Confidence: High

File/line:

- `apps/web/scripts/check-public-route-rate-limit.ts:489`
- `apps/web/scripts/check-public-route-rate-limit.ts:535`

The public route rate-limit scanner only treats variable exports as handlers when the initializer is function-like. `export const POST = handler` and `export const GET = handler` can therefore disappear from the audit even when the local handler mutates or does expensive DB work.

Failure scenario: a future public route writes `const handler = async () => db.insert(...); export const POST = handler;`; Next can execute it, but `lint:public-route-rate-limit` reports no protected handler and passes.

Suggested fix: resolve exported identifier aliases to local function bodies, audit them under the exported HTTP method name, and fail closed on unresolved aliases.
