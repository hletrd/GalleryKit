# Cycle 8 Aggregate Review

Date: 2026-07-07

## Agent Coverage

Callable native subagent roles available here were `default`, `explorer`, and `worker`; named reviewer roles were therefore run as role-scoped `worker` lanes. The AGENTS.md hard cap of six concurrent child agents prevented a literal all-at-once fan-out, so lanes were run in bounded waves with every requested perspective preserved. The first `test-engineer` and `tracer` spawn attempts hit the active-agent limit and were retried successfully after slots freed.

Review files written:

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
- `.context/reviews/ui-ux-designer-reviewer.md`

Agent failures: none.

Raw findings before dedupe: 46.
Deduped findings below: 41.

## Validation Evidence From Review Lanes

- `npm run lint --workspace=apps/web`: passed in verifier lane.
- `npm run lint:api-auth --workspace=apps/web`: passed in verifier/security lanes.
- `npm run lint:action-origin --workspace=apps/web`: passed in verifier/security lanes.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed in verifier/security lanes.
- Targeted Vitest semantic/security/privacy subsets passed in specialist lanes.
- `npm audit --workspace=apps/web --omit=dev`: failed with 2 moderate advisories through Next's nested PostCSS dependency.
- Browser UI evidence was gathered from `https://gallery.atik.kr` by the designer/UI lanes.

## Deduped Findings

### AGG-C8-01 - Password change can bypass the restore mutation barrier

- Original findings: `TRC8-01`, `DBG-C8-01`
- Cross-agent agreement: tracer + debugger
- Severity: High
- Confidence: High
- Status: confirmed correctness/data-integrity bug
- Citations: `apps/web/src/app/actions/auth.ts:291-416`, `apps/web/src/lib/admin-mutation-barrier.ts:67-80`, `apps/web/src/app/[locale]/admin/db-actions.ts:550-562`, `apps/web/src/__tests__/auth-mutation-barrier-source.test.ts:14-25`
- Scenario: `acquireAdminMutationSlot()` returns a truthy object with `acquired: false` during restore, but `updatePassword()` checks `if (!mutationSlot)` and continues into password/session writes.
- Suggested fix: check `!mutationSlot.acquired` and add a regression test proving refused slots return `restoreInProgress` before rate-limit, Argon2, transaction, cookie, or audit work.

### AGG-C8-02 - Admin CSV export still uses MySQL-invalid `GROUP_CONCAT ... SEPARATOR CHAR(1)`

- Original finding: `TRC8-02`
- Severity: Medium
- Confidence: High
- Status: confirmed correctness bug
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:83-164`, `apps/web/src/__tests__/shared-link-runtime-contracts.test.ts:14-29`, `apps/web/src/lib/data.ts:1247-1276`
- Scenario: authenticated image CSV export reaches a SELECT that MySQL rejects with a parse error.
- Suggested fix: use a quoted literal separator matching the fixed public shared-link pattern and add a source/behavior regression.

### AGG-C8-03 - Semantic text search can be configured to return 25,000 public results

- Original findings: `CR-C8-01`, related to `PERF-C8-05`
- Cross-agent agreement: code-reviewer + performance
- Severity: Medium
- Confidence: High
- Status: confirmed performance/resource bug
- Citations: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:72-91`, `apps/web/src/app/api/search/semantic/route.ts:311-367`, `apps/web/src/__tests__/clip-semantic-limits-env.test.ts:75-80`, `apps/web/src/__tests__/semantic-search-params.test.ts:36-38`, `CLAUDE.md:118-119`, `CLAUDE.md:598-601`
- Scenario: an operator misconfigures `SEMANTIC_TOP_K_MAX`; a public request can ask for thousands of enriched JSON results and consume avoidable CPU, DB, memory, and bandwidth.
- Suggested fix: split scan and response hard caps; keep `SEMANTIC_SCAN_LIMIT` at the host budget while clamping `SEMANTIC_TOP_K_MAX` to a UI-sized response ceiling.

### AGG-C8-04 - Next bundles vulnerable PostCSS in the production dependency graph

