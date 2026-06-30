# Cycle 27 Aggregate Review

Date: 2026-06-30 KST
Cycle: 27/100
Reviewed HEAD range: current `master` after cycle 26 plus cycle-27 review artifacts

## Agent Coverage

Completed reviewer artifacts:

- `code-reviewer.md`
- `perf-reviewer.md`
- `security-reviewer.md`
- `critic.md`
- `verifier.md`
- `test-engineer.md`
- `tracer.md`
- `architect.md`
- `debugger.md`
- `document-specialist.md`
- `ui-ux-designer-reviewer.md`
- `product-marketer-reviewer.md`

No reviewer failed after retry/slot scheduling. The environment did not expose every requested named reviewer as a native agent type, so the required personas were run through available native agents plus discovered local reviewer prompts.

## High-Signal Findings

### AGG-C27-01 - SQL restore scanner can still be bypassed by valid MySQL grammar and comment-separated write targets

- Severity/confidence: High / High
- Cross-agent agreement: code-reviewer, verifier, tracer, architect, debugger; security-reviewer recorded the DB-privilege blast-radius risk.
- Citations: `apps/web/src/lib/sql-restore-scan.ts:39-55`, `apps/web/src/lib/sql-restore-scan.ts:138-155`, `apps/web/src/lib/sql-restore-scan.ts:190-221`, `apps/web/src/app/[locale]/admin/db-actions.ts:618-678`, `apps/web/src/__tests__/sql-restore-scan.test.ts:53-96`.
- Problem: the allowlist does not recognize all MySQL `INSERT`/`REPLACE` statement shapes, does not apply write-target extraction to the comment-as-space normalized form, and permits schema-qualified reads via `INSERT ... SELECT` / `CREATE TABLE ... AS SELECT`.
- Failure scenario: an authenticated admin or compromised admin session uploads a crafted restore file. The scanner returns safe, then `mysql --one-database` imports statements that can create/write unexpected app tables, read from sibling schemas, or write outside the gallery schema when the DB user is overprivileged.
- Suggested fix: make the restore language narrower and token-aware, scan both normalized forms, reject schema-qualified identifiers anywhere in executable statements, cover priority/no-`INTO` forms, and add regression tests for each bypass shape.

### AGG-C27-02 - SQL restore scanner accepts temporary app-table DDL

- Severity/confidence: Medium / Medium-High
- Cross-agent agreement: code-reviewer, debugger.
- Citations: `apps/web/src/lib/sql-restore-scan.ts:42-47`, `apps/web/src/lib/sql-restore-scan.ts:190-206`, `apps/web/src/__tests__/sql-restore-scan.test.ts:31-51`.
- Problem: `CREATE TEMPORARY TABLE` and `DROP TEMPORARY TABLE` for app table names are accepted, even though the app's own dump shape does not need temporary app tables.
- Failure scenario: a crafted restore creates a temporary `images` table, routes inserts to it, and loses rows at session end or causes confusing post-restore migration/reconcile failures.
- Suggested fix: reject temporary table DDL in restore files unless a future first-party backup path emits it, and pin with tests.

### AGG-C27-03 - Restore-maintenance recovery runbook does not match the production runtime contract

- Severity/confidence: High / High
- Cross-agent agreement: verifier, architect, document-specialist, debugger.
- Citations: `CLAUDE.md:401`, `apps/web/package.json:20`, `apps/web/Dockerfile:122-157`, `apps/web/scripts/restore-maintenance-recovery.ts:24-41`, `apps/web/src/lib/restore-maintenance.ts:1-27`, `apps/web/src/lib/restore-maintenance-durable.ts:93-103`, `apps/web/src/instrumentation.ts:1-8`, `apps/web/src/app/[locale]/admin/db-actions.ts:684-745`.
- Problem: the documented recovery command is TypeScript/`tsx` based and is not shipped in the production runner image. Even when run externally, it cannot clear `globalThis` state in an already-running Next process.
- Failure scenario: a failed DB restore leaves maintenance active. The operator follows the runbook, but the production image cannot run the command, or an external command clears only the durable marker while the live process remains in maintenance until restart.
- Suggested fix: ship a production-real recovery script or add an authenticated in-process recovery path, and document whether restart is required.

