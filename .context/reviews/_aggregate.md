# Cycle 29 Aggregate Review

Date: 2026-06-30  
HEAD reviewed: `b4fa1f64`  
Cycle: 29/100  
Scope: Prompt 1 review aggregation only.

## Agent Coverage

Completed review artifacts:

- `code-reviewer.md`: no confirmed code-quality issues; residual runtime validation risks.
- `perf-reviewer.md`: 9 performance/scalability findings.
- `security-reviewer.md`: no confirmed security vulnerabilities; 3 operational validation risks.
- `test-engineer.md`: 7 test/gate coverage findings.
- `architect.md`: 4 architecture/operational findings.
- `designer.md`: 4 UI/UX findings with browser evidence.
- `critic.md`: 6 confirmed process/product/performance issues plus risks.
- `verifier.md`: 4 confirmed issues, 1 likely issue, and validation risks.
- `tracer.md`: 1 likely issue and 3 validation risks.
- `debugger.md`: 1 confirmed bug and 2 validation risks.
- `document-specialist.md`: 4 confirmed documentation drift issues and 1 likely doc issue.
- `ui-ux-designer-reviewer.md`: 4 confirmed UI/UX issues and 2 validation risks.
- `product-marketer-reviewer.md`: 3 confirmed trust/product-copy issues, 1 likely issue, and 2 validation risks.

No review subagent failed after retry. The custom reviewer prompt files referenced another product, so the agents were explicitly instructed to adapt only the reviewer lens to GalleryKit.

## Merged Findings

### AGG-C29-01 - Rate-limit bucket retention deletes by an unindexed time column

Severity: Medium  
Confidence: High  
Cross-agent agreement: perf-reviewer, architect, verifier, critic  
Status: Confirmed issue

Evidence: `apps/web/src/db/schema.ts:212-219` defines only primary key `(ip, bucket_type, bucket_start)`, while `apps/web/src/lib/rate-limit.ts:515-517` deletes by `bucket_start < cutoff`. Migrations/reconcile mirror the missing index.

Failure scenario: bot/search/view traffic creates many rows, and the hourly purge scans/locks the rate-limit table on the single MySQL writer.

Fix: add a `bucket_start`-leading index in schema, migration, and reconcile, and make purge deletion chunked/bounded.

### AGG-C29-02 - Semantic and similar search perform request-thread brute-force vector scoring

Severity: Medium  
Confidence: High  
Cross-agent agreement: perf-reviewer, architect, critic  
Status: Confirmed scalability issue

Evidence: `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`, and `apps/web/src/lib/clip-embeddings.ts:36-44`.

Failure scenario: raising `SEMANTIC_SCAN_LIMIT` or concurrent requests can monopolize the Node event loop while decoding/scoring thousands of vectors.

Fix: bound request-thread work with smaller caps/concurrency/yielding or move scoring to workers/vector index. This is larger than a narrow cycle fix and should be deferred unless capacity validation demands it now.

### AGG-C29-03 - Public map can render 10,000 markers and 10,000 fallback links

Severity: Medium  
Confidence: High  
Cross-agent agreement: perf-reviewer, critic, designer, ui-ux-designer-reviewer  
Status: Confirmed UI/performance issue

Evidence: `apps/web/src/lib/data.ts:1649-1685`, `apps/web/src/app/[locale]/(public)/map/page.tsx:37-56`, `:83-95`, and `apps/web/src/components/map/map-client.tsx:76-93`, `:118-140`.

Failure scenario: GPS-rich galleries freeze mobile browsers and overwhelm assistive-tech users on `/map`.

Fix: reduce initial cap and add clustering/viewport loading plus paginated/virtualized fallback list. A full clustered implementation is a larger feature; a cap/truncation notice is a reasonable near-term fix.

### AGG-C29-04 - Public search uses leading-wildcard LIKE scans

Severity: Medium  
Confidence: High  
Cross-agent agreement: perf-reviewer  
Status: Confirmed scalability issue

Evidence: `apps/web/src/lib/data.ts:1545-1621` and `apps/web/src/app/actions/public.ts:236-306`.

