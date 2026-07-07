# Run-10 Cycle 5/100 Deferred Findings

Date: 2026-07-07
Aggregate source: `.context/reviews/_aggregate.md`

Deferred items preserve original severity/confidence. Security, correctness, and data-loss issues are not deferred here unless an explicit repo rule or upstream blocker is recorded.

## Deferred Items

### DEF-C5-07 - Timeline/on-this-day non-sargable date functions

- Aggregate: C5-07
- Citation: `apps/web/src/lib/data-timeline.ts:88-116`, `apps/web/src/lib/data-timeline.ts:129-142`, `apps/web/src/lib/data-timeline.ts:178-207`
- Original severity/confidence: Medium-Low / Medium
- Reason for deferral: scale-sensitive performance improvement requiring either generated columns/functional indexes or caching design. No current review produced production slow-query evidence, and adding generated columns expands schema/product surface beyond the higher-confidence cycle-5 fixes.
- Exit criterion: production-like `EXPLAIN`/slow-query/LCP evidence shows timeline/on-this-day scans are hot, or a future schema cycle already adds generated date-part columns.

### DEF-C5-08 - Public LIKE search leading-wildcard scan

- Aggregate: C5-08
- Citation: `apps/web/src/lib/data.ts:1573-1716`, `apps/web/src/app/actions/public.ts:247-329`
- Original severity/confidence: Low-Medium / Medium
- Reason for deferral: performance risk needs production-like query evidence and a search design decision (FULLTEXT/generated search rows/tokenized search). Current per-IP and result caps bound public exposure at personal-gallery scale.
- Exit criterion: slow-query logs, user-visible search latency, or dataset growth show public LIKE search as a bottleneck.

### DEF-C5-09 - Warm-cache service-worker HEAD probe cost

- Aggregate: C5-09
- Citation: `apps/web/public/sw.template.js:31-39`, `apps/web/public/sw.template.js:365-397`
- Original severity/confidence: Low-Medium / Medium-Low
- Reason for deferral: validation-needed performance risk. Changing the HEAD freshness strategy risks weakening the repo's documented same-filename derivative freshness guarantee; measurement must precede policy change.
- Exit criterion: throttled browser traces show warm-cache HEAD probes materially degrade image paint or overload the server.

### DEF-C5-14 - CLIP production activation tests are outside default CI

- Aggregate: C5-14
- Citation: `apps/web/src/__tests__/clip-offline-load.test.ts:1-65`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:1-80`, `README.md:42`, `CLAUDE.md:160`
- Original severity/confidence: Medium manual-validation risk / High
- Reason for deferral: repo policy explicitly makes these operator/manual gates because CI has no model weights. CLAUDE.md states: "they are permanently skipped in CI (CI has no model weights), so this manual pre-flight is the ONLY verification that the real encoder loads offline and ranks semantically."
- Exit criterion: CLIP production settings, model paths, provider revision, or activation workflow changes; then record the env-gated integration test evidence before enabling production.

### DEF-C5-15 - Authenticated admin browser coverage can be skipped in local loops

- Aggregate: C5-15
- Citation: `apps/web/e2e/admin.spec.ts:6-12`, `apps/web/e2e/origin-guard.spec.ts:28-30`, `apps/web/e2e/origin-guard.spec.ts:55-57`
- Original severity/confidence: Medium manual-validation risk / Medium
- Reason for deferral: environment-dependent browser-flow validation, not a source defect. The current cycle will run e2e when browser-flow coverage is required by touched code; future admin/upload/delete/settings/restore changes must carry configured e2e evidence or targeted behavior tests.
- Exit criterion: this cycle touches admin browser flows, or CI/local policy changes to guarantee admin credentials for every e2e run.

### DEF-C5-16 - Static derivative setting changes remain stale until backfill

- Aggregate: C5-16
- Citation: `apps/web/src/app/actions/settings.ts:86-199`, `apps/web/src/lib/serve-upload.ts:240-265`
- Original severity/confidence: Medium manual-validation risk / Medium
- Reason for deferral: this is an explicit repo contract, not a silent defect. CLAUDE.md states: "Flipping any of these requires a backfill pass to re-encode existing photos at the new settings" and documents the static-path invalidation gotcha.
- Exit criterion: settings/backfill UI changes, operator reports confusion despite the warning, or product decides settings saves should enqueue/force a re-encode automatically.

### DEF-C5-17 - Delete flow clears queue state before DB/file deletion

- Aggregate: C5-17
- Citation: `apps/web/src/app/actions/images.ts:707-756`, `apps/web/src/app/actions/images.ts:825-923`, `apps/web/src/lib/image-queue.ts:378-480`
- Original severity/confidence: Low / Low
- Reason for deferral: low-confidence operational trace risk with no confirmed bug. Delete cancellation before DB/file deletion appears intentional to stop processing first.
- Exit criterion: observed partial-delete recovery issue, or a future delete-flow change revisits ordering and can add focused assertions cheaply.

### DEF-C5-18 - Broad `ProcessingQueueState` partitioning after maintenance extraction

- Aggregate: C5-18
- Citation: `apps/web/src/lib/image-queue.ts:317-433`
- Original severity/confidence: Low-Medium / Medium
- Reason for deferral: WP1 schedules the highest-value state split (maintenance scheduler). The remaining partitioning is an architectural cleanup without a newly confirmed crash.
- Exit criterion: another lifecycle bug appears in queue global state, or a future image-queue refactor touches embedding scan/retry/shutdown ownership.

### DEF-C5-20 - Smart collections lack admin-operable authoring

- Aggregate: C5-20
- Citation: `CLAUDE.md:162`, `apps/web/src/app/actions/collections.ts:16-150`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-164`, `apps/web/src/components/admin-nav.tsx:15-25`
- Original severity/confidence: Medium product/UX issue / High
- Reason for deferral: explicit product-scope boundary. CLAUDE.md states: "no admin UI or API surface invokes them yet" and "Do not document smart-collection authoring as an operable admin feature until a UI ships." WP8 keeps docs/product copy honest; building a full predicate-builder UI is new feature scope, not a cycle-5 bug fix.
- Exit criterion: user requests smart-collection admin authoring, public docs start marketing authoring, or product decides to ship a Collections admin UI.

