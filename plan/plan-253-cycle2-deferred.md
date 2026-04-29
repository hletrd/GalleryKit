# Plan 253 — Cycle 2 deferred findings

## Context
This file is the strict deferred ledger for findings produced in Cycle 2 Prompt 1. Every merged finding in `.context/reviews/_aggregate.md` is scheduled in `plan/plan-252-cycle2-review-fixes.md`; no current-cycle review finding is silently dropped.

## Repo rules read before deferral
- `CLAUDE.md`: security, auth/origin, upload/restore, single-writer topology, Node 24+, and secret-handling constraints.
- `AGENTS.md`: always commit and push; use gitmoji; run full gates; keep changes small and verified.
- `.context/**`: no silent deferrals; preserve original severity/confidence and exit criteria.
- `.cursorrules`: absent.
- `CONTRIBUTING.md`: absent.
- `docs/`: no repository docs directory present.

## Deferred items

Cycle 2 security/correctness/gate findings remain scheduled in `plan/plan-252-cycle2-review-fixes.md`. The items below are performance/operational findings that do not represent confirmed security, correctness, or data-loss failures and are deferred with preserved severity/confidence.

### DEF-C2-08 — Repo-local live deploy env file should move outside checkout
- Citation: `.env.deploy` (ignored local file present during review), `.env.deploy.example:1-5`, `scripts/deploy-remote.sh:4-49`.
- Original severity/confidence: Medium / High (SEC2-04).
- Reason for deferral: Credential rotation and confirming whether values were exposed are owner/ops actions; code changes can move the default env path and avoid printing values, but agents must not inspect or rotate secrets themselves. This is an operational exposure risk, not a code-level auth bypass.
- Exit criterion: any evidence the file contents were shared/logged, any repo archive including ignored files, or owner confirms values are real and need rotation.

### DEF-C2-11 — Public first-page exact counts and duplicate grouped metadata query
- Citation: `apps/web/src/lib/data.ts:486-515`, `apps/web/src/app/[locale]/(public)/page.tsx:14-16`, `apps/web/src/app/[locale]/(public)/page.tsx:78-81`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:164-166`.
- Original severity/confidence: Medium / High (PERF2-02).
- Reason for deferral: Performance-only optimization already tracked from Cycle 1; removing exact public counts changes visible product copy and needs a count/cache design. No security, correctness, or data-loss failure is confirmed.
- Exit criterion: gallery scale >10k images, slow TTFB/query CPU evidence, crawler load issue, or product approval to replace exact counts with approximate/hidden counts.

### DEF-C2-12 — Public search uses leading-wildcard scans
- Citation: `apps/web/src/app/actions/public.ts:115-174`, `apps/web/src/lib/data.ts:861-967`, `apps/web/src/components/search.tsx:89-100`.
- Original severity/confidence: Medium / High (PERF2-03).
- Reason for deferral: Requires search-index design (FULLTEXT/token table/external search) and relevance decisions. Current rate limits/debounce bound abuse; no confirmed outage or correctness issue.
- Exit criterion: search latency/DB CPU incident, large-gallery search requirement, or dedicated search-index migration.

### DEF-C2-13 — Shared selected-photo pages hydrate full group payload
- Citation: `apps/web/src/lib/data.ts:730-805`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:29-38`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:99-157`.
- Original severity/confidence: Medium / High (PERF2-04).
- Reason for deferral: Performance/data-shape optimization; current group size cap bounds payload and splitting accessors touches shared-page architecture.
- Exit criterion: shared-group mobile latency issue, crawler load concern, or raising group size limits.

### DEF-C2-14 — Upload previews render too many originals
- Citation: `apps/web/src/components/upload-dropzone.tsx:43-47`, `apps/web/src/components/upload-dropzone.tsx:81-160`, `apps/web/src/components/upload-dropzone.tsx:381-474`, `apps/web/src/lib/upload-limits.ts:1-17`.
- Original severity/confidence: High / High (PERF2-05).
- Reason for deferral: Browser performance/UX scalability project requiring preview virtualization or thumbnail generation. It is not security/correctness/data-loss; server-side upload limits remain enforced.
- Exit criterion: browser memory crash report, mobile upload UX target, or explicit preview virtualization task.

### DEF-C2-15 — Image processing can saturate web-runtime CPU
- Citation: `apps/web/src/lib/process-image.ts:17-26`, `apps/web/src/lib/process-image.ts:389-478`, `apps/web/src/lib/image-queue.ts:121-132`, `apps/web/src/app/actions/images.ts:373-388`.
- Original severity/confidence: Medium / High (PERF2-06).
- Reason for deferral: Deployment/performance tuning needs benchmarks and possibly a separate worker/container. No data-loss or correctness failure is confirmed.
- Exit criterion: upload processing causes public/admin latency incident, deployment to constrained hosts, or worker-container split milestone.

### DEF-C2-16 — Optional PhotoViewer modules are in the initial client chunk
- Citation: `apps/web/src/components/photo-viewer.tsx:3-20`, `apps/web/src/components/photo-viewer.tsx:634-651`, `apps/web/src/components/histogram.tsx:226-273`, `apps/web/src/components/lightbox.tsx:47-64`.
- Original severity/confidence: Medium-Low / Medium (PERF2-07).
- Reason for deferral: Bundle-size/perceived-performance optimization needs bundle analyzer proof and careful dynamic import boundaries; not a correctness/security issue.
- Exit criterion: mobile JS performance budget miss, bundle analyzer shows these modules dominate initial chunk, or photo-viewer perf sprint.

### DEF-C2-17 — CSV export should stream large datasets
- Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:53-58`, `apps/web/src/app/[locale]/admin/db-actions.ts:76-124`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:94-114`.
- Original severity/confidence: Medium / High (PERF2-08).
- Reason for deferral: Performance/memory improvement requiring a new authenticated streaming route and client download flow. Existing cap bounds blast radius; no security/correctness/data-loss failure is confirmed.
- Exit criterion: large export failure, memory pressure, or admin export performance milestone.


## Notes
Existing deferred items from Cycle 1 remain in `plan/plan-251-cycle1-deferred.md` with original severities/confidences preserved. If Prompt 3 proves any Cycle 2 item cannot be completed without a repo-rule-supported deferral, it must add that item here with citation, original severity/confidence, concrete deferral reason, quoted repo rule, and re-open criterion.
