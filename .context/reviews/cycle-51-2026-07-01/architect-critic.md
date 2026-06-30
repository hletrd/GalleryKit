# Summary

Reviewed current repo HEAD `11c4337f` from an architecture / design-risk / critical-synthesis angle, with emphasis on drift-prone cross-file contracts. I found no actionable source-code contract defect in schema reconciliation, privacy projections, backup restore allowlists, image-setting forwarding, service-worker template/generated parity, i18n key parity, deploy scripts, or documented single-writer assumptions.

One low-severity operational-state finding remains: the Cycle 50 plan ledger still presents the completed/pushed Cycle 50 work as active and does not record deploy completion or an explicit deploy gap. That is not a runtime source bug, but it can mislead the next cycle's orchestration.

Focused validation run:

- `npm test --workspace=apps/web -- sw-template-contract.test.ts privacy-fields.test.ts sql-restore-scan.test.ts migration-journal-monotonicity.test.ts migrate-reconcile-coverage.test.ts i18n-key-parity.test.ts image-queue-settings-wiring.test.ts deploy-script-contract.test.ts`
- Result: 8 test files passed, 155 tests passed.

# Inventory

Required context read:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- Cycle 50 artifacts: `.context/reviews/cycle-50-2026-07-01/_aggregate.md`, `code-reviewer.md`, `security-reviewer.md`, `perf-reviewer.md`, `verifier-test-debugger.md`, `document-specialist.md`, `ui-ux-designer.md`
- Cycle 50 plan/deferred: `.context/plans/cycle-50-2026-07-01-plan.md`, `.context/plans/cycle-50-2026-07-01-deferred.md`

Cross-file contracts inspected:

- Schema / journal / reconcile: `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`
- Privacy omit/type/test guard: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`
- App backup table allowlist: `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/__tests__/sql-restore-scan.test.ts`
- Image settings forwarding: `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/__tests__/image-queue-settings-wiring.test.ts`
- Generated service-worker template/source parity: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/__tests__/sw-template-contract.test.ts`
- i18n key parity: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/__tests__/i18n-key-parity.test.ts`
- Deployment docs vs scripts: `AGENTS.md`, `CLAUDE.md`, `README.md`, `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/src/__tests__/deploy-script-contract.test.ts`
- Single-writer assumptions: `CLAUDE.md`, `README.md`, `apps/web/docker-compose.yml`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, advisory-lock usage references
- Recent diff since Cycle 49 start: `git diff 3a02f7ee..HEAD`

# Findings

## C51-ARCH-01 - Cycle 50 plan ledger still shows completed/pushed work as active and lacks deploy disposition

- Severity: Low
- Confidence: High
- Citation: `.context/plans/cycle-50-2026-07-01-plan.md:37`
- Citation: `.context/plans/cycle-50-2026-07-01-plan.md:44`
- Citation: `.context/plans/cycle-50-2026-07-01-plan.md:45`

Why it is a problem: the plan's progress section marks implementation and required gates complete, but still leaves `Commit, pull --rebase, push` and `Deploy with npm run deploy` unchecked. Current HEAD is `11c4337f` on `origin/master`, so at least the commit/push portion is stale. The plan also records gate evidence but no deploy result. Because `.context/plans/README.md` still lists Cycle 50 as active, the committed plan state is now ambiguous: the next agent cannot tell whether deployment was missed, completed out-of-band, or merely not recorded.

Concrete failure scenario: Cycle 51 or a recovery agent uses `.context/plans/README.md` and the Cycle 50 plan as the source of truth, sees an active plan with unchecked commit/push/deploy steps, and either repeats release work unnecessarily or assumes the pushed service-worker regression test has not been deployed. In the opposite direction, an operator may assume the Lore commit's "root deploy required" constraint was satisfied even though the committed ledger contains no deploy evidence.

Suggested fix: update the Cycle 50 plan ledger to mark commit/pull-rebase/push accurately and add a deploy disposition. If deploy completed, record the command, timestamp, target HEAD, and success evidence. If deploy did not run, state that explicitly and carry it as the next scheduled operational step instead of leaving the plan in a half-complete state.

## Non-Defect Observations

- Service-worker parity is now covered behaviorally. `apps/web/src/__tests__/sw-template-contract.test.ts:124` evaluates concrete route cases against both the template and generated worker, and both `apps/web/public/sw.template.js:59` and `apps/web/public/sw.js:59` use the same `/c|s|g|map` revocable/share matcher while excluding normal `/p/<id>` photo pages.
- Migration drift guardrails are intact in the inspected set. The latest journal entry remains `0028_rate_limit_bucket_start_idx` at `apps/web/drizzle/meta/_journal.json:202`, reconcile mirrors the rate-limit bucket index at `apps/web/scripts/migrate.js:682`, and the journal/reconcile tests passed.
- Privacy projection guardrails are intact. `publicSelectFields` omits sensitive/internal fields at `apps/web/src/lib/data.ts:376`, `PrivacySensitiveKeys` is declared at `apps/web/src/lib/data.ts:473`, and the symmetric runtime fixture lives at `apps/web/src/__tests__/privacy-fields.test.ts:7`.
- Backup restore allowlist is schema-pinned. `APP_BACKUP_TABLES` is declared at `apps/web/src/lib/sql-restore-scan.ts:12`, and `apps/web/src/__tests__/sql-restore-scan.test.ts:169` introspects Drizzle tables to catch missing allowlist entries.
- Image processing settings are forwarded through upload jobs. Browser upload enqueues the six non-default tunables at `apps/web/src/app/actions/images.ts:537`, Lightroom upload mirrors the same forwarding at `apps/web/src/app/api/admin/lr/upload/route.ts:527`, and `apps/web/src/__tests__/image-queue-settings-wiring.test.ts:159` proves the queue passes job-supplied values to `processImageFormats`.
- i18n key parity is explicitly guarded by `apps/web/src/__tests__/i18n-key-parity.test.ts:47`, while `CLAUDE.md:609` documents the intentional value-shape difference for English ICU plurals versus Korean fixed count strings.
- Deploy script/docs agree on the critical safety points inspected: `scripts/deploy-remote.sh:65` refuses unsafe deploy-env permissions, `.env.deploy.example:3` documents `chmod 600`, `apps/web/deploy.sh:56` runs Docker cleanup only after a healthy `up -d`, and `AGENTS.md:17` / `CLAUDE.md:469` document the per-iteration root deploy policy.
- The single-writer assumption is documented and reflected in compose/source shape. `CLAUDE.md:235` and `README.md:165` warn against horizontal scaling without moving process-local state, and `apps/web/docker-compose.yml:3` defines a single `web` service with process-local upload tracker / restore-maintenance state still visible in `apps/web/src/lib/upload-tracker-state.ts:15` and `apps/web/src/lib/restore-maintenance.ts:21`.

Final sweep: checked the requested drift-prone lists, compared Cycle 50 scheduled work against current HEAD, confirmed `.context/reviews/cycle-51-2026-07-01/architect-critic.md` is not ignored by `.gitignore`, and ran the focused test command listed in the summary. I intentionally skipped binary/generated media assets, `node_modules`, historical archive reviews except where surfaced by current aggregate context, full `npm run build`, full `npm test`, and Playwright e2e because this was a read-only architecture review and the changed source surface was covered by the targeted contract tests above.