### AGG-C27-04 - Legacy original migration does not normalize private filesystem permissions

- Severity/confidence: Medium / High
- Cross-agent agreement: critic.
- Citations: `apps/web/scripts/migrate.js:71-110`, `apps/web/src/lib/process-image.ts:910`, `apps/web/src/lib/process-image.ts:1729-1808`, `apps/web/src/__tests__/migrate-legacy-originals.test.ts:46-85`.
- Problem: legacy originals moved from the old public tree into the private original root retain existing file modes on rename/copy and the private root mode is not tightened.
- Failure scenario: files are no longer publicly served over HTTP, but a shared host user, sidecar, or broad bind mount can still read full-resolution originals and metadata if old files were `0644`.
- Suggested fix: chmod the private root and migrated targets to private modes and add a regression test for permissive legacy files.

### AGG-C27-05 - Backfill docs overstate serialization/equivalence semantics

- Severity/confidence: Medium / High
- Cross-agent agreement: document-specialist, product-marketer-reviewer.
- Citations: `CLAUDE.md:333-404`, `apps/web/scripts/backfill-color-pipeline.ts:32-38`, `apps/web/scripts/backfill-color-pipeline.ts:281-340`, `apps/web/src/lib/admin-backfill-runner.ts:49-51`, `apps/web/src/lib/admin-backfill-runner.ts:316-330`, `apps/web/src/lib/admin-backfill-runner.ts:383-418`, `apps/web/messages/en.json:775-781`, `apps/web/README.md:41`.
- Problem: docs say full backfills serialize and the sidecar/in-app entry points are equivalent. In reality, the in-app runner returns `already_running`, sidecar waits only 10 seconds, and only sidecar `--force-reencode` handles settings-only byte changes for current-version rows.
- Failure scenario: an operator changes derivative settings, uses the in-app button because the runbook says it is equivalent, and older derivatives remain at old bytes.
- Suggested fix: rewrite docs to distinguish shared safety contracts from candidate selection and lock waiting behavior.

### AGG-C27-06 - Sharing actions are protected mostly by source-string tests, not behavior tests

- Severity/confidence: Medium / High
- Cross-agent agreement: test-engineer.
- Citations: `apps/web/src/app/actions/sharing.ts:91-397`, `apps/web/src/__tests__/sharing-source-contracts.test.ts:1-27`.
- Problem: sharing tests assert source snippets rather than executing behavior for transactions, audit logging, rate-limit rollback, affectedRows races, and localized revalidation.
- Failure scenario: a future refactor drops child-row deletes, audit calls, or share/admin revalidation and current tests still pass.
- Suggested fix: add behavior tests with mocked DB/auth/rate-limit/revalidation/audit helpers for create/revoke/delete flows.

### AGG-C27-07 - Image upload and metadata-edit audit/cache behavior lack focused tests

- Severity/confidence: Medium / High
- Cross-agent agreement: test-engineer.
- Citations: `apps/web/src/app/actions/images.ts:604-613`, `apps/web/src/app/actions/images.ts:891-962`, `apps/web/src/__tests__/images-actions.test.ts:20-42`, `apps/web/src/__tests__/images-actions.test.ts:178-277`, `apps/web/src/components/image-manager.tsx:274-317`.
- Problem: existing tests do not pin `image_upload` / `image_update` audit calls, metadata sanitization return values, or all cache invalidation paths.
- Failure scenario: audit/revalidation or sanitized return behavior regresses without a focused test failure.
- Suggested fix: extend image action tests for upload audit and metadata update success/failure paths.

### AGG-C27-08 - Desktop public navigation can clip wrapped topic links

