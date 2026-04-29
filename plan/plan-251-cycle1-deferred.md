# Plan 251 — Cycle 1 deferred findings

This file records every aggregate finding not fully implemented in Plan 250. Severities/confidences are preserved from the reviews. Deferred work remains bound by repo policy: signed gitmoji commits, no `--no-verify`, whole-repo gates, Node 24+, and the single-writer deployment constraints documented in `CLAUDE.md` unless/until architecture changes are implemented.

## Repo rules read before deferral
- `CLAUDE.md`: explicitly documents single web-instance / single-writer topology, approximate shared-group view counts, multi-root-admin model, and Docker/private-original/public-derivative persistence requirements.
- `AGENTS.md`: all changes must be committed and pushed with gitmoji; lint/typecheck/tests/static analysis required after changes.
- `.context/**`: prior review/plan artifacts require no silent drops and preserved severity.
- `.cursorrules`: absent.
- `CONTRIBUTING.md`: absent.
- `docs/`: no repo docs directory present.

## Deferred items

### DEF-36 — Production CSP keeps `style-src 'unsafe-inline'`
- Citation: `apps/web/src/lib/content-security-policy.ts:78-88`, especially `style-src` at `:81`.
- Original severity/confidence: Low / High (SEC-04).
- Reason for deferral: hardening-only defense-in-depth; removing inline styles requires framework/component audit and may break Radix/Next inline style behavior. Not a confirmed XSS path.
- Exit criterion: any HTML injection finding, CSP hardening sprint, or confirmed list of inline-style dependencies with nonce/hash replacement plan.

### DEF-37 — Public first-page exact count query hot path
- Citation: `apps/web/src/lib/data.ts:435-464`, `apps/web/src/app/[locale]/(public)/page.tsx:14-16`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:156-166`.
- Original severity/confidence: Medium / High (PERF-01).
- Reason for deferral: performance optimization; no correctness/security/data-loss failure confirmed. Cursor pagination in Plan 250 reduces part of the feed pressure first.
- Exit criterion: gallery >10k images, observed slow TTFB/query CPU, or query-plan evidence showing count window dominates page latency.

### DEF-38 — Search leading-wildcard scans
- Citation: `apps/web/src/lib/data.ts:810-905`, `apps/web/src/components/search.tsx:89-100`.
- Original severity/confidence: Medium-High / High (PERF-02).
- Reason for deferral: requires search-index design (FULLTEXT/materialized tokens/external service). Current rate limits/debounce reduce abuse; no confirmed outage.
- Exit criterion: search latency/DB CPU incident, dataset scale threshold, or product requirement for large-gallery search.

### DEF-39 — Upload preview renders all selected originals
- Citation: `apps/web/src/components/upload-dropzone.tsx:43-47`, `:86-108`, `:389-418`; limits in `apps/web/src/lib/upload-limits.ts:1-3`.
- Original severity/confidence: High / High (PERF-03).
- Reason for deferral: performance/UI scalability requiring thumbnail virtualization/worker design. It is not security/correctness/data-loss; current cycle prioritizes server-side security/correctness gates.
- Exit criterion: browser memory crash report, mobile upload UX target, or explicit image-preview virtualization task.

### DEF-40 — One queue job can saturate CPU via parallel encoders/libvips
- Citation: `apps/web/src/lib/process-image.ts:17-26`, `:389-478`, `apps/web/src/lib/image-queue.ts:121-132`.
- Original severity/confidence: Medium / High (PERF-05).
- Reason for deferral: performance/resource tuning needs benchmark and deployment defaults; no confirmed correctness loss. Queue retry correctness is fixed in Plan 250 first.
- Exit criterion: CPU saturation incident during uploads, deployment to smaller hosts, or requirement for separate worker/container.

### DEF-41 — CSV export materializes 50k rows through a Server Action
- Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:53-58`, `:76-124`, UI at `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:94-114`.
- Original severity/confidence: Medium / High (PERF-06).
- Reason for deferral: performance/memory improvement requiring streaming API route and auth/download design. No confirmed data corruption/security failure.
- Exit criterion: large export failure, memory pressure, or export performance milestone.

