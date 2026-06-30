# Cycle 31 Verifier Review

Role: verifier
Workspace: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `f1dd39eb` (`fix(cycle-30): harden restore and public route guards`)
Date: 2026-06-30
Scope: review current HEAD only; no product code modified.

## Inventory

Read before reviewing:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Current HEAD change inventory:

- Cycle plan/review artifacts: `.context/plans/cycle-30-2026-06-30-plan.md`, `.context/plans/cycle-30-2026-06-30-deferred.md`, `.context/reviews/_aggregate.md`, and role review files.
- Restore hardening: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/__tests__/restore-upload-lock.test.ts`.
- Public route rate-limit gate: `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`.
- Map GPS privacy behavior coverage: `apps/web/src/__tests__/map-get-images-behavior.test.ts`, verified against `apps/web/src/lib/data.ts`.
- Search failure copy/comment updates: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/components/search.tsx`, `apps/web/src/__tests__/search-short-query-guard.test.ts`.

Validation evidence:

- `npm run lint:public-route-rate-limit --workspace=apps/web` passed. It reported OK for the six public route files: health, live, OG photo, OG topic, semantic search, and similar search.
- Targeted Vitest passed: `npm test --workspace=apps/web -- src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/map-get-images-behavior.test.ts src/__tests__/restore-upload-lock.test.ts src/__tests__/search-short-query-guard.test.ts` -> 4 files, 61 tests.
- No focused test markers found in the touched suites: `rg "\.only\(|\.skip\(|it\.only|it\.skip|describe\.only|describe\.skip" ...` returned no matches.
- `git show --check --oneline --decorate HEAD` failed on trailing whitespace in the two new cycle-30 plan files; details below.

## Findings

### VER31-01 - Public expensive-GET gate ignores expensive work in `catch`/`finally`

- Severity: Medium
- Confidence: High
- File/region: `apps/web/scripts/check-public-route-rate-limit.ts:352-372`; fixture coverage at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:163-181`.
- Evidence: `bodyCallsRateLimitBeforeExpensiveGetWork()` recurses into `statement.tryBlock.statements` for a `TryStatement`, then `continue`s. It never inspects `catchClause` or `finallyBlock`, and the block-level caller ignores the boolean result from `inspectStatements(...)` while returning only the shared `sawRateLimitGate` flag.
- Reproducer run during review: a synthetic GET route with `JSON.parse('{')` before the limiter in `try`, followed by `db.select()` in `catch`, passed `checkPublicRouteSource(...)` as `OK: route.ts (expensive GET uses rate-limit helper)`.
- Failure scenario: a future public GET route can perform DB/file/image work in a catch or finally path reached before the limiter runs. The custom lint gate passes because it saw an approved limiter elsewhere in the `try` block.
- Concrete fix: inspect `catchClause.block.statements` and `finallyBlock.statements` with the same expensive-work-before-gate logic, or fail closed on try/catch/finally shapes the scanner cannot dominate. Add a failing fixture where expensive `catch` work is reachable before the limiter, next to the existing positive try-block fixture at `check-public-route-rate-limit.test.ts:163-181`.

### VER31-02 - Cycle-30 plan artifacts fail whitespace checking

- Severity: Low
- Confidence: High
- File/region: `.context/plans/cycle-30-2026-06-30-plan.md:3-4`; `.context/plans/cycle-30-2026-06-30-deferred.md:3-4`.
- Evidence: `git show --check --oneline --decorate HEAD` exits 2 and reports trailing whitespace on those four lines.
- Failure scenario: this is not a product runtime defect, but it makes the HEAD diff fail a standard static hygiene check and can hide meaningful whitespace failures if `git diff --check` is added as a blocking gate later.
- Concrete fix: remove the two trailing spaces from each date/source line or use explicit Markdown line breaks only where required.

## Non-Findings

- Restore queue cleanup ordering matches the cycle-30 intent: `imageQueueQuiesced = true` is now set immediately after `quiesceImageProcessingQueueForRestore()` and before `drainBackgroundDbWritesForRestore()` in `apps/web/src/app/[locale]/admin/db-actions.ts:493-498`; resume is guarded on `restoreLifecycleVerified || imageQueueQuiesced` at `db-actions.ts:514-517`.
- The new map behavior test imports `getMapImages()`, checks the join/predicate/limit shape, and asserts the runtime GPS leak guard in `apps/web/src/__tests__/map-get-images-behavior.test.ts:80-130`. This closes the prior cycle's "source-only map privacy test" gap for the current function.
- Search generic error copy now states temporary unavailability in both locales at `apps/web/messages/en.json:423` and `apps/web/messages/ko.json:423`. The short semantic query guard still has a targeted source contract and passed in the focused test run.
- Current public API route inventory is small and scanned: `health`, `live`, `og/photo/[id]`, `og`, `search/semantic`, and `search/similar/[id]`. The active routes pass the public route rate-limit gate.

## Final Sweep

Final missed-issue sweep covered the current HEAD diff, touched tests, changed gate script, current public API routes, map serialization path, restore prep/finally path, search message usage, focused test markers, and whitespace checks. Full lint/typecheck/build/Vitest were not rerun because the commit records them as green and this lane used lightweight review checks; Playwright was not run.
