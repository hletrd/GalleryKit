# Cycle 19/100 Critic Review

Date: 2026-07-08 KST
Role lane: critic
Repository: `/Users/hletrd/flash-shared/gallery`
Mode: review-only. No source fixes, commits, pushes, deploys, or unrelated file edits performed.

## Process And Inventory

Read for constraints and current intent: `AGENTS.md`, `CLAUDE.md`, `README.md`, root `package.json`, `apps/web/package.json`, `.context/plans/README.md`, current `.context/plans/*cycle*` ledgers, `.context/reviews/_aggregate.md`, prior `.context/reviews/critic.md`, root `plan/plan-377-cycle19-deferred.md`, and related done/deferred plan files.

Inventory was built before reviewing with `rg --files`, `find`, package-script inspection, and targeted line-number reads. Major reviewed surfaces:

- Public app routes: home/topic/photo/share/group/search/map/timeline/year pages, public actions, OG/feed/sitemap/robots/manifest/upload fallback routes, semantic and similar-search APIs.
- Admin workflows: dashboard, image manager, settings, categories/topics/tags, tokens/users/password, DB backup/restore actions and routes, Lightroom PAT upload.
- Core libraries: auth/session/admin-token/origin/rate-limit, data/privacy/search, schema/migrations, upload paths/serving/processing/tracker, image queue, CLIP/embeddings/model loading, restore/advisory locks, CSP/config, analytics.
- Ops/build/deploy: Dockerfile, compose, nginx, deploy helpers, CI workflow, Playwright config, migration scripts, CLIP preflight, service worker.
- Tests and gates: unit tests, source-contract tests, lint gates, e2e specs, touch-target audit, CI gate sequence.
- Docs/context: `CLAUDE.md`, README, `.context/plans/**`, `.context/reviews/**`, root `plan/**`.

Skipped by design: generated build outputs, `node_modules`, runtime uploads/resources/data, ignored local env secret contents, binary/media artifacts, and unrelated untracked review scratch directories.

## Findings Summary

- Confirmed issues or live risks: 5
- Likely issues or high-blast-radius assumptions: 5
- Manual-validation risks: 2
- Total findings: 12

Several findings are carry-forward risks already represented in `plan/plan-377-cycle19-deferred.md`. I still list them because the current code continues to embody the assumptions and this lane is explicitly tasked with whole-repo critique, not only newly introduced regressions.

## Findings

### C19-CRIT-01 - Cycle provenance is split across incompatible active ledgers

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- File/region:
  - `.context/plans/README.md:34-39` still names Run-10 Cycle 18 and an older loop-B Cycle 8 pair as active current-cycle plans.
  - `.context/plans/cycle-18-2026-07-08-plan.md:3` says commit/push/deploy finalization remains in progress.
  - `.context/plans/cycle-18-2026-07-08-plan.md:135-152` records local gates green but leaves signed commit/push and per-cycle deploy unchecked at line 140.
  - `plan/done/plan-376-cycle19-fixes.md:1-5` claims Cycle 19 is `DONE`.
  - `plan/plan-377-cycle19-deferred.md:1-7` is a live Cycle 19 deferred register outside `.context/plans`.
- Why it matters: The repo treats plan/deferred ledgers as orchestration state. Right now, the canonical `.context/plans` index, the Cycle 18 plan, and root Cycle 19 plans disagree about the active frontier and release state. That makes carry-forward age, deploy accountability, and next-cycle scheduling ambiguous.
- Failure scenario: A planner starts from `.context/plans/README.md`, reopens Cycle 18 finalization, and ignores Cycle 19 done/deferred files. Another lane starts from `plan/done/plan-376-cycle19-fixes.md` and assumes Cycle 19 is complete. The next aggregate can then age findings against the wrong cycle and either reschedule already-closed work or drop deploy-evidence gaps.
- Suggested fix: Reconcile cycle state into one canonical lineage. Move the current active Cycle 19 plan/deferred pair into `.context/plans` or explicitly mark root `plan/*cycle19*` files as historical inputs. Mark Cycle 18 terminal with final commit/push/deploy evidence or an explicit supersession. Update the active index and carry-forward register in one docs-only change.

