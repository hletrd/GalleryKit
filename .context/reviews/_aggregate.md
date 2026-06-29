# Cycle 14 Aggregate Review

Date: 2026-06-30

Reviewed HEAD range: started at `c2da917d`, then the architect review artifact was committed as `d821a9ab` during Prompt 1. Production code findings are against current code; review artifact changes do not alter production behavior.

## Review Agents

Completed review files:

- `.context/reviews/code-reviewer.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/verifier.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`
- `.context/reviews/architect.md`
- `.context/reviews/debugger.md`
- `.context/reviews/document-specialist.md`
- `.context/reviews/designer.md`
- `.context/reviews/ui-ux-designer-reviewer.md`
- `.context/reviews/product-marketer-reviewer.md`

Raw findings across agent files: 68.
Deduped aggregate findings: 63.

Agent failures: none. The subagent service hit the live-agent limit during fan-out, so reviewer lanes were launched in bounded batches and closed as they completed. No requested registered reviewer perspective was dropped.

## Cross-Agent Agreement

- Similar-photo target visibility was flagged by debugger as confirmed and tracer as a manual-validation risk. The aggregate preserves the debugger severity/confidence.
- Search input touch sizing was independently flagged by both UI reviewers. The aggregate keeps it as one confirmed touch-target/UI issue.
- Single-instance/trusted-proxy topology was flagged by security, architect, critic, and verifier as an operational risk. The aggregate separates a concrete nginx/docs mismatch from the broader documented single-instance risk.
- CLIP production/offline behavior gaps were flagged by verifier/test/product reviewers. The aggregate records this as a manual-validation/CI coverage risk, not a current code defect.
- Local browser validation gaps repeatedly traced to unavailable local MySQL; this is recorded once as a review validation blocker.

## Confirmed Findings

### AGG-C14-01 - Original-upload path helpers trust DB-stored filenames

Severity: High. Confidence: High. Agents: critic.

Files: `apps/web/src/lib/upload-paths.ts:57-60`, `apps/web/src/lib/upload-paths.ts:75-100`, `apps/web/src/app/actions/images.ts:1234-1237`, `apps/web/src/lib/image-queue.ts:562-623`, `apps/web/src/lib/admin-backfill-runner.ts:442-448`, `apps/web/scripts/backfill-clip-embeddings.ts:152-159`, `apps/web/scripts/backfill-cicp-recheck.ts:92-100`, `apps/web/scripts/backfill-color-pipeline.ts:197-204`.

`resolveOriginalUploadPath()` and original deletion helpers join DB-stored `filename_original` values into original-upload roots without central filename validation, absolute-path rejection, symlink rejection, or realpath containment checks. Some callers validate locally, but retry/backfill/maintenance paths can consume DB-restored or manually edited rows without that guard.

Fix: move filename and containment enforcement into `upload-paths.ts`; keep caller-side validation as defense in depth. Add traversal, absolute path, symlink, missing-file, primary-hit, and legacy-hit tests.

### AGG-C14-02 - nginx proxy-header contract contradicts documented multi-hop deployment

Severity: Medium. Confidence: High. Agents: critic.

Files: `apps/web/nginx/default.conf:6-8`, `apps/web/nginx/default.conf:25-29`, `apps/web/nginx/default.conf:68-70`, `apps/web/nginx/default.conf:85-87`, `apps/web/nginx/default.conf:102-104`, `apps/web/nginx/default.conf:142-144`, `apps/web/nginx/default.conf:159-161`, `apps/web/nginx/default.conf:181-183`, `apps/web/nginx/default.conf:194-196`, `README.md:152-154`, `apps/web/src/lib/rate-limit.ts:161-183`.

Docs describe an edge/CDN -> nginx -> app topology with `TRUSTED_PROXY_HOPS=2`, but nginx overwrites `X-Forwarded-For` with `$remote_addr`. Behind a CDN/LB this can collapse all visitors to the edge IP for rate limits and analytics.

Fix: either implement trusted upstream real-IP handling and forward a sanitized chain, or document direct-client -> nginx -> app as the only supported topology and keep `TRUSTED_PROXY_HOPS=1`.

### AGG-C14-03 - Review directory allows accidental scratch artifacts

