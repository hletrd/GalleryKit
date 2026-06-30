# Cycle 25 Aggregate Review

Date: 2026-06-30 KST
Reviewed HEAD: `4cb1258b` on `master`
Repo: `/Users/hletrd/flash-shared/gallery`

## Agent Coverage

Completed review files:

- `.context/reviews/code-reviewer.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/verifier.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`
- `.context/reviews/debugger.md`
- `.context/reviews/architect.md`
- `.context/reviews/document-specialist.md`
- `.context/reviews/designer.md`
- `.context/reviews/product-marketer-reviewer.md`
- `.context/reviews/ui-ux-designer-reviewer.md`

The repo contains a Next.js web UI, so UI/UX review was included. Both UI reviewers attempted runtime review with `agent-browser`; local MySQL was unavailable (`ECONNREFUSED 127.0.0.1:3306`), so DB-backed pages were partially reviewed through static/code evidence.

## Agent Constraints

- Native subagent concurrency was capped by the environment, so the fan-out ran in waves instead of one physical all-at-once batch. No registered reviewer was silently dropped.
- Named specialized agents were not directly available as first-class native roles after tool discovery; generic/default agents were spawned with explicit reviewer personas and wrote the required per-agent files.
- Previously completed agents became non-addressable after context compaction, but their report files were present and included.

## Deduplicated Findings

### AGG25-01 - Public first-page listing queries compute exact grouped totals

Severity: Medium
Confidence: High
Agents: perf-reviewer, architect
Primary citations: `apps/web/src/lib/data.ts:878-907`, `apps/web/src/lib/data.ts:1417-1467`, `apps/web/src/app/[locale]/(public)/page.tsx:149-168`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:78-101`

First-page public gallery/topic/smart-collection routes couple the UI to exact totals via grouped `COUNT(*) OVER()` queries. Large galleries or broad smart-collection predicates can raise TTFB and DB CPU on unauthenticated hot paths. Fix by using `limit + 1`/cursor-first rendering and moving exact counts to cached/admin/async paths.

### AGG25-02 - Image queue concurrency can exhaust the shared DB pool

Severity: Medium
Confidence: High
Agents: perf-reviewer
Primary citations: `apps/web/src/lib/image-queue.ts:87-107`, `apps/web/src/lib/image-queue.ts:463-479`, `apps/web/src/lib/image-queue.ts:571-574`, `apps/web/src/db/index.ts:23-33`

The queue cap reserves only long-held advisory-lock connections, but each worker can also need transient DB connections while holding its claim. Default 5 workers can consume the 10-connection pool. Fix by budgeting roughly two connections per worker and updating tests.

### AGG25-03 - GPS stripping buffers full originals after streaming upload

Severity: Medium
Confidence: High
Agents: perf-reviewer
Primary citations: `apps/web/src/lib/process-image.ts:1737-1764`, `apps/web/src/lib/gps-exif-strip.ts:224`, `apps/web/src/app/actions/images.ts:388-401`, `apps/web/src/app/api/admin/lr/upload/route.ts:367-385`

Large originals are streamed to disk, then GPS stripping reads the whole file back into memory and may copy buffers. This can create large heap/native pressure. Fix with bounded streaming/segment stripping or an explicit lower GPS-strip buffer cap.

### AGG25-04 - Upload-processing contract lock spans slow file and CPU work

Severity: Low-Medium
Confidence: High
Agents: perf-reviewer
Primary citations: `apps/web/src/lib/upload-processing-contract-lock.ts:9-56`, `apps/web/src/app/actions/images.ts:175-630`, `apps/web/src/app/api/admin/lr/upload/route.ts:252-552`

The lock serializes and pins a DB connection across file I/O, metadata decode, and GPS scrub. Large uploads can block other uploads/settings changes. Fix by shrinking the lock to the true settings/quota/first-write boundary or moving full-span locking to a dedicated connection with documented contention.

### AGG25-05 - Infinite masonry keeps all loaded photos mounted

Severity: Medium
Confidence: High
Agents: perf-reviewer
Primary citations: `apps/web/src/components/home-client.tsx:124-411`, `apps/web/src/components/load-more.tsx:41-132`

Infinite scroll appends and renders every loaded card with no virtualization or page cap. Deep mobile scroll can grow DOM/memory and degrade interactions. Fix by virtualizing/windowing or switching auto-load to explicit pagination after a cap.

### AGG25-06 - Public map serializes and mounts up to 10,000 markers and list rows

Severity: Medium
Confidence: High
Agents: perf-reviewer
Primary citations: `apps/web/src/lib/data.ts:1649-1685`, `apps/web/src/app/[locale]/(public)/map/page.tsx:31-89`, `apps/web/src/components/map/map-client.tsx:86-140`

The `/map` route can ship and hydrate 10k markers plus list items. This can freeze mobile/main-thread interaction. Fix with viewport-bounded fetches, clustering/canvas rendering, and list virtualization/pagination.

### AGG25-07 - CSV export buffers multiple large copies

Severity: Medium
Confidence: High
Agents: perf-reviewer
Primary citations: `apps/web/src/app/[locale]/admin/db-actions.ts:79-159`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:103-124`

