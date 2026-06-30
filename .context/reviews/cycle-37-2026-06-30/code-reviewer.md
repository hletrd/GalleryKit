# Cycle 37 Code Reviewer Review

Reviewed HEAD: `d6c3a8f69911c84a63985a59827d4597def922d4`
Date: 2026-06-30 KST
Lane: code-reviewer

## Inventory

Guidance and prior-cycle context:
- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`
- `.context/reviews/cycle-36-2026-06-30/_aggregate.md`
- `.context/reviews/cycle-36-2026-06-30/code-reviewer.md`
- `.context/reviews/cycle-36-2026-06-30/security-reviewer.md`
- `.context/reviews/cycle-36-2026-06-30/test-engineer.md`
- `.context/reviews/cycle-36-2026-06-30/perf-reviewer.md`

Cycle-36 fix commit delta inspected:
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`
- `apps/web/src/__tests__/admin-tokens.test.ts`

Schema/token references inspected:
- `apps/web/drizzle/0006_admin_tokens.sql`
- `apps/web/src/db/schema.ts`

Additional source sweeps:
- Server-action export forms under `apps/web/src/app/actions/` and `apps/web/src/app/[locale]/admin/db-actions.ts`
- `admin_tokens` / FK reconciliation references across `apps/web/scripts`, `apps/web/src`, and `apps/web/drizzle`

## Findings

### C37-CR-01 - `admin_tokens` FK repair can fail on the orphan rows it is meant to protect against

Severity: High
Confidence: High

Files:
- `apps/web/scripts/migrate.js:288`
- `apps/web/scripts/migrate.js:565`
- `apps/web/scripts/migrate.js:692`
- `apps/web/src/lib/admin-tokens.ts:146`
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:209`

Issue: cycle 36 correctly made runtime PAT verification require a surviving owner via `INNER JOIN admin_users` (`admin-tokens.ts:146-150`) and added `ensureForeignKey(... admin_tokens_user_fk ...)` to legacy reconciliation (`migrate.js:692`). But `ensureForeignKey()` just runs the `ALTER TABLE` when the constraint is missing (`migrate.js:288-290`). It does not first converge existing bad data.

Failure scenario: a legacy DB already has `admin_tokens` without `admin_tokens_user_fk`, and at least one token row points at a deleted/missing `admin_users.id`. That is exactly the stale-token state cycle 36 was addressing. On deploy, `reconcileLegacySchema()` reaches `ALTER TABLE admin_tokens ADD CONSTRAINT ... REFERENCES admin_users(id)`, MySQL rejects it with a foreign-key violation, and migration/deploy fails before the app can start. Runtime verification is fail-closed, but the schema repair can still brick the upgrade.

Suggested fix: before adding `admin_tokens_user_fk`, explicitly delete or quarantine orphaned token rows:

```sql
DELETE at
FROM admin_tokens AS at
LEFT JOIN admin_users AS au ON au.id = at.user_id
WHERE au.id IS NULL;
```

Then run `ensureForeignKey(...)`. Add a migration/reconcile test that models an existing `admin_tokens` table with an orphan row and asserts the cleanup happens before FK creation. The current coverage test only asserts the `ensureForeignKey(...)` call is present (`migrate-reconcile-coverage.test.ts:209-216`), so it cannot catch this data-convergence failure.

### C37-CR-02 - `lint:action-origin` still silently ignores exported identifier aliases

Severity: High
Confidence: High

Files:
- `apps/web/scripts/check-action-origin.ts:677`
- `apps/web/scripts/check-action-origin.ts:680`
- `apps/web/scripts/check-action-origin.ts:819`
- `apps/web/scripts/check-action-origin.ts:826`
- `apps/web/scripts/check-action-origin.ts:832`
- `apps/web/src/__tests__/check-action-origin.test.ts:434`

Issue: cycle 36 fixed wrapped call expressions and default exports, but exported const aliases initialized from identifiers are still neither checked nor rejected. `checkActionSource()` collects local bodies into `localBodies` (`check-action-origin.ts:677-692`), but when scanning exported variable declarations it only evaluates direct function/call-wrapper bodies (`check-action-origin.ts:819-824`) or rejects call expressions (`check-action-origin.ts:826-830`). If the initializer is an identifier, the loop falls through with no `passed`, `failed`, or `skipped` entry.

Reproduced false negative:

```ts
import { requireSameOriginAdmin } from "@/lib/action-guards";

const impl = async function impl() {
  await db.insert(rows).values({ ok: true });
};

export const mutateFoo = impl;
```

Running `checkActionSource(...)` on that source returned:

```json
{
  "passed": [],
  "failed": [],
  "skipped": []
}
```

Current source does not appear to use this export shape under the scanned action files, so this is a gate blind spot rather than a live action bypass. The failure class is still important: a future mutating server action could be exported through an identifier alias, omit `requireSameOriginAdmin()`, and keep `npm run lint:action-origin` green.

Suggested fix: fail closed on exported variable declarations whose initializer is an identifier unless the scanner resolves the identifier to a collected local body and evaluates that body under the exported name. Add negative and positive fixtures for `const impl = async () => ...; export const action = impl;`, including a mutating unguarded body, a guarded body, and a read-only exempt body.

## Validation

Passed:
- `npm run lint:action-origin --workspace=apps/web`
- `npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/admin-tokens.test.ts` — 3 files, 174 tests passed

Additional review fixture:
- `npx tsx -e` import of `checkActionSource(...)` reproduced the exported-identifier-alias false negative above.

Not run:
- Full lint/typecheck/build/test/e2e suite. This was a read-only review lane focused on current HEAD and the cycle-36 fix delta.

## Prior-Cycle Filter

I did not re-raise the cycle-36 deferred perf/design findings:
- bootstrap orphan-temp cleanup repetition
- per-photo OG 304 support
- CLIP preprocessing pixel cap
- load-more live-region failure announcements
- public semantic-search operator jargon
- upload rejection toast localization

The findings above are fresh against `d6c3a8f6`: one regression risk in the cycle-36 FK repair path and one residual false negative in the cycle-36 action-origin scanner hardening.

## Final Sweep Note

Commonly missed issue classes checked in this pass: unsupported export forms, scanner source-contract blind spots, legacy schema convergence vs. dirty existing data, orphan PAT authentication, route-level public rate-limit exemptions, and whether current source already uses the risky patterns. No current exported identifier-alias action was found; the scanner still needs a fixture so the pattern cannot land later.