Severity: Low. Confidence: High. Agents: critic.

Files: `.gitignore:19-25`.

`.context/reviews/**` is unignored broadly, so temp inventories, JSON dumps, hidden scratch files, and command captures written under reviews can be committed with report files.

Fix: ignore review scratch patterns or designate an ignored `.context/scratch/` path for transient reviewer output.

### AGG-C14-04 - Public map serializes and renders up to 10k markers and links

Severity: High. Confidence: High. Agents: perf-reviewer.

Files: `apps/web/src/lib/data.ts:1649-1676`, `apps/web/src/app/[locale]/(public)/map/page.tsx:31-79`, `apps/web/src/components/map/map-loader.tsx:9-12`, `apps/web/src/components/map/map-client.tsx:76-143`, `apps/web/src/db/schema.ts:114-120`.

The dynamic map page loads up to 10,000 GPS rows, serializes all markers through RSC, server-renders a link per marker, and mounts one Leaflet marker/popup per row. There is no GPS/map-oriented index.

Fix: use viewport/bounds fetching and clustering or a much lower initial cap plus accessible pagination/virtualization; validate a supporting index with `EXPLAIN`.

### AGG-C14-05 - Public map is pointer-first with weak accessible structure

Severity: Medium. Confidence: Medium-high. Agents: ui-ux-designer-reviewer.

Files: `apps/web/src/app/[locale]/(public)/map/page.tsx:59-79`, `apps/web/src/components/map/map-client.tsx:107-144`.

The visual map appears before the accessible fallback list and lacks a clear accessible name/instructions around the map/list relationship. Markers are primarily pointer-operated.

Fix: wrap map/list in a named region, add a skip link or hint to the photo list before the map, and either keyboard-label markers reliably or present the list as the primary accessible control.

### AGG-C14-06 - Admin dashboard renders every permanently failed image

Severity: Medium. Confidence: High. Agents: perf-reviewer.

Files: `apps/web/src/lib/data.ts:1000-1013`, `apps/web/src/db/schema.ts:101-120`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:73-120`.

`getFailedImages()` has no limit or failed-list index, and the dashboard renders every failed row with retry controls. A large failed import can make the recovery UI slow or unusable.

Fix: paginate or limit failed images, expose a separate count, lazy-load more failures, and add an index such as `(processed, failed_at)` after checking plans.

### AGG-C14-07 - Sidecar backfill scripts enqueue the full candidate set

Severity: Medium. Confidence: High. Agents: perf-reviewer.

Files: `apps/web/scripts/backfill-color-pipeline.ts:342-359`, `apps/web/scripts/backfill-color-pipeline.ts:474-511`, `apps/web/scripts/backfill-cicp-recheck.ts:57-93`, `apps/web/scripts/backfill-cicp-recheck.ts:144`, `apps/web/src/lib/admin-backfill-runner.ts:381-410`.

Sidecar backfills fetch/enqueue every candidate before waiting, so large libraries allocate one row plus one queue closure per candidate. The in-app runner already shows the bounded keyset-batch shape.

Fix: rewrite these scripts to fetch keyset batches, enqueue/drain only the current batch, flush, advance the cursor, and repeat.

### AGG-C14-08 - GPS stripping materializes whole originals after streaming save

Severity: Medium. Confidence: High. Agents: perf-reviewer.

Files: `apps/web/src/app/actions/images.ts:381-388`, `apps/web/src/app/api/admin/lr/upload/route.ts:150-153`, `apps/web/src/app/api/admin/lr/upload/route.ts:365-377`, `apps/web/src/lib/process-image.ts:1738-1788`.

With GPS stripping enabled, large originals are streamed to disk and then fully read back into memory for metadata scrubbing; Lightroom uploads additionally use `request.formData()`.

Fix: add a memory-budget/semaphore around buffer-based GPS stripping, document/guard the risk, and investigate streaming/range scrubbers or a streaming multipart parser for Lightroom.

### AGG-C14-09 - Backfill no-op leaves stale admin status

Severity: Low. Confidence: High. Agents: code-reviewer.

Files: `apps/web/src/lib/admin-backfill-runner.ts:837-841`, `apps/web/src/lib/admin-backfill-runner.ts:631-646`, `apps/web/src/lib/admin-backfill-runner.ts:780-803`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:302-327`.