- Original finding: `C8-SEC-01`
- Severity: Medium
- Confidence: High
- Status: confirmed dependency advisory
- Citations: `apps/web/package.json:57`, `package-lock.json:9334-9335`
- Scenario: audit reports GHSA-qx2v-qp2m-jg93 through `next` because Next 16.2.10 bundles `postcss@8.4.31`.
- Suggested fix: upgrade when Next ships a fixed nested PostCSS, or validate an npm override to `postcss >=8.5.10` against build/tests. Do not use `npm audit fix --force`.

### AGG-C8-05 - Runtime MySQL TLS ignores `DB_SSL_CA`

- Original finding: `C8-SEC-02`
- Severity: Medium
- Confidence: High for behavior, Medium for deployment impact
- Status: security/ops risk
- Citations: `apps/web/src/db/index.ts:6-12`, `apps/web/scripts/mysql-connection-options.js:11-23`, `apps/web/src/lib/mysql-cli-ssl.ts:13-24`, `README.md:154-170`, `apps/web/README.md:48-50`, `CLAUDE.md:93-94`
- Scenario: operators using a private CA for non-local MySQL cannot make runtime `mysql2` connections validate that CA, creating pressure to disable TLS.
- Suggested fix: read `DB_SSL_CA` for runtime/script mysql2 connection options and test non-local TLS behavior.

### AGG-C8-06 - Optional Google Analytics also tracks admin routes

- Original finding: `C8-SEC-03`
- Severity: Low
- Confidence: High
- Status: privacy risk
- Citations: `apps/web/src/site-config.json:10`, `apps/web/src/app/[locale]/layout.tsx:154-168`, `apps/web/src/app/[locale]/admin/layout.tsx:21-34`, `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:5-17`, `apps/web/README.md:48`
- Scenario: enabling `google_analytics_id` injects GA in the locale root that wraps public and admin surfaces.
- Suggested fix: move GA injection to the public route layout or route-gate it away from `/admin`.

### AGG-C8-07 - `image_embeddings` cannot retain more than one model version

- Original findings: `CRIT-C8-01`, `ARCH-C8-03`, `DOC-C8-01`
- Cross-agent agreement: critic + architect + document-specialist
- Severity: Medium
- Confidence: High
- Status: confirmed architecture/docs risk
- Citations: `apps/web/drizzle/0012_image_embeddings.sql:5-11`, `apps/web/src/db/schema.ts:271-300`, `apps/web/scripts/backfill-clip-embeddings.ts:212-223`, `apps/web/src/app/actions/embeddings.ts:175-186`, `apps/web/src/lib/image-queue.ts:512-523`, `apps/web/src/app/api/search/semantic/route.ts:263-279`, `apps/web/src/app/api/search/similar/[id]/route.ts:137-190`, `apps/web/README.md:64-74`, `CLAUDE.md:553-574`
- Scenario: a partial production model rollout overwrites old rows one image at a time; rolling back the active model can only see rows not overwritten.
- Suggested fix: either migrate to `(image_id, model_version)` storage, or explicitly document the current single-active-version destructive rewrite/rollback contract.

### AGG-C8-08 - Production CLIP sidecar can repeatedly spend its scan budget on the same failing low-id prefix

- Original finding: `CRIT-C8-02`
- Severity: Medium
- Confidence: Medium
- Status: likely ops/data-coverage risk
- Citations: `apps/web/scripts/backfill-clip-embeddings.ts:150-188`, `apps/web/scripts/backfill-clip-embeddings.ts:193-204`, `apps/web/scripts/backfill-clip-embeddings.ts:228-248`, `apps/web/README.md:80-82`, `apps/web/src/lib/image-queue.ts:340-356`
- Scenario: repeated sidecar runs restart at ID 0, retry the same failures, hit `SEMANTIC_SCAN_LIMIT`, and never progress to valid newer rows.
- Suggested fix: add durable resume/skip support or `--start-after-id`, and update the runbook.

### AGG-C8-09 - Real LR PAT multipart upload is not proven end-to-end