Failure scenario: short/common public searches scan processed images, tags, and aliases under concurrent traffic.

Fix: introduce a search index or stricter query constraints. Defer unless it becomes a measured production bottleneck.

### AGG-C29-05 - Timeline/year/On This Day use non-sargable date functions

Severity: Medium  
Confidence: High  
Cross-agent agreement: perf-reviewer  
Status: Likely scalability issue

Evidence: `apps/web/src/lib/data-timeline.ts:97-116`, `:129-141`, `:186-207`.

Failure scenario: archive pages scan processed rows row-by-row as gallery size grows.

Fix: convert year/month predicates to ranges and use generated/indexed month/day columns for On This Day. Defer schema work unless paired with broader archive performance work.

### AGG-C29-06 - Feed and sitemap freshness ordering lacks a supporting index

Severity: Low  
Confidence: High  
Cross-agent agreement: perf-reviewer  
Status: Likely scalability issue

Evidence: `apps/web/src/lib/data.ts:828-853`, `:1635-1646`; schema lacks `(processed, updated_at, created_at, id)`.

Failure scenario: crawlers/feed readers trigger expensive sorts over processed rows.

Fix: add freshness index if feed/sitemap latency appears in production.

### AGG-C29-07 - First-page gallery and smart collections compute exact totals with `COUNT(*) OVER()`

Severity: Medium  
Confidence: High  
Cross-agent agreement: perf-reviewer  
Status: Likely scalability issue

Evidence: `apps/web/src/lib/data.ts:878-907`, `:1325-1364`.

Failure scenario: first public page loads pay all-row grouped count cost even when pagination only needs `limit + 1`.

Fix: remove exact hot-path counts or cache/materialize them. Defer unless measured.

### AGG-C29-08 - Upload/bulk tag resolution is serial and chatty

Severity: Low  
Confidence: High  
Cross-agent agreement: perf-reviewer  
Status: Confirmed performance issue

Evidence: `apps/web/src/app/actions/images.ts:301-329`, `:1132-1156`, and `apps/web/src/lib/tag-records.ts:29-68`.

Failure scenario: admin batch uploads or bulk tag edits spend many serialized DB round trips.

Fix: batch tag lookup/insert/reselect. Defer as a low-severity admin-path optimization.

### AGG-C29-09 - Service worker waits on per-image HEAD probes before serving cached derivatives

Severity: Low  
Confidence: Medium  
Cross-agent agreement: perf-reviewer  
Status: Manual-validation risk

Evidence: `apps/web/public/sw.template.js:34-38`, `:184-287`.

Failure scenario: warm cached gallery paints are delayed by synchronous HEAD probes on lossy networks.

Fix: validate with throttled traces; if confirmed, serve cached bytes immediately and revalidate in background.

### AGG-C29-10 - Map GPS privacy test reimplements logic instead of testing `getMapImages()`

Severity: Medium  
Confidence: High  
Cross-agent agreement: test-engineer, verifier  
Status: Confirmed test-quality gap

Evidence: production code at `apps/web/src/lib/data.ts:1660-1697`; copied test logic at `apps/web/src/__tests__/map-privacy.test.ts:80-130`.

Failure scenario: the production query drops `topics.map_visible=true` or GPS predicates while tests still pass.

Fix: add a behavior/source test that exercises `getMapImages()` or locks the query chain/guard directly.

### AGG-C29-11 - Semantic stub ranking lacks formula-distinguishing behavior coverage

Severity: Medium  
Confidence: High  
Cross-agent agreement: test-engineer, verifier  
Status: Confirmed test gap

Evidence: `apps/web/src/app/api/search/semantic/route.ts:296-302`; current tests use vectors where dot product and cosine agree.

Failure scenario: route switches to unconditional dot product and stub rankings become magnitude-biased without behavior-test failure.

Fix: add a non-normalized vector behavior test where cosine and dot product produce different order.

### AGG-C29-12 - Real CLIP activation tests are skipped by default CI

Severity: Medium  
Confidence: High  
Cross-agent agreement: test-engineer, verifier  
Status: Confirmed coverage gap