- Severity/confidence: Medium / High
- Cross-agent agreement: ui-ux-designer-reviewer.
- Citations: `apps/web/src/components/nav-client.tsx:85-153`.
- Problem: collapsed nav uses `h-16 overflow-hidden`, desktop topics are forced visible and `md:flex-wrap`, and the expand control is mobile-only.
- Failure scenario: many topics or long localized labels wrap to a hidden second line; keyboard focus can land on clipped links.
- Suggested fix: choose an explicit desktop overflow model: grow the header, use horizontal scroll, or add a More menu. Add a responsive fixture/test.

### AGG-C27-09 - Create-user password hint is not programmatically associated

- Severity/confidence: Low / High
- Cross-agent agreement: ui-ux-designer-reviewer.
- Citations: `apps/web/src/components/admin-user-manager.tsx:113-123`.
- Problem: the visible 12-character password hint lacks an id and is not referenced by `aria-describedby`.
- Failure scenario: screen-reader admins do not hear the minimum-length instruction before validation failure.
- Suggested fix: add a stable hint id and wire it to the password input.

## Likely Findings

### AGG-C27-10 - Fire-and-forget analytics inserts can still cross the restore import boundary

- Severity/confidence: Medium / Medium
- Cross-agent agreement: tracer, architect; debugger notes this is carried from prior deferred work.
- Citations: `apps/web/src/app/actions/public.ts:416-509`, `apps/web/src/app/[locale]/admin/db-actions.ts:491-504`, `apps/web/src/lib/data.ts:222-249`.
- Reason not promoted to confirmed: the boundary is visible in source, but product policy treats public analytics as approximate and runtime symptoms depend on timing/pool scheduling.
- Suggested fix: tracked analytics writer with pause/drain semantics, or await inserts.

### AGG-C27-11 - Search/modal stacking can cause Escape/focus drift

- Severity/confidence: Medium / Medium
- Cross-agent agreement: tracer, code-reviewer, debugger.
- Citations: `apps/web/src/components/search.tsx:297-327`, `apps/web/src/components/search.tsx:366-536`, `apps/web/src/components/lightbox.tsx:309-360`, `apps/web/src/components/info-bottom-sheet.tsx:132-139`, `apps/web/src/components/use-modal-tree-isolation.ts:19-65`, `apps/web/src/components/ui/dropdown-menu.tsx:34-50`.
- Reason not promoted to confirmed: source strongly indicates stack-risk, but exact browser behavior depends on listener order and data-dependent dropdown availability.
- Suggested fix: add a modal stack/owner guard and test Search over Lightbox/InfoBottomSheet and portaled dropdowns inside modal roots.

### AGG-C27-12 - `updateTag` audit and dashboard revalidation lack direct tests

- Severity/confidence: Low / Medium-High
- Cross-agent agreement: test-engineer.
- Citations: `apps/web/src/app/actions/tags.ts:42-106`, `apps/web/src/__tests__/tags-actions.test.ts:100-255`.
- Suggested fix: add direct `updateTag` tests for success, audit, revalidation, validation errors, missing tag, duplicate/DB failures, and affected-image timestamp update.

### AGG-C27-13 - SEO OG image input copy accepts paths but the field uses URL semantics