### C19-CRIT-02 - Single-process coordination is documented but remains a warn-only topology assumption

- Severity: Medium under accidental scale-out; Low under the documented deployment
- Confidence: High
- Status: Manual-validation risk
- File/region:
  - `CLAUDE.md:245-246` documents single web-instance/single-writer topology and warns that restore maintenance, upload quotas, image queue state, backfill status, rate-limit fast paths, and view buffers are process-local.
  - `apps/web/src/lib/restore-maintenance.ts:1-60` stores restore maintenance state on `globalThis`.
  - `apps/web/src/lib/upload-tracker-state.ts:7-78` stores upload quota windows in a process-local `Map`.
  - `apps/web/src/lib/rate-limit.ts:124-133` keeps several rate-limit fast paths in memory.
  - `apps/web/src/lib/single-writer-guard.ts` is documented as a warning guard, not a startup blocker.
- Why it matters: The code is coherent for one web process, but many safety properties degrade if an operator runs two containers during blue/green deploy, clustering, or autoscaling. The current guard surfaces this, but it intentionally does not fail closed.
- Failure scenario: A second `gallerykit-web` instance starts against the same DB during a manual rollout. Upload quotas split per process, restore process flags diverge, queue in-memory failure state resets per instance, and public rate-limit fast paths become weaker. The guard logs, but traffic continues.
- Suggested fix: Add an operator-facing preflight/deploy check that fails before scale-out in the supported compose path, or move process-local coordination state to shared storage before supporting multiple web instances. At minimum, add CI/runbook tests that the deploy helper surfaces singleton-guard contention as a hard deploy warning.

### C19-CRIT-03 - Browser and Lightroom uploads still duplicate one ingest transaction contract

- Severity: High
- Confidence: High
- Status: Likely issue / carry-forward architecture risk
- File/region:
  - Browser upload: `apps/web/src/app/actions/images.ts:129-320` handles admission, auth, quota claim, config snapshot, disk/topic checks.
  - Browser post-save/insert/enqueue path: `apps/web/src/app/actions/images.ts:520-620`.
  - Lightroom upload: `apps/web/src/app/api/admin/lr/upload/route.ts:84-260` repeats admission, token usage, quota claim, multipart parsing, and validation.
  - Lightroom post-save/insert/enqueue path: `apps/web/src/app/api/admin/lr/upload/route.ts:283-620`.
  - Deferred as `AGG-C19-02` in `plan/plan-377-cycle19-deferred.md:18-23`.
- Why it matters: These two paths must preserve the same privacy, color/HDR, topic, quota, disk, restore, audit, and queue invariants. Current code has many comments and source contracts because past cycles repeatedly fixed one path after the other. Duplication is now the main defect generator.
- Failure scenario: A future upload-time column or processing setting is added to browser uploads and queue jobs, but the Lightroom route misses it. Lightroom-published images then bypass an admin-selected privacy or color processing invariant while all browser tests pass.
- Suggested fix: Extract a shared ingest service with thin adapters for Server Action and PAT multipart input. The shared unit should own config snapshot, quota claim/settle, topic verification, original save, metadata normalization, DB insert, queue payload, and cleanup semantics. Keep adapter-specific auth and request parsing outside it.

### C19-CRIT-04 - Upload quota settlement is still protected by comments and fragile control flow

- Severity: Medium
- Confidence: Medium-High
- Status: Likely issue / carry-forward maintainability risk
- File/region:
  - Browser preclaim and `settleClaim`: `apps/web/src/app/actions/images.ts:259-269`.
  - Browser per-file catch depends on `deleteOriginalUploadFile` never rejecting after the preclaim: `apps/web/src/app/actions/images.ts:563-578`.
  - Settlement arithmetic mutates the process-local tracker: `apps/web/src/lib/upload-tracker.ts:19-33`.
  - Deferred as `AGG-C19-25` in `plan/plan-377-cycle19-deferred.md:78-82`.