- Original findings: `VER-C8-01`, `TE-C8-03`
- Cross-agent agreement: verifier + test-engineer
- Severity: Medium
- Confidence: High
- Status: confirmed integration-proof gap
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:84-92`, `apps/web/src/app/api/admin/lr/upload/route.ts:528-565`, `apps/web/src/app/api/admin/lr/upload/route.ts:611`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:44-47`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:172-199`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:191-431`, `apps/web/src/__tests__/api-auth-response-headers.test.ts:50-149`, `apps/web/src/__tests__/admin-tokens.test.ts:181-294`
- Scenario: header/scope/context/`last_used_at`/multipart/DB/enqueue can drift while mocked route and source-contract tests pass.
- Suggested fix: add a disposable integration test creating an `lr:upload` token and POSTing a real multipart JPEG through the wrapper.

### AGG-C8-10 - Authenticated admin browser e2e proof remains opt-in

- Original findings: `VER-C8-02`, `TE-C8-04`
- Cross-agent agreement: verifier + test-engineer
- Severity: Medium
- Confidence: High
- Status: confirmed coverage gap
- Citations: `apps/web/playwright.config.ts:78-85`, `apps/web/scripts/run-e2e-server.mjs:75-84`, `apps/web/scripts/seed-e2e.ts:174-230`, `apps/web/e2e/admin.spec.ts:6-165`, `apps/web/e2e/origin-guard.spec.ts:28-57`, `apps/web/src/components/admin-nav.tsx:15-26`
- Scenario: admin hydration, SEO, tokens, analytics, upload, topic CRUD, and authenticated origin behavior can regress without the optional admin e2e profile.
- Suggested fix: require a disposable admin e2e job for release evidence and add one stable assertion per admin nav destination.

### AGG-C8-11 - E2E safety guard runs after database initialization

- Original finding: `TE-C8-01`
- Severity: Medium
- Confidence: High
- Status: confirmed harness-safety gap
- Citations: `apps/web/scripts/run-e2e-server.mjs:75-84`, `apps/web/scripts/init-db.ts:24-30`, `apps/web/scripts/seed-e2e.ts:169-183`, `apps/web/src/__tests__/seed-e2e-safety.test.ts:9-28`
- Scenario: `npm run test:e2e` can run migrations/reconcile through `npm run init` before the disposable-DB guard in `seed-e2e.ts` refuses an unsafe database.
- Suggested fix: run the DB safety guard before `npm run init` and test that ordering.

### AGG-C8-12 - No coverage ratchet protects critical branches

- Original finding: `TE-C8-02`
- Severity: Medium
- Confidence: High
- Status: confirmed test strategy gap
- Citations: `apps/web/package.json:13`, `apps/web/vitest.config.ts:16-39`
- Scenario: new action/API/lib branches can ship without runtime coverage while existing tests pass.
- Suggested fix: add a non-blocking coverage baseline, then ratchet changed files or critical directories.

### AGG-C8-13 - Zoom and swipe combined interaction states are not browser-tested

- Original finding: `TE-C8-05`
- Severity: Medium
- Confidence: Medium-High
- Status: likely coverage gap
- Citations: `apps/web/src/components/image-zoom.tsx:198-258`, `apps/web/src/components/photo-viewer.tsx:400-420`, `apps/web/src/components/lightbox.tsx:331-350`, `apps/web/e2e/swipe-visual-reset.spec.ts:59-131`, `.context/plans/cycle-96-2026-07-01-deferred.md:65-70`, `.context/plans/cycle-96-2026-07-01-deferred.md:109-114`
- Scenario: a zoomed photo can accidentally navigate on arrow/touch pan while math/source tests pass.
- Suggested fix: add Playwright tests for zoomed keyboard and mobile pan/swipe states.

### AGG-C8-14 - Playwright remains Chromium-only despite mobile/touch-heavy flows

- Original finding: `TE-C8-06`
- Severity: Low-Medium
- Confidence: High
- Status: confirmed matrix gap
- Citations: `apps/web/playwright.config.ts:48-77`, `apps/web/e2e/test-fixes.spec.ts:16-82`, `apps/web/e2e/focus-restore.spec.ts:34-60`, `apps/web/e2e/swipe-visual-reset.spec.ts:23-49`
- Scenario: Safari/iOS event, focus, viewport, and touch behavior can regress with green Chromium-only e2e.
- Suggested fix: add a small Mobile Safari/WebKit smoke project.