Evidence: `apps/web/src/__tests__/clip-offline-load.test.ts`, `clip-semantic-integration.test.ts`, and `.github/workflows/quality.yml`.

Failure scenario: production model loading breaks but normal PR CI stays green.

Fix: add scheduled/manual CI with seeded models, or record as a release-blocking manual gate.

### AGG-C29-13 - Public GET rate-limit enforcement is outside the custom gate

Severity: Medium  
Confidence: High  
Cross-agent agreement: test-engineer, verifier, critic  
Status: Confirmed gate blind spot

Evidence: `apps/web/scripts/check-public-route-rate-limit.ts:1-12`, `:36`, `:344-346`.

Failure scenario: a future expensive public GET route ships without a limiter because the gate only scans mutating methods.

Fix: extend the gate to audit expensive public GET route markers or require explicit exemptions.

### AGG-C29-14 - E2E browser matrix is desktop Chromium only

Severity: Medium  
Confidence: High  
Cross-agent agreement: test-engineer, verifier  
Status: Manual-validation/coverage risk

Evidence: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:72-77`.

Failure scenario: Safari/WebKit-specific P3/HDR/focus/service-worker behavior regresses without CI coverage.

Fix: add small WebKit smoke project or defer as infrastructure/browser-matrix work.

### AGG-C29-15 - Important public pages have no browser smoke path

Severity: Low  
Confidence: High  
Cross-agent agreement: test-engineer, verifier  
Status: Confirmed E2E coverage gap

Evidence: no E2E coverage for `/map`, `/timeline`, `/year`, or `/c`; routes exist under `apps/web/src/app/[locale]/(public)/`.

Failure scenario: route hydration or translation failure ships unnoticed.

Fix: add cheap route-smoke specs with seeded fixtures.

### AGG-C29-16 - Nav visual E2E writes screenshots without asserting baselines

Severity: Low  
Confidence: High  
Cross-agent agreement: test-engineer, verifier  
Status: Confirmed test-quality gap

Evidence: `apps/web/e2e/nav-visual-check.spec.ts:51`, `:65`, `:78`.

Failure scenario: visual regressions create new screenshots but tests still pass.

Fix: add `toHaveScreenshot` baselines or document/rename as artifact-only geometry smoke.

### AGG-C29-17 - Public DB-backed `generateMetadata()` bypasses restore-maintenance guards

Severity: Low  
Confidence: Medium  
Cross-agent agreement: architect, verifier, tracer  
Status: Likely issue

Evidence: body guards in public routes, but metadata functions call `getSeoSettings()`, `getImageCached()`, `getTopicBySlugCached()`, etc. before maintenance fallback.

Failure scenario: restore drops/imports DB tables; public bodies would render maintenance, but metadata reads can throw or emit wrong metadata.

Fix: add a shared metadata guard returning static noindex maintenance metadata before DB reads.

### AGG-C29-18 - Proxy/header trust needs production validation

Severity: Medium if misconfigured  
Confidence: Medium  
Cross-agent agreement: architect, security-reviewer, tracer, product-marketer-reviewer  
Status: Manual-validation risk

Evidence: `TRUST_PROXY=true` in compose, `request-origin.ts`, `rate-limit.ts`, and nginx forwarding headers.

Failure scenario: direct Next access or wrong forwarded-header chain causes false same-origin checks or collapsed rate-limit buckets.

Fix: validate deployed topology and document header chain; optionally add runtime/admin warning.

### AGG-C29-19 - `.context/plans/` is documented as committed history but ignored

Severity: Medium  
Confidence: High  
Cross-agent agreement: critic  
Status: Confirmed process issue

Evidence: `AGENTS.md` says plans are committed history; `.gitignore:19-21` ignores `.context/plans/**`.

Failure scenario: this or future cycles write plans that are not staged/committed by default.

Fix: unignore `.context/plans/` and `.context/plans/**`.

### AGG-C29-20 - Runtime/transient artifacts remain tracked despite ignore policy

Severity: Low  
Confidence: High  
Cross-agent agreement: critic  
Status: Confirmed repo-hygiene issue

Evidence: tracked `.omc` files and review `.log`/`.pid` artifacts despite ignore rules.

Failure scenario: stale logs/PIDs confuse later agents or leak environment detail.

Fix: decide archival policy and remove cached transient artifacts. This is potentially broad and should be deferred unless scoped carefully.

### AGG-C29-21 - App README upload flow still leads operators to upload before GPS decision

Severity: Medium  
Confidence: High  
Cross-agent agreement: critic  
Status: Confirmed documentation/privacy issue

Evidence: `apps/web/README.md:7-24`, `gallery-config-shared.ts` default `strip_gps_on_upload=false`, settings lock once photos exist.

Failure scenario: operator uploads a geotagged first photo before reviewing GPS stripping, then the setting is locked.

Fix: update app README to review Settings before first upload.

### AGG-C29-22 - Current photographer baseline in `CLAUDE.md` is stale

Severity: Medium  
Confidence: High  
Cross-agent agreement: document-specialist  
Status: Confirmed doc drift

Evidence: `CLAUDE.md:559-567` points to photographer-r4 while later r6-r8/run-9 artifacts exist.

Failure scenario: future agents use stale r4 as current baseline and duplicate or miss work.

Fix: update the audit-history section to name current/latest baselines.

### AGG-C29-23 - Auto alt-text feature/runbook is undocumented

Severity: Medium  
Confidence: High  
Cross-agent agreement: document-specialist  
Status: Confirmed doc drift

Evidence: `auto_alt_text_enabled`, `caption-generator.ts`, queue/backfill script exist; README/CLAUDE/app README omit contract.

Failure scenario: operator expects real AI captioning or automatic backfill; old rows remain null.

Fix: document default-off EXIF-stub behavior, public fallback chain, bulk apply, and `backfill-alt-text.ts`.

### AGG-C29-24 - Public route freshness docs omit current dynamic surfaces

Severity: Low  
Confidence: High  
Cross-agent agreement: document-specialist  
Status: Confirmed doc drift

Evidence: `CLAUDE.md` mentions photo/topic/shared/home but source also sets `revalidate=0` for smart collections, timeline, year, and map.

Failure scenario: future performance work reintroduces ISR on dynamic archive/map pages.

Fix: update docs with full category rule.

### AGG-C29-25 - Touch-target docs omit app-level scanned files

Severity: Low  
Confidence: High  
Cross-agent agreement: document-specialist  
Status: Confirmed doc drift

Evidence: `CLAUDE.md` documents `SCAN_ROOTS`; `touch-target-audit.test.ts` also has `appLevelExtraFiles`.

Failure scenario: maintainers are surprised by root-level error/layout/loading audit failures.

Fix: update docs.

### AGG-C29-26 - Historical migration comments use superseded product language

Severity: Low  
Confidence: Medium  
Cross-agent agreement: document-specialist  
Status: Likely doc issue

Evidence: old migration comments mention Lightroom plugin and Florence-2.

Failure scenario: grep-based readers infer unsupported current features.

Fix: add errata in docs rather than editing old migrations casually.

### AGG-C29-27 - Semantic embedding sidecar bypasses runtime mode resolver

Severity: Low  
Confidence: High  
Cross-agent agreement: tracer  
Status: Likely issue

Evidence: runtime uses `getGalleryConfig()`; `apps/web/scripts/backfill-clip-embeddings.ts:87-124` reads raw DB mode.

Failure scenario: DB says production but env opt-in is absent; runtime disables search while sidecar writes misleading stub embeddings.

Fix: use shared runtime resolver semantics or require resolved target mode unless `--force`.

### AGG-C29-28 - Color sidecar lacks per-image processing claims

Severity: Low  
Confidence: Medium  
Cross-agent agreement: tracer  
Status: Manual-validation risk

Evidence: queue and in-app backfill use per-image locks; `scripts/backfill-color-pipeline.ts` only takes the global lock.

Failure scenario: future flow overlaps sidecar with per-image processing and derivative bytes/DB state diverge.

Fix: mirror per-image claim or test the non-overlap invariant.

### AGG-C29-29 - Deploy success uses liveness, not DB-backed readiness

Severity: Low  
Confidence: High  
Cross-agent agreement: tracer  
Status: Manual-validation risk

Evidence: `apps/web/deploy.sh` accepts `/api/live`; `/api/health` has optional DB readiness.

Failure scenario: deploy reports success after Next starts while DB is unavailable or restore maintenance active.

Fix: split deploy readiness from Docker liveness.

### AGG-C29-30 - `SimilarPhotos` permanently caches transient fetch failures

Severity: Low  
Confidence: High  
Cross-agent agreement: debugger  
Status: Confirmed bug

Evidence: `apps/web/src/components/similar-photos.tsx:78-108`, `:137-147`.

Failure scenario: first open hits 429/503/network error; closing/reopening cannot retry until remount.

Fix: clear `fetchedRef` on retryable errors or add an explicit retry control.

### AGG-C29-31 - Lightroom upload materializes multipart body before exact file-size rejection

Severity: Medium if route is exposed to untrusted PAT clients  
Confidence: Medium  
Cross-agent agreement: debugger  
Status: Manual-validation risk

Evidence: `apps/web/src/app/api/admin/lr/upload/route.ts:85-112`, `:153-172`.

Failure scenario: authenticated oversized multipart bodies are buffered before exact file-size 413.

Fix: validate Next buffering/proxy caps; consider streaming parser or tighter cap.

### AGG-C29-32 - Unwired CLIP backfill action reports per-row failures as successful skips

Severity: Low while unwired  
Confidence: Medium  
Cross-agent agreement: debugger  
Status: Manual-validation risk

Evidence: `apps/web/src/app/actions/embeddings.ts:53-55`, `:145-188`; no production call sites found.

Failure scenario: future UI wires it and operators see successful backfill despite failures.

Fix: remove dead action or return explicit failure semantics before wiring.

### AGG-C29-33 - Theme control hydrates with different label/icon than server render

Severity: Medium  
Confidence: High  
Cross-agent agreement: designer, ui-ux-designer-reviewer  
Status: Confirmed UI/a11y issue

Evidence: `apps/web/src/components/nav-client.tsx:35-45`, `:160-176`; browser evidence shows dark theme storage causing hydration mismatch.

Failure scenario: returning dark/OLED visitors get wrong initial accessible name/icon and React regenerates subtree.

Fix: render stable placeholder until mounted/client theme resolved.

### AGG-C29-34 - Public GPS map publishing is a one-click switch

Severity: Medium  
Confidence: High  
Cross-agent agreement: designer, ui-ux-designer-reviewer  
Status: Confirmed privacy-affordance issue

Evidence: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:64-78`, `:259-265`; `getMapImages()` exposes GPS for `topics.map_visible=true`.

Failure scenario: accidental toggle publishes all GPS-bearing photos in a category.

Fix: require confirmation on false-to-true transition, ideally with affected count.

### AGG-C29-35 - DB-backed public failures collapse to generic route error shell

Severity: Medium  
Confidence: High  
Cross-agent agreement: designer, ui-ux-designer-reviewer  
Status: Confirmed UX issue

Evidence: `apps/web/src/app/[locale]/error.tsx:22-57` and runtime DB-down browser evidence.

Failure scenario: transient DB failure looks like a generic broken page instead of gallery-specific unavailable/maintenance state.

Fix: add product-specific data-unavailable fallback or handle expected DB errors in public routes.

### AGG-C29-36 - Admin E2E selectors are stale after main-content rename

Severity: Low  
Confidence: High  
Cross-agent agreement: ui-ux-designer-reviewer  
Status: Confirmed validation risk

Evidence: `apps/web/src/app/[locale]/admin/layout.tsx:19-27` uses `#main-content`; `apps/web/e2e/helpers.ts:195` and `admin.spec.ts` still use `#admin-content`.

Failure scenario: opt-in admin E2E fails before exercising admin flows.

Fix: update selectors to `#main-content` or roles.

### AGG-C29-37 - GPS privacy positioning conflicts with default-off stripping

Severity: Medium  
Confidence: High  
Cross-agent agreement: product-marketer-reviewer, critic  
Status: Confirmed trust/product issue

Evidence: README emphasizes private originals; default `strip_gps_on_upload=false`; toggle locks after images exist.

Failure scenario: photographer expects private-original safety but first upload retains GPS.

Fix: make first-run GPS decision harder to miss, or default stripping on. At minimum update docs/copy.

### AGG-C29-38 - Public privacy copy omits short-lived full-IP rate-limit storage

Severity: Medium  
Confidence: High  
Cross-agent agreement: product-marketer-reviewer  
Status: Confirmed privacy-copy issue

Evidence: privacy copy in `apps/web/messages/en.json`; DB-backed `rate_limit_buckets.ip`; public actions call rate limiters.

Failure scenario: privacy-conscious visitor believes no full IP is stored, while rate-limit buckets persist IPs temporarily.

Fix: update privacy copy in English and Korean to distinguish analytics from short-lived abuse-prevention records.

### AGG-C29-39 - Share links can be created in UI but not listed/revoked in UI

Severity: Medium  
Confidence: High  
Cross-agent agreement: product-marketer-reviewer  
Status: Confirmed product gap

Evidence: create actions are used by UI; revoke/delete actions exist but no production UI call sites.

Failure scenario: admin cannot revoke leaked share URLs from the app.

Fix: add admin share-management UI. Defer if too large for this cycle, but record explicitly.

### AGG-C29-40 - App-level backups can be misunderstood as complete file backups

Severity: Low-Medium  
Confidence: Medium  
Cross-agent agreement: product-marketer-reviewer  
Status: Likely documentation issue

Evidence: README private-original/backups wording; DB page copy says DB only.

Failure scenario: operator keeps SQL dump but loses original/derivative/resource files.

Fix: add backup completeness note to Getting Started/Docker docs.

### AGG-C29-41 - Semantic-search/demo claims depend on deployed operator state

Severity: Low-Medium  
Confidence: High  
Cross-agent agreement: product-marketer-reviewer, verifier/test-engineer related CLIP coverage  
Status: Manual-validation risk

Evidence: README says semantic search; runtime depends on DB row, env opt-in, weights, embeddings.

Failure scenario: live demo claims semantic search but deployed host is disabled/stub/no embeddings.

Fix: validate host state before public claims and consider operator status readout.

### AGG-C29-42 - Production sitemap and Playwright browser-flow validation remain runtime gaps

Severity: Low  
Confidence: Medium  
Cross-agent agreement: code-reviewer  
Status: Manual-validation risk

Evidence: `sitemap.ts` intentionally falls back when local DB unavailable; Playwright was not fully run by code-reviewer.

Failure scenario: production sitemap remains fallback-only or browser flows fail outside unit/build gates.

Fix: post-deploy sitemap smoke and configured Playwright run when browser-flow evidence is required.

## Aggregate Counts

New findings produced this cycle: 42.

High-signal cross-agent implementation candidates:

1. `AGG-C29-01` rate-limit retention index/chunking.
2. `AGG-C29-10` map privacy behavior coverage.
3. `AGG-C29-11` semantic stub-ranking behavior coverage.
4. `AGG-C29-13` public expensive GET rate-limit gate.
5. `AGG-C29-17` restore-maintenance metadata guard.
6. `AGG-C29-19` unignore `.context/plans`.
7. `AGG-C29-21` app README first-upload GPS guidance.
8. `AGG-C29-23` auto-alt-text docs.
9. `AGG-C29-27` CLIP sidecar mode resolver.
10. `AGG-C29-30` SimilarPhotos retry.
11. `AGG-C29-33` theme hydration guard.
12. `AGG-C29-34` GPS map publishing confirmation.
13. `AGG-C29-36` stale admin E2E selectors.
14. `AGG-C29-38` privacy copy for short-lived IP rate-limit buckets.

Items requiring deferral/manual validation must be recorded in Prompt 2 with original severity/confidence preserved.