- Why it matters: The current browser path is intentionally shaped so the claim is made before awaits, then manually settled on each early exit. That closes the known TOCTOU, but the invariant lives in comments and local discipline. A future cleanup/helper change can reintroduce a leak without changing the tracker helper.
- Failure scenario: `deleteOriginalUploadFile` is refactored to propagate filesystem errors, or a new awaited cleanup is added after quota claim but before `settleClaim`. A failed upload then leaks count/bytes for the rest of the one-hour window, locking out the admin from further uploads even though no image landed.
- Suggested fix: Replace ad hoc settlement with an owned claim object or `try/finally` wrapper that captures the window key and reconciles exactly once from a final success counter. Make throwing cleanup impossible to bypass settlement.

### C19-CRIT-05 - Topic slug is a mutable natural key with manual fan-out across relational and JSON references

- Severity: Medium
- Confidence: High
- Status: Likely issue / data-integrity risk
- File/region:
  - `apps/web/src/db/schema.ts:10-23` makes `topics.slug` the primary key and `topic_aliases.topic_slug` a FK to it.
  - `apps/web/src/db/schema.ts:25-39` stores `images.topic` as a FK to `topics.slug` with `onDelete: 'restrict'` and no update cascade.
  - `apps/web/src/app/actions/topics.ts:287-372` implements rename by inserting a new topic, updating images, aliases, topic views, scanning every smart collection JSON rule, then deleting the old topic.
  - Deferred as `AGG-C19-24` in `plan/plan-377-cycle19-deferred.md:72-76`.
- Why it matters: Topic identity is encoded in route slugs, foreign keys, analytics rows, aliases, and smart-collection JSON. Rename correctness depends on every reference being remembered manually. The code already includes comments for previously missed siblings, which is evidence the fan-out is brittle.
- Failure scenario: A new table or JSON blob stores topic slugs. Topic rename ships without adding that reference to the transaction. The old topic row is deleted, new rows render correctly, but the new feature silently points to a nonexistent slug or loses historical association.
- Suggested fix: Move toward surrogate topic IDs with slug as mutable display/route attribute, or add database-level `ON UPDATE CASCADE` where supported and a central registry/test that enumerates every slug-bearing store. Until then, make any new topic-slug persistence update the rename fan-out and tests in the same change.

### C19-CRIT-06 - Semantic and similar search decode and score a capped vector scan per public request

- Severity: Low-Medium now; Medium if production semantic traffic grows
- Confidence: High
- Status: Confirmed performance risk
- File/region:
  - `apps/web/src/app/api/search/semantic/route.ts:263-311` reads up to `SEMANTIC_SCAN_LIMIT` embedding blobs and scores every decoded vector in process.
  - `apps/web/src/app/api/search/similar/[id]/route.ts:177-214` does the same for similar-photo recommendations.
  - `apps/web/src/lib/clip-embeddings.ts:36-48` allows `SEMANTIC_SCAN_LIMIT` up to `25_000`.
  - Deferred as `AGG-C19-28` in `plan/plan-377-cycle19-deferred.md:90-94`.
- Why it matters: The cap prevents unbounded scans, but this is still O(n) blob transfer, decode, and CPU per request on a public endpoint. Abort handling helps wasted inference, not the fundamental DB/CPU shape after admission.
- Failure scenario: Production semantic search is enabled, the gallery grows to tens of thousands of embeddings, and concurrent users expand search/similar panels. Each request pulls thousands of 2 KB blobs from MySQL and scores them in Node, raising latency and competing with normal page requests.
- Suggested fix: Introduce a vector index or cached in-memory matrix with explicit memory budget and invalidation, move scoring to a worker, or make semantic search a bounded admin-enabled feature with backpressure/concurrency separate from page serving.

### C19-CRIT-07 - Public keyword search still uses leading-wildcard scans after admission

- Severity: Medium
- Confidence: High
- Status: Confirmed performance risk
- File/region:
  - Public action admission and rate-limit path: `apps/web/src/app/actions/public.ts:247-329`.
  - Main search query matches multiple columns with `containsLike`: `apps/web/src/lib/data.ts:1637-1648`.
  - Tag and alias branches run after the first query when needed: `apps/web/src/lib/data.ts:1716-1737`.
  - Deferred as `AGG-C19-14` in `plan/plan-377-cycle19-deferred.md:48-52`.