### AGG-C8-15 - Visual checks write screenshots but do not assert snapshots

- Original finding: `TE-C8-07`
- Severity: Low
- Confidence: High
- Status: confirmed assertion weakness
- Citations: `apps/web/e2e/nav-visual-check.spec.ts:6-37`, `apps/web/e2e/nav-visual-check.spec.ts:58-85`
- Scenario: visual regressions can produce artifacts without failing the test.
- Suggested fix: add stable `toHaveScreenshot` assertions or rename/scope the test as a metrics-only smoke.

### AGG-C8-16 - CLIP real-model tests are opt-in and teardown is noisy

- Original findings: `TE-C8-08`, `PMR-C8-01`
- Cross-agent agreement: test-engineer + product-marketer-reviewer
- Severity: Medium
- Confidence: Medium-High
- Status: release/activation proof gap
- Citations: `README.md:48`, `apps/web/README.md:64-70`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:4-10`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:72-80`
- Scenario: public English/Korean semantic-search claims can remain unproven in default gates when production CLIP dependencies regress.
- Suggested fix: document and/or automate a release/activation gate for real CLIP integration tests on hosts with seeded weights.

### AGG-C8-17 - Public data-contract guards can be bypassed by aliasing sensitive columns

- Original finding: `ARCH-C8-01`
- Severity: Medium
- Confidence: High
- Status: confirmed guard-shape privacy risk
- Citations: `apps/web/src/lib/data.ts:368-407`, `apps/web/src/lib/data.ts:458-475`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`, `apps/web/src/lib/data-timeline.ts:35-67`, `apps/web/src/lib/data.ts:1599-1617`
- Scenario: a public select can expose `images.latitude` under a safe alias and pass the key-name-based privacy guard.
- Suggested fix: move public selects behind column-level allowlists or lint direct sensitive column use in public select modules.

### AGG-C8-18 - Derivative setting changes do not invalidate the dominant static image-serving path

- Original finding: `ARCH-C8-02`
- Severity: Medium
- Confidence: High
- Status: confirmed behavior/product risk
- Citations: `apps/web/next.config.ts:56-73`, `apps/web/src/lib/serve-upload.ts:240-258`, `apps/web/src/lib/settings-hash.ts:14-19`, `apps/web/src/app/actions/settings.ts:168-239`, `apps/web/src/lib/revalidation.ts:59-64`
- Scenario: byte-impacting setting changes commit immediately, but existing static derivatives keep serving old bytes until a re-encode.
- Suggested fix: move derivatives behind version-aware route serving, use content-addressed filenames, or make backfill required/visible before presenting settings as applied.

### AGG-C8-19 - Single-writer safety is documented but not enforceable

- Original finding: `ARCH-C8-04`
- Severity: Medium
- Confidence: High
- Status: confirmed operational risk
- Citations: `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/instrumentation.ts:22-31`, `apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/lib/image-queue.ts:373-455`, `apps/web/src/lib/rate-limit.ts:393-415`
- Scenario: two web instances against one DB continue serving despite process-local restore/upload/rate-limit/queue assumptions.
- Suggested fix: add an enforceable production option or move correctness-relevant state to shared coordination.

### AGG-C8-20 - Shared-group reads still own a view-count write side effect

- Original finding: `ARCH-C8-05`
- Severity: Low
- Confidence: High
- Status: confirmed design/coupling risk
- Citations: `apps/web/src/lib/data.ts:1322-1407`, `apps/web/src/lib/data.ts:1796-1800`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`
- Scenario: future read-only callers of `getSharedGroupCached()` can accidentally increment denormalized view counts.
- Suggested fix: make reads pure and move counter buffering to an explicit route-owned view service.

### AGG-C8-21 - Experimental storage abstraction does not preserve live pipeline file invariants

- Original finding: `ARCH-C8-06`
- Severity: Low
- Confidence: Medium
- Status: likely future-integration risk
- Citations: `apps/web/src/lib/storage/index.ts:1-12`, `apps/web/src/lib/storage/types.ts:1-16`, `apps/web/src/lib/storage/local.ts:98-108`, `apps/web/src/lib/storage/local.ts:142-156`, `apps/web/src/lib/process-image.ts:1164-1224`
- Scenario: a future integration could replace atomic temp-file/rename semantics with direct final-path writes.
- Suggested fix: keep the abstraction quarantined or upgrade its contract before integration.

