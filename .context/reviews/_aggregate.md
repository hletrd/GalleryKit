# Cycle 2 Aggregate Review

Date: 2026-06-29
HEAD: `3d1387045e0d7f1e06fb48756e412228bbdaf08d`

Prompt 1 fan-out completed across all available required review roles. The native subagent tool exposed `worker`/`explorer`/`default` types, so required reviewer roles were run as worker lanes with role-specific prompts. UI/UX review was in scope because this is a Next.js web app. The UI lane used browser automation against a local dev server on port `3012`; public DB-backed pages were limited by local DB `ECONNREFUSED`, while `/en/admin` rendered and confirmed title evidence.

## Agent Outputs

- `code-reviewer.md`: 1 confirmed issue, 1 risk.
- `debugger.md`: duplicate confirmed issue, 1 risk.
- `perf-reviewer.md`: 6 performance findings.
- `architect.md`: 8 architecture findings.
- `security-reviewer.md`: no confirmed security defects; 2 operational risks.
- `critic.md`: no confirmed critic defects; 2 operational risks.
- `verifier.md`: 1 confirmed doc mismatch, 1 verification gap.
- `test-engineer.md`: 2 confirmed test gaps, 1 test-quality risk.
- `tracer.md`: 1 confirmed high-severity operator-flow issue, 1 semantic-search risk.
- `document-specialist.md`: duplicate high-severity operator-flow issue, 1 documentation risk.
- `designer.md`: 2 UI findings.
- `ui-ux-designer-reviewer.md`: duplicate 2 UI findings.
- `product-marketer-reviewer.md`: duplicate admin-title finding plus 2 metadata/copy findings.

## Merged Findings

### AGG-C2-01 - Gitignored `.claude/` enters Docker build context

Severity: Medium
Confidence: High
Status: Confirmed
Cross-agent agreement: `code-reviewer`, `debugger`

Citations: `.gitignore:30`, `.dockerignore:1-22`, `apps/web/docker-compose.yml:4-6`, `apps/web/Dockerfile:67-75`.

The root Docker context is the repository root and the Dockerfile performs `COPY . .`, but root `.dockerignore` excludes `.omx`, `.omc`, and `.agent` while missing `.claude/`. Local agent worktrees can therefore be sent to the builder, slowing deploys and risking local artifact leakage into layers.

Suggested fix: add `.claude/` to root `.dockerignore`; consider a static check aligning local runtime ignores.

### AGG-C2-02 - Timeline and on-this-day date queries are non-sargable

Severity: Medium
Confidence: High
Status: Confirmed performance issue
Cross-agent agreement: `perf-reviewer`

Citations: `apps/web/src/lib/data-timeline.ts:95-114`, `:127-143`, `:176-205`; `apps/web/src/components/on-this-day-widget.tsx:14-23`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:14,40-60`; `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:15,56-65`.

Public dynamic archive pages use `YEAR()`, `MONTH()`, and `DAY()` predicates over capture dates. Large archives can turn public requests into table/index scans and DB CPU spikes.

Suggested fix: use range predicates for year pages; consider generated/indexed month/day columns or a small anniversary cache for on-this-day.

### AGG-C2-03 - Map page loads up to 10,000 unclustered markers without query/index support

Severity: Medium
Confidence: High
Status: Confirmed performance issue
Cross-agent agreement: `perf-reviewer`

Citations: `apps/web/src/lib/data.ts:1624-1661`, `apps/web/src/db/schema.ts:111-117`, `apps/web/src/app/[locale]/(public)/map/page.tsx:9,30-63`, `apps/web/src/components/map/map-client.tsx:86-90,119-143`.

A GPS-heavy gallery can scan many rows, serialize thousands of markers, compute bounds over every point, and mount thousands of Leaflet markers on mobile.

Suggested fix: validate an index with `EXPLAIN`, then move to viewport loading or clustering before supporting large marker payloads.

### AGG-C2-04 - Production CLIP image embeddings bypass image-queue backpressure

Severity: Medium
Confidence: High
Status: Confirmed concurrency risk
Cross-agent agreement: `perf-reviewer`

Citations: `apps/web/src/lib/image-queue.ts:212`, `:414-449`, `:512-569`; `apps/web/src/lib/clip-model.ts:151-186`.

Sharp work is bounded by `QUEUE_CONCURRENCY`, but production embedding work is launched in a detached async task after image processing commits. Batch uploads can stack inference work alongside new Sharp jobs in the same Node process.

Suggested fix: route embeddings through a bounded queue such as `EMBEDDING_CONCURRENCY=1`, or await production embeddings inside the existing queue.

### AGG-C2-05 - Semantic search brute-force scans are request-path and newest-first bounded

Severity: Medium
Confidence: High
Status: Confirmed scaling/product-quality risk
Cross-agent agreement: `perf-reviewer`, `architect`, `tracer`, `document-specialist`

Citations: `apps/web/src/app/api/search/semantic/route.ts:240-281`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`, `apps/web/src/lib/clip-embeddings.ts:18-40,160-164`, `apps/web/README.md:61`.

