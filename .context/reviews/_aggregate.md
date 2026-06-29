# Aggregate Review - review-plan-fix Cycle 5

Date: 2026-06-29
Scope: cycle 5 fan-out across code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer, and product-marketer-reviewer.

## Agent Coverage

- Completed: code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer, product-marketer-reviewer.
- UI/UX was included because the repository contains a Next.js web frontend. The designer lane used `agent-browser`; local MySQL was unavailable, so DB-backed pages were partly validated by source/tests plus route-shell browser evidence.
- Additional locally registered reviewer-style agents were enumerated. `ui-ux-designer-reviewer` and `product-marketer-reviewer` were BurstPick-specific prompts; the UI lane was covered by the required designer reviewer, and the product-marketer lane was adapted to GalleryKit without BurstPick assumptions.

## Agent Failures

None after retry/slot management. The initial test-engineer spawn hit the native thread limit and was retried after completed agents were closed.

## Merged Findings

### AGG-C5-01 - Docker runner omits immutable public assets

Severity: High
Confidence: High
Status: Confirmed
Cross-agent agreement: verifier, tracer

Citations:
- `apps/web/Dockerfile:105-120`
- `apps/web/docker-compose.yml:23-27`
- `apps/web/src/components/register-service-worker.tsx:18`
- `apps/web/src/components/histogram.tsx:544`
- `apps/web/src/app/[locale]/globals.css:5`
- `apps/web/src/app/manifest.ts:35`

Failure scenario:
The runner image does not copy `apps/web/public`, while compose bind-mounts only mutable public subdirectories. Production can therefore 404 `/sw.js`, `/histogram-worker.js`, fonts, and PWA icons.

Suggested fix:
Copy the full built `public` tree into the runner image, keep `public/uploads` and `public/resources` as bind mounts, and add packaging/source-contract tests.

### AGG-C5-02 - Docker build context still admits mutable topic resources

Severity: Medium
Confidence: High
Status: Confirmed/Likely
Cross-agent agreement: code-reviewer, verifier

Citations:
- `.dockerignore:16-18`
- `apps/web/.dockerignore:7-8`
- `apps/web/.gitignore:49`
- `apps/web/docker-compose.yml:25`

Failure scenario:
Runtime topic-cover resources under `public/resources` can enter Docker build context and image layers even though production is supposed to persist them as bind-mounted mutable data.

Suggested fix:
Ignore `apps/web/public/resources/**` in the root context and `public/resources/**` in the app context, with tests covering both contexts.

### AGG-C5-03 - Legacy-original migration can delete the only good original

Severity: High
Confidence: High
Status: Confirmed
Cross-agent agreement: critic, debugger, tracer

Citations:
- `apps/web/scripts/migrate.js:46-110`
- `apps/web/src/__tests__/upload-paths.test.ts:58-76`

Failure scenario:
If `data/uploads/original/foo.jpg` exists but is corrupt/truncated while a valid legacy `public/uploads/original/foo.jpg` remains, startup unlinks the valid source solely because the target path exists.

Suggested fix:
Before unlinking a legacy source, compare size plus SHA-256. Delete only identical duplicates; on mismatch, fail startup or quarantine without deleting the public source. Add identical/divergent/`EXDEV` regression tests.

### AGG-C5-04 - Service-worker offline HTML cache can outlive share revoke/delete/expiry

Severity: Medium
Confidence: High
Status: Confirmed
Cross-agent agreement: critic, debugger

Citations:
- `apps/web/public/sw.template.js:271-310`
- `apps/web/public/sw.template.js:366-369`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:14-96`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:17-108`
- `apps/web/src/app/actions/sharing.ts:306-386`

Failure scenario:
A visitor opens a shared link/group, then the admin revokes/deletes/expires it. Online requests fail correctly, but the same device can still view cached HTML offline for up to 24 hours.

Suggested fix:
Exclude `/s/` and `/g/` from offline HTML caching, or add and honor a no-offline-cache response header. Add SW contract coverage and update docs.

### AGG-C5-05 - Disabled semantic search can consume unmetered parse/config work