### AGG-C8-22 - Semantic-search docs blur stub text search with production-only similar photos

- Original finding: `DOC-C8-02`
- Severity: Low
- Confidence: High
- Status: confirmed docs/product mismatch
- Citations: `README.md:48`, `apps/web/README.md:64-72`, `apps/web/src/app/api/search/semantic/route.ts:186-204`, `apps/web/src/app/api/search/similar/[id]/route.ts:115-130`, `apps/web/src/components/similar-photos.tsx:47-52`, `apps/web/src/components/search.tsx:519-552`
- Scenario: operators can enable stub mode expecting similar photos, but similar photos are intentionally production-only.
- Suggested fix: document the mode matrix explicitly.

### AGG-C8-23 - Admin category/tag/SEO edit failures are toast-only and not field-associated

- Original finding: `DES-C8-01`
- Severity: Medium
- Confidence: High
- Status: confirmed accessibility/UX issue
- Citations: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90-123`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:204-221`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:362-382`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:52-66`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:168-181`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-72`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:98-184`
- Scenario: keyboard/screen-reader admins get ephemeral toast errors without `aria-invalid`, `aria-describedby`, persistent alert, or invalid-field focus.
- Suggested fix: follow the login/settings pattern with field/form error state and focus routing.

### AGG-C8-24 - Tag autocomplete popovers can be clipped inside the admin image table scroller

- Original finding: `DES-C8-02`
- Severity: Medium
- Confidence: Medium
- Status: likely UI issue
- Citations: `apps/web/src/components/image-manager.tsx:424-531`, `apps/web/src/components/tag-input.tsx:183-275`
- Scenario: suggestions rendered inside an overflow table can be clipped despite high z-index.
- Suggested fix: render suggestions through a portal/popover layer and add a regression around overflow containers.

### AGG-C8-25 - Product/footer chrome is forced onto every public gallery

- Original finding: `PMR-C8-02`
- Severity: Low-Medium
- Confidence: High
- Status: confirmed product/trust mismatch
- Citations: `apps/web/src/site-config.example.json:2-9`, `apps/web/src/components/footer.tsx:32-64`, `apps/web/src/app/[locale]/(public)/about-gallerykit/page.tsx:21-45`, `apps/web/messages/en.json:823-831`, `README.md:36-38`
- Scenario: a photographer deploys a branded gallery, but every visitor still sees project/GitHub/admin chrome.
- Suggested fix: make product/footer links configurable or document the intentional product chrome boundary.

### AGG-C8-26 - Upload-token copy promises expiry behavior the create UI cannot choose

- Original finding: `PMR-C8-03`
- Severity: Low
- Confidence: High
- Status: confirmed copy/UI mismatch
- Citations: `apps/web/messages/en.json:867-894`, `apps/web/src/app/actions/lr-tokens.ts:29-101`, `apps/web/src/lib/admin-tokens.ts:141-167`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-89`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:210-246`
- Scenario: admins read expiry language, but the create dialog can only mint non-expiring tokens.
- Suggested fix: add an expiry control or tighten copy to say tokens created here do not expire by default.

### AGG-C8-27 - Repeated gallery cards have indistinguishable accessible names

- Original finding: `UXR-C8-01`
- Severity: High
- Confidence: High
- Status: confirmed accessibility issue
- Citations: live `/en` and `/ko` accessibility snapshots; `apps/web/src/components/masonry-card.tsx:47-64`, `apps/web/src/components/masonry-card.tsx:107-158`, `apps/web/e2e/public.spec.ts:160-167`
- Scenario: a screen-reader or keyboard visitor hears identical "View photo..." links for many adjacent cards and cannot choose or return reliably.
- Suggested fix: include a stable differentiator such as ordinal, capture time, image id, or filename-derived short label in accessible names.

### AGG-C8-28 - Mobile filters can push the first photo below the primary viewport

- Original finding: `UXR-C8-02`
- Severity: Medium
- Confidence: High
- Status: confirmed live UI issue
- Citations: live `/ko` mobile browser evidence; `apps/web/src/components/tag-filter.tsx:62-123`, `apps/web/src/components/home-client.tsx:232-342`
- Scenario: tag chips occupy roughly half of a 390x844 viewport before the first photo appears.
- Suggested fix: show a capped/scrollable chip row or move full filters into a sheet/dialog.

### AGG-C8-29 - Admin photo management is a wide table, not an efficient photo workflow

- Original finding: `UXR-C8-03`
- Severity: High
- Confidence: High for source, likely for friction
- Status: source-confirmed workflow risk
- Citations: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:140-144`, `apps/web/src/components/image-manager.tsx:321-600`
- Scenario: admins manage photos through a horizontally scrollable dense table where the photo is secondary to row controls.
- Suggested fix: introduce an admin photo workbench with grid/selection plus inspector, while keeping table as a dense list mode if needed.