Semantic and similar search read BLOB embeddings, score them synchronously in JS, sort candidates, and scan newest rows first up to `SEMANTIC_SCAN_LIMIT`. Larger galleries can omit older relevant images or block the event loop if the cap is raised.

Suggested fix: add operational warning when embedding count exceeds the scan cap; keep a stricter production ceiling and plan a vector-index/worker boundary before raising limits.

### AGG-C2-06 - Smart-collection cursor pages still pay full `COUNT(*) OVER()`

Severity: Low
Confidence: Medium
Status: Confirmed performance issue
Cross-agent agreement: `perf-reviewer`

Citations: `apps/web/src/lib/data.ts:1388-1430`, `apps/web/src/app/actions/public.ts:161-213`, `apps/web/src/components/load-more.tsx:48-64`.

Cursor load-more pages discard total-count metadata but the query still computes `COUNT(*) OVER()` over every matching smart-collection row.

Suggested fix: split first-page and cursor query shapes; use `LIMIT + 1` lookahead for cursor pages.

### AGG-C2-07 - Backfill stale-candidate discovery scans `pipeline_version` without an index

Severity: Low
Confidence: Medium
Status: Likely maintenance-path inefficiency
Cross-agent agreement: `perf-reviewer`

Citations: `apps/web/src/lib/admin-backfill-runner.ts:370-379`, `:387-410`; `apps/web/src/db/schema.ts:111-117`.

Color-pipeline backfill count/batch discovery can scan the image table when most rows are current.

Suggested fix: add `(processed, pipeline_version, id)` if production backfills are common, or avoid eager counts.

### AGG-C2-08 - Restore maintenance is process-local while restore locking is DB-wide

Severity: Medium
Confidence: High
Status: Confirmed scale-out risk under unsupported topology
Cross-agent agreement: `architect`, `security-reviewer`, `critic`

Citations: `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/app/[locale]/admin/db-actions.ts:263-350`, `CLAUDE.md` runtime-topology section.

The documented deployment is single-instance. If scaled horizontally first, only the process that starts restore sees maintenance mode, while another process can accept writes mid-restore.

Suggested fix: keep single-instance as a hard invariant or move restore-maintenance state to DB/shared storage before scale-out.

### AGG-C2-09 - `clip-embeddings.ts` mixes shared helpers with server-only env policy

Severity: Low
Confidence: High
Status: Confirmed boundary smell
Cross-agent agreement: `architect`

Citations: `apps/web/src/lib/clip-embeddings.ts:18-40`, `apps/web/src/components/search.tsx:1,19`, semantic/similar route imports.

Client components import the same module that reads server env at module load. Future client imports of env-derived symbols can get browser fallback values while server routes enforce operator settings.

Suggested fix: move env-derived limits into a `server-only` module or add a source-contract test preventing client imports of those symbols.

### AGG-C2-10 - Upload quota claim settlement relies on hand-maintained rollback paths

Severity: Medium
Confidence: High
Status: Confirmed maintainability risk; currently fenced
Cross-agent agreement: `architect`

Citations: `apps/web/src/app/actions/images.ts:224-279`, `:520-564`.

The upload quota pre-claim spans a long async region with manual rollback and final settlement. A future awaited throw can leave quota inflated until window expiry.

Suggested fix: introduce a small claim object or `try/finally` wrapper the next time upload flow is edited.

### AGG-C2-11 - Topic identity uses a mutable natural key with manual fan-out

Severity: Medium
Confidence: High
Status: Confirmed design risk; test-fenced
Cross-agent agreement: `architect`

Citations: `apps/web/src/db/schema.ts:14-17,33,234-243,288-302`, `apps/web/src/app/actions/topics.ts:320-337`.

Topic slug rename manually updates FK children and JSON smart-collection predicates. New slug stores can orphan data if not registered in the fan-out.

Suggested fix: long-term immutable topic IDs; short-term keep registry tests strict.