CSV export loads rows, builds a line array, joins one string, transports it through a server action, and creates a browser Blob. Large galleries can cause memory spikes. Fix with an authenticated streaming route or background export file.

### AGG25-08 - Timeline/archive predicates are non-sargable

Severity: Low-Medium
Confidence: High
Agents: perf-reviewer
Primary citations: `apps/web/src/lib/data-timeline.ts:97-207`, `apps/web/src/db/schema.ts:116-120`

`YEAR()`, `MONTH()`, and `DAY()` wrappers prevent normal use of capture-date indexes on dynamic public pages. Fix year/month filters with range predicates and add generated date-part columns or rollups for On This Day/distinct years.

### AGG25-09 - Public nav topic helper computes sitemap-only timestamps

Severity: Low
Confidence: Medium
Agents: perf-reviewer
Primary citations: `apps/web/src/lib/data.ts:509-529`, `apps/web/src/components/nav.tsx:8-20`, `apps/web/src/app/sitemap.ts:40-72`

Navigation pays for per-topic `MAX(images.updated_at)` values used only by the sitemap. Fix by splitting nav and sitemap topic helpers.

### AGG25-10 - Service worker blocks cached images on per-tile HEAD probes

Severity: Low-Medium
Confidence: Medium
Agents: perf-reviewer
Primary citations: `apps/web/public/sw.template.js:250-280`, `apps/web/public/sw.js:250-280`

Cached image display can wait on one synchronous HEAD probe per tile. Warm masonry loads on slow networks can show unnecessary blank time. Fix by serving stale immediately and revalidating in the background, or using a shared freshness token.

### AGG25-11 - Analytics page fans out aggregate scans

Severity: Low-Medium
Confidence: Medium
Agents: perf-reviewer
Primary citations: `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-36`, `apps/web/src/lib/analytics-data.ts:28-207`

The analytics page dispatches multiple grouped aggregate queries concurrently on the shared pool. Validate with production `EXPLAIN ANALYZE`; fix with TTL caching, rollups, or a small concurrency limiter.

### AGG25-12 - Auth paths log raw exception messages

Severity: Low
Confidence: Medium
Agents: security-reviewer
Primary citations: `apps/web/src/app/actions/auth.ts:246-248`, `apps/web/src/app/actions/auth.ts:430-439`

Login/password-change catch blocks can emit raw driver/framework messages into logs. Fix by logging structured event codes or sanitized messages.

### AGG25-13 - Container startup and runtime lack hardening; broad chown can delay recovery

Severity: Low-Medium
Confidence: High
Agents: security-reviewer, critic
Primary citations: `apps/web/docker-compose.yml:12-28`, `apps/web/scripts/entrypoint.sh:4-25`, `apps/web/Dockerfile:147-157`

Startup recursively `chown -R`s bind mounts and `.next` on owner mismatch, and compose lacks defense-in-depth controls such as `cap_drop`, `no-new-privileges`, and limits. Fix by narrowing ownership repair to specific writable directories/checks and adding compose hardening where compatible.

### AGG25-14 - Bundled nginx config depends on external TLS termination

Severity: Medium if misdeployed
Confidence: Medium
Agents: security-reviewer
Primary citations: `apps/web/nginx/default.conf:21-30`, `apps/web/nginx/default.conf:49-55`, `apps/web/nginx/default.conf:187-202`

The committed nginx config is an internal HTTP hop. If exposed directly, first-time login/session traffic can be cleartext. Fix with a public-edge TLS example or explicit deployment assertion/docs.

