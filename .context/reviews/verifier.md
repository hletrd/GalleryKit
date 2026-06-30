# Verifier Review - Cycle 23

Date: 2026-06-30 KST
HEAD reviewed: `45208b21` (`test(cycle22): ✅ lock review regression contracts`)
Scope: evidence-based verifier review of the current repository against `AGENTS.md`, `CLAUDE.md`, cycle-23 review artifacts, live source behavior, tests, scripts, migrations, and cross-file invariants. Source code was not edited. This review artifact is the only file intentionally changed by this verifier pass.

## Inventory Built First

Required instructions and project docs examined:

- `AGENTS.md`.
- `CLAUDE.md`.
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`.
- `README.md`.
- `apps/web/README.md`.
- `package.json`.
- `apps/web/package.json`.

Cycle/review artifacts examined:

- `.context/reviews/archive/_aggregate-c23-deep.md`.
- `.context/reviews/archive/code-reviewer-c23.md`.
- `.context/reviews/archive/cycle23-comprehensive-review.md`.
- Existing `.context/reviews/verifier.md` from cycle 22 before replacement.

Implementation, test, and operations inventory:

- Built a tracked-file inventory of 2,578 repo files.
- Counted 597 tracked review-relevant files across `apps/web/src/**`, `apps/web/scripts/**`, `apps/web/drizzle/**`, `apps/web/e2e/**`, configs, deploy files, `README.md`, `CLAUDE.md`, and `AGENTS.md`.
- Directly inspected the live server actions, API routes, core libraries, schema/migrations, deploy scripts, tests, and UI surfaces implicated by current and adjacent review history.
- Re-verified archived cycle-23 findings against current implementation. The prior batch-tag, bulk-delete, topic-label sanitization, topic-alias sanitization, topic-alias delete audit, and restore-cancel i18n findings are already fixed in current code.

Repository-wide/static sweeps run:

- Route/action auth and rate-limit surface sweeps for `withAdminAuth`, `requireSameOriginAdmin`, mutating handlers, public handlers, and rate-limit pre-increment helpers.
- Advisory-lock sweep for every `GET_LOCK` call site and `isAdvisoryLockAcquired` use.
- Insert-ID sweep for `insertId`, `safeInsertId`, and remaining manual coercions.
- Privacy-field sweep across `schema.ts`, `data.ts`, `search-enrichment-fields.ts`, and `privacy-fields.test.ts`.
- Migration journal/SQL file existence and timestamp-order check. The historical non-monotonic journal entry remains present and is documented/guarded by the custom migrator; no missing SQL file was found.
- Node-runtime sweep for Node-only APIs in App Router route handlers.
- JSON-LD/dangerous HTML sweep; inspected all live `dangerouslySetInnerHTML` JSON-LD sites and confirmed they use `safeJsonLd`.
- Deployment-doc sweep for stale `docker compose ... --build` commands.

Validation run:

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm run lint --workspace=apps/web`: passed.
- `npm run typecheck --workspace=apps/web`: passed.
- Targeted Vitest: `admin-tokens.test.ts`, `lr-tokens-action.test.ts`, `smart-collections.test.ts`, `advisory-locks.test.ts`, `deploy-script-contract.test.ts`, `privacy-fields.test.ts`, `check-api-auth.test.ts`, `check-action-origin.test.ts`, `check-public-route-rate-limit.test.ts`: passed, 9 files / 199 tests.
- Full Vitest: passed, 265 files / 2,485 tests; 2 files / 4 tests skipped.

Workspace note: `.context/reviews/code-reviewer.md` was already modified before this verifier wrote the report. I left it untouched.

## Confirmed Findings

### V23-01 - Lightroom token creation drops non-number MySQL `insertId` values to `0`

Severity: Low  
Confidence: High  
Status: Confirmed code defect  
Category: correctness / audit accuracy

Evidence:

- `apps/web/src/lib/admin-tokens.ts:221-228` inserts the token row, types the result header as `{ insertId?: number }`, and returns `0` unless `typeof header.insertId === 'number'`.
- The repo already has a canonical helper for this exact risk: `apps/web/src/lib/validation.ts:174-199` documents that MySQL `insertId` may be `BigInt`, validates safe coercion, and throws on unsafe overflow.
- Current insert-ID call sites for image upload, admin-user create, group-share create, and LR upload use `safeInsertId`: `apps/web/src/app/actions/images.ts:464-465`, `apps/web/src/app/actions/admin-users.ts:153-154`, `apps/web/src/app/actions/sharing.ts:262-263`, and `apps/web/src/app/api/admin/lr/upload/route.ts:458-462`.
- `createLrToken` trusts the returned ID for the audit target: `apps/web/src/app/actions/lr-tokens.ts:87-99`.
- `apps/web/src/__tests__/admin-tokens.test.ts` covers token format, verification, scope parsing, and mark-used behavior, but does not cover `createToken` with `insertId: BigInt(7)`.

Failure scenario:

If mysql2 returns a `BigInt` insert ID for `admin_tokens` under driver/server settings or a high auto-increment value, the row is created successfully but `createToken` returns `{ id: 0 }`. The plaintext token still works because verification is hash-based, but the creation audit event records target `admin_token:0`, and callers receive a row ID that never existed. If the value is beyond `Number.MAX_SAFE_INTEGER`, the current code also fails open to `0` instead of throwing like the other protected insert-ID paths.

Concrete fix:

Import `safeInsertId` into `apps/web/src/lib/admin-tokens.ts`, widen the header type to `{ insertId?: number | bigint }`, and replace the manual `typeof === 'number' ? ... : 0` fallback with `safeInsertId(header?.insertId ?? 0)` or an explicit throw when the header is missing. Add a unit test for `createToken` where mocked `db.execute` returns `[{ insertId: BigInt(7) }, []]`, and another for an unsafe BigInt overflow if you want parity with `validation.test.ts`.

## Likely / Manual-Validation Risks

No additional likely or manual-validation-only risks were found that I would elevate as actionable this cycle. Known carry-forward items remain documented in prior review aggregates, including CSP `style-src 'unsafe-inline'`, the large `data.ts` module, API-route CSP coverage, process-local runtime state under single-instance topology, and historical migration-journal non-monotonicity.

## Re-verified Correct / Not Findings

- Archived C23 UI double-submit findings are fixed: `image-manager.tsx` now guards Enter submission with `!isBatchAddingTag` and disables/settles the bulk-delete confirmation while `isBulkDeleting`.
- Archived C23 topic sanitization/audit findings are fixed: topic labels use `sanitizeAdminString`, aliases use `requireCleanInput`, and `deleteTopicAlias` logs only when `affectedRows > 0`.
- Cycle-22 advisory-lock issue is fixed: all current `GET_LOCK` call sites use `isAdvisoryLockAcquired`, which accepts `1`, `BigInt(1)`, and `'1'`.
- Cycle-22 smart-collection tag-value issue is fixed: tag predicates now require string values before compile.
- Cycle-22 Docker compose docs drift is fixed in `README.md`, `CLAUDE.md`, `apps/web/deploy.sh`, and the deploy contract test.
- JSON-LD script injection sites inspected in public photo/home/topic/collection/timeline/year pages route through `safeJsonLd`.
- API/admin route auth, mutating action origin guards, and public mutating route rate-limit gates passed their dedicated scanners.

## Final Missed-Issues Sweep / Skipped Files

Final sweep covered docs, current and archived cycle-23 reviews, package scripts, deploy helpers, Docker/nginx config, migrations and journal, schema, data/privacy fields, server actions, API routes, admin DB backup/restore, advisory locks, upload/processing paths, CLIP semantic search, public analytics/actions, OG routes, service-worker contracts, JSON-LD render sites, i18n messages touched by reviewed flows, and relevant unit tests.

Skipped or not exhaustively read manually: generated/runtime-heavy paths (`node_modules`, `.next`, local uploads/data, screenshots, binary fixtures, and build cache files) and older historical plan/review archives outside the current/adjacent cycle evidence chain. Those were not current executable behavior. Playwright E2E was not rerun because the confirmed finding is a server-side token ID/audit edge, and the full Vitest/unit plus static gates already cover the relevant branch.