Severity: Medium
Confidence: High
Status: Confirmed
Cross-agent agreement: critic, debugger

Citations:
- `apps/web/src/app/api/search/semantic/route.ts:100-225`
- `apps/web/src/__tests__/semantic-search-route.test.ts:208-218`
- `apps/web/src/lib/rate-limit.ts:312-352`

Failure scenario:
While semantic search is disabled, a same-origin-looking client repeatedly sends valid JSON bodies. The route reads/parses the body and loads config, then rolls back the limiter token.

Suggested fix:
Check semantic mode before body materialization, or keep disabled-mode attempts charged. Update tests to prove disabled mode does not read request bodies or does not roll back.

### AGG-C5-06 - Lightroom upload leaks pre-claimed quota when topic lookup throws

Severity: Medium
Confidence: High
Status: Confirmed
Cross-agent agreement: tracer

Citations:
- `apps/web/src/app/api/admin/lr/upload/route.ts:94-131`
- `apps/web/src/app/api/admin/lr/upload/route.ts:198-205`

Failure scenario:
The Lightroom upload route preclaims count/bytes, then the topic `SELECT` can throw before the preclaim is settled. Transient DB errors can consume quota until the tracking window expires without landing an image.

Suggested fix:
Wrap the topic lookup after preclaim in `try/catch`, settle quota on throw, and add a regression test.

### AGG-C5-07 - Restore does not quiesce color-pipeline backfills

Severity: High
Confidence: High
Status: Confirmed
Cross-agent agreement: architect

Citations:
- `apps/web/src/app/[locale]/admin/db-actions.ts:279-340`
- `apps/web/src/lib/admin-backfill-runner.ts:303-327`
- `apps/web/src/lib/admin-backfill-runner.ts:498-617`
- `apps/web/scripts/backfill-color-pipeline.ts:301-311`

Failure scenario:
An active backfill continues through SQL restore and writes stale metadata or derivatives to a restored row with the same id.

Suggested fix:
Include the color-pipeline backfill lock in restore quiescence or expose/await a backfill drain before import. Add restore contract tests.

### AGG-C5-08 - Restored databases resume before current migrations/reconcile run

Severity: High
Confidence: High
Status: Confirmed
Cross-agent agreement: architect

Citations:
- `apps/web/Dockerfile:137-143`
- `apps/web/scripts/migrate.js:725-789`
- `apps/web/src/app/[locale]/admin/db-actions.ts:493-507`

Failure scenario:
Restoring an older dump resumes current app code against an older schema until next restart/deploy, causing unknown-column errors or skipped migration postconditions.

Suggested fix:
Run the same migration/reconcile path inside restore maintenance before ending maintenance and resuming queues.

### AGG-C5-09 - Backup/restore is DB-only while gallery state spans DB and files

Severity: Medium
Confidence: High
Status: Risk
Cross-agent agreement: architect

Citations:
- `apps/web/docker-compose.yml:23-27`
- `apps/web/src/app/actions/images.ts:304-408`
- `apps/web/src/app/actions/images.ts:653-677`
- `apps/web/src/app/[locale]/admin/db-actions.ts:138-166`
- `apps/web/src/app/[locale]/admin/db-actions.ts:454-518`

Failure scenario:
DB restore can resurrect rows whose image/resource files were deleted, or leave orphan files no longer referenced by DB rows.

Suggested fix:
Either label restore explicitly as DB-only and add post-restore reconciliation, or implement full gallery snapshots containing SQL plus uploads/resources/config with manifest hashes.

### AGG-C5-10 - Timeline and On-This-Day use non-sargable date functions

Severity: Medium
Confidence: High
Status: Confirmed
Cross-agent agreement: perf-reviewer

Citations:
- `apps/web/src/lib/data-timeline.ts:97`
- `apps/web/src/lib/data-timeline.ts:129`
- `apps/web/src/lib/data-timeline.ts:186`
- `apps/web/src/components/on-this-day-widget.tsx:14`
- `apps/web/src/db/schema.ts:111`

Failure scenario:
`/timeline`, `/year/:year`, and home renders scan processed images with `YEAR/MONTH/DAY(capture_date)`, increasing DB CPU as libraries grow.