When candidate count is zero, `triggerAdminBackfill()` returns without resetting prior per-run failure/status counters, so the settings UI can keep showing stale previous-run failures.

Fix: record a completed no-op status that clears per-run counters and failure state; add a regression test seeded with previous failures.

### AGG-C14-10 - Touch-target audit allowlist can create stale slack

Severity: Medium. Confidence: High. Agents: test-engineer.

Files: `apps/web/src/__tests__/touch-target-audit.test.ts:112-189`, `apps/web/src/__tests__/touch-target-audit.test.ts:764-782`.

Positive `KNOWN_VIOLATIONS` budgets are treated as an upper bound. If old known violations are removed, new unrelated violations in the same file can pass within the stale allowance.

Fix: require exact counts or fingerprint known exceptions; add a fixture proving stale slack fails.

### AGG-C14-11 - Public route rate-limit exemption is file-level

Severity: Medium. Confidence: High. Agents: test-engineer.

Files: `apps/web/scripts/check-public-route-rate-limit.ts:287-296`, `apps/web/scripts/check-public-route-rate-limit.ts:238-280`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:79-89`.

One `@public-no-rate-limit-required` comment exempts every mutating handler in a route file, so a mixed route could contain one justified exempt handler and one unmetered unrelated mutating handler.

Fix: attach exemptions to the specific handler/export or reject file-level exemptions when a file has more than one mutating handler. Add a mixed POST/DELETE regression fixture.

### AGG-C14-12 - Similar-photo lookup trusts embeddings before target visibility

Severity: Medium. Confidence: Medium. Agents: debugger, tracer.

Files: `apps/web/src/app/api/search/similar/[id]/route.ts:118-125`, `apps/web/src/app/api/search/similar/[id]/route.ts:145-150`, `apps/web/src/app/api/search/similar/[id]/route.ts:198-205`, `apps/web/src/db/schema.ts:280-295`, `apps/web/drizzle/0012_image_embeddings.sql:5-12`.

The route loads the target vector by image id/model version without joining to `images` or requiring `images.processed = true`. Result enrichment later filters processed rows, but the target and candidate scoring set can include stale/unprocessed embeddings.

Fix: join target and scan queries to `images` and filter processed images before decoding/scoring. Add a route test for an unprocessed target with an embedding returning 404.

### AGG-C14-13 - Backup creation comment promises header validation that is not implemented

Severity: Low. Confidence: High. Agents: debugger.

Files: `apps/web/src/app/[locale]/admin/db-actions.ts:220-236`, `apps/web/src/app/[locale]/admin/db-actions.ts:456-477`, `apps/web/src/lib/db-restore.ts:21-25`.

`dumpDatabase()` comments say it verifies a mysqldump header, but it only checks non-empty size. Restore has the actual header validator.

Fix: read the first bytes after dump completion and call `hasPlausibleSqlDumpHeader()`. Delete/return failure on invalid output and add coverage.

### AGG-C14-14 - `db:push` is documented like a normal DB command

Severity: Medium. Confidence: High. Agents: document-specialist.

Files: `CLAUDE.md:58-61`, `apps/web/README.md:23-32`, `apps/web/package.json:17`, `AGENTS.md:22-27`, `CLAUDE.md:415-435`.

Docs list `npm run db:push` without a development-only warning, even though repo policy requires journaled SQL migrations plus `_journal.json` and reconcile updates.

Fix: remove it from operator-facing docs or explicitly mark it local throwaway prototyping only; point schema changes to the migration checklist.

### AGG-C14-15 - CLIP backfill concurrency guidance is stale/incomplete

Severity: Low. Confidence: High. Agents: document-specialist.

Files: `apps/web/scripts/backfill-clip-embeddings.ts:44-45`, `apps/web/scripts/backfill-clip-embeddings.ts:72-73`, `apps/web/src/lib/clip-model.ts:53-56`, `CLAUDE.md:510-523`, `apps/web/.env.local.example:68-72`.

The script says operators can raise concurrency after real ONNX inference ships, but the script batch concurrency is hardcoded and the actual inference limiter is `CLIP_INFERENCE_CONCURRENCY`, which is not documented in the runbook/env example.

Fix: update script comments, CLIP runbook, and env example to distinguish batch concurrency from model inference concurrency and document defaults/caps/caveats.

### AGG-C14-16 - Search dialog input overrides the 44 px floor

Severity: Medium. Confidence: High. Agents: designer, ui-ux-designer-reviewer.

Files: `apps/web/src/components/search.tsx:372-403`, `apps/web/src/components/ui/input.tsx:10-14`.

The search combobox input passes `h-8`, overriding the shared input `min-h-11` and making the primary mobile search field visually 32 px tall.

Fix: remove the `h-8` override or set `h-11 min-h-11`; add touch-target audit coverage for raw input height overrides.

### AGG-C14-17 - Mobile nav expander exposes only one controlled region

Severity: Low. Confidence: High. Agents: designer.

Files: `apps/web/src/components/nav-client.tsx:99-107`, `apps/web/src/components/nav-client.tsx:117-123`, `apps/web/src/components/nav-client.tsx:156-160`.

The mobile expand button sets `aria-controls="primary-nav-controls"` but also changes `primary-nav-topics`.

Fix: point `aria-controls` at both regions or wrap both controlled areas in one container with a stable id.

### AGG-C14-18 - Admin form dialogs omit descriptions

Severity: Low. Confidence: Medium. Agents: designer.

Files: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:189-193`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:295-301`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:165-171`.