### AGG25-15 - Per-IP rate limiting depends on proxy topology

Severity: Low
Confidence: High
Agents: security-reviewer
Primary citations: `apps/web/src/lib/rate-limit.ts:164-195`, `apps/web/.env.local.example:54-67`, `apps/web/nginx/default.conf:67-71`

`TRUST_PROXY` misconfiguration can collapse all clients to `unknown` or allow spoofed forwarding headers. Fix with startup/health warnings and clearer private-proxy requirements.

### AGG25-16 - All admins are root admins

Severity: Low
Confidence: High
Agents: security-reviewer
Primary citations: `CLAUDE.md:5`, `CLAUDE.md:236`, `apps/web/src/app/[locale]/admin/db-actions.ts:162-172`, `apps/web/src/app/actions/admin-users.ts:77-84`

The personal-gallery model intentionally treats all admins as equally trusted. If multiple operators are introduced, backup/restore/token/settings/admin-user operations need roles/capabilities.

### AGG25-17 - SQL backups are plaintext at rest

Severity: Low
Confidence: High
Agents: security-reviewer
Primary citations: `CLAUDE.md:216-218`, `apps/web/src/app/[locale]/admin/db-actions.ts:181-190`, `apps/web/src/app/api/admin/db/download/route.ts:21-89`

Backups are permissioned but plaintext. Host compromise or accidental copy exposes DB contents. Fix with optional operator-managed encryption or stronger docs/retention warnings.

### AGG25-18 - Build inputs are mutable without provenance gate

Severity: Low
Confidence: High
Agents: security-reviewer, architect
Primary citations: `apps/web/Dockerfile:1-21`, `apps/web/Dockerfile:49-67`

Floating base images and explicit native optional installs can drift outside review. Add deploy digest logging/SBOM/image scan and a lockfile parity check for native pins.

### AGG25-19 - Public analytics writes lack durable/global rate limiting

Severity: Medium
Confidence: High
Agents: critic
Primary citations: `apps/web/src/app/actions/public.ts:329-455`, `apps/web/src/db/schema.ts:212-219`, `apps/web/src/lib/view-retention.ts:5-14`

Photo/topic/shared view recorders use only a process-local limiter before durable DB inserts. Restarts or scale-out reset/multiply the budget. Fix with DB-backed buckets and tests.

### AGG25-20 - Semantic search rate-limit durability is overstated

Severity: Low-Medium
Confidence: High
Agents: critic
Primary citations: `apps/web/README.md:61-69`, `apps/web/src/app/api/search/semantic/route.ts:6-8`, `apps/web/src/lib/rate-limit.ts:350-372`, `CLAUDE.md:234-235`

Docs imply semantic search has the same posture as other public routes, but the semantic limiter is process-local. Fix docs or move semantic/similar protections to DB-backed buckets.

### AGG25-21 - Semantic-search live-production claims are not repo-verifiable

Severity: Medium
Confidence: High
Agents: verifier
Primary citations: `AGENTS.md:49`, `CLAUDE.md:159`, `README.md:42`, `apps/web/README.md:73-80`, `apps/web/src/lib/gallery-config.ts:123-141`

Docs state semantic search is live with production embeddings, but repo config only proves code paths and operator gates. Fix by rephrasing as dated ops notes or adding `verify:semantic-production`.

### AGG25-22 - Settings update race protections lack action-level behavior tests

Severity: High
Confidence: High
Agents: test-engineer
Primary citations: `apps/web/src/app/actions/settings.ts:68-166`, `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:10-22`

Helper/source tests exist, but `updateGallerySettings` ordering and lock release behavior are not action-tested. Add mocked action-level tests for lock denial, historical-image rejections, success, and error cleanup.

### AGG25-23 - Lightroom upload route lacks behavior-level side-effect tests