### AGG-C2-12 - Public image field selections are split across manual allowlists

Severity: Low-Medium
Confidence: High
Status: Confirmed architecture risk; no current leak found
Cross-agent agreement: `architect`

Citations: `apps/web/src/lib/data.ts:364-482`, `apps/web/src/lib/data-timeline.ts:20-73`, `apps/web/src/lib/search-enrichment-fields.ts:29-46`, `apps/web/src/__tests__/privacy-fields.test.ts:74-80`.

Public selectors are guarded but duplicated across read paths, leaving future public routes dependent on reviewer memory.

Suggested fix: extract a canonical public image select module and derive route subsets from it.

### AGG-C2-13 - Dormant storage abstraction is not wired to the product boundary

Severity: Low
Confidence: High
Status: Confirmed dead abstraction risk
Cross-agent agreement: `architect`

Citations: `apps/web/src/lib/storage/index.ts:4-143`, `apps/web/src/lib/storage/local.ts:37-139`; no live non-test importers.

Future code can import `getStorage()` and accidentally build a parallel storage path outside the direct filesystem pipeline.

Suggested fix: delete until scheduled or quarantine with a source-contract test preventing non-test imports.

### AGG-C2-14 - `lib/api-auth.ts` depends upward on `app/actions/auth`

Severity: Low-Medium
Confidence: Medium
Status: Confirmed layering smell
Cross-agent agreement: `architect`

Citations: `apps/web/src/lib/api-auth.ts:1`, `apps/web/src/app/actions/auth.ts:23-56`.

Lower-level API auth imports an app action module, which can create circular pressure during future auth refactors.

Suggested fix: move current-user/session helpers into server-only `lib/auth.ts`, re-export from action module for compatibility.

### AGG-C2-15 - Direct container exposure bypasses nginx edge controls

Severity: Medium
Confidence: Medium
Status: Operational risk, not a confirmed defect under shipped compose
Cross-agent agreement: `security-reviewer`, `critic`

Citations: `apps/web/docker-compose.yml:14-21`, `apps/web/Dockerfile:83-85`, `apps/web/nginx/default.conf:25-31,56-60,72-76,89-93,131-150`.

The app image binds broadly by default and relies on compose/nginx for localhost binding, body caps, throttles, and proxy normalization. Direct exposure preserves app auth but loses edge protections.

Suggested fix: add production startup/deploy guard requiring localhost binding or explicit direct-exposure opt-in.

### AGG-C2-16 - `AGENTS.md` says `.context/plans/` is gitignored though it is tracked

Severity: Low
Confidence: High
Status: Confirmed doc mismatch
Cross-agent agreement: `verifier`

Citations: `AGENTS.md:41`, `git ls-files '.context/plans/*'`.

Contributors may treat committed plan history as disposable local state or place sensitive notes under a tracked directory.

Suggested fix: update `AGENTS.md` to describe the actual committed/current-vs-local plan split.

### AGG-C2-17 - Build gate was not run in verifier lane

Severity: Low
Confidence: High
Status: Verification gap
Cross-agent agreement: `verifier`

Citations: `AGENTS.md` quality gates, `apps/web/package.json:11`.

The verifier lane skipped `npm run build --workspace=apps/web` to avoid generated `sw.js` churn during read-only review. Prompt 3 must run the configured build gate.

Suggested fix: run the build gate in implementation verification and handle/commit any generated stamp intentionally.

### AGG-C2-18 - E2E nav visual checks capture screenshots without assertions

Severity: Medium
Confidence: High
Status: Confirmed test gap
Cross-agent agreement: `test-engineer`

Citations: `apps/web/e2e/nav-visual-check.spec.ts:14,27,39`; no `toHaveScreenshot`/`toMatchSnapshot` in test tree.

Visual regressions can pass because screenshots are artifacts only.

Suggested fix: convert to real visual assertions or add DOM/bounding-box assertions and rename as artifact capture.

### AGG-C2-19 - Browser upload enqueue settings are weakly asserted

Severity: Medium
Confidence: High
Status: Confirmed coverage gap
Cross-agent agreement: `test-engineer`

