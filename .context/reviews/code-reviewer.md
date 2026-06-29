# Code Reviewer Report - Cycle 19

HEAD reviewed: `26f1a66d fix(review): 🐛 close cycle 18 findings`
Branch: `master`
Scope: comprehensive repository-wide static review focused on code quality, logic, maintainability, and cross-file correctness. No source files were modified.

Outcome: 1 confirmed issue. No critical or high-severity issue was confirmed in this pass.

## Review Inventory

Instruction and context files read:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/code-reviewer.md` from cycle 18
- `.context/plans/archive/392-cycle19-fixes.md`
- `.context/plans/archive/378-deferred-cycle19.md`

Repository inventory built before detailed review:
- Workspace/package/config: `package.json`, `apps/web/package.json`, Next/Vitest/Playwright/ESLint/TypeScript config, deploy and migration scripts.
- Static enforcement gates: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, and their focused tests.
- Public and admin API routes: every `route.ts` / `route.tsx` under `apps/web/src/app/api`, plus upload and feed route handlers outside `/api`.
- Server actions: all files under `apps/web/src/app/actions`, plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Data/privacy surfaces: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, schema definitions, public map/feed/share helpers.
- Upload/image-processing surfaces: browser upload action, Lightroom upload route, image queue, upload path resolution, image serving, color/HDR/GPS processing, admin backfill.
- Auth/origin/rate-limit surfaces: session/auth actions, `api-auth`, `request-origin`, `action-guards`, `rate-limit`, `auth-rate-limit`, PAT token creation/verification.
- Restore/backup operations: DB dump/restore actions, restore scanner, restore maintenance, migration runner.
- Semantic search surfaces: semantic text route, similar-photo route, CLIP model loading/embedding helpers, embedding backfill.

Representative files examined in detail:
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/app/feed.xml/route.ts`
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/clip-model.ts`

Validation and evidence:
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npx vitest run src/__tests__/check-public-route-rate-limit.test.ts --config vitest.config.ts` passed: 38 tests.
- A direct `checkPublicRouteSource()` probe reproduced the scanner false negative described below.

## Confirmed Issue

### CR19-CR-01 - Public route rate-limit scanner accepts aliased non-limiter imports

Severity: MEDIUM
Confidence: High

Code regions:
- `apps/web/scripts/check-public-route-rate-limit.ts:38-42`
- `apps/web/scripts/check-public-route-rate-limit.ts:96-115`
- `apps/web/scripts/check-public-route-rate-limit.ts:118-122`
- `apps/web/scripts/check-public-route-rate-limit.ts:188-207`
- `apps/web/scripts/check-public-route-rate-limit.ts:366-370`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:458-484`
- `apps/web/src/lib/rate-limit.ts:301-308`
- `apps/web/src/lib/rate-limit.ts:378-385`

Problem:
The public mutating-route scanner verifies that a rate-limit-looking local identifier is imported from an approved module, but it decides approval from the local alias name instead of the actual exported symbol. In `collectApprovedRateLimitImports`, `localName = element.name.text` is accepted when it starts with `preIncrement` or `checkAndIncrement`; `element.propertyName` is ignored. `isRateLimitHelperCall` then treats calls to that local alias as a valid gate.

This means any export from `@/lib/rate-limit` or `@/lib/auth-rate-limit` can be imported under a `preIncrement*` alias and satisfy the lint gate. The risk is not that current routes are unmetered; the current public mutating route inventory is clean. The risk is that the repo's security lint can be bypassed by a future route while still reporting green.

Concrete failure scenario:

```ts
import { rollbackSemanticAttempt as preIncrementSemanticAttempt } from '@/lib/rate-limit';

export async function POST(request) {
  if (preIncrementSemanticAttempt('1.2.3.4')) return { status: 429 };
  await db.insert(rows).values({ ok: true });
  return { status: 200 };
}
```

Validated result from `checkPublicRouteSource()`:

```json
{
  "passed": ["OK: route.ts (uses rate-limit helper)"],
  "failed": []
}
```

At runtime that call is a rollback helper, not a pre-increment limiter. It returns `undefined`, so the over-limit branch never runs and the subsequent mutation is admitted without charging a public rate-limit budget. A similar alias could target any approved-module helper whose behavior is not a pre-increment/check gate.

Why existing tests miss it:
The current spoofing tests cover a local fake helper and an import from an unapproved module at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:458-484`. They do not cover an alias of a non-limiter export from an approved module, which is the exact fail-open path here.

Suggested fix:
Approve imports by actual exported name, not local alias. Use `const importedName = element.propertyName?.text ?? element.name.text` for prefix or, better, explicit allow-list matching, then record `element.name.text` as the callable local binding only after the imported symbol is approved. Add a regression test with `rollbackSemanticAttempt as preIncrementSemanticAttempt` and assert `MISSING RATE LIMIT`.

## Missed-Issue Sweep

Areas rechecked after the finding:
- Admin API route auth wrappers: both admin API route files are directly wrapped with `withAdminAuth(...)`; token-scope and same-origin behavior in `api-auth.ts` matched route intent.
- Mutating server actions: origin guard ordering and exemptions were checked by the lint gate and spot-reviewed in actions that write DB state or trigger revalidation.
- Public routes: semantic POST is rate-limited before DB/vector work; similar-photo GET is same-origin and rate-limited; OG GET routes retain explicit CPU/DB rate limits despite not being covered by the mutating-route scanner.
- Privacy selectors: public selectors, map selector exception, search enrichment fields, and privacy-sensitive type guards were checked for GPS/original filename/internal processing fields.
- Upload and restore lifecycles: browser upload, Lightroom upload, queue quiesce/resume, backup/restore locks, SQL scan, and original-file path handling were reviewed for cleanup and race conditions.
- Cycle 18 closure: the prior scanner transitive-local-mutator issue, bulk tag timestamp issue, semantic enrichment privacy issue, and CLI/import drift fixes appear present.

No additional real issue met the reporting bar after this sweep.