Severity: High
Confidence: High
Agents: test-engineer
Primary citations: `apps/web/src/app/api/admin/lr/upload/route.ts:78-547`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-450`

Critical route side effects are largely source-contract tested. Add a route harness covering happy path and failure branches with tracker settlement, cleanup, DB insert, queue, audit, and lock-release assertions.

### AGG25-24 - DB restore lifecycle lacks behavior-path tests

Severity: High
Confidence: Medium-High
Agents: test-engineer, tracer, debugger
Primary citations: `apps/web/src/app/[locale]/admin/db-actions.ts:388-548`, `apps/web/src/__tests__/db-restore.test.ts:1-78`, `apps/web/src/__tests__/restore-upload-lock.test.ts:7-118`

Restore locking/maintenance paths are mostly source-order tested while real branches depend on connection/lock/child-process results. Add behavior tests for denied locks, partial acquisition, maintenance denial, quiesce errors, restore failure, and cleanup.

### AGG25-25 - Smart-collection pagination lacks behavior regression coverage

Severity: Medium
Confidence: High
Agents: test-engineer
Primary citations: `apps/web/src/app/actions/public.ts:169-233`, `apps/web/src/__tests__/public-actions.test.ts:99-280`

`loadMoreSmartCollectionImages` has unique slug/visibility/cursor/hasMore behavior with no direct behavior tests. Add tests for invalid/missing/private collections, cursor forwarding, page-size fetch count, and `hasMore` boundaries.

### AGG25-26 - Admin token plaintext acknowledgement lacks interaction coverage

Severity: Medium
Confidence: Medium
Agents: test-engineer
Primary citations: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:46-235`

Server action/source tests do not prove the one-time plaintext dialog cannot close early or lose the token. Add component or Playwright coverage for acknowledgement/copy/dismiss behavior.

### AGG25-27 - Visual-check E2E captures screenshots without visual assertions

Severity: Low
Confidence: High
Agents: test-engineer
Primary citations: `apps/web/e2e/nav-visual-check.spec.ts:6-78`, `apps/web/playwright.config.ts:48-87`

Screenshots are artifacts only; layout/color regressions can pass. Add stable `toHaveScreenshot` baselines or explicitly document these as diagnostics.

### AGG25-28 - Failed restore safety is process-local and can be lost or trap operators

Severity: High
Confidence: High
Agents: tracer, debugger, architect, test-engineer
Primary citations: `apps/web/src/app/[locale]/admin/db-actions.ts:388-524`, `apps/web/src/app/[locale]/admin/db-actions.ts:651-731`, `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/app/actions/auth.ts:70-75`

Failed restore keeps process-local maintenance but releases advisory locks. A restart clears the barrier; without restart, login can be blocked if sessions were replaced. Fix with durable restore recovery state outside the DB import, a narrow recovery surface, startup/sidecar checks, and tests.

### AGG25-29 - Public analytics inserts can race into restore

Severity: Medium
Confidence: High
Agents: debugger
Primary citations: `apps/web/src/app/actions/public.ts:370-456`, `apps/web/src/app/[locale]/admin/db-actions.ts:481-489`

View recorders check maintenance only before async target validation, then fire-and-forget inserts that restore does not drain. Add a late maintenance check and ideally track/drain analytics write promises.

### AGG25-30 - Deploy script reports success before health is proven

Severity: Medium
Confidence: High
Agents: debugger
Primary citations: `apps/web/deploy.sh:28-63`, `apps/web/Dockerfile:139-142`, `apps/web/src/__tests__/deploy-script-contract.test.ts:20-101`

`docker compose up -d --build` is followed by prune and success output without waiting for container health or `/api/live`. Add bounded health wait/log dump before prune/success and contract tests.

### AGG25-31 - CLIP embedding work continues after restore maintenance starts

Severity: Low
Confidence: High
Agents: debugger
Primary citations: `apps/web/src/lib/image-queue.ts:351-385`, `apps/web/src/lib/image-queue.ts:1053-1080`

Embedding generation checks maintenance only after expensive inference. Add an early maintenance check before `embedImageReal`, keeping the late DB-write check.

### AGG25-32 - Embedding column has split type ownership

Severity: Medium
Confidence: High
Agents: architect
Primary citations: `apps/web/src/db/schema.ts:266-286`, `apps/web/drizzle/0012_image_embeddings.sql:5-8`, `apps/web/scripts/migrate.js:643-651`, `apps/web/src/lib/clip-embeddings.ts:115-153`

The physical column is `MEDIUMBLOB`, but Drizzle schema declares text and runtime decoders compensate. Fix with a binary custom type/helper and a schema/migration/reconciler contract test.

### AGG25-33 - Broad server-action barrel blurs client/server and domain boundaries

Severity: Medium
Confidence: High
Agents: architect
Primary citations: `apps/web/src/app/actions.ts:1-34`, `apps/web/src/components/upload-dropzone.tsx:7`, `apps/web/src/lib/api-auth.ts:1`, `apps/web/src/app/actions/auth.ts:1-70`

