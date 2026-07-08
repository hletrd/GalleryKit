# Run-10 Cycle 34/100 Deferred Findings

Status: OPEN
Aggregate: `.context/reviews/run10-cycle34/_aggregate.md` and rolling `.context/reviews/_aggregate.md`
Date: 2026-07-08 KST

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`, README files, and Cycle 34 review artifacts. No confirmed security, correctness, or data-loss finding is deferred here.

## Deferred Items

### C34-07 - Background DB connection budgets are fragmented across image queue and backfills

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:106-143`; `apps/web/src/lib/background-db-writes.ts`; `CLAUDE.md` DB pool budget note.
- Reason for deferral: broad scheduler/resource-governor architecture spanning image queue, admin backfill, analytics writes, maintenance, and sidecars. Cycle 34 schedules the contained shutdown and sidecar-lock correctness fixes first.
- Exit criterion: schedule when implementing a shared background resource governor, changing pool/concurrency formulas, adding observability for DB pool saturation, or seeing production queue-limit/pool-exhaustion evidence.

### C34-09 - Semantic embedding bootstrap and sidecars do not coordinate on one work owner

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/lib/image-queue.ts`; `apps/web/scripts/backfill-clip-embeddings.ts`; `apps/web/src/app/actions/embeddings.ts`; `.context/reviews/architect.md`.
- Reason for deferral: design/test-infra coordination work across operator sidecars, upload/bootstrap embeddings, and semantic backfill. No contained data-loss or auth/security bug was confirmed in this cycle.
- Exit criterion: schedule when changing semantic activation/backfill ownership, modifying CLIP model-version selection, or adding production semantic-search activation automation.

### C34-10 - Large Server Action upload and restore bodies are admitted after framework parsing

- Original severity/confidence: High / High.
- Citations: `apps/web/next.config.ts:111-119`; `apps/web/src/app/actions/images.ts:87-106`; `apps/web/src/app/[locale]/admin/db-actions.ts:789-810`; `.context/reviews/perf-reviewer.md`; `.context/reviews/debugger.md`.
- Reason for deferral: performance/resource architecture migration from Server Actions to streaming route handlers. This needs browser-flow/e2e coverage and operator memory-budget validation; Cycle 34 handles narrower upload correctness and containment bugs.
- Exit criterion: schedule when working on upload/restore ingestion architecture, measuring production RSS envelope, or seeing OOM/GC stalls during large browser uploads/restores.

### C34-11 - Search/timeline/map performance paths still rely on scan-heavy query shapes

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/lib/data.ts` public search/map query paths; `apps/web/src/lib/data-timeline.ts`; `.context/reviews/perf-reviewer.md`.
- Reason for deferral: schema/index/query redesign and product pagination/UX decisions are broader than this correctness-focused cycle.
- Exit criterion: schedule when catalog size or production query latency crosses acceptable thresholds, or when adding generated date columns, full-text/ngram search, map clustering, or indexed public discovery work.

### C34-12 - Test strategy gaps remain despite high raw test count

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/test-engineer.md`.
- Reason for deferral: test-infra expansion across coverage measurement, visual comparison, browser matrix, CLIP preflight, and sidecar behavioral tests is a separate quality program. Cycle 34 adds focused regression tests for scheduled fixes.
- Exit criterion: schedule during a test-infra hardening cycle, when changing semantic/sidecar/browser behavior, or when CI starts enforcing coverage/visual/browser-matrix gates.

### C34-13 - Public/admin UX field association and responsive issues

- Original severity/confidence: Medium / High for SEO field-error issue; mixed for other UI findings.
- Citations: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:75-208`; `apps/web/src/app/actions/seo.ts:85-139`; `.context/reviews/designer.md`.
- Reason for deferral: UI behavior changes need structured field-error design, browser-flow validation, and potentially new i18n keys. Cycle 34 does not otherwise touch browser UX.
- Exit criterion: schedule when editing SEO/taxonomy/admin responsive flows, when an authenticated admin a11y pass is available, or when adding structured server-action field errors.

### C34-14 - Checked-in Atik site-config can become a fresh deploy's public identity

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/site-config.json`; `apps/web/scripts/ensure-site-config.mjs`; `README.md`; `apps/web/README.md`; `.context/reviews/product-marketer-reviewer.md`.
- Reason for deferral: product/distribution decision. The primary gallery deployment uses this repository and file-backed static fields are build-time-inlined, so replacing or rejecting the tracked real config could affect the configured production target without an explicit distribution plan.
- Exit criterion: schedule when preparing a distributable release, changing deployment config policy, or deciding to require an explicit allow flag for deployment-specific `site-config.json`.

### C34-15 - Operational/manual validation risks remain outside repository proof

- Original severity/confidence: Medium mixed / High that manual validation is required.
- Citations: proxy/nginx docs and scripts; CLIP runbook/tests; backup/privacy docs; `.context/reviews/code-reviewer.md`; `.context/reviews/security-reviewer.md`; `.context/reviews/verifier.md`; `.context/reviews/document-specialist.md`.
- Reason for deferral: host nginx/real-IP state, CLIP seeded weights/env/DB state, upload RSS envelope, runtime secret rotation, plaintext backup boundary, and service-worker offline freshness require operator or live-host validation beyond source edits. Cycle 34 will still perform required post-deploy `/api/live` and missing-upload 404 smoke.
- Exit criterion: schedule when operator credentials/context are available for those checks, when proxy/CLIP/backup/offline behavior changes, or when production evidence contradicts documented assumptions.

## Carry-Forward Note

Earlier deferred findings remain in their authoritative home registers and `.context/plans/deferred-carry-forward.md`. No Cycle 34 deferred item supersedes those records unless a future cycle explicitly updates the carry-forward register.
