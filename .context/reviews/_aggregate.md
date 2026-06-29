# Cycle 13 Aggregate Review

Date: 2026-06-29

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

Raw findings across agent files: 41.
Deduped aggregate findings: 38.

Agent failures: none. The subagent service hit the live-agent cap during fan-out, so the remaining required reviewer personas were launched as earlier workers completed and were closed. No requested review perspective was dropped.

## Cross-Agent Agreement

- Service-worker admin bypass was independently flagged by verifier and tracer: unlocalized `/admin` routes are not matched by the SW admin bypass predicate.
- Restore maintenance failure was debugger-confirmed and aligns with the repo's documented restore/queue safety model: after `mysql` begins importing, failed restore exits must fail closed.
- Several reviewers converged on single-instance/topology boundaries, but those are documented deployment constraints rather than immediate code defects when production remains one web process.

## Findings

### AGG-C13-01 - Failed mysql restore can clear maintenance after partial import

Severity: High. Confidence: High. Status: Confirmed.
Agents: debugger.

Files: `apps/web/src/app/[locale]/admin/db-actions.ts:367-389`, `apps/web/src/app/[locale]/admin/db-actions.ts:526-604`.

Once `mysql` starts importing a validated dump, read/stdin/spawn failures and nonzero mysql exits resolve failure without `keepMaintenance: true`. The outer `finally` then clears restore maintenance and resumes the image queue because `keepRestoreMaintenance` is false, even though the live DB may be partially mutated.

Fix: after handoff to `mysql`, return `keepMaintenance: true` for nonzero import exits and non-ignorable stream/process failures. Add regression coverage that the queue is not resumed and maintenance is not cleared after a started import fails.

### AGG-C13-02 - `updatePassword` reads auth state before rejecting hostile origin

Severity: High. Confidence: High. Status: Confirmed coverage-backed correctness/security gap.
Agents: test-engineer.

Files: `apps/web/src/app/actions/auth.ts:283-298`, `apps/web/src/__tests__/auth-actions-behavior.test.ts:241-253`, `apps/web/scripts/check-action-origin.ts:228-232`.

The generic action scanner treats session/user reads before origin validation as prohibited, but `auth.ts` is intentionally excluded. `updatePassword` currently calls `getCurrentUser()` before checking `hasTrustedSameOrigin`, and the hostile-origin behavior test only asserts no Argon2 verify/transaction.

Fix: check trusted origin before `getCurrentUser()` and add a regression assertion that hostile-origin password-change requests do not verify sessions or perform DB user reads.

### AGG-C13-03 - Service worker admin bypass omits unlocalized `/admin` routes

Severity: Low. Confidence: High. Status: Confirmed.
Agents: verifier, tracer.

Files: `apps/web/public/sw.template.js:42-46`, `apps/web/src/lib/sw-cache.ts:54-62`, `apps/web/src/__tests__/sw-cache.test.ts:47-71`, `apps/web/src/proxy.ts:65-72`.

The SW bypass predicate matches locale-prefixed admin pages and `/api/admin`, but misses `/admin` and `/admin/dashboard`, which the proxy treats as protected default-locale admin routes. Those routes can fall through to the offline HTML cache path.

Fix: match `^/admin(/|$)` in the template and reference helper, regenerate `public/sw.js`, and add tests for `/admin` and `/admin/dashboard`.

### AGG-C13-04 - OKLCH overrides invalidate Tailwind HSL color utilities

Severity: High. Confidence: High. Status: Confirmed.
Agents: designer.

Files: `apps/web/tailwind.config.ts:23-61`, `apps/web/src/app/[locale]/globals.css:121-148`.

Tailwind emits utilities like `hsl(var(--primary))`, but the OKLCH support block replaces `--primary` and related variables with full `oklch(...)` functions. In Chromium, primary and destructive utilities compute to invalid declarations/fallback colors.

Fix: keep the token contract consistent. Either remove the OKLCH overrides for these HSL-channel variables or migrate Tailwind token definitions to complete `var(...)` color values with tested fallbacks. Add computed-style regression coverage.

### AGG-C13-05 - TagInput combobox misses the 44 px touch-target contract

Severity: Medium. Confidence: High. Status: Confirmed.
Agents: designer.

Files: `apps/web/src/components/tag-input.tsx:184-223`, `apps/web/src/__tests__/touch-target-audit.test.ts`.

The raw combobox input has no `min-h-11` or equivalent target sizing, and the wrapper does not proxy clicks to focus the input. Existing touch-target tests do not scan text inputs.

Fix: give the input an explicit 44 px hit target or make the wrapper an honest focus proxy, and extend the touch-target audit for raw text/search inputs.

### AGG-C13-06 - Fire-and-forget public analytics can still reject before internal catch

Severity: Medium. Confidence: High. Status: Confirmed.
Agents: critic.

Files: `apps/web/src/app/actions/public.ts:357-441`, public page call sites under `p/[id]`, `[topic]`, and `g/[key]`.

The view-recording functions catch only final insert failures. `headers()`, target visibility selects, or rate-limit work can reject before the internal catch while callers discard the returned promise.

Fix: wrap the full recorder body in `try/catch` after cheap input validation and add regression tests for rejected pre-insert work.

### AGG-C13-07 - nginx forwarded-IP handling conflicts with documented multi-hop edge guidance

Severity: Medium. Confidence: High for mismatch; production impact requires topology validation. Status: Confirmed mismatch / manual validation.
Agents: critic.