Client components import a broad `@/app/actions` barrel, and API auth imports action-layer auth helpers. Split domain auth context into `lib`, deprecate broad client imports, and extend boundary tests.

### AGG25-34 - Docker native dependency pins can drift outside CI

Severity: Medium
Confidence: Medium
Agents: architect
Primary citations: `apps/web/Dockerfile:49-61`, `apps/web/src/__tests__/deploy-script-contract.test.ts:90-100`, `.github/workflows/quality.yml:48-80`

Dockerfile installs explicit native optional package versions, but tests only check semver shape, not lockfile parity, and CI does not build the Docker image. Add lockfile parity or Docker build coverage.

### AGG25-35 - Semantic search recall is a recency window

Severity: Medium
Confidence: High
Agents: architect
Primary citations: `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`, `apps/web/src/lib/clip-embeddings.ts:36-44`

Search scans only newest active embeddings up to `SEMANTIC_SCAN_LIMIT`. Older relevant photos become unreachable once corpus exceeds the cap. Surface scanned/total coverage and consider ANN/vector indexing or another retrieval tier.

### AGG25-36 - Single-instance runtime ownership is documented but not enforced

Severity: Medium
Confidence: Medium
Agents: architect, tracer
Primary citations: `apps/web/docker-compose.yml:12-28`, `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/upload-tracker-state.ts:7-79`, `apps/web/src/lib/image-queue.ts:267-342`

Single web process is a documented invariant, but there is no startup lease. Accidental second writer splits process-local queues, rate limits, trackers, and status. Enforce with a startup advisory lease or move state durable before scale-out.

### AGG25-37 - Public analytics row writes are untracked fire-and-forget side effects

Severity: Low
Confidence: High
Agents: architect, debugger
Primary citations: `apps/web/src/app/actions/public.ts:362-456`, `apps/web/src/instrumentation.ts:33-40`

Row-level view writes can be dropped on shutdown/crash and are not drained like shared-group buffers. Document analytics as approximate with counters or route through a bounded queue with shutdown drain.

### AGG25-38 - PAT/LR upload docs advertise ignored metadata fields

Severity: Medium
Confidence: High
Agents: document-specialist
Primary citations: `README.md:214`, `apps/web/README.md:87`, `apps/web/src/app/api/admin/lr/upload/route.ts:161-452`

Docs say `tags`, camera/lens/date/exposure fields are accepted, but the route consumes only `file`, `topic`, optional `title`, and optional `description`. Update docs or implement the fields.

### AGG25-39 - PAT/LR upload docs promise generated filenames not returned

Severity: Medium
Confidence: High
Agents: document-specialist
Primary citations: `README.md:216`, `apps/web/README.md:89`, `apps/web/src/app/api/admin/lr/upload/route.ts:544-546`

Docs promise created-image and generated-filename JSON, but the route returns only `{ success: true, id }`. Update docs or extend the response with tests.

### AGG25-40 - CLIP wiki omits required `--force`

Severity: High
Confidence: High
Agents: document-specialist
Primary citations: `.omc/wiki/clip-semantic-search-us-p51.md:35`, `apps/web/scripts/backfill-clip-embeddings.ts:55-116`, `CLAUDE.md:537`

The wiki pre-enable command can no-op successfully without processing embeddings. Add `--force` and the existing pre-enable note.

### AGG25-41 - Disk-hygiene wiki overstates the public bind mount

Severity: Low
Confidence: High
Agents: document-specialist
Primary citations: `.omc/wiki/deploy-disk-hygiene-runbook.md:22`, `apps/web/docker-compose.yml:24-27`, `apps/web/deploy.sh:39-45`

The wiki says `./public` is persistent, but only `public/uploads` and `public/resources` are bind-mounted. Fix the mount list.

### AGG25-42 - Public route error shell drops normal wayfinding

Severity: Medium
Confidence: High
Agents: designer, ui-ux-designer-reviewer
Primary citations: `apps/web/src/app/[locale]/error.tsx:22-55`, `apps/web/src/app/[locale]/not-found.tsx:18-48`, `apps/web/src/app/[locale]/(public)/page.tsx:89-167`