Create/edit category and edit tag dialogs have titles but no `DialogDescription`, leaving less context for screen-reader users.

Fix: add localized descriptions or explicitly opt out with `aria-describedby={undefined}` if the title/fields are sufficient.

### AGG-C14-19 - Admin tables lack narrow-screen overflow/fallback

Severity: Medium. Confidence: High. Agents: ui-ux-designer-reviewer.

Files: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:216-261`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:95-126`, `apps/web/src/components/admin-user-manager.tsx:137-177`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123-132`, `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:95-96`.

Several admin tables are not wrapped in local overflow/card fallbacks, unlike dashboard and analytics tables. Mobile/Korean layouts can clip actions or force page-level horizontal scrolling.

Fix: wrap tables in `overflow-x-auto` with stable min widths or provide small-screen card rows.

### AGG-C14-20 - Settings/SEO admin layouts are brittle with Korean copy on mobile

Severity: Medium. Confidence: Medium-high. Agents: ui-ux-designer-reviewer.

Files: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:226-240`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:407-443`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:553-671`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:658-665`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:72-87`, `apps/web/messages/ko.json`.

Single-line headers/rows and fixed-width controls can collide with long Korean copy on narrow screens.

Fix: add responsive wrapping, `min-w-0`, `shrink-0`, and mobile two-row setting layouts; replace fixed select width with `w-full sm:w-[200px]`.

### AGG-C14-21 - Public home empty state is not actionable for a fresh gallery

Severity: Low. Confidence: High. Agents: ui-ux-designer-reviewer.

Files: `apps/web/src/components/home-client.tsx:424-438`, `apps/web/src/components/upload-dropzone.tsx:344-363`.

An empty unfiltered public home only says no images, with no setup/publishing explanation or admin path.

Fix: improve neutral empty copy and optionally show an authenticated-admin upload/dashboard link.

### AGG-C14-22 - README terminology says "Topics & Albums" while UI says "Categories"

Severity: Low. Confidence: High. Agents: product-marketer-reviewer.

Files: `README.md:34`, `apps/web/messages/en.json:3-5`, `apps/web/messages/en.json:76-108`.

Public docs use "Topics & Albums" while the UI consistently presents "Categories".

Fix: align README wording with UI terminology and note internal topic naming only where useful.

### AGG-C14-23 - README overstates search as "full metadata search"

Severity: Medium. Confidence: High. Agents: product-marketer-reviewer.

Files: `README.md:36`, `apps/web/src/lib/data.ts:1542-1612`.

Search covers titles, descriptions, camera/lens, topic slug/label/aliases, and tags, but not full EXIF/date/GPS/color metadata.

Fix: narrow README copy or implement/document broader metadata search.

### AGG-C14-24 - Fresh example config can produce blank Atom feed author/rights

Severity: Medium. Confidence: High. Agents: product-marketer-reviewer.