Files: `apps/web/nginx/default.conf`, `apps/web/src/lib/rate-limit.ts:161-183`, `README.md:151-154`.

Docs describe a possible CDN/LB -> nginx -> app chain, but nginx overwrites `X-Forwarded-For` with `$remote_addr`, collapsing upstream client chains. With multi-hop settings, app-visible per-IP rate-limit buckets can become edge-IP buckets.

Fix: either configure nginx trusted-real-IP handling for the intended upstream topology and update tests, or narrow docs to the single host-nginx hop contract.

### AGG-C13-08 - Public map can render and serialize up to 10k markers

Severity: High. Confidence: High. Status: Confirmed performance issue.
Agents: perf-reviewer.

Files: `apps/web/src/lib/data.ts:1649-1676`, `apps/web/src/app/[locale]/(public)/map/page.tsx:31-79`, `apps/web/src/components/map/map-client.tsx:76-143`.

The public map fetches, serializes, server-renders a link for, and Leaflet-renders every marker up to `MAP_MAX_MARKERS = 10000`.

Fix: use clustering and viewport/bounds-based or paginated marker loading, with a lower initial render cap.

### AGG-C13-09 - Admin dashboard renders every permanently failed image

Severity: Medium. Confidence: High. Status: Confirmed performance issue.
Agents: perf-reviewer.

Files: `apps/web/src/lib/data.ts:1000-1013`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:73-120`.

`getFailedImages()` has no limit or failed-list index, and dashboard renders every failed row synchronously.

Fix: paginate/lazy-load failed images and add an index shaped for the failed list after checking `EXPLAIN`.

### AGG-C13-10 - First public listing pages perform count-window work on dynamic requests

Severity: Medium. Confidence: Medium. Status: Likely performance issue.
Agents: perf-reviewer.

Files: `apps/web/src/lib/data.ts:878-907`, public home/topic/smart collection pages.

Dynamic listing pages compute `COUNT(*) OVER()` with joins/grouping for the initial visible page.

Fix: avoid exact hot-path counts or cache/precompute them; use `LIMIT + 1` for `hasMore`.

### AGG-C13-11 - Image queue can pin shared DB pool connections through Sharp work

Severity: Medium. Confidence: High. Status: Likely performance/concurrency issue.
Agents: perf-reviewer.

Files: `apps/web/src/db/index.ts:23-33`, `apps/web/src/lib/image-queue.ts:446-657`.

Image jobs hold advisory-lock pool connections while doing CPU/disk-heavy Sharp work, and `QUEUE_CONCURRENCY` can be raised high enough to starve live request DB capacity.

Fix: use a dedicated lock pool, row leases, or clamp effective queue concurrency against reserved live pool capacity.

### AGG-C13-12 - GPS stripping materializes whole originals after streaming save

Severity: Medium. Confidence: High. Status: Likely memory issue.
Agents: perf-reviewer.

Files: `apps/web/src/lib/process-image.ts:887-910`, `apps/web/src/lib/process-image.ts:1738-1786`, `apps/web/src/app/api/admin/lr/upload/route.ts:150-153`.

The upload save path streams to disk, but GPS stripping immediately reads whole originals and may allocate a second scrubbed/re-encoded buffer.

Fix: add a memory-budget gate and plan streaming/container-aware scrubbers where feasible.

### AGG-C13-13 - Semantic search is bounded brute force with unbounded inference waiters

Severity: Medium. Confidence: Medium-High. Status: Manual validation/performance risk.
Agents: perf-reviewer.

Files: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:261-305`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`, `apps/web/src/lib/clip-model.ts:53-70`.

Semantic/similar routes decode and score bounded newest-first embedding scans per request; CLIP inference waiters are unbounded.

Fix: load-test production CLIP limits, add bounded global admission/backpressure, and plan vector indexing before raising scan caps.

### AGG-C13-14 - Infinite masonry retains every loaded card and image element

Severity: Medium. Confidence: High. Status: Manual validation/performance risk.
Agents: perf-reviewer.

Files: `apps/web/src/components/home-client.tsx:124-130`, `apps/web/src/components/home-client.tsx:286-360`, `apps/web/src/components/load-more.tsx:41-96`.

Long browsing sessions append and retain all loaded image cards in the DOM.

Fix: add virtualization/windowing or cap mounted pages while preserving scroll restoration.

### AGG-C13-15 - Non-sargable timeline/search/smart predicates are scale-sensitive

Severity: Low-Medium. Confidence: High. Status: Performance risk.
Agents: perf-reviewer.

Files: `apps/web/src/lib/data-timeline.ts:97-207`, `apps/web/src/lib/data.ts:1537-1613`, `apps/web/src/lib/smart-collections.ts:218-264`.

Date functions and `%LIKE%` predicates are bounded but can scan heavily at larger gallery scale.

Fix: add generated/indexed date parts or search indexes if these paths become hot.

### AGG-C13-16 - Service worker image freshness probe can add one HEAD RTT per warm cached tile

Severity: Low. Confidence: High. Status: Performance tradeoff.
Agents: perf-reviewer.

Files: `apps/web/public/sw.template.js:226-270`, `apps/web/public/sw.js:226-270`.

Warm cached image display performs a synchronous bounded HEAD probe when an ETag exists.

Fix: measure before changing; consider batching/coalescing or versioned derivative URLs if visible.

### AGG-C13-17 - Public route IDs accept unsafe integer ranges before DB lookup

Severity: Low. Confidence: Medium. Status: Future-schema risk.
Agents: code-reviewer.

Files: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`.

