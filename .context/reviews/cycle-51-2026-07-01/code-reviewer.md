# Summary

Review date: 2026-07-01
Lane: Cycle 51 code-reviewer
Reviewed HEAD: `11c4337f` (`test(sw): 🧪 pin photo fallback route classification`)
Scope: correctness, code quality, logic bugs, edge cases, stale generated-source contracts, race conditions, invariant violations, and maintainability risks.
Write scope: this artifact only.

No actionable new code-quality or source-correctness defects found.

Current HEAD is mostly review/plan ledger plus the Cycle 50 service-worker regression-test fix. The app-code change under review is limited to `apps/web/src/__tests__/sw-template-contract.test.ts`; `apps/web/public/sw.template.js` and generated `apps/web/public/sw.js` are unchanged from the runtime fix but were rechecked for behavioral parity. The Cycle 50 finding `C50-01` is closed by the new behavioral test: both the template and generated worker classifiers are evaluated against concrete public photo, localized photo, share, smart-collection, group, map, root, locale-root, and timeline paths.

# Inventory

Required context read:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/plans/cycle-50-2026-07-01-plan.md`
- `.context/plans/cycle-50-2026-07-01-deferred.md`
- `.context/reviews/cycle-50-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-50-2026-07-01/code-reviewer.md`
- `.context/reviews/cycle-50-2026-07-01/verifier-test-debugger.md`
- `.context/reviews/cycle-50-2026-07-01/security-reviewer.md`
- `.context/reviews/cycle-50-2026-07-01/perf-reviewer.md`
- `.context/reviews/cycle-50-2026-07-01/document-specialist.md`
- `.context/reviews/cycle-50-2026-07-01/ui-ux-designer.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Relevant app files inventoried and inspected:
- Service worker generated-source contract: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/scripts/build-sw.ts`, `apps/web/src/__tests__/sw-template-contract.test.ts`, `apps/web/src/proxy.ts`.
- Topic route mutation races: `apps/web/src/app/actions/topics.ts`, `apps/web/src/lib/advisory-locks.ts`, `apps/web/src/__tests__/topics-actions.test.ts`.
- Upload, processing, and restore queue edges: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Public API guard and expensive-route paths: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, admin API route inventory via `lint:api-auth`, server-action inventory via `lint:action-origin`, public-route inventory via `lint:public-route-rate-limit`.
- Privacy and public projection contracts: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`.
- Migration/reconcile contracts: `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`.
- Current HEAD metadata/docs touched by the last commit: `.gitignore`, `.context/reviews/_aggregate.md`, `.context/plans/README.md`, Cycle 50 plan/review artifacts.

Validation run during this review:
- `npm test --workspace=apps/web -- sw-template-contract.test.ts` - pass, 26 tests.
- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- `npm test --workspace=apps/web -- privacy-fields.test.ts migration-journal-monotonicity.test.ts migrate-reconcile-coverage.test.ts` - pass, 93 tests.
- Manual generated-worker parity check: `apps/web/public/sw.js` equals `apps/web/public/sw.template.js` with deterministic version `67d2683e-p7` substituted from `IMAGE_PIPELINE_VERSION = 7`.
- Manual migration journal check: latest entry `0028_rate_limit_bucket_start_idx` has the max `when` value (`1782812037323`).
- `git diff --check` - pass before writing this artifact.

# Findings

No actionable defects.

Non-defect observations:
- The new service-worker test directly exercises `isRevocableShareHtmlRoute` from both `sw.template.js` and generated `sw.js` at `apps/web/src/__tests__/sw-template-contract.test.ts:32` and `apps/web/src/__tests__/sw-template-contract.test.ts:124`, closing the Cycle 50 test-strength gap without changing runtime worker code.
- The generated worker is not stale: `apps/web/public/sw.js:26` carries `67d2683e-p7`, and a fresh deterministic replacement check matched the template output exactly.
- Fresh-upload `enqueueImageProcessing(...)` return values are still intentionally ignored in the browser and Lightroom upload paths after DB insert, but the recovery path is covered by pending-row bootstrap: restore quiesce sets bootstrap state false in `apps/web/src/lib/image-queue.ts:1095`, successful restore resumes and bootstraps at `apps/web/src/app/[locale]/admin/db-actions.ts:514`, and process startup bootstraps at `apps/web/src/instrumentation.ts:7`. I did not file this as a defect.
- Cycle 50’s plan artifact still has unchecked commit/deploy progress boxes, but the current HEAD contains the signed Cycle 50 implementation commit and commit-message gate evidence. I treated that as historical ledger drift outside this code-quality lane, not an app-correctness finding.

Not re-raised:
- `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08` remain carry-forward deferred items. I found no new evidence changing severity or making them scheduled now.

Final sweep:
- Checked the current HEAD patch, service-worker classifier behavior, generated-worker parity, action/API/public route guard inventories, topic-route lock path, upload/queue/restore interlocks, privacy projections, migration journal/reconcile coverage, and relevant Cycle 50 context.
- Intentionally skipped full `npm run lint`, `npm run typecheck`, `npm run build`, full `npm test`, and Playwright e2e because this was a read-only review lane and the only source change since Cycle 50 is focused service-worker contract-test coverage. I did not inspect every UI component, every historical review artifact, production deployment state, or live database state.
