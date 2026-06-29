# Plan 371 - Cycle 9/100 Deferred Findings

Created: 2026-06-29
Source: `.context/reviews/_aggregate.md` and cycle 9 per-agent reports.
Status: DEFERRED / MANUAL VALIDATION

This document records every cycle 9 finding not scheduled for implementation in `plan/plan-370-cycle9-fixes.md`. Severity/confidence is preserved from the aggregate or source review. Deferred work remains bound by repo policy: GPG-signed commits, Conventional Commits with gitmoji, no force-push/no-verify bypasses, required gates, migration rules, and per-cycle deploy policy when implemented.

## Deferred Findings

### C9-01 - First-page public listing queries aggregate tags and count the full matched set

- File+line citation: `apps/web/src/lib/data.ts:877-905`, `apps/web/src/lib/data.ts:1437-1452`, `apps/web/src/app/[locale]/(public)/page.tsx:149-166`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-176`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`
- Original severity/confidence: High / High
- Reason for deferral: Performance-only query-shape refactor with broad data-layer blast radius. The current single-instance personal gallery has functioning pages and no review reported data loss, security exposure, or wrong results from this query shape. Implementing the split safely needs query benchmarks and careful updates to the existing `tagNamesAgg` contract noted in `CLAUDE.md`.
- Exit criterion: Re-open when first-page listing TTFB/DB CPU is observed as a production bottleneck, when the gallery grows beyond the current scale, or when a dedicated data-layer performance cycle can include `EXPLAIN` evidence and regression tests.

### C9-11 - Upload preview creates and renders every selected file at once

- File+line citation: `apps/web/src/components/upload-dropzone.tsx:45-49`, `apps/web/src/components/upload-dropzone.tsx:95-123`, `apps/web/src/components/upload-dropzone.tsx:458-490`
- Original severity/confidence: Medium / High
- Reason for deferral: Performance/UX issue, not security/correctness/data-loss. The current implementation already has `loading="lazy"` and `decoding="async"` mitigations. A proper fix should choose a preview-window/virtualization UX and test browser behavior with large local file selections.
- Exit criterion: Re-open if admins report upload-page jank/crashes with large selections, or when upload UX is scheduled for a focused browser-performance pass.

### C9-13 - AVIF bit-depth metadata can overstate the base/downloadable AVIF

- File+line citation: `apps/web/src/lib/process-image.ts:1018-1024`, `apps/web/src/lib/process-image.ts:1224-1262`, `apps/web/src/lib/process-image.ts:1409`, `apps/web/src/lib/image-queue.ts:542-560`, `apps/web/src/components/color-details-section.tsx:471-497`, `apps/web/src/components/lightbox-color-pip.tsx:237-256`
- Original severity/confidence: Low / Medium
- Reason for deferral: Likely issue needing a reproducible mixed-success Sharp/libheif fixture. The review did not prove the base/largest derivative can actually fall back after an earlier 10-bit success in current Sharp/libheif behavior. No repo rule permits deferring confirmed photographer-honesty defects, so this is deferred only as an unconfirmed likely issue pending fixture evidence.
- Exit criterion: Re-open immediately if a fixture or production image demonstrates a size-specific 10-bit-to-8-bit fallback while `avif_10bit=true`, or when color-pipeline tests can simulate per-size AVIF fallback behavior.

### C9-22 TE9-C03 - Playwright "visual" screenshots are generated artifacts, not visual assertions

- File+line citation: `.context/reviews/test-engineer.md:65`
- Original severity/confidence: Medium / High
- Reason for deferral: Quality-infrastructure gap, not a product runtime defect. Adding visual assertions requires choosing a baseline strategy, tolerances, artifact storage, and update workflow.
- Exit criterion: Re-open when visual regression coverage is prioritized or when a UI regression escapes existing DOM/a11y/source tests.

### C9-22 TE9-C04 - No coverage reporting or threshold gate exists for the critical test surface

- File+line citation: `.context/reviews/test-engineer.md:85`
- Original severity/confidence: Low / High
- Reason for deferral: Quality-infrastructure improvement that can create noisy/churn-heavy gate failures if introduced without scoped thresholds. Existing repo gates are already extensive and blocking.
- Exit criterion: Re-open when a coverage-policy cycle can define per-surface thresholds and exclusions without destabilizing current gates.

### C9-22 TE9-L01 - `backfillClipEmbeddings` server action is mostly source-contract tested, not behavior-tested

- File+line citation: `.context/reviews/test-engineer.md:108`
- Original severity/confidence: Low / Medium
- Reason for deferral: Low-severity coverage gap for an operator/admin path. Work item 6 covers the higher-risk automatic embedding retry issue first.
- Exit criterion: Re-open when CLIP backfill UI/actions are actively changed or before exposing additional in-app embedding backfill controls.

### C9-22 TE9-L02 - Local blocking-gate documentation omits Playwright e2e even though formal/CI coverage includes it

- File+line citation: `.context/reviews/test-engineer.md:130`
- Original severity/confidence: Low / High
- Reason for deferral: Documentation/process gap. The orchestrator-provided `GATES` for this cycle intentionally excludes e2e, while repo docs distinguish unit/full gates from `test:e2e`. Changing the blocking local gate list would materially expand per-cycle runtime and environment requirements.
- Exit criterion: Re-open if the user wants Playwright e2e in every review-plan-fix cycle, or if CI/local policy changes to make e2e blocking for ordinary commits.

### C9-22 TE9-R01 - Playwright project coverage is Chromium-only