DB outage routes fall to a generic error shell with only retry/home links, losing nav/footer/search/theme/locale context. Use a client-safe public error shell or DB-unavailable state preserving normal wayfinding.

### AGG25-43 - Auto-lightbox loading status is unnamed

Severity: Low
Confidence: High
Agents: designer
Primary citations: `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx:20-25`, `apps/web/src/components/photo-viewer-loading.tsx:9-20`

The auto-lightbox loading status has only a decorative spinner. Add an accessible name/visually hidden text and a small regression test.

### AGG25-44 - Search result keyboard model is not discoverable

Severity: Low
Confidence: Medium
Agents: designer
Primary citations: `apps/web/src/components/search.tsx:72-80`, `apps/web/src/components/search.tsx:402-449`

Search results are arrow-operated listbox options with `tabIndex={-1}`, but no local instruction explains arrow/Enter operation. Add `aria-describedby` and visible/screen-reader hint copy or make results tabbable links.

### AGG25-45 - Fresh-install DB examples disagree

Severity: Medium
Confidence: High
Agents: product-marketer-reviewer
Primary citations: `README.md:106-141`, `apps/web/README.md:9-20`, `apps/web/.env.local.example:1-7`

Quick-start SQL creates `gallerykit`, while snippets/templates use `gallery` or placeholders. Align one canonical local DB/user/name across docs and env example.

### AGG25-46 - Nginx comments imply a bundled Lightroom plugin

Severity: Low
Confidence: High
Agents: product-marketer-reviewer
Primary citations: `README.md:205-214`, `apps/web/messages/en.json:830-835`, `CLAUDE.md:160`, `apps/web/nginx/default.conf:124-130`

Nginx comments say "Lightroom Classic publish-plugin upload" and "LR publish integration", conflicting with docs/admin copy that define a PAT-authenticated external upload API. Reword comments.

### AGG25-47 - Modal backgrounds remain exposed to assistive technology

Severity: High
Confidence: High
Agents: ui-ux-designer-reviewer
Primary citations: `apps/web/src/components/search.tsx:363-524`, `apps/web/src/components/lightbox.tsx:451-459`, `apps/web/src/components/info-bottom-sheet.tsx:185-199`

Custom modals declare `aria-modal` and trap tab focus but do not make app-root siblings inert/hidden, so screen-reader virtual cursors can traverse background content. Add a shared modal manager/inert behavior or use dialog primitives, plus regression tests.

### AGG25-48 - Photo viewer single-key shortcuts fire on focused controls

Severity: Medium
Confidence: High
Agents: ui-ux-designer-reviewer
Primary citations: `apps/web/src/components/photo-viewer.tsx:42-49`, `apps/web/src/components/photo-viewer.tsx:355-386`, `apps/web/src/components/photo-viewer.tsx:541-968`

Global shortcuts ignore editable fields only, not links/buttons/menu items. Single letters and arrows can trigger viewer actions while focus is on controls. Expand the guard or scope shortcuts to the media surface, with focused-control tests.

### AGG25-49 - Admin settings copy mixes daily controls with operator runbook detail

Severity: Medium
Confidence: Medium
Agents: ui-ux-designer-reviewer
Primary citations: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:307-789`, `apps/web/messages/en.json:747-780`, `apps/web/messages/ko.json:747-780`

Settings pages embed dense implementation/runbook copy in primary controls. Split photographer-facing outcomes from operator details and shorten Korean/English UI copy.

## Highest-Signal Cross-Agent Themes

- Restore durability and recovery is the highest-risk cluster: tracer, debugger, architect, and test-engineer all converged on process-local restore maintenance and untested failure branches.
- Public write side effects are the second cluster: critic, debugger, architect, and perf-reviewer flagged analytics durability/rate-limit/drain/restore interactions.
- Runtime/deploy reliability is the third cluster: debugger, critic, security-reviewer, product/document specialists, and architect flagged deploy health, broad startup repair, Docker/native drift, and operator docs mismatch.
- UI/accessibility issues are real but scoped: modal background isolation, global shortcuts, public error wayfinding, and loading/search affordances have precise file evidence.

## Review Validation Summary

Agents collectively ran targeted guardrails and tests, including:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- Full gate run by code-reviewer: lint, typecheck, build, and unit tests passed at review time.
- UI reviewer targeted tests: touch target, i18n parity, a11y, and focus-visible tests passed.

Full final gates still must run after implementation.
