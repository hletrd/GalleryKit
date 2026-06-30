# Cycle 44 Test-Engineer / Verifier Review

Date: 2026-07-01
Start HEAD: `f417d86b` (`fix(cycle-43): 🐛 harden lint guard provenance`)

## Scope

Deep repository review for test coverage gaps, regression risks, invariant tests, flaky tests, fixture realism, and whether code behavior matches documented contracts.

Read before review:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-43-2026-07-01/_aggregate.md`
- `.context/plans/cycle-43-2026-07-01-plan.md`
- `.context/plans/cycle-43-2026-07-01-deferred.md`

Inventory completed:

- `apps/web/src/__tests__`: 285 files
- `apps/web/e2e`: 8 files
- `apps/web/scripts`: 29 files
- Public route scanner currently discovers route files beyond `src/app/api`, including upload/feed route handlers.
- Admin API scanner currently covers 2 admin route files.
- Action-origin scanner currently covers `app/actions/**`, `app/actions.ts`, and `app/[locale]/admin/db-actions.ts`.

Prior deferred items not re-raised: `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`.

## Findings

### TV-C44-01 — HIGH — `lint:action-origin` skips protected reads in exempt concise arrow actions

File: `apps/web/scripts/check-action-origin.ts:715`
File: `apps/web/scripts/check-action-origin.ts:1220`
Test gap: `apps/web/src/__tests__/check-action-origin.test.ts:1296`

The protected-read proof returns success for non-block bodies:

```ts
if (!ts.isBlock(body)) {
    return true;
}
```

That is reachable because exported async arrow actions with concise expression bodies are accepted by `functionInfoFromExpression`. For a reasoned `@action-origin-exempt` export, `evaluateBody` calls `exemptReadHasAuthBeforeProtectedRead(...)`; if the body is an expression, the function returns `true` before checking `nodeContainsProtectedRead`.

Verified false negative:

```ts
import { db } from '@/db';
/** @action-origin-exempt: read-only admin getter */
export const listSessions = async () => db.select().from(sessions);
```

`checkActionSource(...)` returns:

```json
{
  "passed": [],
  "failed": [],
  "skipped": [
    "SKIP (exempt comment): src/app/actions/admin-sessions.ts::listSessions"
  ]
}
```

The equivalent block-bodied action fails correctly with `EXEMPT READ WITHOUT AUTH`.

Failure scenario: a future refactor turns a read-only admin getter into a concise arrow export and leaves the exemption comment in place. The scanner stays green while the action performs an admin DB read without `isAdmin()`, `getCurrentUser()`, or `requireSameOriginAdmin()` dominance.

Suggested fix/test:

- Make `exemptReadHasAuthBeforeProtectedRead` fail closed or inspect expression bodies for protected reads unless it can prove an auth gate dominates them.
- Add fixtures for concise arrow exempt reads:
  - `export const listSessions = async () => db.select().from(sessions)` must fail.
  - `export const listSessions = async () => (await isAdmin()) ? db.select().from(sessions) : []` should fail unless dominance is modeled correctly.
  - Keep block-bodied authenticated read fixtures as passing controls.

Confidence: high. The scanner probe reproduces the false negative on current HEAD.

### TV-C44-02 — MEDIUM — `lint:public-route-rate-limit` accepts concise expensive GET/HEAD bodies when the limiter runs after expensive work

File: `apps/web/scripts/check-public-route-rate-limit.ts:624`
File: `apps/web/scripts/check-public-route-rate-limit.ts:628`
Test gap: `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:196`

For block-bodied expensive GET/HEAD handlers, `bodyCallsRateLimitBeforeExpensiveGetWork` walks statements and fails if expensive work appears before the limiter. For non-block bodies, it falls back to:

```ts
return bodyCallsApprovedRateLimit(body, approvedRateLimitImports);
```

That only proves an approved limiter call exists somewhere in the expression, not that it runs before the expensive read.

Verified false negative:

```ts
import { db } from '@/db';
import { preIncrementShareAttempt } from '@/lib/rate-limit';
export const GET = async () => (
  (await db.select().from(images)),
  preIncrementShareAttempt('1.2.3.4')
    ? new Response(null, { status: 429 })
    : Response.json({ ok: true })
);
```

`checkPublicRouteSource(...)` returns:

```json
{
  "passed": [
    "OK: src/app/api/foo/route.ts (expensive GET uses rate-limit helper for GET/HEAD handlers)"
  ],
  "failed": []
}
```

The equivalent block-bodied handler with `db.select()` before the limiter fails correctly.

Failure scenario: a future public expensive GET/HEAD route uses a concise arrow expression, performs DB/image/filesystem/embedding work before a later limiter call, and passes `lint:public-route-rate-limit`. That weakens the documented “pre-increment before expensive work” contract and can expose expensive unauthenticated work.

Suggested fix/test:

- Fail closed for non-block expensive GET/HEAD bodies, or implement expression-order proof for conditional/comma/await expressions.
- Add fixtures that must fail:
  - concise `GET` with `db.select()` before a limiter in a comma expression.
  - concise `HEAD` with the same shape.
- Add a passing concise-body control only if the scanner can prove limiter dominance.

Confidence: high. The scanner probe reproduces the false negative on current HEAD.

## No New Finding Areas

- `lint:api-auth`: no new issue found in the focused review. Current source uses direct `withAdminAuth(...)` exports for both admin API routes, and the scanner fails current unsupported alias/function-declaration patterns.
- i18n parity: no new issue found. The key-set parity gate matches the documented English/Korean value-shape asymmetry.
- Privacy guards: no new issue found. The symmetric image-field privacy guard still covers public/timeline/search-enrichment select drift.
- Touch-target audit: no new surviving finding from this pass. The scanner remains heuristic-heavy, but no concrete current-source mismatch survived beyond already documented pattern-scan limitations.
- E2E: no new finding. This review focused on source-level invariant tests and scanner coverage, not browser-flow expansion.

## Validation Evidence

Commands run:

```bash
npm test --workspace=apps/web -- check-action-origin.test.ts check-public-route-rate-limit.test.ts check-api-auth.test.ts i18n-key-parity.test.ts privacy-fields.test.ts touch-target-audit.test.ts
npm run lint:action-origin --workspace=apps/web
npm run lint:public-route-rate-limit --workspace=apps/web
npm run lint:api-auth --workspace=apps/web
```

Results:

- Focused Vitest: 6 files passed, 213 tests passed.
- `lint:action-origin`: passed on current source.
- `lint:public-route-rate-limit`: passed on current source.
- `lint:api-auth`: passed on current source.

Synthetic probes:

- `checkActionSource` skips an exempt concise arrow protected DB read with no auth.
- `checkPublicRouteSource` passes a concise expensive GET/HEAD body where DB work runs before the limiter.

No source files were edited.
