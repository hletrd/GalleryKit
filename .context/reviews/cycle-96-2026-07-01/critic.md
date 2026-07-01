# Cycle 96 Critic Review

## Inventory

Reviewed repo rules and current change surface:

- Rules/docs: `AGENTS.md`, `CLAUDE.md`
- Release/review ledgers: `.context/plans/README.md`, `.context/plans/cycle-95-2026-07-01-plan.md`, `.context/plans/cycle-95-2026-07-01-deferred.md`, `.context/reviews/_aggregate.md`, `.context/reviews/cycle-95-2026-07-01/*`
- Recent source/test surface: Lightroom token admin UI/actions/tests, LR upload route/tests, admin navigation/e2e, image zoom/lightbox, admin image manager, restore actions, semantic embeddings, public listing queries.
- Git evidence: `HEAD == origin/master == 2f22620c361304ba0408053f546f45e3c74ddfdb`; recent commits are `2f22620`, `2178046`, `750729a`.
- Validation run in this review: static inspection plus `git diff --check HEAD~2..HEAD` (clean). No files modified.

## Confirmed Findings

### C96-01 — Cycle 95 release ledger is internally contradictory and one deployed-commit behind

- **Severity:** Medium
- **Confidence:** High
- **Perspective:** Operations, docs, previous-cycle convergence
- **Citations:** `AGENTS.md:15-18`, `.context/plans/README.md:7`, `.context/plans/cycle-95-2026-07-01-plan.md:42-56`, `.context/reviews/_aggregate.md:17-29`, `.context/reviews/cycle-95-2026-07-01/_aggregate.md:13-30`
- **Problem:** Repo policy requires deploy after every pushed `master` commit (`AGENTS.md:17`). Current `HEAD` is `2f22620`, but durable cycle ledgers record Cycle 95 as deployed at `2178046` only, while the latest aggregate still says `C95-01` is “scheduled” and also says it is “closed.”
- **Failure scenario:** Cycle 96+ agents read the committed ledgers and cannot tell whether production is at `2178046` or `2f22620`, causing repeated stale-ledger cycles or missed deploy verification for the actual current head.
- **Suggested fix:** Verify whether `2f22620` was deployed. If yes, update the Cycle 95/96 release ledger to name `2f22620` with smoke evidence and reconcile aggregate wording from “scheduled” to “closed.” If not, deploy `2f22620`, smoke, then record that evidence without creating another one-commit-behind loop.

### C96-02 — Token-list load-error fix still collapses DB/table failures into the empty state

- **Severity:** Medium
- **Confidence:** High
- **Perspective:** Reliability, UX, tests, previous-cycle convergence
- **Citations:** `apps/web/src/lib/admin-tokens.ts:178-190`, `apps/web/src/app/actions/lr-tokens.ts:131-140`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:37-47`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:146-163`, `apps/web/src/__tests__/client-source-contracts.test.ts:191-201`
- **Problem:** The client shows a persistent alert only when `listLrTokens()` returns `{ error }`. But `listTokensForUser()` catches every SELECT failure and returns `[]`, so missing `admin_tokens`, query failure, or swallowed DB errors render as “No tokens yet.”
- **Failure scenario:** After a failed migration or token-table outage, an admin opens Tokens and sees an empty state, not an operational error/retry path; they may believe no PATs exist or generate/revoke based on false state.
- **Suggested fix:** Return a discriminated error from `listTokensForUser()` / `listLrTokens()` for non-successful list loads, or narrowly treat known pre-migration missing-table as a clear “feature unavailable” state. Add behavioral tests that mock list failure and assert the persistent retryable alert.

### C96-03 — Token-label length contract mismatches server code-point validation and browser `maxLength`

- **Severity:** Low
- **Confidence:** High
- **Perspective:** Product contract, UX, tests
- **Citations:** `apps/web/src/app/actions/lr-tokens.ts:60-69`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:209-223`, `apps/web/src/__tests__/lr-tokens-action.test.ts:127-143`
- **Problem:** Server explicitly accepts labels up to 128 Unicode code points, and tests prove 128 camera emoji are accepted. The UI uses `maxLength={128}`, which browser inputs enforce by UTF-16 code units, blocking many non-BMP labels before they reach the server.
- **Failure scenario:** An admin pastes a 128-emoji label that the server contract accepts; the browser truncates/blocks around 64 emoji, making UI behavior inconsistent with server validation and test claims.
- **Suggested fix:** Remove the strict HTML `maxLength` or raise it to a conservative transport cap, then perform client-side `Array.from(label).length <= 128` validation with the same inline error path as server label errors.

## Carry-Forward Confirmed Findings Still Active

### C94-04 / C93-05 — Lightroom upload API lacks route-level behavior coverage

- **Severity:** Medium
- **Confidence:** High
- **Citations:** `apps/web/src/app/api/admin/lr/upload/route.ts:84-128`, `apps/web/src/app/api/admin/lr/upload/route.ts:583-594`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-16`
- **Scenario:** A refactor breaks token-scope rejection, content-length handling, or cleanup after save; current source-contract tests can still pass.
- **Fix:** Add mocked route-level tests for auth/scope, maintenance `503`, content-length errors, over-limit paths, success shape, and cleanup failure.