Routes parse digit-only IDs to `number` but do not reject values above `Number.MAX_SAFE_INTEGER` or the current MySQL int range before DB lookup.

Fix: centralize route ID parsing with safe integer and schema-bound checks.

### AGG-C13-18 - Database backups are plaintext at rest

Severity: Low. Confidence: High. Status: Confirmed operational/security boundary.
Agents: security-reviewer.

Files: `apps/web/src/app/[locale]/admin/db-actions.ts:140-172`, `apps/web/src/app/api/admin/db/download/route.ts:78-86`, `apps/web/src/db/schema.ts:160-211`.

SQL backups are written as plaintext files with restrictive modes. This matches the documented host/storage encryption boundary but remains a security exposure if copied off-host or the deploy user is compromised.

Fix: encrypt backups with an operator-controlled key if the operational boundary changes; otherwise keep the plaintext-at-rest warning explicit.

### AGG-C13-19 - Checked-in nginx is HTTP-only and depends on an external TLS edge

Severity: High if internet-facing, otherwise informational. Confidence: Medium for deployed exposure. Status: Manual validation risk.
Agents: security-reviewer.

Files: `apps/web/nginx/default.conf:21-29`, `apps/web/docker-compose.yml:14-21`.

The shipped nginx listens on port 80 only and relies on a TLS-terminating edge.

Fix: validate live topology; add TLS/redirect if this nginx can be reached by external clients.

### AGG-C13-20 - Public analytics actions can be intentionally forged within limits

Severity: Low. Confidence: Medium. Status: Accepted analytics-integrity risk.
Agents: security-reviewer.

Files: `apps/web/src/app/actions/public.ts:314-442`.

Public view-recording actions are origin-exempt and rate-limited, but a caller can inflate visible analytics within per-IP limits.

Fix: if analytics integrity matters, require stronger bot/origin/page-view proof; otherwise document counts as non-audit-grade.

### AGG-C13-21 - Retained originals may keep GPS if best-effort stripping cannot parse them

Severity: Low. Confidence: Medium. Status: Future/operational privacy risk.
Agents: security-reviewer.

Files: `apps/web/src/app/actions/images.ts:385-387`, `apps/web/src/app/api/admin/lr/upload/route.ts:364-378`, `apps/web/src/lib/process-image.ts:1738-1820`.

Public metadata/derivatives are stripped, but structurally anomalous retained originals can keep GPS if stripping fails.

Fix: persist strip status or refuse future original downloads when stripping failed.

### AGG-C13-22 - Failed-image retry recovery uses source-text tests for side effects

Severity: Medium. Confidence: High. Status: Confirmed test gap.
Agents: test-engineer.

Files: `apps/web/src/app/actions/images.ts:1162-1275`, `apps/web/src/__tests__/failed-image-retry.test.ts:4-113`.

Important retry side effects are asserted by source snippets rather than runtime state transition tests.

Fix: add mocked behavior tests for success, config failure, non-failed row, invalid id, and enqueue rejection.

### AGG-C13-23 - Navigation visual check records screenshots without baselines

Severity: Medium. Confidence: High. Status: Confirmed test gap.
Agents: test-engineer.

Files: `apps/web/e2e/nav-visual-check.spec.ts:40-79`.

The spec captures screenshots as artifacts but never asserts `toHaveScreenshot`.

Fix: add visual baseline assertions or rename the spec as manual artifact generation and add a real visual regression spec.

### AGG-C13-24 - Production CLIP semantic-search coverage is skipped by default CI

Severity: Medium. Confidence: High. Status: Coverage/CI risk.
Agents: test-engineer.

Files: `apps/web/src/__tests__/clip-semantic-integration.test.ts`, `apps/web/src/__tests__/clip-offline-load.test.ts`, `.github/workflows/quality.yml`.

Production CLIP ranking and offline model-load tests require opt-in env/cache and do not run in default CI.

Fix: add a scheduled or label-triggered CI job with seeded `CLIP_MODELS_ROOT`.

### AGG-C13-25 - Expensive public GET route rate limiting remains a manual-audit boundary

Severity: Medium. Confidence: Medium. Status: Future gate risk.
Agents: test-engineer.

Files: `apps/web/scripts/check-public-route-rate-limit.ts`, public GET routes for similar/OG.

The public route scanner only enforces mutating handlers. Expensive public GET routes rely on bespoke tests and author memory.

Fix: add an expensive-GET scan mode for known costly imports/calls.

### AGG-C13-26 - Sitemap and robots routes lack direct route-level regression tests

Severity: Low. Confidence: Medium. Status: Likely test gap.
Agents: test-engineer.

Files: `apps/web/src/app/sitemap.ts`, `apps/web/src/app/robots.ts`.

There are no direct unit tests for localized sitemap/feed entries, fallback behavior, or robots disallow output.

Fix: add route-level tests with mocked data/config.

### AGG-C13-27 - No coverage-report script or threshold exists

Severity: Low. Confidence: High. Status: Tooling gap.
Agents: test-engineer.

Files: root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `.github/workflows/quality.yml`.

The suite has many source-contract tests but no coverage signal or threshold.

Fix: start with a non-blocking coverage report for critical directories.

### AGG-C13-28 - Smart collection predicate contract is column-global

Severity: Medium. Confidence: Medium. Status: Likely issue.
Agents: architect.

