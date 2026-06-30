# Cycle 41 verifier + test-engineer review

Scope: deep review only, no implementation. Focused on test inventory, fixture scanners, source-contract tests, quality gates, and recent drift at current HEAD `ae71bd5a`.

## Inventory

- Blocking gates from `AGENTS.md` / `CLAUDE.md`: ESLint, `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, `typecheck`, `build`, Vitest, and Playwright E2E when browser-flow coverage is required.
- Package scripts: root `package.json` forwards `lint`, `typecheck`, `test`, `test:e2e`, and the three custom lint gates to `apps/web`; `apps/web/package.json` runs Vitest, Playwright, Next typegen + `tsc`, and the scanner scripts.
- Unit test surface: 277 Vitest test files under `apps/web/src/__tests__/`.
- E2E surface: 5 Playwright specs under `apps/web/e2e/`; admin flows are environment-gated (`CI=true`, `E2E_ADMIN_ENABLED=true`).
- Source-contract / fixture-style surface: 116 test files either source-read or source-contract-oriented. These include many brittle string pins, plus executable scanner fixture suites.
- Custom scanner / guard tests identified: `check-api-auth.test.ts`, `check-action-origin.test.ts`, `check-public-route-rate-limit.test.ts`, `touch-target-audit.test.ts`, `focus-visible-links-scan.test.ts`, and the cycle-specific focus-ring tests.
- Recent drift since Cycle 33 is concentrated in custom scanner hardening, SW cache template/cache parity, backfill delete/detection races, Lightroom upload token/HDR behavior, and Cycle 40 download label/HDR UI copy.

Targeted commands run:

```text
npm run lint:public-route-rate-limit --workspace=apps/web
npm run lint:action-origin --workspace=apps/web
npm run lint:api-auth --workspace=apps/web
```

All three passed on current HEAD. The findings below are gate blind spots proven with focused fixtures, not active violations in the current route/action files.

## Findings

### MEDIUM: public route rate-limit scanner accepts inverted limiter conditions

Files:
- `apps/web/scripts/check-public-route-rate-limit.ts:287`
- `apps/web/scripts/check-public-route-rate-limit.ts:321`
- `apps/web/scripts/check-public-route-rate-limit.ts:407`
- `apps/web/scripts/check-public-route-rate-limit.ts:441`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:181`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:697`

The scanner treats a public route as gated when an `if` condition contains an approved pre-increment helper and the `then` branch returns. It does not prove that the returning branch is the over-limit branch. A future handler can invert the condition:

```ts
if (!preIncrementShareAttempt(ip)) return new Response('limited', { status: 429 });
await db.insert(rows).values({ ok: true });
```

That rejects under-limit callers and lets over-limit callers continue to the mutation. I confirmed the current scanner reports this fixture as:

```json
{ "passed": ["OK: route.ts (uses rate-limit helper)"], "failed": [] }
```

Existing fixtures cover correct direct calls, captured results, ignored results, delayed limiter calls, and inverted local wrapper helpers, but not direct `!preIncrement...` / `overLimit === false` / `false === overLimit` conditions.

Suggested fix: make `statementHasRateLimitGate` accept only positive over-limit checks for direct calls and captured limiter variables, reject negated expressions and equality-to-false shapes, and add failing fixtures for direct inversion in both mutating handlers and expensive GET handlers.

Confidence: high.

### MEDIUM: public expensive-GET detection misses aliased `db` imports

Files:
- `apps/web/scripts/check-public-route-rate-limit.ts:60`
- `apps/web/scripts/check-public-route-rate-limit.ts:78`
- `apps/web/scripts/check-public-route-rate-limit.ts:499`
- `apps/web/scripts/check-public-route-rate-limit.ts:515`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:168`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:345`

Expensive GET detection catches unaliased `db.` through a text marker and catches imported data helper calls by identifier / namespace. It does not treat property accesses on named imports from `@/db` as expensive when the import is aliased:

```ts
import { db as database } from '@/db';
export async function GET() {
  const rows = await database.select().from(images).limit(10);
  return Response.json({ rows });
}
```

I confirmed the current scanner reports this as:

```json
{
  "passed": ["OK: route.ts (no mutating or expensive GET handlers; HEAD is treated as an expensive read)"],
  "failed": []
}
```

Failure scenario: a new public GET route performs a DB scan under an alias and ships without a limiter or exemption while `lint:public-route-rate-limit` stays green. This is plausible because the script already supports alias-aware imports for rate-limit helpers and for named data helpers, so an aliased DB import looks like ordinary TypeScript style rather than suspicious code.

Suggested fix: when collecting expensive imports from `@/db`, preserve local names and mark property-access calls on those identifiers as expensive, not only bare identifier calls. Add fixtures for `import { db as database }`, namespace DB imports, and an unapproved local object named `db` to avoid false positives.

Confidence: high.

### MEDIUM: action-origin scanner misses aliased pre-origin auth/session reads

Files:
- `apps/web/scripts/check-action-origin.ts:308`
- `apps/web/scripts/check-action-origin.ts:392`
- `apps/web/scripts/check-action-origin.ts:622`
- `apps/web/src/__tests__/check-action-origin.test.ts:197`
- `apps/web/src/__tests__/check-action-origin.test.ts:763`

The action-origin scanner blocks `isAdmin()`, `getCurrentUser()`, and `getSession()` before `requireSameOriginAdmin()` by matching hard-coded callee names. It does not collect approved auth imports or their local aliases. This fixture passes today:

```ts
import { requireSameOriginAdmin } from '@/lib/action-guards';
import { isAdmin as canAdmin } from '@/lib/auth';

export async function deleteFoo(id) {
  if (!(await canAdmin())) return { error: 'unauthorized' };
  const originError = await requireSameOriginAdmin();
  if (originError) return { error: originError };
  await db.delete(foo).where(eq(foo.id, id));
}
```

Confirmed scanner output:

```json
{ "passed": ["OK: actions/fixture.ts::deleteFoo"], "failed": [], "skipped": [] }
```

Failure scenario: a future mutating server action can read session/admin state before origin provenance if the imported auth helper is locally renamed. The current tests only cover unaliased `isAdmin()` / `getCurrentUser()` names, so the regression lock is incomplete.

Suggested fix: collect local names for `isAdmin`, `getCurrentUser`, and `getSession` from the modules that actually export them, use that set in `statementContainsPreOriginAuthRead`, and add alias fixtures for normal actions and `auth.ts`-specific flows.

Confidence: high.

## Notes

- I did not run the full gate suite, build, or Playwright suite per lane instructions.
- I avoided carry-forward deferred items from Cycle 40 unless the inspection produced new evidence. The three findings above are newly reproduced fixture gaps in current HEAD.
