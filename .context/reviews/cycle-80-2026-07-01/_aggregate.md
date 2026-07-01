# Cycle 80/100 Aggregate Review

Start HEAD: `8c4999c9294e0196608b4a0bce8078edc3be2366`.
Date: 2026-07-01.

## Review Lanes

- `code-reviewer.md`: one confirmed scanner coverage finding.
- `security-privacy-reviewer.md`: no new security/privacy finding.
- `performance-concurrency-reviewer.md`: one confirmed shutdown-drain finding.
- `test-verifier-reviewer.md`: one confirmed release-ledger finding.
- `architect-debugger-tracer.md`: one confirmed sidecar restore guard finding and one broader site-config contract issue.
- `designer-accessibility-reviewer.md`: one confirmed map accessibility finding and duplicate ledger confirmation.

## Deduplicated Findings

### C80-01 - Dynamic expensive imports bypass the public-route rate-limit scanner

- Severity: Medium
- Confidence: High
- Sources: `code-reviewer.md`
- Citations: `apps/web/scripts/check-public-route-rate-limit.ts:325`, `apps/web/scripts/check-public-route-rate-limit.ts:652`, `apps/web/scripts/check-public-route-rate-limit.ts:668`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:472`
- Problem: Static expensive imports are classified, but dynamic imports such as `await import('sharp')` or `await import('node:fs/promises')` are not treated as expensive public GET/HEAD work.
- Failure scenario: a future public route performs CPU/IO-heavy dynamic work without a pre-increment limiter and passes `npm run lint:public-route-rate-limit`.
- Suggested fix: fail closed on dynamic imports of expensive modules and add scanner fixtures.

### C80-02 - SIGTERM shutdown does not drain tracked background DB writes

- Severity: Medium
- Confidence: High
- Sources: `performance-concurrency-reviewer.md`
- Citations: `apps/web/src/lib/background-db-writes.ts:3`, `apps/web/src/lib/background-db-writes.ts:20`, `apps/web/src/lib/audit.ts:86`, `apps/web/src/app/actions/public.ts:431`, `apps/web/src/app/[locale]/admin/db-actions.ts:492`, `apps/web/src/instrumentation.ts:36`, `apps/web/src/instrumentation.ts:55`
- Problem: Restore drains tracked background DB writes, but normal graceful shutdown exits after draining only the image queue and shared-group buffer.
- Failure scenario: deploy or container stop can terminate an in-flight audit or analytics write before it settles.
- Suggested fix: expose a generic background-write drain and include it in instrumentation's bounded shutdown drain.

### C80-03 - Cycle 79 ledger still reads active and deploy-incomplete

- Severity: Medium
- Confidence: High
- Sources: `test-verifier-reviewer.md`, `designer-accessibility-reviewer.md`, main-agent check
- Citations: `AGENTS.md:17`, `CLAUDE.md:469`, `.context/plans/README.md:5`, `.context/plans/cycle-79-2026-07-01-plan.md:47`, `.context/plans/cycle-79-2026-07-01-plan.md:49`, `.context/plans/cycle-79-2026-07-01-plan.md:50`, `.context/reviews/_aggregate.md:3`
- Problem: Current HEAD is pushed and this cycle began from deployed `master` `8c4999c9`, but committed artifacts still present Cycle 79 as active and deploy-incomplete.
- Failure scenario: future agents/operators cannot infer whether Cycle 79's scanner hardening was shipped.
- Suggested fix: record terminal Cycle 79 evidence, move it to recent/closed, and advance the latest aggregate pointer.

### C80-04 - Alt-text backfill can write during restore maintenance

- Severity: Medium
- Confidence: High
- Sources: `architect-debugger-tracer.md`
- Citations: `apps/web/scripts/backfill-alt-text.ts:30`, `apps/web/scripts/backfill-alt-text.ts:49`, `apps/web/scripts/backfill-alt-text.ts:75`, `apps/web/scripts/backfill-alt-text.ts:107`, `apps/web/src/lib/restore-maintenance-durable.ts:57`, `apps/web/scripts/backfill-clip-embeddings.ts:109`, `apps/web/scripts/backfill-color-pipeline.ts:320`, `apps/web/src/__tests__/cycle-71-source-contracts.test.ts:18`
- Problem: `backfill-alt-text.ts` is a DB-mutating sidecar but lacks the durable restore-maintenance guard used by sibling backfill scripts.
- Failure scenario: an alt-text sidecar run during restore can interleave with table import and produce failed, lost, or stale suggested captions.
- Suggested fix: call `assertNoDurableRestoreMaintenanceForScript` before reads and before write batches, and extend the source contract test.

### C80-05 - Map popup thumbnail falls back to a bare numeric accessible label

- Severity: Low
- Confidence: High
- Sources: `designer-accessibility-reviewer.md`
- Citations: `apps/web/src/components/map/map-client.tsx:52`, `apps/web/src/components/map/map-client.tsx:125`, `apps/web/src/app/[locale]/(public)/map/page.tsx:81`, `apps/web/messages/en.json:699`, `apps/web/messages/ko.json:699`, `apps/web/src/__tests__/map-thumb-wiring.test.ts:34`
- Problem: Untitled map markers fall back to raw ids for thumbnail alt text and popup button labels instead of localized `Photo {id}` / `사진 {id}` labels.
- Failure scenario: a screen-reader user hears a numeric-only image/button label for an untitled map marker.
- Suggested fix: compute a localized marker display title on the server and use it consistently.

### C80-06 - `site-config.json` runtime/build-time contract is ambiguous

- Severity: Medium
- Confidence: Medium-High
- Sources: `architect-debugger-tracer.md`
- Citations: `apps/web/docker-compose.yml:24`, `CLAUDE.md:477`, `apps/web/README.md:55`, `CLAUDE.md:663`, `apps/web/src/app/[locale]/layout.tsx:11`, `apps/web/src/components/nav-client.tsx:14`, `apps/web/src/lib/data.ts:1794`
- Problem: Docs and Compose describe a runtime-mounted site config, while code imports the JSON statically at build time.
- Failure scenario: operators may edit the mounted file and restart expecting changed links, analytics, or fallback SEO, but bundled values can remain in effect.
- Suggested fix: choose a runtime-loader contract or build-time-only contract, then update code/docs/Compose together.

## Scheduled For Cycle 80

Schedule `C80-01` through `C80-05`. Defer `C80-06` because it requires a product/operator contract decision beyond this cycle's safe patch scope.

## Deferred Not Re-Raised

- `C77-ARCH-01`: restore maintenance does not globally drain every already-started foreground non-upload admin mutation.
- `C76-04`: bottom-sheet dropdown portal coverage remains source-shaped.
- `C76-05`: `getImageProcessingState` tests would miss processed-predicate drift.
- `C75-08`: bulk-edit validation alert association remains behavior-test deferred.
- Historical performance, semantic-search, settings re-encode, shared-view, and browser-matrix deferred items remain covered by prior deferred artifacts unless their recorded exit criteria are hit.