Files: `apps/web/src/lib/smart-collections.ts:21-392`, `apps/web/src/app/actions/collections.ts`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`.

One global operator set applies to numeric, text, date, topic, and tag columns, allowing semantically invalid predicates to be saved and executed.

Fix: use per-column operator/value schemas and reject invalid combinations at save time.

### AGG-C13-29 - Single-instance runtime is an explicit correctness boundary

Severity: High if violated. Confidence: High. Status: Accepted topology constraint / manual validation.
Agents: architect.

Files: `CLAUDE.md`, `apps/web/docker-compose.yml`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/data.ts`.

Restore flags, queue state, upload tracking, public rate-limit fast paths, and view-count buffering are process-local.

Fix: keep production to exactly one active web process or move these states to shared durable coordination before scaling.

### AGG-C13-30 - Upload attribution comments still claim public Atom per-entry author attribution

Severity: Low. Confidence: High. Status: Confirmed docs/code mismatch.
Agents: document-specialist.

Files: `apps/web/src/app/actions/images.ts:435-439`, `apps/web/src/app/api/admin/lr/upload/route.ts:434-443`, `apps/web/src/lib/data.ts:833-845`.

Ingest comments suggest `uploaded_by` feeds public per-entry Atom authors, but current feed code intentionally emits feed-level authors only.

Fix: update comments to describe admin/audit linkage and the separate safe-display-name requirement for future public per-entry authors.

### AGG-C13-31 - `CLAUDE.md` overstates canonical URL matching requirements

Severity: Low. Confidence: High. Status: Confirmed docs/code mismatch.
Agents: document-specialist.

Files: `CLAUDE.md`, `apps/web/src/lib/constants.ts`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/src/app/api/og/photo/[id]/route.tsx`.

`CLAUDE.md` says `site-config.json.url` must match `BASE_URL`, while code uses effective `BASE_URL || siteConfig.url`.

Fix: clarify that `BASE_URL` may override `siteConfig.url`.

### AGG-C13-32 - Privacy test comment points to obsolete `data.ts` line range

Severity: Low. Confidence: High. Status: Confirmed docs/test mismatch.
Agents: document-specialist.

Files: `apps/web/src/__tests__/privacy-fields.test.ts:81-84`, `apps/web/src/lib/data.ts:459-477`.

The test comment cites a stale line range for `_privacyGuard`.

Fix: use a symbol reference rather than line numbers.

### AGG-C13-33 - Caption-generator comment says binary footprint is zero despite CLIP native inference

Severity: Low. Confidence: Medium. Status: Likely docs/code mismatch.
Agents: document-specialist.

Files: `apps/web/src/lib/caption-generator.ts:4-15`, `apps/web/package.json`, `package-lock.json`, `apps/web/src/lib/clip-embeddings.ts`.

The Florence caption stub comment says binary footprint is zero, which conflicts with shipped CLIP/ONNX native inference in the app.

Fix: narrow the comment to no additional captioning/Florence footprint.

### AGG-C13-34 - CLIP design spec still contains unresolved open-item wording

Severity: Low. Confidence: Medium. Status: Documentation cleanup / manual validation.
Agents: document-specialist.

Files: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:94-132`, `apps/web/src/lib/clip-embeddings.ts:175-191`.

The spec top banner says production is shipped, but later sections still label threshold calibration as an open item.

Fix: rename the section to decisions/resolutions and note `PRODUCTION_COSINE_THRESHOLD = 0.22`.

### AGG-C13-35 - Mobile info sheet modality in peek state needs validation

Severity: Medium. Confidence: Medium. Status: Likely UI/a11y risk.
Agents: designer.

Files: `apps/web/src/components/info-bottom-sheet.tsx:176-210`.

Peek state lacks a backdrop but still activates focus trap and `aria-modal="true"`.

Fix: manually test mobile assistive-tech behavior and choose a consistent modal or non-modal peek contract.

### AGG-C13-36 - Similar-search target visibility hardening should be validated

Severity: Medium. Confidence: Medium. Status: Manual validation risk.
Agents: tracer.

Files: `apps/web/src/app/api/search/similar/[id]/route.ts`.

Tracer flagged target visibility as worth validating so private/deleted/unprocessed target IDs cannot shape public similar-image behavior.

Fix: audit the route target lookup and add a regression test if visibility constraints are not already explicit.

### AGG-C13-37 - Upload serving realpath-before-stream TOCTOU assumption should be documented/validated

Severity: Low. Confidence: Medium. Status: Manual validation risk.
Agents: tracer.

Files: `apps/web/src/lib/serve-upload.ts`.

Tracer flagged the time between path validation/realpath checks and stream opening as a residual filesystem race assumption.

Fix: document the accepted local-filesystem trust boundary or open files using a pattern that reduces post-check path swapping risk.

### AGG-C13-38 - Review scratch files under `.context/reviews` are easy to commit accidentally

Severity: Low. Confidence: High. Status: Confirmed process hygiene issue.
Agents: critic.

Files: `.gitignore:19-25`.

The ignore rules unignore all `.context/reviews/**` except a few log paths, so temporary inventories or hidden scratch files can become trackable.

Fix: ignore scratch suffixes such as `.tmp` or create a separate ignored `.context/scratch/` location for generated review intermediates.

---

# Cycle 12 Aggregate Review

Date: 2026-06-29

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
- `.context/reviews/product-marketer-reviewer.md`

Raw findings across agent files: 47.
Deduped aggregate findings: 40.

Agent failures: none. The subagent service initially hit its live-agent cap after five agents, so the remaining reviewer lanes were launched after completed agents were closed. No requested review perspective was dropped.

## High Signal Agreement Clusters

