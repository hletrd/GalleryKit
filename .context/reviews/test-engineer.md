# Cycle 31 Test-Engineer Review

Role: test-engineer
Workspace: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `f1dd39eb`
Date: 2026-06-30
Scope: test and gate review of current HEAD; no product code modified.

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`.

Inventoried current HEAD test/gate surfaces:

- Package gates: root `package.json`, `apps/web/package.json`.
- Custom gates touched by HEAD: `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`.
- Restore regression coverage: `apps/web/src/__tests__/restore-upload-lock.test.ts`, checked against `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Map GPS behavior coverage: `apps/web/src/__tests__/map-get-images-behavior.test.ts`, checked against `apps/web/src/lib/data.ts` and `/map` serialization in `apps/web/src/app/[locale]/(public)/map/page.tsx`.
- Search UX regression coverage: `apps/web/src/__tests__/search-short-query-guard.test.ts`, `apps/web/src/components/search.tsx`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Current public API route inventory under `apps/web/src/app/api/**/route.*`, excluding `api/admin/**`.

Fresh validation:

```text
npm run lint:public-route-rate-limit --workspace=apps/web
PASS

npm test --workspace=apps/web -- \
  src/__tests__/check-public-route-rate-limit.test.ts \
  src/__tests__/map-get-images-behavior.test.ts \
  src/__tests__/restore-upload-lock.test.ts \
  src/__tests__/search-short-query-guard.test.ts
PASS: 4 files, 61 tests

rg ".only|.skip" over those touched suites
PASS: no focused/skipped tests found
```

One command was corrected during review: the first targeted Vitest run used repo-root paths under `--workspace=apps/web` and found no files. The rerun above used workspace-relative `src/__tests__/...` paths and passed.

## Findings

### TE31-01 - Missing negative fixture for expensive GET work in catch/finally paths

- Severity: Medium
- Confidence: High
- File/region: `apps/web/scripts/check-public-route-rate-limit.ts:352-372`; `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:163-181`.
- Evidence: the new tests cover three key paths: expensive work after a direct limiter (`check-public-route-rate-limit.test.ts:117-130`), expensive work before the limiter (`:132-145`), and a positive `try` block where the limiter is before the expensive work (`:163-181`). They do not cover `catch` or `finally`.
- Confirmed gap: a review-only synthetic fixture with a throwing statement before the limiter and `db.select()` in `catch` passed `checkPublicRouteSource(...)`, because the scanner recurses only into `tryBlock.statements` and never inspects the catch/finally statements.
- Failure scenario: future code adds an expensive fallback or error-recovery DB/image path in `catch` before the limiter can run. The route passes the custom lint gate while unauthenticated abuse can still trigger unmetered expensive work.
- Concrete test/fix: add a failing fixture:

```ts
export async function GET() {
  try {
    JSON.parse('{');
    if (preIncrementSemanticAttempt(ip, Date.now())) return Response.json({}, { status: 429 });
  } catch {
    const rows = await db.select().from(images).limit(10);
    return Response.json({ rows });
  }
}
```

Then update the scanner to inspect `catchClause.block.statements` and `finallyBlock.statements`, preserving the current positive try-block fixture.

### TE31-02 - Restore regression remains a source-order contract, not an executable failure-path test

- Severity: Low
- Confidence: Medium
- File/region: `apps/web/src/__tests__/restore-upload-lock.test.ts:103-120`; production path at `apps/web/src/app/[locale]/admin/db-actions.ts:493-517`.
- Evidence: the test asserts string ordering: quiesce, set `imageQueueQuiesced = true`, drain, maintenance-exit condition, resume condition, and resume call. It does not execute `restoreDatabase()` with `quiesceImageProcessingQueueForRestore()` succeeding and `drainBackgroundDbWritesForRestore()` throwing.
- Failure scenario: a refactor preserves the searched strings/order but changes control flow, e.g. early returns outside the `finally`, a renamed wrapper, or a resume condition that no longer runs in the partial-prep failure path. The source contract can pass without proving the queue actually resumes after the specific failure that cycle 30 fixed.
- Concrete test/fix: add an executable module-level test using mocks for `@/lib/image-queue`, `@/lib/background-db-writes`, restore maintenance, advisory locks, and connection acquisition. Assert that when quiesce resolves and drain rejects, `resumeImageProcessingQueueAfterRestore()` is called and advisory/upload locks are released. Keep the source-order test as a cheap structural tripwire.

### TE31-03 - Cycle plan markdown fails `git show --check`

- Severity: Low
- Confidence: High
- File/region: `.context/plans/cycle-30-2026-06-30-plan.md:3-4`; `.context/plans/cycle-30-2026-06-30-deferred.md:3-4`.
- Evidence: `git show --check --oneline --decorate HEAD` reports trailing whitespace on the date and review-source lines in both new plan files.
- Failure scenario: static whitespace checks fail on HEAD. This is not in the configured gate list, but it is an avoidable artifact-quality regression and can make future review automation noisier.
- Concrete fix: remove the trailing spaces or use a Markdown line-break style that does not trip `git diff --check`.

## Non-Findings

- The map privacy regression is now behavior-covered for the production function. `map-get-images-behavior.test.ts:80-130` imports `getMapImages()`, asserts the `topics.map_visible=true` predicate, GPS non-null predicates, inner join, marker cap, and runtime guard.
- The current public route rate-limit gate passes against all non-admin API routes. The active route list is `health`, `live`, `og/photo/[id]`, `og`, `search/semantic`, and `search/similar/[id]`.
- The touched search short-query suite passed and still verifies the semantic minimum, early return before semantic fetch, and locale key presence.
- No `.only`/`.skip` markers were found in the touched suites.

## Final Sweep

Final missed-issue sweep covered changed tests, the rate-limit scanner fixtures, current public API route shapes, the restore failure-path assertion, map public serialization, search status copy, focused/skipped tests, targeted Vitest, public-route lint, and whitespace checks. Full `npm test`, `npm run typecheck`, `npm run build`, and Playwright were not rerun in this review lane; the reviewed commit message records the full standard gate list as previously green except E2E.