### AGG-C8-30 - Admin navigation is flat and wraps instead of grouping workflows

- Original finding: `UXR-C8-04`
- Severity: Medium
- Confidence: High
- Status: source-confirmed IA issue
- Citations: `apps/web/src/components/admin-nav.tsx:15-29`, `apps/web/src/components/admin-header.tsx:13-27`
- Scenario: ten peer admin links wrap across rows and change spatial positions across widths/locales.
- Suggested fix: group admin IA into Content, Publishing, Operations, Access, and Insights.

### AGG-C8-31 - Photo viewer shortcut discoverability is partial

- Original finding: `UXR-C8-05`
- Severity: Medium
- Confidence: Medium-High
- Status: confirmed source pattern
- Citations: `apps/web/src/components/photo-viewer.tsx:400-418`, `apps/web/src/components/lightbox.tsx:316-368`, `apps/web/src/components/photo-viewer.tsx:580-584`, `apps/web/messages/en.json:363-365`, `apps/web/messages/ko.json:363-365`, `apps/web/src/components/photo-navigation.tsx:306-329`
- Scenario: keyboard shortcuts work but are split between prose and partial `aria-keyshortcuts`, limiting discovery by assistive tooling.
- Suggested fix: add consistent `aria-keyshortcuts` and a structured keyboard-help surface.

### AGG-C8-32 - Normal photo viewer remains framed by rounded chrome

- Original finding: `UXR-C8-06`
- Severity: Low-Medium
- Confidence: High for live evidence, Medium for impact
- Status: confirmed visual/fidelity tradeoff
- Citations: live `/en/p/348` computed style; `apps/web/src/components/photo-viewer.tsx:483-542`, `apps/web/src/components/photo-viewer.tsx:697`
- Scenario: critical photo inspection occurs inside a rounded/padded panel unless the user opens the lightbox.
- Suggested fix: make fidelity mode obvious or reduce frame/radius/padding in the main desktop viewer.

### AGG-C8-33 - Long Korean operational copy risks overwhelming settings surfaces

- Original finding: `UXR-C8-07`
- Severity: Medium
- Confidence: Medium
- Status: likely layout/content risk
- Citations: `apps/web/messages/en.json:765-815`, `apps/web/messages/ko.json:790-815`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- Scenario: dense Korean settings prose can bury action/risk decisions.
- Suggested fix: split long settings copy into structured summary, consequences, and warning rows; add Korean settings layout checks.

### AGG-C8-34 - Touch-target exemptions keep admin mobile quality ambiguous

- Original finding: `UXR-C8-08`
- Severity: Low-Medium
- Confidence: Medium
- Status: governance risk
- Citations: `apps/web/src/__tests__/touch-target-audit.test.ts:42-88`, `apps/web/src/__tests__/touch-target-audit.test.ts:156-194`, `apps/web/src/__tests__/touch-target-audit.test.ts:218-243`, `apps/web/src/components/image-manager.tsx:338-341`, `apps/web/src/components/admin-user-manager.tsx:93-99`, `apps/web/src/components/admin-header.tsx:21-25`
- Scenario: if admin mobile support becomes expected, documented exemptions can hide rough edges.
- Suggested fix: explicitly support mobile admin and retire exemptions, or document desktop-only admin support.