- Severity/confidence: Low / Medium
- Cross-agent agreement: product-marketer-reviewer.
- Citations: `apps/web/messages/en.json:477-479`, `apps/web/src/app/actions/seo.ts:126-133`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:171-179`.
- Suggested fix: use `type="text"` with `inputMode="url"` for same-origin path support, or tighten copy to absolute URLs only.

## Manual-Validation / Operational Risks

### AGG-C27-R01 - Proxy/header trust and TLS edge assumptions must match production

- Severity/confidence: Medium / Medium
- Citations: `apps/web/src/lib/request-origin.ts:5-107`, `apps/web/nginx/default.conf:25-197`.
- Deferral reason: operational deployment validation, not a tracked source defect.
- Exit criterion: reopen if deployment proxy topology changes or if `TRUST_PROXY=true` is used without proven forwarded-header overwrite at the public edge.

### AGG-C27-R02 - DB restore blast radius depends on MySQL account least privilege

- Severity/confidence: Medium / Medium
- Citations: `apps/web/src/lib/sql-restore-scan.ts:39-221`, `apps/web/src/app/[locale]/admin/db-actions.ts:618-678`.
- Deferral reason: operational grant validation. Code hardening is scheduled under AGG-C27-01.
- Exit criterion: reopen if production grants include sibling schemas/global privileges or restore scanner grammar changes.

### AGG-C27-R03 - Gitignored runtime secret files were intentionally not inspected

- Severity/confidence: Low / High
- Citations: `apps/web/src/lib/session.ts:19-35`, `README.md:134-143`, `CLAUDE.md:79-86`, `apps/web/deploy.sh:18`.
- Deferral reason: secret-store inspection/rotation is operational and should not read or commit gitignored secrets in this review cycle.
- Exit criterion: reopen if secrets were shared in logs/tickets or copied from historical examples.

### AGG-C27-R04 - Existing host private-original modes need one-time inspection after code fix

- Severity/confidence: Medium if permissive modes are present / Medium
- Citations: `apps/web/scripts/migrate.js:71-110`.
- Deferral reason: live filesystem validation. Code-side mode normalization is scheduled under AGG-C27-04.
- Exit criterion: reopen after deploy if `data/uploads/original` contains group/world-readable files or directories.

### AGG-C27-R05 - Production semantic-search/demo expectations remain operator-state-dependent

- Severity/confidence: Low-Medium / High
- Citations: `README.md:21-42`, `CLAUDE.md:159`, `apps/web/src/app/api/search/semantic/route.ts:196-289`, `apps/web/src/app/api/search/similar/[id]/route.ts:121-125`.
- Deferral reason: host state/marketing validation, not a source defect. Repo docs already state production activation is operator-enabled and must be verified.
- Exit criterion: reopen before public release notes, demo campaigns, or semantic-search marketing changes.

### AGG-C27-R06 - Nav screenshots are artifacts, not visual-regression assertions

- Severity/confidence: Low / Medium
- Citations: `apps/web/e2e/nav-visual-check.spec.ts:6-78`.
- Deferral reason: visual snapshot baselines are a QA process choice, not a correctness/security issue.
- Exit criterion: reopen when visual fidelity becomes a release gate or nav styling is redesigned.

### AGG-C27-R07 - DB-backed UI/browser flows need manual validation after local DB was unavailable

- Severity/confidence: Low-Medium / Medium
- Citations: `ui-ux-designer-reviewer.md` runtime blocker notes; DB-backed public/admin routes.
- Deferral reason: local MySQL refused `127.0.0.1:3306`, so browser validation was partial. Source/test checks remain scheduled for concrete findings.
- Exit criterion: reopen when a seeded local/prod-like DB is available for browser QA.

### AGG-C27-R08 - Browser color/HDR support matrix can drift faster than repo tests

- Severity/confidence: Low / Medium
- Citations: `CLAUDE.md:367-381`.
- Deferral reason: external browser support validation. No current code/doc mismatch was proven.
- Exit criterion: reopen when editing color/HDR docs or browser capability code.

### AGG-C27-R09 - Exact "2000+ tests" prose was not re-proven during review

- Severity/confidence: Low / Medium
- Citations: `AGENTS.md:32-38`.
- Deferral reason: wording freshness risk only; Prompt 3 still runs the full configured gate list.
- Exit criterion: reopen if exact test-count claims are used in release documentation or if full suite count drops materially.

## Non-Findings / Not Re-Filed

- No new confirmed performance regression was found by `perf-reviewer`; existing performance debts remain tracked in prior deferred files.
- No new confirmed/likely source security defect was found by `security-reviewer`; operations risks are listed above.
- 2FA/WebAuthn and Stripe/paid-download work remain explicit product non-goals in `CLAUDE.md` and were not re-filed.
- Known cycle-26 deferred items such as approximate analytics, upload lock span, GPS-strip buffering, masonry/map/CSV/timeline/nav/SW performance, and semantic-search host activation were not duplicated except where cycle-27 reviewers found a new evidence angle.