- Why it matters: Rate limits bound request count, but each admitted search can force non-sargable scans across title, description, camera, lens, topic, labels, tags, and aliases. This creates false confidence that "rate limited" equals "cheap."
- Failure scenario: A crawler or curious public user issues varied short searches within the allowed budget. MySQL repeatedly scans and groups image/tag rows, increasing tail latency for normal browsing.
- Suggested fix: Add full-text indexes or a normalized search document table maintained on image/topic/tag changes. If broader search quality is desired, use the semantic index instead of parallel wildcard SQL scans.

### C19-CRIT-08 - Public map can still hydrate 10,000 markers and 10,000 fallback links in one request

- Severity: Low-Medium
- Confidence: Medium-High
- Status: Manual-validation risk
- File/region:
  - `apps/web/src/lib/data.ts:1766-1816` caps public map rows at `MAP_MAX_MARKERS = 10000`, returns one extra row to flag truncation.
  - `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66` builds every marker server-side.
  - `apps/web/src/app/[locale]/(public)/map/page.tsx:89-110` passes all markers to Leaflet and renders a full fallback photo list.
  - `apps/web/src/components/map/map-client.tsx:108-140` renders a Leaflet `Marker` and popup for every marker.
  - Deferred as `AGG-C19-31` in `plan/plan-377-cycle19-deferred.md:108-112`.
- Why it matters: The cap prevents infinity, but 10,000 markers plus 10,000 links is still a very large SSR/client payload and a heavy Leaflet mount. The truncation notice helps honesty, not responsiveness.
- Failure scenario: A photographer enables map visibility for location-rich archives. `/map` serializes thousands of rows and the browser constructs thousands of markers; mobile users see long main-thread stalls or tab crashes before any clustering or viewport filtering can help.
- Suggested fix: Replace all-at-once markers with clustering and a viewport/bbox API, or lower the server cap with pagination/list fallback. Treat the map as a spatial browser, not a full archive dump.

### C19-CRIT-09 - IPv6 public clients can rotate rate-limit buckets

- Severity: Low-Medium
- Confidence: High
- Status: Likely security/resource-control issue
- File/region:
  - `apps/web/src/lib/rate-limit.ts:135-153` normalizes IP literals but keeps full IPv6 addresses rather than aggregating to a prefix.
  - `apps/web/src/lib/rate-limit.ts:175-205` uses trusted proxy headers to select the client IP bucket.
  - Deferred as `AGG-C19-27` in `plan/plan-377-cycle19-deferred.md:84-88`.
- Why it matters: Per-address limits are much weaker for IPv6 users who can rotate privacy addresses within a delegated prefix. The login path also has account-based limits, but public expensive routes depend more heavily on client IP.
- Failure scenario: An attacker with a /64 range rotates source addresses and makes semantic/search/load-more/API requests below the per-address budget. The process-local and DB-backed buckets see different keys and admit more expensive work than intended.
- Suggested fix: Normalize IPv6 clients to an operator-configurable prefix, usually /64, before building rate-limit keys. If a CDN is authoritative, prefer a stable edge-provided client identity and document the trust boundary.

### C19-CRIT-10 - Desktop photo metadata, color disclosure, similar photos, and downloads are hidden by default

- Severity: Medium
- Confidence: High
- Status: Likely product/UX issue
- File/region:
  - `apps/web/src/components/photo-viewer.tsx:111-115` documents the deterministic first render for info pin state.
  - `apps/web/src/components/photo-viewer.tsx:747-756` hides the info sidebar unless `showInfo` is enabled on `lg+`.
  - `apps/web/src/components/photo-viewer.tsx:797-800` places color details, wide-gamut hint, and similar photos inside that sidebar.
  - `apps/web/src/components/photo-viewer.tsx:965-1010` places the download affordance in the same hidden sidebar footer.
  - Deferred as `AGG-C19-21` in `plan/plan-377-cycle19-deferred.md:60-64`.
- Why it matters: This product explicitly prioritizes accurate photographic intent and no editing/culling/scoring. Hiding color/metadata/download by default on desktop makes important trust and utility signals opt-in behind an icon-like toggle.
- Failure scenario: A client opens a desktop photo page, sees only the image, and never discovers the download or P3/AVIF color disclosure. They assume download is unavailable or miss color-management context.
- Suggested fix: Revisit photo-page information architecture with screenshots. Consider a persistent compact metadata/download rail, a visible download control near the primary image, or first-use/default-open behavior that does not create hydration mismatch.