- File+line citation: `.context/reviews/test-engineer.md:153`
- Original severity/confidence: Low / High
- Reason for deferral: Manual/browser-matrix risk rather than a confirmed defect. Adding WebKit/Firefox/mobile engines requires environment validation and flake budget planning.
- Exit criterion: Re-open when browser-engine parity becomes release-blocking or a browser-specific regression is reported.

## Manual Validation / Operational Risks

### Process-local coordination remains valid only for the documented single web-instance topology

- File+line citation: `CLAUDE.md:227-229`, `apps/web/src/lib/data.ts:17-33`, `apps/web/src/lib/rate-limit.ts:81-89`, `apps/web/src/lib/admin-backfill-runner.ts:1-80`
- Original severity/confidence: Medium / High
- Reason for deferral: Operational topology risk already documented in `CLAUDE.md`; not a code defect in the shipped single-instance deployment.
- Exit criterion: Re-open before any horizontal scaling, blue/green overlap, PM2 clustering, or multi-process deployment.

### DB-only restore can drift from file storage

- File+line citation: `CLAUDE.md:208-210`, `apps/web/messages/en.json:18-24`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:144-231`, `apps/web/src/app/[locale]/admin/db-actions.ts:157-583`
- Original severity/confidence: Medium / High
- Reason for deferral: Operational recovery limitation explicitly disclosed in docs/UI. It requires backup/reconciliation product work, not a cycle 9 bug fix.
- Exit criterion: Re-open if users expect DB restore to roll back files, or when adding filesystem backup/reconciliation features.

### Production semantic search depends on env, DB setting, weights, and embeddings staying aligned

- File+line citation: `README.md:37`, `apps/web/README.md:53-73`, `CLAUDE.md:151`, `apps/web/src/lib/gallery-config.ts:123-142`, `apps/web/src/app/api/search/semantic/route.ts:156-260`
- Original severity/confidence: Low / Medium to Medium / High depending on source lane
- Reason for deferral: Runtime/operator validation risk. The document-specialist lane smoke-tested the live demo successfully during review, and code gates are honest.
- Exit criterion: Re-open if demo semantic search returns disabled/503 unexpectedly, after host migration, after DB restore, or when adding a deploy smoke script.

### TLS/HSTS and TRUST_PROXY safety depend on production ingress topology

- File+line citation: `apps/web/nginx/default.conf:21-31`, `apps/web/nginx/default.conf:47-53`, `apps/web/docker-compose.yml:14-21`, `apps/web/src/lib/request-origin.ts:45-107`, `README.md:145-151`
- Original severity/confidence: High if misdeployed / Medium; Medium / High
- Reason for deferral: Deployment validation risk, not a repo code defect under the documented reverse-proxy topology.
- Exit criterion: Re-open if app port 3000 is exposed directly, if the edge stops stripping/setting forwarded headers, or if public HTTP reaches the app without redirect/blocking.

### Multiple root admins and deferred 2FA fit only the current personal-gallery threat model

- File+line citation: `CLAUDE.md:228`, `CLAUDE.md:552-553`, `apps/web/src/lib/admin-tokens.ts:24-25`, `apps/web/src/app/[locale]/admin/db-actions.ts:47-52`
- Original severity/confidence: Medium / High
- Reason for deferral: Product threat-model decision explicitly recorded in `CLAUDE.md` under "Permanently Deferred". This remains acceptable only while all admins are equally trusted.
- Exit criterion: Re-open if semi-trusted assistants, clients, contractors, or public admin teams are added.

### Plaintext DB backups at rest depend on host controls

- File+line citation: `CLAUDE.md:208-209`, `apps/web/src/app/[locale]/admin/db-actions.ts:140-166`, `apps/web/src/app/api/admin/db/download/route.ts:78-86`
- Original severity/confidence: Low to Medium / High
- Reason for deferral: Operational storage-control risk. Current backups are non-public, authenticated, and mode-limited; encryption-at-rest policy belongs to host/backup operations unless product-scoped encrypted dumps are requested.
- Exit criterion: Re-open if backups leave encrypted/trusted storage, if host backup access broadens, or when adding encrypted backup support.

### Custom modal shells need real assistive-technology validation

- File+line citation: `apps/web/src/components/search.tsx:320-340`, `apps/web/src/components/lightbox.tsx:446-453`, `apps/web/src/components/info-bottom-sheet.tsx:185-199`
- Original severity/confidence: Medium / Medium
- Reason for deferral: Manual AT validation risk, not a confirmed Chromium keyboard/a11y failure. Designer browser checks found Tab trapping and basic dialog semantics working.
- Exit criterion: Re-open after VoiceOver/NVDA/JAWS validation finds background virtual-cursor leakage, or when replacing custom modal shells with Radix Dialog.

### Authenticated admin UI needs live browser coverage with auth state

- File+line citation: `apps/web/src/app/[locale]/admin/login-form.tsx:47-104`, `apps/web/src/__tests__/touch-target-audit.test.ts:42-65`
- Original severity/confidence: Low / High
- Reason for deferral: Coverage risk blocked by lack of local seeded DB/auth state during the review lane. Source and unit audits cover current admin controls.
- Exit criterion: Re-open when a reusable non-production auth state or seeded local DB is available for browser smoke coverage.

### Sidecar runbooks pin `tsx@4.21.0` while repo uses `tsx ^4.22.4`

- File+line citation: `CLAUDE.md:349`, `CLAUDE.md:506`, `CLAUDE.md:521`, `apps/web/package.json:82`
- Original severity/confidence: Low / Medium
- Reason for deferral: Operator-runbook drift risk. No current sidecar failure was reported; changing the pinned version should be validated against production sidecar behavior.
- Exit criterion: Re-open if sidecar scripts fail under the pinned version or when standardizing maintenance runbook tool versions.

