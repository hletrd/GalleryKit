# Latest Aggregate Review

Current aggregate: `cycle-91-2026-07-01/`

Cycle 91 reviewed deployed `master` at `c648634b666f59c29cfe40ea5bbd547bc98d1885`.

## Agent Coverage

- Active/covered: `code-reviewer` (including merged performance/style/API/quality coverage), `security-reviewer`, `critic`, `verifier`, `test-engineer`, `architect`, `debugger`, `designer`.
- Best-effort unavailable requested roles: `document-specialist` and `tracer` were not registered active agents, so the architect lane wrote bounded best-effort artifacts for both.
- Additional local reviewer prompts covered: `ui-ux-designer-reviewer`, `product-marketer-reviewer`.

## Deduplicated Confirmed Findings

### C91-01 - Cycle 90 terminal ledger still describes current HEAD sync as incomplete

Severity: Medium
Confidence: High
Cross-agent agreement: `critic`, `verifier`, `test-engineer`.

Evidence: `.context/plans/README.md:7` says the Cycle 90 docs-only terminal-evidence sync is still in progress, while `.context/plans/cycle-90-2026-07-01-plan.md:56`-`59` records only primary commit/deploy evidence for `dcc8055`, not the starting deployed HEAD for this cycle, `c648634b666f59c29cfe40ea5bbd547bc98d1885`.

Failure scenario: later cycles cannot prove from committed artifacts that `c648634` closed the Cycle 90 terminal sync and may reuse `dcc8055` as the last evidenced baseline.

Scheduled: `.context/plans/cycle-91-2026-07-01-plan.md`.

### C91-02 - Lightbox accessibility source test no longer proves the live position-announcement contract

Severity: Low
Confidence: High
Cross-agent agreement: `designer`, `ui-ux-designer-reviewer`.

Evidence: `apps/web/src/__tests__/a11y-us-p15.test.ts:57`-`63` still tests broad `currentIndex` / `totalCount` source regexes under an image-aria-label name, while the current lightbox exposes position through a separate `role="status"` live region at `apps/web/src/components/lightbox.tsx:676`-`681`.

Failure scenario: a future edit can remove or weaken the status live region while the stale regex still passes because unrelated source code contains `currentIndex`, `totalCount`, and `N / M` formatting.

Scheduled: `.context/plans/cycle-91-2026-07-01-plan.md`.

### C91-03 - Restore maintenance still does not fence in-flight non-upload admin mutations

Severity: High
Confidence: High
Cross-agent agreement: `architect`, `tracer`.

Evidence: restore acquires DB/upload/backfill locks before durable maintenance in `apps/web/src/app/[locale]/admin/db-actions.ts:390`-`452`, but representative non-upload writers such as `updateTopic` check maintenance only at entry in `apps/web/src/app/actions/topics.ts:182`-`184` and can later write in transactions at `apps/web/src/app/actions/topics.ts:285`-`338`.

Failure scenario: a slow foreground admin mutation passes its entry check, restore starts, and the mutation writes during or after restore import, producing lost or inconsistent state.

Disposition: carry-forward deferred as `C77-ARCH-01`; not newly scheduled in Cycle 91 because it requires a broad shared foreground admin mutation barrier beyond this cycle's safe narrow-fix constraint.

### C91-04 - Semantic embeddings remain one row per image despite model-version filtering

Severity: Medium
Confidence: High
Cross-agent agreement: `architect`, `tracer`, `document-specialist`.

Evidence: `image_embeddings.image_id` remains the primary key in `apps/web/src/db/schema.ts:284`-`290` and `apps/web/drizzle/0012_image_embeddings.sql:5`-`10`, while search routes filter by model version and writers upsert a single row.

Failure scenario: switching from stub to production, rolling back, or introducing a future production model version replaces the prior embedding row and leaves routes filtering for a version that no longer exists.

Disposition: carry-forward deferred as `C88-03`; not newly scheduled in Cycle 91 because it requires a schema migration plus Drizzle/reconcile/query/backfill updates.

## Manual-Validation Risks

- `MV-C91-01` / `MV-UX-C91-01`: seeded browser/E2E visual and keyboard traversal were not run in the review lanes; run `npm run test:e2e --workspace=apps/web` when browser-flow coverage is required.
- `MV-SEC-01`: confirm deployed nginx cleartext listener exposure from the production edge, not from local source alone.
- `MV-SEC-02`: dependency CVE state requires a networked audit, which was outside this bounded review.
- `MV-SEC-03`: rate-limit IP attribution depends on production proxy trust configuration.
- `C91-ARCH-RISK-01` / `C91-DOC-RISK-01` / `C91-TRC-RISK-01`: `site-config.json` runtime-vs-build-time behavior remains ambiguous without compiled-bundle or Docker validation; carry-forward deferred as `C80-06`.
- `MV-PM-C91-01`: live demo/current deployment claims were not browser-verified by the product-marketing lane.

## Agent Failures

None after fallback. One review lane saw local `tsx` IPC `EPERM` while probing npm scanner scripts and reran the scanner entrypoints through `NODE_OPTIONS='--import tsx' node ...` successfully; this is recorded as review-lane validation friction, not an application finding.

## Plan Disposition

Cycle 91 schedules `C91-01` and `C91-02` for safe narrow fixes. `C91-03`, `C91-04`, and the `site-config.json` risk remain bound to existing deferred exit criteria in `.context/plans/cycle-91-2026-07-01-deferred.md`.