### C19-CRIT-11 - Admin image management remains a wide table with horizontal scrolling on narrow screens

- Severity: Medium
- Confidence: High
- Status: Confirmed UX/operations risk
- File/region:
  - `apps/web/src/components/image-manager.tsx:427-452` renders a 9-column table inside horizontal overflow.
  - `apps/web/src/components/image-manager.tsx:474-591` puts preview, title, filename, topic, tags, gamut, date, and row actions in each table row.
  - Deferred as `AGG-C19-22` in `plan/plan-377-cycle19-deferred.md:66-70`.
- Why it matters: The controls meet target-size rules, but the workflow remains desktop-table-first. Admin photo operations are likely to happen during shoots or events where phones/tablets are realistic. Horizontal scrolling with tag editors and destructive actions increases error risk.
- Failure scenario: An admin on a phone needs to retag or delete a mistaken upload. They horizontally scroll a dense table, lose row context, and act on the wrong image or abandon the task.
- Suggested fix: Add a responsive card/list admin management surface below a breakpoint, keeping bulk selection and destructive confirmations explicit. Preserve the table for desktop density.

### C19-CRIT-12 - Several quality gates are source-shape or screenshot-smoke tests that can pass with broken behavior

- Severity: Medium
- Confidence: High
- Status: Confirmed testing risk
- File/region:
  - `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-16` explicitly uses source-text contracts for a heavy upload route.
  - `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:1-17` notes mock-based tests would miss limit removal and adds a source pin.
  - `apps/web/e2e/nav-visual-check.spec.ts:40-86` saves screenshots but does not compare them to baselines.
  - `apps/web/playwright.config.ts:72-77` runs only a Chromium project.
  - `.github/workflows/quality.yml:75-80` installs only Chromium before e2e.
  - Deferred in parts as `AGG-C19-47` and `AGG-C19-49` in `plan/plan-377-cycle19-deferred.md:156-166`.
- Why it matters: Source contracts are useful guardrails, but they can create false confidence when used as a substitute for behavior on high-risk paths. Screenshot files without comparisons are manual artifacts, not regression tests. Chromium-only e2e misses WebKit/mobile/photo rendering quirks that matter for a gallery.
- Failure scenario: A refactor preserves string snippets like `config.allowHdrIngest` and `.limit(SEMANTIC_SCAN_LIMIT)` but moves them into a dead branch. Unit gates pass. Separately, nav spacing regresses visually; screenshots are saved, but no baseline comparison fails CI.
- Suggested fix: Promote highest-risk source contracts to behavior tests with lightweight fakes where possible, especially upload route parity and semantic route query behavior. Rename screenshot-only specs to smoke tests or add visual baselines. Add at least one WebKit/mobile project for critical public photo/navigation flows.

## Refuted Or Already Closed Suspicions

- The Cycle 19 scheduled fixes for LR PAT admission order are present: the Lightroom route now performs restore/content-length/quota/parse-slot checks before `markAdminAuthTokenUsed` at `apps/web/src/app/api/admin/lr/upload/route.ts:94-160`.
- Initial listing and smart-collection `COUNT(*) OVER()` concerns appear stale in current source; `getImagesLitePage` and `getImagesForSmartCollection` now use lean count/page shapes rather than the old combined window-count shape.
- Public map privacy is intentionally opt-in by topic and has both SQL and runtime assertions in `apps/web/src/lib/data.ts:1777-1816`.
- Admin API auth, same-origin action guards, and public route rate-limit lint gates are present in package scripts and CI.
- Docker compose now passes `.env.local` to `docker compose --env-file` in the deploy path, reducing the older build/runtime env divergence risk, though deploy secret handling remains operator-bound.

## Final Sweep

Examined app routes/components, admin workflows, actions/API routes, data layer/schema, migrations/scripts/deploy, tests/lint gates, CI, docs/context, and cross-file invariants around upload, restore, search, privacy, color, and release ledgers.

No fixes were implemented. No tests were run because this lane is review-only and the requested deliverable is the critique artifact. The only write target was this file: `.context/reviews/critic.md`.