Citations: `apps/web/src/app/actions/images.ts:467-497`, `apps/web/src/__tests__/images-actions.test.ts:375`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:326-337`, `apps/web/src/lib/image-queue.ts:414-429`.

The browser upload action forwards processing/search settings, but tests only assert `id` and `topic` in the queued payload.

Suggested fix: strengthen `images-actions.test.ts` to assert the full enqueue payload shape.

### AGG-C2-20 - High-value client async behavior is locked by source scans

Severity: Medium
Confidence: Medium
Status: Test-quality risk
Cross-agent agreement: `test-engineer`

Citations: `apps/web/src/__tests__/search-stale-response.test.ts:8-27`, `apps/web/src/components/search.tsx:175-225`, `apps/web/src/__tests__/upload-dropzone-topic-wiring.test.ts:15-21`, `apps/web/src/components/upload-dropzone.tsx:214-234`.

Stale search response and mid-batch upload topic behavior are verified by brittle source-order scans instead of runtime behavior.

Suggested fix: add a minimal component/harness test for these async contracts.

### AGG-C2-21 - CLIP production backfill examples omit required `--force`

Severity: High
Confidence: High
Status: Confirmed documentation/operator-flow issue
Cross-agent agreement: `tracer`, `document-specialist`

Citations: `apps/web/README.md:35-37`, `apps/web/scripts/backfill-clip-embeddings.ts:4-22`, `apps/web/scripts/backfill-clip-embeddings.ts:90-95`, `apps/web/src/app/api/search/semantic/route.ts:255-259`, correct guidance at `apps/web/README.md:68-70` and `CLAUDE.md:506-527`.

The script table and script header show `--production` without `--force`, which exits `0` without processing on a default disabled install. Enabling production afterward yields no embeddings and semantic search returns 503.

Suggested fix: update the README script table and script header examples to use `--production --force` for pre-enable production backfills.

### AGG-C2-22 - Admin pages lack route-specific document titles

Severity: Medium
Confidence: High
Status: Confirmed UI/UX issue
Cross-agent agreement: `designer`, `ui-ux-designer-reviewer`, `product-marketer-reviewer`

Citations: browser check `/en/admin` title `GalleryKit`; `apps/web/src/app/[locale]/layout.tsx:22-27`, `apps/web/src/app/[locale]/admin/page.tsx:6-15`, `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:5-17`, `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx:6-9`, `apps/web/messages/en.json:2-13`, `apps/web/messages/ko.json:2-13`.

Admin login/dashboard/settings/database/SEO/tokens pages can inherit only the site title, weakening tab and screen-reader orientation.

Suggested fix: add localized metadata to admin routes using existing nav labels and add metadata coverage tests.

### AGG-C2-23 - Timeline/year photo cards use hard-coded English and title-only link names

Severity: Medium
Confidence: High
Status: Confirmed accessibility/i18n issue
Cross-agent agreement: `designer`, `ui-ux-designer-reviewer`

Citations: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:192-212`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:151-168`, stronger pattern in `apps/web/src/components/home-client.tsx:291-323` and `apps/web/src/components/on-this-day-widget.tsx:49-59`.

Korean timeline/year pages can expose English `Photo` fallbacks, and links use bare titles rather than localized action labels.

Suggested fix: reuse the home grid localized untitled/photo fallback and `view photo` aria template.

### AGG-C2-24 - Timeline/year pages miss social preview metadata

Severity: Low
Confidence: High
Status: Confirmed product metadata gap
Cross-agent agreement: `product-marketer-reviewer`

Citations: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:26-30`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:37-41`, richer metadata in home/topic/smart collection routes.

Timeline and year pages are shareable public surfaces but can fall back to generic social cards.

Suggested fix: add localized Open Graph/Twitter metadata with a representative photo or configured fallback image.

### AGG-C2-25 - Invalid year metadata returns English copy on localized routes

Severity: Low
Confidence: High
Status: Confirmed i18n metadata issue
Cross-agent agreement: `product-marketer-reviewer`

Citations: `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:22-25`, localized not-found copy in `apps/web/messages/en.json` and `apps/web/messages/ko.json`.

Malformed localized year URLs can expose English `Not Found` in metadata.

Suggested fix: resolve locale/messages before invalid-year metadata or centralize localized not-found metadata.

## Agent Failures

None. The first UI/custom spawn failed because the active agent limit was reached; it was retried after another lane completed and returned successfully.

## Verification Evidence Collected During Review

- Verifier lane: lint, API-auth lint, action-origin lint, public-route-rate-limit lint, typecheck, and Vitest passed.
- Security/critic lane: `npm audit` returned 0 vulnerabilities; auth/origin/rate-limit lints passed; targeted security tests passed.
- Code/debugger lane: targeted Vitest passed, 7 files / 57 tests.
- UI lane: dev server started on port `3012`, `/en/admin` inspected, dev server stopped, `git diff --check` passed.