Suggested fix:
Use date ranges where possible and/or add generated indexed capture year/month/day columns or a derived timeline table.

### AGG-C5-11 - Public map can fetch/render 10,000 markers

Severity: Medium
Confidence: High
Status: Confirmed
Cross-agent agreement: perf-reviewer

Citations:
- `apps/web/src/lib/data.ts:1642`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:8`
- `apps/web/src/components/map-client.tsx:76`
- `apps/web/src/db/schema.ts:111`

Failure scenario:
`/map` can serialize and mount thousands of Leaflet markers on the main thread without map-specific indexing, bounds fetching, or clustering.

Suggested fix:
Add map/GPS access paths or denormalized eligibility, plus bounds-based fetching or clustering.

### AGG-C5-12 - Production CLIP embedding escapes queue backpressure

Severity: Medium
Confidence: High
Status: Confirmed
Cross-agent agreement: perf-reviewer

Citations:
- `apps/web/src/lib/image-queue.ts:204`
- `apps/web/src/lib/image-queue.ts:470`
- `apps/web/src/lib/image-queue.ts:490`
- `apps/web/src/lib/clip-model.ts:151`

Failure scenario:
Completed image jobs launch detached real embedding work, allowing Sharp raw conversion and ONNX inference to pile up outside `QUEUE_CONCURRENCY` and shutdown drains.

Suggested fix:
Move embedding to a bounded queue with drain/shutdown behavior, or to a durable DB-backed embedding worker.

### AGG-C5-13 - Semantic/similar search can decode and rank up to 1,000,000 vectors

Severity: Medium
Confidence: High
Status: Confirmed
Cross-agent agreement: perf-reviewer

Citations:
- `apps/web/src/lib/clip-embeddings.ts:36`
- `apps/web/src/lib/clip-embeddings.ts:104`
- `apps/web/src/lib/clip-embeddings.ts:164`
- `apps/web/src/app/api/search/semantic/route.ts:240`
- `apps/web/src/app/api/search/similar/[id]/route.ts:141`
- `apps/web/src/db/schema.ts:271`

Failure scenario:
An increased `SEMANTIC_SCAN_LIMIT` can pull huge MEDIUMBLOB sets, allocate many `Float32Array`s, score every vector, and sort full match sets in-process.

Suggested fix:
Lower or guard the hard ceiling, use bounded heap top-K, add metrics, and move larger installs to ANN/vector search.

### AGG-C5-14 - Admin dashboard loads every permanently failed image

Severity: Low
Confidence: High
Status: Confirmed
Cross-agent agreement: perf-reviewer

Citations:
- `apps/web/src/lib/data.ts:993`
- `apps/web/src/db/schema.ts:108`

Failure scenario:
Many failed rows make dashboard load scan/sort and hydrate the full failure list.

Suggested fix:
Cap or paginate failed rows and add a matching index.

### AGG-C5-15 - Semantic route lacks model-version filtering regression coverage

Severity: Medium
Confidence: High
Status: Confirmed
Cross-agent agreement: test-engineer

Citations:
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/__tests__/semantic-search-route.test.ts`

Failure scenario:
A future route refactor can mix stub and production embedding rows, returning irrelevant results across model spaces.

Suggested fix:
Add tests proving semantic text search filters by the active model version.

### AGG-C5-16 - Cursor pagination tests copy a looser cursor mock

Severity: Medium
Confidence: High
Status: Confirmed
Cross-agent agreement: test-engineer

Citations:
- `apps/web/src/__tests__/data-pagination.test.ts`
- real cursor helper in `apps/web/src/lib/data.ts`

Failure scenario:
Tests pass with a local mock that accepts behavior the production cursor helper rejects.

Suggested fix:
Export or otherwise test the real cursor normalization helper directly.

### AGG-C5-17 - Real CLIP activation tests are opt-in/skipped in blocking CI

Severity: Medium
Confidence: Medium
Status: Risk
Cross-agent agreement: test-engineer

Citations:
- CLIP model activation tests under `apps/web/src/__tests__/clip-*`
- `apps/web/package.json` blocking `test` script