- LR upload request body cap: critic and debugger both flagged that `apps/web/src/app/api/admin/lr/upload/route.ts` parses multipart before enforcing the 200 MiB per-file cap.
- Migration convergence: critic and architect both flagged that schema/journal reconciliation can leave old defaults or unjournaled schema changes treated as applied.
- Single-process topology: architect, debugger, and tracer all flagged that documented single-instance runtime assumptions lack hard guardrails.
- Service-worker stale cache: code-reviewer and tracer independently found stale offline/cache behavior after revoke/delete or privacy visibility changes.
- Docs/copy drift: verifier, document-specialist, and product-marketer all found stale or over-broad user/operator wording.

## Findings

### AGG-C12-01 - Journal-covered databases can skip schema repair for current columns

Severity: High. Confidence: High. Status: Confirmed.
Agents: critic, architect.

Files: `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/db/schema.ts`.

The migration runner can baseline or consider journal hashes applied while the concrete schema still depends on `reconcileLegacySchema()` repair paths. A database with partial historical migration state can keep old column defaults or miss newer schema details while future deploys report migration success.

Fix: add journaled migrations for current schema deltas where missing and make `reconcileLegacySchema()` converge defaults/indexes, not just column existence. Add a regression test that simulates an old/poisoned `__drizzle_migrations` state and asserts the final schema matches `schema.ts`.

### AGG-C12-02 - Lightroom upload parses oversized multipart before enforcing the per-file cap

Severity: High. Confidence: High. Status: Confirmed risk.
Agents: critic, debugger.

Files: `apps/web/src/app/api/admin/lr/upload/route.ts:85`, `apps/web/src/app/api/admin/lr/upload/route.ts:139`, `apps/web/src/app/api/admin/lr/upload/route.ts:147`, `apps/web/src/lib/process-image.ts:887`.

The LR route validates `Content-Length` against the total upload window, then calls `request.formData()` before rejecting `fileEntry.size > MAX_UPLOAD_FILE_BYTES`. A PAT caller or bypass of nginx body caps can force Next to materialize a body that should have been rejected at the application boundary.

Fix: reject declared LR upload sizes above the file cap plus multipart overhead before `formData()`, then reject `fileEntry.size > MAX_UPLOAD_FILE_BYTES` immediately after parse and before topic/settings/disk work. Add a source or route test for both guards.

### AGG-C12-03 - Offline HTML cache can outlive smart-collection revoke/delete

Severity: Medium. Confidence: High. Status: Confirmed.
Agents: code-reviewer.

Files: `apps/web/public/sw.template.js:275`, `apps/web/public/sw.template.js:370`, `apps/web/src/app/actions/collections.ts:112`, `apps/web/src/lib/data.ts:1375`.

The service worker excludes revocable share pages from offline HTML caching, but public smart collection pages (`/c/[slug]`) are revocable by admin delete or public/private toggle and can still be served from the 24 h offline fallback.

Fix: treat public smart-collection HTML as revocable in the SW, or add a versioned/revocation-aware cache key and invalidate on collection mutation. Regenerate `public/sw.js` after template edits.

### AGG-C12-04 - Offline HTML cache can preserve GPS map markers after topic map visibility is disabled

Severity: Medium. Confidence: High. Status: Confirmed.
Agents: code-reviewer.

Files: `apps/web/public/sw.template.js:275`, `apps/web/src/app/actions/topics.ts:594`, `apps/web/src/lib/data.ts:1658`, `apps/web/src/components/map/map-client.tsx`.

The public map page can be cached as offline HTML. If an admin later disables `topic.map_visible`, a previously cached map page can still expose the old rendered marker set while offline.

Fix: bypass offline HTML caching for the map page, or add a privacy-sensitive cache invalidation/version mechanism tied to `map_visible` changes.

### AGG-C12-05 - Service worker serves deleted image derivatives from stale cache

Severity: Medium. Confidence: High. Status: Confirmed.
Agents: tracer.

Files: `apps/web/public/sw.template.js:176`, `apps/web/public/sw.template.js:237`, `apps/web/public/sw.template.js:245`, `apps/web/public/sw.template.js:262`, `apps/web/src/app/actions/images.ts:673`.

After an image is deleted, cached derivative URLs under `/uploads/{avif,webp,jpeg}/...` are not evicted when HEAD/GET revalidation returns 404/410. The handler falls through to return stale cached bytes.

Fix: evict the cache entry and metadata when HEAD or background GET returns 404/410 for a derivative, and lock it with SW template/reference tests.

### AGG-C12-06 - Admin dashboard loads every permanently failed image in one query/render

Severity: Medium. Confidence: High. Status: Confirmed.
Agents: perf-reviewer.

Files: `apps/web/src/lib/data.ts:1000`, admin dashboard failed-image surfaces under `apps/web/src/app/[locale]/admin/`.

`getFailedImages()` returns the entire failed-image set. A production incident with many failures can turn the admin dashboard into a large query/render path.

Fix: paginate failed images or cap the default dashboard query with a clear "view more" flow.

### AGG-C12-07 - Per-photo OG generation lacks conditional validation before Satori/Sharp work

Severity: Medium. Confidence: High. Status: Confirmed.
Agents: perf-reviewer.

Files: `apps/web/src/app/api/og/photo/[id]/route.tsx:38`, `apps/web/src/app/api/og/photo/[id]/route.tsx:227`.

The per-photo OG route performs image/Satori/Sharp work even when a crawler/client already has a fresh cached card.

Fix: support conditional request handling where practical before expensive generation, or document why dynamic cards cannot validate cheaply.

