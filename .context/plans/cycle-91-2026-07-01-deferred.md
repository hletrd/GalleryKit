# Cycle 91/100 Deferred Findings

Start HEAD: `c648634b666f59c29cfe40ea5bbd547bc98d1885`.
Review aggregate: `.context/reviews/_aggregate.md` (Cycle 91).

## Newly Deferred

None. Cycle 91 schedules the newly actionable safe fixes `C91-01` and `C91-02` instead of deferring them.

## Scheduled Instead Of Deferred

- `C91-01` - Medium / High: Cycle 90 terminal ledger still describes current HEAD sync as incomplete. Scheduled in `.context/plans/cycle-91-2026-07-01-plan.md`.
- `C91-02` - Low / High: Lightbox accessibility source test no longer proves the live position-announcement contract. Scheduled in `.context/plans/cycle-91-2026-07-01-plan.md`.

## Carry-Forward Deferred Review Findings

The cycle constraint says: "Implement only safe, narrow fixes for confirmed findings. Prefer tests/docs/source-contracts for test/ledger gaps. Do not invent broad refactors or new dependencies." The following findings are not newly deferred by Cycle 91; they remain bound to prior deferred ledgers and exit criteria.

### C91-03 / C77-ARCH-01 - Restore maintenance does not fence in-flight non-upload admin mutations

- Original severity/confidence: High / High.
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:452`, `apps/web/src/app/actions/topics.ts:182`, `apps/web/src/app/actions/topics.ts:338`, `.context/plans/cycle-90-2026-07-01-deferred.md:18`.
- Reason for deferral: Requires a broad shared foreground admin mutation barrier across many application-table writers, not a safe narrow Cycle 91 fix.
- Exit criterion: A shared foreground admin mutation barrier is used by every application-table writer that can run during restore, with representative tests proving writes cannot cross the restore-maintenance boundary after an entry precheck.

### C91-04 / C88-03 - `image_embeddings` cannot retain multiple model versions per image

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/db/schema.ts:284`, `apps/web/src/db/schema.ts:290`, `apps/web/drizzle/0012_image_embeddings.sql:5`, `apps/web/drizzle/0012_image_embeddings.sql:10`, `.context/plans/cycle-90-2026-07-01-deferred.md:16`.
- Reason for deferral: Requires a schema migration plus Drizzle schema, reconciliation, route, queue, and backfill updates; this exceeds the safe narrow Cycle 91 scope.
- Exit criterion: Dedicated semantic-embedding schema migration stores one row per `(image_id, model_version)` with Drizzle/reconcile/query/backfill updates and regression coverage proving inactive model rows are preserved.

### C91-RISK-SITE-CONFIG / C80-06 - `site-config.json` runtime/build-time contract remains ambiguous

- Original severity/confidence: Medium / Medium.
- Citations: `apps/web/docker-compose.yml:24`, `apps/web/docker-compose.yml:28`, `apps/web/src/components/nav-client.tsx:14`, `apps/web/src/app/[locale]/layout.tsx:11`, `.context/plans/cycle-90-2026-07-01-deferred.md:17`.
- Reason for deferral: Requires an operator-contract decision and either runtime-loader implementation or deployment-doc/mount changes; no exit criterion was triggered by the docs-only Cycle 90 delta.
- Exit criterion: Either implement a validated runtime loader and pass client-safe values explicitly, or document/remove the runtime mount and state that `site-config.json` edits require rebuild/deploy.

## Manual-Validation Risks Recorded From Reviews

These were review-lane validation risks, not confirmed source defects. They remain bound to the same repo policies when reopened.

- `MV-C91-01` / `MV-UX-C91-01` - Low / Medium. Citations: `apps/web/playwright.config.ts:78`, `apps/web/e2e/helpers.ts:89`, `apps/web/e2e/helpers.ts:105`. Reason: seeded browser/E2E visual and keyboard traversal were not available in the bounded review lanes. Exit criterion: run seeded `npm run test:e2e --workspace=apps/web` and/or manual browser screenshots for public/admin responsive states.
- `MV-SEC-01` - Low / Medium. Citation: `.context/reviews/cycle-91-2026-07-01/security-reviewer.md:37`. Reason: public-edge cleartext exposure cannot be proven from local source alone. Exit criterion: verify production edge/nginx listener behavior from the deployed environment without changing network configuration.
- `MV-SEC-02` - Low / Medium. Citation: `.context/reviews/cycle-91-2026-07-01/security-reviewer.md:45`. Reason: dependency CVE status requires networked audit outside this bounded review. Exit criterion: run the repo-approved dependency audit in an allowed networked validation pass.
- `MV-SEC-03` - Low / Medium. Citation: `.context/reviews/cycle-91-2026-07-01/security-reviewer.md:53`. Reason: rate-limit IP attribution depends on production proxy trust configuration. Exit criterion: verify deployed `TRUST_PROXY` / proxy hop settings against the active nginx/reverse-proxy path.
- `MV-PM-C91-01` - Low / Medium. Citation: `.context/reviews/cycle-91-2026-07-01/product-marketer-reviewer.md:41`. Reason: live demo/current deployment claims were not browser-verified in the product-marketing lane. Exit criterion: perform a live browser smoke of public demo pages and compare visible claims with committed docs/copy.

## Carry-Forward Register

Prior deferred items not reopened by Cycle 91 remain active: `C76-04`, `C76-05`, `C75-08`, plus historical performance, semantic-search, settings re-encode, shared-view, browser-matrix, and broad E2E expansion items recorded in earlier deferred artifacts.
