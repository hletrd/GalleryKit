# Cycle 49/100 Aggregate Review

Start HEAD: `dc4f4acf` (user-provided current deployed `master` HEAD at cycle start).
Review date: 2026-07-01.

## Reviewer Artifacts

- `code-security-performance.md` - 0 findings.
- `verifier-test-debugger.md` - 1 finding.
- `architect-tracer.md` - 1 finding.
- `docs-deploy-drift.md` - 3 findings.
- `ui-ux-accessibility.md` - 0 findings.
- `product-photographer-critic.md` - 2 findings.

## Aggregate Findings

### C49-01 - Public photo pages are excluded from the documented offline HTML fallback

- Severity: Medium
- Confidence: High
- Sources: `C49-SW-01`, `C49-PPC-01`
- Evidence: `apps/web/public/sw.template.js:59`, `apps/web/public/sw.template.js:456`, `apps/web/public/sw.js:59`, `apps/web/src/__tests__/sw-template-contract.test.ts:71`, `CLAUDE.md:422`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:40`
- Problem: `/p/<id>` is classified as a revocable/share HTML route and bypasses `networkFirstHtml()`, contradicting the documented offline fallback contract for core public photo pages.
- Scheduled fix: remove `/p/<id>` from the bypass classifier, update the service-worker contract test, and regenerate `sw.js`.

### C49-02 - `deleteTopic` bypasses the topic-route advisory lock

- Severity: Medium
- Confidence: High
- Source: `architect-tracer.md`
- Evidence: `apps/web/src/app/actions/topics.ts:62`, `apps/web/src/app/actions/topics.ts:409`, `apps/web/src/app/actions/topics.ts:511`, `apps/web/src/db/schema.ts:14`, `apps/web/src/lib/advisory-locks.ts:24`
- Problem: topic create/update/alias mutations serialize route segments, but topic deletion does not, so a concurrent successful alias create can be cascade-deleted by an unlocked topic delete.
- Scheduled fix: wrap the delete transaction in `withTopicRouteMutationLock` and add a regression test.

### C49-03 - Cycle 48 closure state is stale after the artifact commit

- Severity: Low
- Confidence: High
- Source: `docs-deploy-drift.md`
- Evidence: `.context/plans/README.md:5`, `.context/plans/cycle-48-2026-07-01-plan.md:36`, `.context/reviews/_aggregate.md:3`, current HEAD `dc4f4acf`
- Problem: committed coordination docs still describe Cycle 48 as deploy-pending even though Cycle 49 starts from deployed `dc4f4acf`.
- Scheduled fix: update Cycle 48 plan/index/aggregate state to record closure and move the active pointer to Cycle 49.

### C49-04 - Action-origin gate docs drift around `auth.ts`

- Severity: Low
- Confidence: High
- Source: `docs-deploy-drift.md`
- Evidence: `CLAUDE.md:620`, `CLAUDE.md:631`, `apps/web/scripts/check-action-origin.ts:63`, `apps/web/scripts/check-action-origin.ts:1145`, `apps/web/src/__tests__/check-action-origin.test.ts:799`
- Problem: docs say `auth.ts` is excluded, but the scanner includes it and accepts the auth-specific `hasTrustedSameOrigin` guard shape.
- Scheduled fix: update the gate documentation to describe the actual scanner contract.

### C49-05 - Remote deploy setup omits the required `chmod 600` step

- Severity: Medium
- Confidence: High
- Source: `docs-deploy-drift.md`
- Evidence: `README.md:123`, `CLAUDE.md:681`, `.env.deploy.example:1`, `scripts/deploy-remote.sh:65`
- Problem: the documented copy/edit/run path creates `.env.deploy` with common group/world-readable permissions, but the deploy helper refuses to source unsafe permissions.
- Scheduled fix: document `chmod 600 .env.deploy` in setup/runbook surfaces and the example file comments.

### C49-06 - Force-show color chip copy overpromises public HDR badge visibility

- Severity: Low
- Confidence: High
- Source: `product-photographer-critic.md`
- Evidence: `apps/web/messages/en.json:768`, `apps/web/messages/ko.json:768`, `apps/web/src/app/[locale]/globals.css:160`, `apps/web/src/components/color-details-section.tsx:544`, `apps/web/src/components/lightbox-color-pip.tsx:188`
- Problem: admin copy implies public visitors can always see HDR badges, but HDR/source metadata remains admin-only until HDR delivery exists. Behavior is correct; copy is misleading.
- Scheduled fix: clarify English/Korean copy and Firefox detail text.

## Not Re-raised

The carried-forward deferred items from Cycle 48 are unchanged and not re-raised as new findings: `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`.

## Validation Already Run By Review Lanes

- `npm test --workspace=apps/web -- sw-template-contract.test.ts` passed before the scheduled service-worker fix; it currently locks the wrong `/p/<id>` bypass.
- UI/accessibility targeted tests passed: `touch-target-audit`, `focus-visible-links-scan`, `a11y-us-p15`, lightbox, picture fallback, bottom sheet IA, and privacy landmark contracts.
- Product/privacy targeted tests passed: `privacy-fields`, `photo-viewer-no-hdr-download`, `lightbox-color-pip-hdr`, and `download-labels`.