### AGG-C12-08 - Image queue can starve the shared MySQL pool while Sharp work holds advisory-lock connections

Severity: Medium. Confidence: High. Status: Likely.
Agents: perf-reviewer.

Files: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/db/index.ts`.

Queue processing combines long Sharp work with DB/advisory-lock coordination in the same process and pool budget. Higher concurrency can crowd live reads/writes.

Fix: bound queue concurrency against DB pool reserve, shorten lock-held sections where possible, and add a concurrency budget test or runtime guard.

### AGG-C12-09 - GPS stripping still materializes whole originals in memory after upload streaming

Severity: Medium. Confidence: High. Status: Likely.
Agents: perf-reviewer.

Files: `apps/web/src/lib/gps-exif-strip.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.

Large uploads are streamed to disk first, but GPS stripping can still read full originals into memory for supported formats.

Fix: evaluate streaming or bounded-buffer strip paths, or document and test the memory ceiling for max-size originals.

### AGG-C12-10 - CLIP inference admits an unbounded waiter queue with no timeout or abort propagation

Severity: Medium. Confidence: Medium-High. Status: Risk.
Agents: perf-reviewer.

Files: `apps/web/src/lib/clip-model.ts`, `apps/web/src/app/api/search/semantic/route.ts`.

Concurrent semantic requests can wait behind model inference without a bounded queue, timeout, or request abort propagation.

Fix: add inference queue limits/backpressure and connect request aborts to waiting work.

### AGG-C12-11 - Infinite gallery accumulates every loaded card and image element

Severity: Medium. Confidence: High. Status: Risk.
Agents: perf-reviewer.

Files: `apps/web/src/components/masonry-gallery.tsx`, public gallery pages.

Long browsing sessions keep all loaded cards/images mounted, increasing DOM, memory, and layout cost.

Fix: add virtualization/windowing or bounded page retention for large galleries.

### AGG-C12-12 - Semantic/similar search remains a bounded brute-force scan

Severity: Low-Medium. Confidence: High. Status: Risk.
Agents: perf-reviewer, product-marketer-reviewer.

Files: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `README.md`.

The code caps semantic scans, but user-facing wording can imply complete semantic search for larger galleries. At scale, recent-row bounded brute force can miss older matches.

Fix: clarify scale limits in README/admin copy or add an ANN/indexed search plan before making broad completeness claims.

### AGG-C12-13 - Timeline and smart/search predicates retain non-sargable scan paths

Severity: Low-Medium. Confidence: High. Status: Risk.
Agents: perf-reviewer.

Files: `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/public.ts`.

Some smart/search predicates remain hard for MySQL to satisfy through indexes, which can degrade with larger libraries.

Fix: profile representative predicates and add generated columns/indexes or query rewrites for hot filters.

### AGG-C12-14 - Backup/restore CLI TLS encrypts but does not verify server identity

Severity: Medium. Confidence: High. Status: Confirmed.
Agents: security-reviewer.

Files: `apps/web/src/lib/mysql-cli-ssl.ts:11`, `apps/web/src/app/[locale]/admin/db-actions.ts:149`, `apps/web/src/app/[locale]/admin/db-actions.ts:511`, `apps/web/scripts/mysql-connection-options.js:11`.

The app DB client uses certificate verification for remote DB TLS, but `mysqldump`/`mysql` receive `--ssl-mode=REQUIRED`, which encrypts without verifying identity.

Fix: add CA/env support and use a verifying CLI mode (`VERIFY_IDENTITY` or MariaDB equivalent), failing closed for remote DB hosts when verification cannot be configured.

### AGG-C12-15 - Shipped nginx config is HTTP-only if copied as a public edge

Severity: High risk. Confidence: Medium. Status: Risk.
Agents: security-reviewer.

Files: `apps/web/nginx/default.conf`, `CLAUDE.md`.

The shipped nginx config is appropriate behind a trusted TLS terminator but can be copied as a public edge without TLS, weakening cookies/admin traffic.

Fix: split internal versus public-edge nginx examples or make the shipped public-edge path redirect HTTP and require TLS.

### AGG-C12-16 - Database backups are plaintext at rest

Severity: Low. Confidence: High. Status: Confirmed operational risk.
Agents: security-reviewer.

Files: `apps/web/src/app/[locale]/admin/db-actions.ts`, backup storage under `apps/web/data/backups`.

Admin DB backups are stored as plaintext SQL under the app data directory.

Fix: document the boundary beside the backup UI/runbook or add optional operator-managed encryption at creation time.

### AGG-C12-17 - Atom attribution comments/test wording still describe stale per-entry behavior

Severity: Low. Confidence: High. Status: Confirmed.
Agents: verifier, document-specialist.

Files: `apps/web/src/lib/data.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `CLAUDE.md:171`.

Comments/tests still imply public Atom per-entry attribution behavior around `uploaded_by`, while the current privacy contract uses feed-level author only.

Fix: update comments/test descriptions to match the current privacy behavior.

### AGG-C12-18 - Resolved-path stream tests overstate TOCTOU protection

Severity: Low. Confidence: Medium. Status: Risk.
Agents: verifier.

Files: tests/comments around resolved-path stream helpers.

The tests document stronger time-of-check/time-of-use protection than the stream contract actually provides.

Fix: narrow the comments to the guaranteed containment/symlink checks or add stronger open-by-handle protections if needed.

### AGG-C12-19 - Auth server actions rely on source-contract tests instead of behavior locks

Severity: High. Confidence: High. Status: Confirmed test gap.
Agents: test-engineer.

Files: `apps/web/src/app/actions/auth.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, auth action tests.