Files: `apps/web/src/site-config.example.json:6`, `apps/web/src/lib/data.ts:1733-1740`, `apps/web/src/app/feed.xml/route.ts:103-120`, `apps/web/src/lib/atom-feed.ts:92-104`.

The example config sets `author` to an empty string, and feed generation emits author/right fields from that value.

Fix: make example author non-empty and add code fallback to site title or suppress rights when author/copyright are empty.

## Likely Issues

### AGG-C14-25 - Invalid share keys consume real share lookup budget

Severity: Medium. Confidence: Medium. Agents: critic.

Files: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:79-90`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:84-102`, `apps/web/src/lib/data.ts:1177-1181`, `apps/web/src/lib/data.ts:1243-1250`, `apps/web/src/lib/rate-limit.ts:88-96`.

Malformed share paths are charged against the per-IP share lookup bucket before cheap Base56 validation.

Fix: validate key syntax before rate-limit charging, while preserving rate limiting before valid-looking DB lookups.

### AGG-C14-26 - Image queue can pin most shared DB pool connections

Severity: Medium. Confidence: High. Agents: perf-reviewer.

Files: `apps/web/src/db/index.ts:23-33`, `apps/web/src/lib/image-queue.ts:87-90`, `apps/web/src/lib/image-queue.ts:446-462`, `apps/web/src/lib/image-queue.ts:519-540`, `apps/web/src/lib/image-queue.ts:622-657`, `apps/web/src/lib/image-queue.ts:812-815`.

If `QUEUE_CONCURRENCY` is raised, jobs can hold advisory-lock connections through Sharp work, leaving little pool capacity for live traffic.

Fix: avoid holding shared-pool connections across Sharp processing, use a dedicated lock pool/lease model, or clamp concurrency with reserved pool capacity.

### AGG-C14-27 - Dynamic first listing pages perform count-window work on hot requests

Severity: Medium. Confidence: Medium. Agents: perf-reviewer.

Files: `apps/web/src/lib/data.ts:878-907`, `apps/web/src/lib/data.ts:1438-1453`, `apps/web/src/app/[locale]/(public)/page.tsx:14-16`, `apps/web/src/app/[locale]/(public)/page.tsx:164-167`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:174-176`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`.

Dynamic SSR first pages use `COUNT(*) OVER()` with grouped joins and exact counts on broad result sets.

Fix: avoid exact hot-path counts, cache/precompute counts, or load counts asynchronously after `LIMIT + 1`.

### AGG-C14-28 - Feed ordering lacks matching indexes

Severity: Medium. Confidence: Medium. Agents: perf-reviewer.