Failure scenario:
Production CLIP activation can regress without the blocking suite noticing because real-model tests are skipped unless model weights/env are present.

Suggested fix:
Keep heavyweight model tests opt-in, but add a lightweight blocking contract around production-mode gating/offline-load prerequisites.

### AGG-C5-18 - Semantic search comments still describe stub-only behavior

Severity: Low
Confidence: High
Status: Confirmed
Cross-agent agreement: document-specialist

Citations:
- `apps/web/src/__tests__/semantic-search-route.test.ts:95-96`
- `apps/web/src/app/api/search/semantic/route.ts:209-227`

Failure scenario:
Future test/refactor work may reject production mode again because comments say only stub serves public requests.

Suggested fix:
Update comments to state that stub is the default test mode while stub and gated production serve public requests.

### AGG-C5-19 - Embeddings action header comment describes old future-ONNX behavior

Severity: Low
Confidence: High
Status: Confirmed
Cross-agent agreement: document-specialist

Citations:
- `apps/web/src/app/actions/embeddings.ts:3-9`
- `apps/web/src/app/actions/embeddings.ts:68-99`

Failure scenario:
Future cleanup may remove production/model-version handling as “unneeded.”

Suggested fix:
Rewrite the header comment for disabled no-op, stub writes, production real encoder, and active model-version selection.

### AGG-C5-20 - Admin analytics public links force default-locale pages and English aria labels

Severity: Low
Confidence: High
Status: Confirmed
Cross-agent agreement: designer

Citations:
- `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:112`
- `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:194`
- `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:222`
- `apps/web/src/proxy.ts:7`

Failure scenario:
A Korean admin on `/ko/admin/analytics` opens a public preview and lands on `/en/...`; screen readers also announce English text in the Korean admin page.

Suggested fix:
Pass/read locale in `AnalyticsClient`, use localized paths, add localized `opensInNewWindow` text, and format counts with locale.

### AGG-C5-21 - GPS privacy copy contradicts retained-original GPS scrubbing

Severity: Medium
Confidence: High
Status: Confirmed
Cross-agent agreement: product-marketer-reviewer

Citations:
- `apps/web/messages/en.json:701-704`
- `apps/web/messages/ko.json:701-704`
- `apps/web/src/app/actions/images.ts:333-343`
- `apps/web/src/lib/process-image.ts:1600-1639`
- `CLAUDE.md:218`

Failure scenario:
An admin enables GPS stripping expecting only DB/public metadata to omit GPS, then later finds retained originals had GPS removed when possible.

Suggested fix:
Update both locales to state that new uploads omit GPS from gallery metadata and, when possible, remove GPS metadata from retained originals; existing images are unchanged.

### AGG-C5-22 - Auto alt-text copy implies Florence-2 setup although feature is EXIF-derived stub

Severity: Medium
Confidence: High
Status: Confirmed
Cross-agent agreement: product-marketer-reviewer

Citations:
- `apps/web/messages/en.json:712-715`
- `apps/web/messages/ko.json:712-715`
- `apps/web/src/lib/caption-generator.ts:1-18`
- `apps/web/src/lib/caption-generator.ts:33-64`
- `apps/web/src/lib/image-queue.ts:470-488`

Failure scenario:
An operator enables Auto Alt-Text expecting a real local Florence-2 vision model, or bulk-copies EXIF-derived placeholders as if they were real generated captions.

Suggested fix:
Reword settings copy to current truth: EXIF-derived placeholders, no vision model yet; avoid “AI” wording until real inference ships.

## Security Review Result

Security-reviewer found no critical/high/medium/low security vulnerabilities in the reviewed auth, session, upload, backup, route, privacy, and header surfaces. It recorded one residual scale-out risk for process-local state if the single-instance topology changes.

## Deferred Candidates

Performance-only findings AGG-C5-10 through AGG-C5-14 and test-strategy findings AGG-C5-16 through AGG-C5-17 may be candidates for explicit deferral if they cannot be completed in this cycle. Data-loss, correctness, privacy, and production-packaging findings are not treated as silently deferrable.