Auth actions are outside the action-origin scanner and are mostly protected by source-contract tests rather than behavior tests for hostile origins and HTTPS cookie semantics.

Fix: add behavior-level tests for login/logout/password update origin and cookie contracts, or extend the scanner with explicit auth exemptions plus behavioral fixtures.

### AGG-C12-20 - Failed image retry recovery is mostly source-text tested

Severity: Medium. Confidence: High. Status: Likely test gap.
Agents: test-engineer.

Files: `apps/web/src/app/actions/images.ts:1163`, `apps/web/src/__tests__/failed-image-retry.test.ts`.

Retry recovery behavior is asserted primarily via source text, which can pass while runtime behavior drifts.

Fix: add behavior tests around retrying failed images, queue enqueue state, and persisted fields.

### AGG-C12-21 - Navigation visual check records screenshots but does not assert them

Severity: Medium. Confidence: High. Status: Confirmed test gap.
Agents: test-engineer.

Files: visual/navigation test artifacts under `apps/web/e2e` or related screenshot scripts.

Screenshots are collected but not compared or asserted, so the gate can pass with visible regressions.

Fix: add screenshot comparison thresholds, DOM/accessibility assertions, or retire the non-asserting capture from the gate.

### AGG-C12-22 - Production CLIP semantic-search coverage is skipped in default CI

Severity: Medium. Confidence: High. Status: Risk.
Agents: test-engineer.

Files: `apps/web/src/__tests__/clip-semantic-integration.test.ts`, `apps/web/src/__tests__/clip-offline-load.test.ts`, CI workflow files if present.

Production CLIP/offline model tests are gated out of default CI, so dependency/model-path regressions can escape.

Fix: add a lightweight CI smoke with cached/minimal model fixtures or document and schedule periodic production-mode verification.

### AGG-C12-23 - Public route rate-limit scanner ignores expensive GET handlers

Severity: Medium. Confidence: High. Status: Risk.
Agents: test-engineer.

Files: `apps/web/scripts/check-public-route-rate-limit.mjs`, `apps/web/src/app/api/og/**`, other public GET API routes.

The scanner only covers mutating public API handlers. Expensive public GET routes depend on manual review for rate limiting.

Fix: extend the scanner to a documented expensive-GET allowlist/requirement or add explicit exemptions for reviewed routes.

### AGG-C12-24 - Sitemap and robots metadata routes lack route-level regression tests

Severity: Low. Confidence: Medium. Status: Likely test gap.
Agents: test-engineer.

Files: `apps/web/src/app/sitemap.ts`, `apps/web/src/app/robots.ts`.

SEO metadata routes have important fallback and URL construction behavior but little route-level coverage.

Fix: add tests for DB-failure fallback, localized URLs, feed entries, and canonical base handling.

### AGG-C12-25 - No coverage report or threshold gate exists for the mixed test suite

Severity: Low. Confidence: High. Status: Confirmed.
Agents: test-engineer.

Files: `apps/web/package.json`, Vitest config/test scripts.

The suite has many tests but no coverage threshold or report to reveal untested critical surfaces.

Fix: add coverage reporting and initially conservative thresholds, then ratchet for critical modules.

### AGG-C12-26 - Public shared-group view recording can be forged by numeric group id

Severity: Low. Confidence: High. Status: Confirmed.
Agents: tracer.

Files: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:127`, `apps/web/src/app/actions/public.ts:413`, `apps/web/src/lib/data.ts:1323`.

The durable analytics action records shared-group views by numeric id only. A client can forge events for guessed valid group ids without knowing the share key, polluting analytics but not exposing images.

Fix: pass and verify the share key, or issue a signed one-use analytics token from the key-gated page.

### AGG-C12-27 - Sidecar color backfill warning is stale about admin retry overlap

Severity: Low. Confidence: High. Status: Confirmed docs/comment drift.
Agents: tracer.

Files: `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `CLAUDE.md`.

The sidecar warning still suggests admin retry overlap behavior that no longer matches the shared advisory-lock implementation.

Fix: update the warning/comment to the current shared-lock behavior.

### AGG-C12-28 - Restore and queue safety depend on documented single web-process topology

Severity: Medium. Confidence: Medium-High. Status: Risk.
Agents: tracer, architect, debugger.