Files: `apps/web/src/app/feed.xml/route.ts:29-40`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:49-63`, `apps/web/src/lib/data.ts:828-853`, `apps/web/src/db/schema.ts:94-120`.

Feeds order by `updated_at DESC, created_at DESC, id DESC`, but indexes are capture-date/created-at oriented.

Fix: add feed-shaped indexes or split feed ID selection into an indexed subquery before tag aggregation.

### AGG-C14-29 - Pipeline-version backfill scans lack supporting index

Severity: Medium. Confidence: Medium. Agents: perf-reviewer.

Files: `apps/web/src/lib/admin-backfill-runner.ts:370-408`, `apps/web/scripts/backfill-color-pipeline.ts:337-348`, `apps/web/src/db/schema.ts:76-120`.

Stale-pipeline candidate discovery filters by `processed` and `pipeline_version` without a matching composite index.

Fix: add and validate `(processed, pipeline_version, id)` or split predicates if MySQL does not use the index.

### AGG-C14-30 - Semantic rate-limit helper comment contradicts charged short-query behavior

Severity: Low. Confidence: Medium. Agents: code-reviewer.

Files: `apps/web/src/lib/rate-limit.ts:372-375`, `apps/web/src/app/api/search/semantic/route.ts:194-243`, `apps/web/src/__tests__/semantic-search-route.test.ts:230-235`.

The helper comment says short queries are an example rollback case, but the route intentionally charges after body admission and does not roll back short queries.

Fix: update the comment or explicitly move short-query validation before charging and test that contract.

### AGG-C14-31 - Sitemap/robots metadata routes lack direct behavioral coverage

Severity: Low. Confidence: Medium. Agents: test-engineer.

Files: `apps/web/src/app/sitemap.ts:24-119`, `apps/web/src/app/robots.ts:17-25`.

No direct tests invoke sitemap/robots behavior despite non-trivial URL budget, locale expansion, feed entries, and crawl policy.

Fix: add direct unit tests with mocked data helpers.

### AGG-C14-32 - Quarantined storage abstraction models resources in wrong keyspace

Severity: Medium. Confidence: High. Agents: architect.

Files: `apps/web/src/lib/storage/index.ts:4-12`, `apps/web/src/__tests__/storage-quarantine.test.ts:1-132`, `apps/web/src/lib/storage/local.ts:15-20`, `apps/web/src/lib/storage/local.ts:130-137`, `apps/web/src/lib/process-topic-image.ts:11-102`, `apps/web/docker-compose.yml:23-27`, `apps/web/next.config.ts:29-34`, `apps/web/src/lib/serve-upload.ts:15-140`.

If the quarantined storage abstraction is wired in, topic resources would be stored/served under upload keyspace instead of `public/resources`.

Fix: keep quarantine or split explicit upload/original/resource keyspaces before integration.

### AGG-C14-33 - LocalStorageBackend write paths are less hardened than live pipeline

Severity: Medium. Confidence: Medium. Agents: architect.

Files: `apps/web/src/__tests__/storage-quarantine.test.ts:11-16`, `apps/web/src/lib/storage/local.ts:40-98`, `apps/web/src/lib/storage/local.ts:118-127`, `apps/web/src/lib/upload-paths.ts:11-46`.

If quarantine is breached, writes/copies follow final-path symlinks and lack production-grade temp/atomic/no-follow checks.

Fix: keep quarantine or harden writes before integration with temp files, `lstat`/realpath checks, and symlink tests.

### AGG-C14-34 - Embedding bootstrap retry can outlive restore quiescence

Severity: Medium. Confidence: Medium. Agents: debugger.

Files: `apps/web/src/lib/image-queue.ts:327-425`, `apps/web/src/lib/image-queue.ts:951-956`, `apps/web/src/lib/image-queue.ts:1035-1063`, `apps/web/src/app/[locale]/admin/db-actions.ts:367-385`, `apps/web/src/lib/restore-maintenance.ts:21-55`.

The bootstrap retry root promise is fire-and-forget until per-row tasks are registered, so restore quiescence may miss it before it begins writes.

Fix: track the bootstrap root promise in queue side effects or a dedicated state slot that restore quiescence awaits; re-check maintenance close to insert.

### AGG-C14-35 - CLIP spec uses broad `./data/models/` path in some shipped sections

Severity: Low. Confidence: Medium. Agents: document-specialist.

Files: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:24`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:34`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:41`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:72`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:137`, `apps/web/src/lib/clip-paths.ts:48-65`.

The shipped CLIP design spec inconsistently says `./data/models/` while implementation/runbooks use `data/models/clip`.

Fix: update shipped-status sections to consistently say `data/models/clip`.

### AGG-C14-36 - Root layout hard-codes LTR despite future-RTL comment

Severity: Low. Confidence: High. Agents: designer.

Files: `apps/web/src/app/[locale]/layout.tsx:94-100`.

The document direction is hard-coded `ltr` while the nearby comment implies future RTL readiness.

Fix: derive direction from locale or update the comment to state RTL is out of scope.

### AGG-C14-37 - Photo-page swipe listeners may intercept gestures outside media

Severity: Low-medium. Confidence: Medium. Agents: ui-ux-designer-reviewer.

Files: `apps/web/src/components/photo-navigation.tsx:47-60`, `apps/web/src/components/photo-navigation.tsx:131-133`.

Global `window` touch listeners can call `preventDefault()` after detecting horizontal movement, even if the gesture starts over controls/panels.

Fix: scope swipe handling to the photo media region or ignore gestures starting in controls/dialogs/sheets/scrollable metadata.

### AGG-C14-38 - README PWA offline fallback claim is too broad

Severity: Low. Confidence: Medium-high. Agents: product-marketer-reviewer.