### AGG-C8-35 - Public map hydrates up to 10,000 markers plus a duplicate list

- Original finding: `PERF-C8-01`
- Severity: Medium
- Confidence: High
- Status: confirmed performance issue
- Citations: `apps/web/src/lib/data.ts:1732-1782`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-110`, `apps/web/src/components/map/map-client.tsx:77-139`
- Scenario: a map page for 8,000-10,000 GPS photos can freeze mobile clients and inflate RSC/client payloads.
- Suggested fix: use viewport/bounds APIs, clustering/canvas/WebGL, lower initial caps, and virtualize/paginate the accessible list.

### AGG-C8-36 - Timeline and On This Day use non-sargable predicates on uncached SSR paths

- Original finding: `PERF-C8-02`
- Severity: Medium
- Confidence: High
- Status: confirmed performance issue
- Citations: `apps/web/src/lib/data-timeline.ts:7-9`, `apps/web/src/lib/data-timeline.ts:88-207`, `apps/web/src/components/on-this-day-widget.tsx:10-22`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19-94`
- Scenario: homepage and timeline traffic repeatedly scans processed/capture-date rows through `MONTH()`, `DAY()`, and `YEAR()` wrappers.
- Suggested fix: use sargable year ranges, generated/indexed month-day columns, and cache/revalidate low-churn widgets.

### AGG-C8-37 - Public smart collections can execute unindexed scans and a separate count per request

- Original finding: `PERF-C8-03`
- Severity: Medium
- Confidence: High
- Status: likely query/index issue
- Citations: `apps/web/src/lib/smart-collections.ts:21-30`, `apps/web/src/lib/smart-collections.ts:142-267`, `apps/web/src/db/schema.ts:117-135`, `apps/web/src/lib/data.ts:1488-1550`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17-111`
- Scenario: a broad public collection can run expensive listing and count scans on every uncached visit.
- Suggested fix: classify/index predicate shapes, materialize memberships, and avoid exact counts for expensive public predicates.

### AGG-C8-38 - Batch image deletion repeats derivative-directory scans

- Original finding: `PERF-C8-04`
- Severity: Medium
- Confidence: High
- Status: confirmed performance issue
- Citations: `apps/web/src/app/actions/images.ts:778-785`, `apps/web/src/app/actions/images.ts:860-884`, `apps/web/src/lib/process-image.ts:575-630`
- Scenario: deleting 100 images can scan derivative directories up to 300 times.
- Suggested fix: scan each derivative directory once per batch or schedule old-variant cleanup separately.

### AGG-C8-39 - Upload route advertises range handling but returns full-body 200 responses

- Original finding: `DBG-C8-02`
- Severity: Medium
- Confidence: Medium
- Status: likely docs/code/HTTP behavior issue
- Citations: `apps/web/src/app/uploads/[...path]/route.ts:4-15`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:4-15`, `apps/web/src/lib/serve-upload.ts:268-369`, `apps/web/src/__tests__/serve-upload.test.ts:41-260`, `apps/web/src/__tests__/uploads-route-method-wiring.test.ts:41-65`
- Scenario: clients requesting partial content through the route-handler fallback receive full `200` responses.
- Suggested fix: implement range support or remove the "range handling" claim and update rate-limit exemption rationale.

### AGG-C8-40 - Product docs overstate GA as public-page-only

- Original finding: covered by `C8-SEC-03`
- Severity: Low
- Confidence: High
- Status: docs/privacy mismatch
- Citations: `apps/web/README.md:48`, `apps/web/src/app/[locale]/layout.tsx:154-168`
- Scenario: docs say GA loads on public pages, but current root layout also covers admin.
- Suggested fix: same as AGG-C8-06, then update docs if needed.

### AGG-C8-41 - Shared review execution was constrained by agent-thread cap

- Original finding: orchestration observation
- Severity: Low
- Confidence: High
- Status: process constraint
- Citations: native subagent spawn failures during `test-engineer` and `tracer` launch
- Scenario: prompt requested a single all-agent batch, but AGENTS.md capped child agents and the tool refused extra threads.
- Suggested fix: record this in the aggregate, which this section does; no repo code fix required.