Files: `apps/web/docker-compose.yml`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/restore-maintenance.ts`, `CLAUDE.md:227`.

Several correctness controls are process-local and documented as single-instance only, but deployment guardrails do not enforce that topology.

Fix: add runtime/deploy assertions for single web replica or move the relevant coordination state to shared storage before scale-out.

### AGG-C12-29 - Public privacy guards are alias-key based, not column-origin based

Severity: Medium. Confidence: Medium. Status: Risk.
Agents: architect.

Files: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, privacy tests.

The compile-time privacy guard protects selected object keys, but a future raw SQL alias or computed field can obscure sensitive column origin.

Fix: add source/AST tests for sensitive column references in public selectors or centralize public field construction around safe schema helpers.

### AGG-C12-30 - Browser and Lightroom upload paths duplicate ingest transaction boundaries

Severity: Medium. Confidence: High. Status: Confirmed architectural risk.
Agents: architect.

Files: `apps/web/src/app/actions/images.ts:114`, `apps/web/src/app/api/admin/lr/upload/route.ts:62`.

Browser and LR uploads duplicate topic validation, locks, disk checks, HDR/GPS handling, DB insert, queue snapshots, audit, and revalidation.

Fix: extract a shared ingest service with route/action adapters so parity is enforced in one implementation.

### AGG-C12-31 - Quarantined local storage backend still maps `original/` under public upload root

Severity: Medium. Confidence: High. Status: Risk, not live path.
Agents: architect.

Files: `apps/web/src/lib/storage/local.ts:130`, `apps/web/src/lib/upload-paths.ts:25`, `CLAUDE.md`.

The quarantined storage abstraction refuses public URLs for `original/*`, but if wired later it would still write those bytes under the public upload tree.

Fix: keep storage quarantined or change original storage to a private root before integration; add tests that `original/*` cannot resolve under public uploads.

### AGG-C12-32 - Semantic search can materialize an oversized body without `Content-Length`

Severity: Medium. Confidence: Medium. Status: Likely.
Agents: debugger.

Files: `apps/web/src/app/api/search/semantic/route.ts:147`, `apps/web/src/app/api/search/semantic/route.ts:212`.

The semantic route caps declared `Content-Length`, but when the header is absent and transfer is not chunked, the route can read a too-large body before the JSON-size guard catches it.

Fix: read with a bounded stream/parser or reject missing length for this public JSON endpoint unless transfer semantics are explicitly safe.

### AGG-C12-33 - Florence caption-generator comments say `onnxruntime-node` still needs to be added

Severity: Low. Confidence: High. Status: Confirmed docs/comment drift.
Agents: document-specialist.

Files: `apps/web/src/lib/caption-generator.ts`, `CLAUDE.md:540`, `apps/web/package.json`.

Comments say `onnxruntime-node` needs adding, while the CLIP dependency path already installs it.

Fix: update the comments to distinguish future caption work from already-present CLIP runtime dependencies.

### AGG-C12-34 - CLAUDE base-URL prose overstates `siteConfig.url` / `BASE_URL` matching

Severity: Low. Confidence: High. Status: Confirmed docs drift.
Agents: document-specialist.

Files: `CLAUDE.md:93`, `CLAUDE.md:636`, `apps/web/src/lib/constants.ts:24`, `apps/web/scripts/ensure-site-config.mjs`.

Docs imply `BASE_URL` must match `siteConfig.url`, but runtime/build behavior uses a fallback/override contract.

Fix: rewrite the prose to the actual effective-base-url behavior and any production constraints.

### AGG-C12-35 - Privacy test comment points at an obsolete `data.ts` line range

Severity: Low. Confidence: High. Status: Confirmed docs/test drift.
Agents: document-specialist.

Files: `apps/web/src/__tests__/privacy-fields.test.ts`.

The comment references a stale `data.ts` line range.

Fix: remove brittle line references or update them to semantic references.

### AGG-C12-36 - Nginx `X-Forwarded-Host` docs/config drift

Severity: Low. Confidence: Medium. Status: Risk.
Agents: document-specialist.

Files: `apps/web/nginx/default.conf`, `CLAUDE.md`.

Docs require proxies to overwrite forwarded host headers, but the shipped catch-all config does not set `X-Forwarded-Host`.

Fix: align the nginx config and docs, or document that an upstream edge is responsible for that header.

### AGG-C12-37 - Privacy page nests a second `main` landmark

Severity: Low. Confidence: High. Status: Confirmed.
Agents: designer.

Files: `apps/web/src/app/[locale]/(public)/layout.tsx`, `apps/web/src/app/[locale]/(public)/privacy/page.tsx`.

Browser evidence on `/en/privacy` showed a nested `<main>` landmark inside the public layout's main landmark, creating redundant landmarks for assistive technology.

Fix: change the privacy page wrapper to `section`/`article` or make the layout/page landmark ownership singular.

### AGG-C12-38 - Mobile info sheet likely overstates modality in peek state

Severity: Medium. Confidence: Medium. Status: Likely.
Agents: designer.

Files: `apps/web/src/components/photo-viewer.tsx`, mobile info sheet/dialog components.

The mobile photo info bottom sheet appears to expose modal/dialog semantics while in a peek/non-modal state, risking focus-trap and screen-reader mismatch.

Fix: split peek versus expanded modal semantics, with correct `aria-modal`, focus handling, and escape/back behavior.

### AGG-C12-39 - Lightroom wording implies an included publish plugin

Severity: Medium. Confidence: High. Status: Confirmed product-copy drift.
Agents: product-marketer-reviewer.

Files: `README.md`, `CLAUDE.md:152`, LR token/admin upload docs.

User-facing wording can imply GalleryKit ships a Lightroom Classic publish plugin, while the repo exposes a PAT upload endpoint and token management rather than a bundled plugin.

Fix: clarify "Lightroom-compatible upload API/token support" unless and until a plugin is shipped.

### AGG-C12-40 - Firefox display-detection and self-hosting nginx copy can mislead operators/users

Severity: Low. Confidence: Medium-High. Status: Confirmed/risk docs drift.
Agents: product-marketer-reviewer.

Files: `README.md`, `CLAUDE.md`, `apps/web/nginx/default.conf`.

Firefox display-copy should match the documented browser matrix, and self-hosting nginx guidance points at a config with production-domain assumptions.

Fix: align Firefox limitations with the browser matrix and make nginx self-hosting instructions explicit about domain/TLS/proxy assumptions.

## Prompt 1 Completion

Every requested reviewer perspective completed and wrote a per-agent review file. This aggregate dedupes their findings while preserving the per-agent files as provenance.