Files: `README.md:38`, `apps/web/public/sw.template.js:7-18`, `apps/web/public/sw.template.js:62-66`, `apps/web/public/sw.template.js:297-398`.

README says offline HTML fallback, but implementation is a 24-hour fallback for previously visited eligible public HTML, with admin/share/smart/group/map bypasses.

Fix: qualify the README claim.

### AGG-C14-39 - Firefox color/HDR copy blames the wrong capability layer

Severity: Low. Confidence: Medium. Agents: product-marketer-reviewer.

Files: `apps/web/messages/en.json:739-740`, `apps/web/messages/ko.json:739-740`, `CLAUDE.md:368-375`.

UI copy says Firefox does not support the `color-gamut` media query, while docs say Firefox parses it but reports false because wide-gamut rendering is not implemented.

Fix: reword both locales to a more precise detection/support statement.

## Risks Needing Manual Validation Or Explicit Deferral

### AGG-C14-R01 - Listing/search SQL needs production-scale evidence

Severity: Medium at large scale. Confidence: Medium. Agents: critic, perf-reviewer.

Files: `apps/web/src/lib/data.ts:878-907`, `apps/web/src/lib/data.ts:1438-1453`, `apps/web/src/lib/data.ts:1482-1555`, `apps/web/src/db/schema.ts:115-117`.

Validate with `EXPLAIN ANALYZE` on production-sized data for home/topic/tag/smart collection/search paths before deciding on count/index/search-index changes.

### AGG-C14-R02 - Admin/origin/browser E2E coverage is environment-gated

Severity: Medium if CI lacks seeded lanes. Confidence: High for gating. Agents: critic, verifier, designer, ui-ux-designer-reviewer.

Files: `apps/web/e2e/admin.spec.ts:7-12`, `apps/web/e2e/origin-guard.spec.ts:29-77`.

Local review hit `ECONNREFUSED 127.0.0.1:3306`; data-backed public pages and protected admin browser flows need seeded DB/credentials validation.

### AGG-C14-R03 - Trusted-proxy/single-instance topology must be validated

Severity: High if violated. Confidence: High for repo assumption. Agents: security-reviewer, architect, critic.

Files: `CLAUDE.md:227-230`, `apps/web/docker-compose.yml:3-27`, `apps/web/src/lib/restore-maintenance.ts:1-55`, `apps/web/src/lib/image-queue.ts:76-325`, `apps/web/src/lib/rate-limit.ts:75-119`, `apps/web/src/lib/data.ts:75-150`.

The app remains correct only under one active web process with trusted proxy headers. Validate deployment and document/guard against scale-out until process-local state moves to shared storage.

### AGG-C14-R04 - SQL backups are intentionally plaintext and DB-only

Severity: Low-Medium depending on host controls. Confidence: High. Agents: security-reviewer.

Files: `CLAUDE.md:209-210`, `apps/web/src/app/[locale]/admin/db-actions.ts:140-178`, `apps/web/src/app/api/admin/db/download/route.ts:21-101`.

Validate host/offsite encryption and pair DB dumps with filesystem snapshots for full recovery.

### AGG-C14-R05 - Admin authorization is all-root by design

Severity: Medium if admins are not equally trusted. Confidence: High. Agents: security-reviewer.

Files: `README.md:40`, `CLAUDE.md:229`, `apps/web/src/app/actions/admin-users.ts:75-82`, `apps/web/src/app/[locale]/admin/db-actions.ts:121-133`.

Validate that every admin account is fully trusted; otherwise plan roles/capabilities.

### AGG-C14-R06 - Historical secrets need operator rotation validation

Severity: Medium if historical examples were reused. Confidence: Unknown for production. Agents: security-reviewer.

Files: `apps/web/.env.local.example:19-30`, `CLAUDE.md:80-85`.

Confirm production secrets were rotated away from historical examples.

### AGG-C14-R07 - Real CLIP production/offline suites are skipped by default

Severity: Medium. Confidence: High. Agents: test-engineer, verifier, product-marketer-reviewer.