### DEF-42 — Shared selected-photo pages hydrate full group payload
- Citation: `apps/web/src/lib/data.ts:702-740`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:29-38`, `:99-107`, `:170-193`.
- Original severity/confidence: Medium-Low / Medium-High (PERF-07).
- Reason for deferral: performance/shape optimization; current 100-image cap bounds blast radius.
- Exit criterion: shared-group mobile latency issue, crawler load concern, or raising group size limits.

### DEF-43 — Node upload fallback lacks conditional/range support
- Citation: `apps/web/src/lib/serve-upload.ts:69-99`, nginx preferred path at `apps/web/nginx/default.conf:96-105`.
- Original severity/confidence: Low / Medium (PERF-08).
- Reason for deferral: deployment performance hardening; nginx/CDN path is documented preferred production route.
- Exit criterion: supported deployment without nginx/CDN, static asset latency issue, or platform requiring Node upload serving.

### DEF-44 — React/TSX component behavior outside unit gate
- Citation: `apps/web/vitest.config.ts:10-12`, examples `apps/web/src/components/image-manager.tsx:62-193`, `apps/web/src/components/photo-viewer.tsx:303-328`.
- Original severity/confidence: High / High (TE-01).
- Reason for deferral: test infrastructure expansion (DOM/jsdom/component harness) rather than confirmed product bug. UI issues fixed in Plan 250 add targeted lightweight tests where practical.
- Exit criterion: component refactor, recurring UI regression, or adoption of Vitest browser/jsdom lane.

### DEF-45 — Sharing server actions lack behavioral unit coverage
- Citation: `apps/web/src/app/actions/sharing.ts:92-391`, export at `apps/web/src/app/actions.ts:16-17`.
- Original severity/confidence: High / High (TE-02).
- Reason for deferral: coverage gap only; no confirmed action bug from review. Requires extensive mocks for auth/origin/DB/audit/revalidation/rate-limit.
- Exit criterion: modifying sharing actions, share-link incident, or dedicated server-action behavior test sprint.

### DEF-46 — Visual check writes screenshots without baselines
- Citation: `apps/web/e2e/nav-visual-check.spec.ts:14`, `:27`, `:39`; config `apps/web/playwright.config.ts:59-61`.
- Original severity/confidence: Medium / High (TE-03).
- Reason for deferral: test-quality improvement; current e2e still asserts control visibility.
- Exit criterion: visual regression task, snapshot baseline approval, or nav layout issue.

### DEF-47 — Source-contract tests stand in for behavior
- Citation: examples `apps/web/src/__tests__/data-view-count-flush.test.ts:13-122`, `settings-image-sizes-lock.test.ts:5-22`, `images-delete-revalidation.test.ts:5-23`, `auth-rate-limit-ordering.test.ts:19-104`.
- Original severity/confidence: Medium / High (TE-04).
- Reason for deferral: test-suite architecture improvement; no single confirmed runtime failure. Plan 250 adds focused behavior/source guards for changed invariants.
- Exit criterion: touching those modules, flaky/source-test false positive, or test-hardening sprint.

### DEF-48 — Middleware/metadata/OG route coverage thin
- Citation: `apps/web/src/proxy.ts:73-107`, `apps/web/src/app/sitemap.ts:24-77`, `robots.ts:10-18`, `manifest.ts:6-30`, `api/og/route.tsx:26-194`.
- Original severity/confidence: Medium / High (TE-06).
- Reason for deferral: coverage gap without confirmed route defect; route-level mocks are broader than this cycle’s fixes.
- Exit criterion: SEO/middleware/OG refactor or crawler/social-preview incident.

### DEF-49 — Touch-target gate permits known admin controls
- Citation: `apps/web/src/__tests__/touch-target-audit.test.ts:81-190`, assertion `:417-470`.
- Original severity/confidence: Low-Medium / High (TE-07).
- Reason for deferral: Plan 250 fixes several specific target-size issues; replacing the entire audit policy is a separate test-governance change.
- Exit criterion: after known violations are reduced, split strict/public vs admin-debt gates.

### DEF-50 — Full gallery backup/restore bundle not implemented
- Citation: SQL-only backup/restore `apps/web/src/app/[locale]/admin/db-actions.ts:127-250`, `:350-490`; file roots `apps/web/src/lib/upload-paths.ts:11-46`; compose volumes `apps/web/docker-compose.yml:22-25`.
- Original severity/confidence: Medium-High / High (A2).
- Reason for deferral: Plan 250 mitigates the misleading claim by documenting/labeling database-only backup/restore. Full gallery bundle/manifest/checksum restore is a major feature, not required by existing repo rules. `CLAUDE.md` already requires both private originals and public derivatives to be persisted in Docker, which supports deferring a new bundle feature while preserving operator responsibility.
- Exit criterion: user requests full disaster recovery, restore-to-fresh-host workflow, or missing-file incident after DB restore.

### DEF-51 — Runtime single-writer lease not enforced
- Citation: documented invariant `CLAUDE.md:146`; process-local state `apps/web/src/lib/restore-maintenance.ts:1-56`, `upload-tracker-state.ts:7-20`, `data.ts:11-23`, `image-queue.ts:121-140`, health `apps/web/src/app/api/health/route.ts:7-9`.
- Original severity/confidence: Medium / High (A3).
- Reason for deferral: `CLAUDE.md` explicitly documents the single web-instance / single-writer topology; enforcing a DB-backed lease changes deployment semantics and may break legitimate dev/test workflows. Plan 250 improves docs/config guardrails.
- Exit criterion: multi-instance deployment requirement or evidence of two writers sharing one DB/uploads root.

### DEF-52 — Build-time/runtime `IMAGE_BASE_URL` startup manifest enforcement
- Citation: build parse `apps/web/next.config.ts:8-28`, remote patterns `:77-80`, runtime constants `apps/web/src/lib/constants.ts:6-7`, image URL `apps/web/src/lib/image-url.ts:4-9`, Docker args/env `apps/web/Dockerfile:35-38`, compose `apps/web/docker-compose.yml:7-20`.
- Original severity/confidence: Medium / High (A4).
- Reason for deferral: Plan 250 improves build/docs guardrails; generating and enforcing a runtime build manifest is a broader deployment-contract change. Current README already warns that `IMAGE_BASE_URL` must be set before building.
- Exit criterion: runtime image-origin mismatch incident, CDN migration, or explicit deployment-hardening task.

### DEF-53 — Topic image resource crash orphan cleanup
- Citation: final write `apps/web/src/lib/process-topic-image.ts:42-80`, temp cleanup `:95-102`, callers `apps/web/src/app/actions/topics.ts:112-153`, `:214-286`.
- Original severity/confidence: Low / Medium-High (A7).
- Reason for deferral: low-severity crash-consistency file leak; normal error paths already cleanup. Not data loss/security.
- Exit criterion: resource directory growth/orphan report, topic image lifecycle refactor, or startup sweeper task.