### C94-05 / C93-06 — Admin Playwright coverage omits first-class pages

- **Severity:** Medium
- **Confidence:** High
- **Citations:** `apps/web/src/components/admin-nav.tsx:15-25`, `apps/web/e2e/admin.spec.ts:20-43`, `apps/web/e2e/admin.spec.ts:73-103`
- **Scenario:** `/admin/seo`, `/admin/tokens`, or `/admin/analytics` can regress while admin e2e remains green.
- **Fix:** Drive every `AdminNav` destination and assert one stable landmark/control per page.

### C94-06 / C93-09 — Zoomed photos are not keyboard-pannable

- **Severity:** Medium
- **Confidence:** High
- **Citations:** `apps/web/src/components/image-zoom.tsx:197-208`, `apps/web/src/components/image-zoom.tsx:328-365`, `apps/web/src/components/lightbox.tsx:340-343`
- **Scenario:** Keyboard users can zoom but cannot inspect off-center details; arrow keys navigate slides instead.
- **Fix:** Add keyboard pan controls/instructions and prevent slide navigation while keyboard pan mode is active.

### C94-07 / C93-10 — Mobile admin navigation remains a wrapped ten-link header

- **Severity:** Medium
- **Confidence:** High
- **Citations:** `apps/web/src/components/admin-nav.tsx:15-29`, `apps/web/src/components/admin-nav.tsx:33-49`
- **Scenario:** On narrow devices, admin IA consumes vertical space and becomes difficult to scan.
- **Fix:** Use an accessible compact mobile nav pattern with focus restoration and `aria-current`.

### C94-08 / C93-11 — Admin image management is still desktop-table-first on mobile

- **Severity:** Medium
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`, `apps/web/src/components/image-manager.tsx:424-448`, `apps/web/src/components/image-manager.tsx:551-563`
- **Scenario:** Mobile admins must horizontally scroll a dense table for routine edit/delete/tag tasks.
- **Fix:** Add a mobile card/list management layout while preserving labels and 44 px controls.

### C94-09 / C77-ARCH-01 — Restore maintenance does not fence already-in-flight non-upload mutations

- **Severity:** High
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:449-452`, `apps/web/src/app/actions/settings.ts:41-48`, `apps/web/src/app/actions/settings.ts:163-175`, `apps/web/src/app/actions/tags.ts:42-49`, `apps/web/src/app/actions/topics.ts:85-92`, `apps/web/src/app/actions/sharing.ts:91-99`
- **Scenario:** An admin mutation passes the precheck just before restore maintenance begins, then writes into application tables during restore.
- **Fix:** Add a shared restore/admin-write barrier around all foreground application-table mutations, with representative race tests.

### C94-10 / C88-03 — `image_embeddings` cannot retain multiple model versions per image

- **Severity:** Medium
- **Confidence:** High
- **Citations:** `apps/web/src/db/schema.ts:284-299`, `apps/web/drizzle/0012_image_embeddings.sql:5-12`, `apps/web/src/lib/image-queue.ts:379-390`, `apps/web/src/app/api/search/semantic/route.ts:270-279`, `apps/web/src/app/api/search/similar/[id]/route.ts:135-147`
- **Scenario:** Switching embedding models overwrites prior embeddings, preventing staged rollout or rollback.
- **Fix:** Migrate to a `(image_id, model_version)` key and update queue/query/backfill logic.

### C94-11 — First-page public listings force exact `COUNT(*) OVER()` through grouped tag joins

- **Severity:** Medium
- **Confidence:** High
- **Citations:** `apps/web/src/lib/data.ts:910-927`, `apps/web/src/lib/data.ts:1495-1510`, `apps/web/src/components/home-client.tsx:267-269`
- **Scenario:** Large galleries pay an exact count cost on first render even when only first-page display is needed.
- **Fix:** Decide product count policy, then remove or defer exact window counts on grouped listing paths.

## Likely Issues

No separate likely-only issues identified beyond the confirmed findings above.

## Manual-Validation Risks

- Production deployment of current `HEAD` (`2f22620`) was not independently verified in this review; the ledger only records `2178046`.
- Browser/mobile behavior for the admin nav, image manager, and zoom panning remains unvalidated in this cycle.
- Full quality gates were not rerun for this review-only lane; Cycle 95 records gate evidence at `.context/plans/cycle-95-2026-07-01-plan.md:48-56`.

## Missed-Issue Sweep / Coverage

I reviewed the full recent docs/source/test change surface rather than sampling only one lane: release ledgers, token UI/actions/tests, LR upload route coverage, admin navigation/e2e, zoom/lightbox accessibility, admin image management, restore fencing, semantic embedding schema/query paths, and listing count paths. No newly introduced confirmed auth bypass, secret leakage, injection, or public data exposure was found in the Cycle 95 docs-only commit or the Cycle 94 token changes.