Files: `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `.github/workflows/quality.yml:66-80`, `apps/web/src/app/api/search/semantic/route.ts:248-283`.

Add a seeded scheduled/manual CI lane for real CLIP offline load/ranking, and manually validate live demo semantic/similar after deploy/config changes.

### AGG-C14-R08 - Semantic/similar brute force and inference waiter limits need load evidence

Severity: Medium. Confidence: Medium. Agents: perf-reviewer.

Files: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:261-305`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`, `apps/web/src/lib/clip-model.ts:53-70`.

Load-test scan limits and add bounded CLIP admission/backpressure before raising limits.

### AGG-C14-R09 - Infinite masonry retains every loaded card

Severity: Medium. Confidence: High. Agents: perf-reviewer.

Files: `apps/web/src/components/home-client.tsx:124-130`, `apps/web/src/components/load-more.tsx:41-96`, `apps/web/src/components/home-client.tsx:286-360`.

Consider virtualization/windowing after a threshold for very long browsing sessions.

### AGG-C14-R10 - Non-sargable timeline/search/smart predicates are scale-sensitive

Severity: Low-Medium. Confidence: High. Agents: perf-reviewer, debugger.

Files: `apps/web/src/lib/data-timeline.ts:97-207`, `apps/web/src/lib/data.ts:1537-1613`, `apps/web/src/lib/smart-collections.ts:218-264`.

Validate under different `TZ` and production-sized data; use sargable date ranges/generated columns or proper search indexes if confirmed.

### AGG-C14-R11 - Service-worker image freshness adds one HEAD RTT per warm cached image

Severity: Low. Confidence: High. Agents: perf-reviewer.

Files: `apps/web/public/sw.template.js:31-38`, `apps/web/public/sw.template.js:227-260`, `apps/web/src/lib/serve-upload.ts:20-80`.

Measure warm-cache waterfalls before changing; consider coalescing/versioned URLs if it becomes visible.

### AGG-C14-R12 - Topic slug is mutable natural key with manual rename fan-out

Severity: Medium. Confidence: High. Agents: architect.

Files: `apps/web/src/db/schema.ts:4-33`, `apps/web/src/db/schema.ts:239-249`, `apps/web/src/app/actions/topics.ts:255-339`, `apps/web/src/__tests__/topic-slug-fk-registry.test.ts:1-23`.

Plan a structural migration to immutable topic IDs or `ON UPDATE CASCADE`; keep registry tests until then.

### AGG-C14-R13 - Migration runner cannot detect live schema drift after hashes are recorded

Severity: Medium. Confidence: Medium. Agents: architect.

Files: `apps/web/drizzle/meta/_journal.json:47-64`, `apps/web/scripts/migrate.js:748-808`, `CLAUDE.md:421-427`.

Add read-only schema-shape postconditions if operator drift has been observed.

### AGG-C14-R14 - Historical archived docs may contain stale recommendations

Severity: Low. Confidence: Medium. Agents: document-specialist.

Files: `.context/**`, `plan/**`.

Treat archived plans/reviews as historical unless linked from active docs.

### AGG-C14-R15 - Some advanced env knobs are intentionally undocumented

Severity: Low. Confidence: Medium. Agents: document-specialist.

Files: `apps/web/.env.local.example`, related scripts/libs.

Revisit only if advanced/test-only knobs become supported operator controls.

### AGG-C14-R16 - OG/social cards need deployed validator coverage

Severity: Low. Confidence: Medium. Agents: product-marketer-reviewer.

Files: `apps/web/src/app/[locale]/(public)/page.tsx:61-123`, `apps/web/src/app/api/og/route.tsx:33-224`, `apps/web/src/app/api/og/photo/[id]/route.tsx:38-299`.

Validate home/topic/photo OG URLs with social-card validators after deploy.

### AGG-C14-R17 - PWA install/offline behavior needs browser smoke coverage

Severity: Low. Confidence: Medium. Agents: product-marketer-reviewer.

Files: `apps/web/src/app/manifest.ts:6-52`, `apps/web/public/sw.template.js:370-403`.

Run production-build installability/offline smoke for eligible and bypassed routes.

## Verified No-Finding Summaries

- Security-reviewer found no confirmed or likely vulnerabilities and passed lint/typecheck/security gate subsets, `npm audit`, and targeted security tests.
- Verifier found no confirmed correctness findings, with the local E2E/MySQL blocker recorded above.
- Tracer found no confirmed/likely defects beyond the similar-photo visibility risk promoted by debugger.