### DEF-C5-22 - Live Core Web Vitals were not measured

- Aggregate: C5-22
- Citation: public home/topic/photo/share flows and mobile admin routes
- Original severity/confidence: Medium manual-validation risk / Medium
- Reason for deferral: measurement requirement, not a source finding. This cycle will rely on gates plus targeted tests; full CWV traces require representative photo data and device/network profiles.
- Exit criterion: external launch/marketing copy, performance-sensitive UI changes, or observed LCP/CLS/INP regression.

### DEF-C5-23 - Future RTL locale support

- Aggregate: C5-23
- Citation: `apps/web/src/app/[locale]/layout.tsx:103-109`, `apps/web/src/lib/locale-path.ts:37-40`
- Original severity/confidence: Low manual-validation risk / Medium
- Reason for deferral: no RTL locale ships today; English and Korean are LTR. RTL validation belongs to the first RTL-locale feature branch.
- Exit criterion: an RTL locale is added or requested.

### DEF-C5-24 - Proxy trust and edge limiter deployment validation

- Aggregate: C5-24
- Citation: `apps/web/src/lib/request-origin.ts:45-107`, `apps/web/src/lib/rate-limit.ts:78-205`, `apps/web/docker-compose.yml:15-23`, `apps/web/nginx/default.conf`, `CLAUDE.md` deploy/nginx sections
- Original severity/confidence: Medium manual-validation risk / Medium
- Reason for deferral: operator/environment validation. CLAUDE.md explicitly says deploys do not touch host nginx and provides a manual apply/verify procedure for edge limiter changes.
- Exit criterion: nginx/proxy topology changes, scale-out is introduced, or the operator applies pending host-nginx config and records curl/nginx evidence.

### DEF-C5-25 - Plaintext DB backup storage

- Aggregate: C5-25
- Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:196-353`
- Original severity/confidence: Medium manual-validation risk / Medium
- Reason for deferral: operator storage/security boundary, not an app code defect. CLAUDE.md states DB dumps are plaintext at rest and host/storage encryption is the operator boundary.
- Exit criterion: product decides to implement application-level encrypted backups, off-host backup automation is added, or host security posture changes.

### DEF-C5-10-UPSTREAM - Dev/build esbuild advisory if safe override is unavailable

- Aggregate: C5-10
- Citation: `apps/web/package.json:70-85`, `package-lock.json`
- Original severity/confidence: Medium / High
- Reason for deferral: upstream-transitive blocker. WP9 verified with `npm view` on 2026-07-07 that `drizzle-kit@0.31.10` and `esbuild@0.28.1` are current latest. The root override already pins direct `esbuild` to `0.28.1`, but `npm explain esbuild --workspace=apps/web` still shows `@esbuild-kit/core-utils@3.3.2 -> esbuild@0.18.20` under current `drizzle-kit`. Forcing that nested package graph is not a safe local remediation without upstream support, so this remains deferred with original severity/confidence preserved.
- Exit criterion: `drizzle-kit` releases a patched dependency graph, or a tested override passes the full gate suite.
