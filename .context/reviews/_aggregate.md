# Cycle 18 Aggregate Review

Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Cycle: review-plan-fix 18/100
Reviewed HEAD: `a186340570351af0cab5347de21a5bb1b50c327a`

## Agent Coverage

The native subagent environment exposed only generic agent types, so role-specialist reviews were run as role-specific prompts through the available default agent surface. Active thread limits required one delayed UI/product lane retry, but every requested lane returned and wrote its report.

Reports ingested:

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

Agent failures: none.

Validation limitations noted by agents:

- Local DB-backed pages could not fully render (`ECONNREFUSED 127.0.0.1:3306` / local HTTP 500), so protected admin UI findings are partly source-backed and need credentialed browser validation.
- No lane proved live production commit, nginx/proxy state, CLIP weights, semantic-search mode, or deployment state from the static repository.
- Several performance issues are source-confirmed but still need DB/browser profiling to quantify production impact.

## Summary

- Unique deduped findings: 22
- Confirmed or likely source/product/doc issues: 17
- Manual-validation risks: 5
- Highest-severity confirmed issues: large multipart framework materialization and request-local semantic vector scans.
- Strongest cross-agent agreement: stale Cycle 17 release/deploy ledger state, PAT usage telemetry before route admission, mobile tag hierarchy, admin table/nav ergonomics, and UI/browser verification gaps.

## Findings

### AGG-C18-01 - Active release ledgers are stale after the pushed Cycle 17 commit

- Severity: Medium
- Confidence: High
- Source findings: `C18-SEC-MV-01`, `C18-CRIT-01`, `VER-01`, `VER-03`
- Cross-agent agreement: security-reviewer, critic, verifier
- Citations: `.context/plans/README.md:34-38`, `.context/plans/cycle-17-2026-07-08-plan.md:3-7`, `.context/plans/cycle-17-2026-07-08-plan.md:141-158`, `plan/plan-374-cycle18-fixes.md:1-10`, `plan/plan-375-cycle18-deferred.md:1-7`
- Problem: the canonical `.context/plans` index still treats Cycle 17 as active/pending from `fc15b235`, while git history shows pushed HEAD `a1863405 fix(cycle17): 🐛 harden review-plan-fix findings`.
- Failure scenario: future agents or operators cannot distinguish pushed-but-not-deployed from not-pushed work, reschedule already-fixed items, or skip explicit deploy validation for security-sensitive restore/upload changes.
- Suggested fix: move Cycle 17 to a terminal state with commit/push/deploy evidence or explicit deploy gap, and reconcile root `plan/` cycle ledgers with the canonical `.context/plans` lineage.

### AGG-C18-02 - Carry-forward age budget is no longer mechanically checkable

- Severity: Medium
- Confidence: High
- Source findings: `VER-02`
- Citations: `.context/plans/deferred-carry-forward.md:3-7`, `.context/plans/deferred-carry-forward.md:19-29`, `.context/plans/deferred-carry-forward.md:40-124`
- Problem: the carry-forward register still labels ages at `run-10 c4` and stops newer rows around `cycle-7b-2026-07-07`, while repo policy requires High items crossing 8 cycles and Medium items crossing 16 cycles to be mechanically re-reviewed.
- Failure scenario: aged Medium/High deferred items can miss required re-justification or closure decisions because the register underreports current age.
- Suggested fix: refresh the carry-forward table for Cycle 18, remove closed rows, add current open deferred items, and update checkpoint text.

### AGG-C18-03 - Large multipart ingest still materializes request bodies before app-level streaming

- Severity: High
- Confidence: High
- Source findings: `C18-PERF-01`
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:101-180`, `apps/web/src/app/actions/images.ts:184-260`
- Problem: Lightroom upload eventually calls `request.formData()`, and dashboard upload Server Actions receive materialized `FormData`/`File` objects before downstream disk streaming.
- Failure scenario: large admin uploads or concurrent upload/restore operations pin large request bodies in Node memory before app-level streaming and quota checks can relieve pressure.
- Suggested fix: migrate large browser upload and DB restore ingestion to route handlers with streaming multipart parsing and a shared large-ingress semaphore.

### AGG-C18-04 - Semantic search and similar-photo routes still scan embedding blobs per request

- Severity: High
- Confidence: High
- Source findings: `C18-PERF-02`
- Citations: `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`
- Problem: public semantic/similar routes fetch up to `SEMANTIC_SCAN_LIMIT` embedding blobs from MySQL and rank them in Node for every request.
- Failure scenario: multiple users or crawlers can contend with public traffic, DB pool usage, Sharp work, and CLIP inference by triggering repeated O(scan limit) vector scans.
- Suggested fix: move nearest-neighbor lookup to an indexed/vector service or shared in-process matrix/worker with refresh contracts; at minimum add concurrency and result caching with invalidation.

### AGG-C18-05 - Public map page still renders up to 10k Leaflet markers client-side

- Severity: Medium
- Confidence: High
- Source findings: `C18-PERF-03`
- Citations: `apps/web/src/lib/data.ts:1775-1816`, `apps/web/src/components/map/map-client.tsx:77-140`
- Problem: `/map` can ship and mount thousands of React Leaflet markers, then allocates latitude/longitude arrays for bounds calculation.
- Failure scenario: large geotagged galleries freeze mobile or older browsers during initial render.
- Suggested fix: use viewport-bounded fetches plus server-side clustering; in the interim compute bounds in one loop and lower/progressively load the initial marker budget.

### AGG-C18-06 - Cycle 17 high-risk fixes are mostly pinned by source-shape contracts, not behavior

- Severity: Medium
- Confidence: High
- Source findings: `TEST-01`
- Citations: `apps/web/src/__tests__/cycle-17-source-contracts.test.ts:10-50`, `apps/web/src/__tests__/cycle-17-source-contracts.test.ts:54-77`
- Problem: tests assert strings such as helper names, counter increments, and log messages rather than executing the advisory-lock, LR upload setup-failure, and CLIP skipped-prefix branches.
- Failure scenario: a refactor preserves the asserted string while moving it out of the relevant branch, and the test suite passes despite behavior regressing.
- Suggested fix: add behavior tests with mocked pool connections, upload-directory failures, and CLIP candidate batches.

### AGG-C18-07 - Cycle 17 UI/operator copy acceptance was not browser-verified

- Severity: Medium
- Confidence: High
- Source findings: `TEST-02`
- Citations: `.context/plans/cycle-17-2026-07-08-plan.md:89-120`, `.context/plans/cycle-17-2026-07-08-plan.md:151-158`, `apps/web/src/__tests__/cycle-17-source-contracts.test.ts:80-112`
- Problem: proxy icon routes, token revoke/alias delete confirmation text, and analytics country rendering are verified by source tokens rather than browser flows.
- Failure scenario: a dialog imports the right key but resets selected row state before render, leaving destructive confirmations ambiguous while source tests pass.
- Suggested fix: add narrow Playwright coverage for metadata icon routes, token revoke text, alias delete target text, and analytics country display.

### AGG-C18-08 - E2E browser matrix is Chromium desktop only

- Severity: Medium
- Confidence: High
- Source findings: `TEST-03`
- Citations: `apps/web/playwright.config.ts:72-77`
- Problem: standard Playwright projects include only Desktop Chrome.
- Failure scenario: WebKit/mobile regressions in service worker install, photo swipe/zoom, wide-gamut display detection, or responsive public browsing ship untested.
- Suggested fix: add scheduled or opt-in WebKit mobile and Firefox desktop projects for public browsing/photo/lightbox/service-worker smoke.

### AGG-C18-09 - Admin E2E can pass locally while authenticated flows are skipped

- Severity: Low-Medium
- Confidence: High
- Source findings: `TEST-04`
- Citations: `apps/web/e2e/admin.spec.ts:6-12`, `apps/web/e2e/helpers.ts:28-45`
- Problem: local `npm run test:e2e` can be green without running admin flows unless plaintext admin credentials are configured.
- Failure scenario: token/settings/category UI changes ship after a local green e2e run that skipped the authenticated surfaces.
- Suggested fix: require cycle reports to record admin skip state, and for admin-touching work run `test:e2e:admin` or record the validation gap.

### AGG-C18-10 - PAT `last_used_at` is updated before Lightroom upload route admission gates

- Severity: Low-Medium
- Confidence: High
- Source findings: `TRC18-01`, `ARCH18-01`
- Cross-agent agreement: tracer, architect
- Citations: `apps/web/src/lib/api-auth.ts:72-85`, `apps/web/src/lib/admin-tokens.ts:171-175`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-99`
- Problem: `withAdminAuth` marks scoped token use before route-specific restore-maintenance/admission gates run.
- Failure scenario: a valid Lightroom PAT request during restore maintenance updates `last_used_at` even though the route returns 503 and accepts no upload, confusing incident/token-use evidence.
- Suggested fix: keep the auth wrapper side-effect-light and let token-backed routes mark usage only after their route-specific gates pass, or track rejected authenticated attempts separately.

### AGG-C18-11 - Pipeline-version history is duplicated and stale in the Sharp pipeline module

- Severity: Low
- Confidence: High
- Source findings: `ARCH18-02`
- Citations: `apps/web/src/lib/gallery-config-shared.ts:10-22`, `apps/web/src/lib/process-image.ts:371-397`, `CLAUDE.md:137`
- Problem: the canonical `IMAGE_PIPELINE_VERSION` is 7, but the history block in `process-image.ts` only documents through v6.
- Failure scenario: future encoder work loses the v7 decision chain for byte semantics, backfills, ETags, service worker invalidation, and runbooks.
- Suggested fix: remove the duplicate history or update it to point to the single authoritative ledger in `gallery-config-shared.ts`.

### AGG-C18-12 - Unwired CLIP server action still has skipped-prefix starvation shape

- Severity: Low
- Confidence: High
- Source findings: `DBG-C18-01`
- Citations: `apps/web/src/app/actions/embeddings.ts:89-90`, `apps/web/src/app/actions/embeddings.ts:136-156`, `apps/web/src/app/actions/embeddings.ts:161-202`
- Problem: exported `backfillClipEmbeddings` selects one `SEMANTIC_SCAN_LIMIT` window, skips missing originals without durable progress, and can repeatedly revisit the same skipped prefix if it is ever wired.
- Failure scenario: a future admin UI calls this action and never reaches later valid rows behind missing-original rows.
- Suggested fix: delete/unexport it if unsupported, or port the sidecar keyset cursor/attempt budget and add a skipped-prefix regression.

### AGG-C18-13 - CLIP backfill runbooks describe candidate-row limits instead of embedding-attempt limits

- Severity: Low
- Confidence: High
- Source findings: `DOC-C18-01`
- Citations: `CLAUDE.md:598`, `apps/web/README.md:85`, `apps/web/scripts/backfill-clip-embeddings.ts:157-190`, `apps/web/scripts/backfill-clip-embeddings.ts:199-207`
- Problem: docs say `SEMANTIC_SCAN_LIMIT` caps candidate rows, but the sidecar now advances through skipped/missing-original candidates and caps embedding attempts.
- Failure scenario: an operator expects `SEMANTIC_SCAN_LIMIT` to bound all row scanning/filesystem work, but a corpus with many skipped rows scans more candidates before inference attempts hit the cap.
- Suggested fix: update docs and script header to state the current embedding-attempt budget, or add a separate scanned-candidate cap.

### AGG-C18-14 - CLIP sidecar header still says concurrency can be raised after real ONNX ships

- Severity: Low
- Confidence: High
- Source findings: `DOC-C18-02`
- Citations: `apps/web/scripts/backfill-clip-embeddings.ts:49-50`, `apps/web/scripts/backfill-clip-embeddings.ts:59-60`, `apps/web/scripts/backfill-clip-embeddings.ts:73-75`, `apps/web/scripts/backfill-clip-embeddings.ts:81-85`
- Problem: the executable runbook says operators can raise `BATCH_CONCURRENCY` once real ONNX ships, but production ONNX is already present and concurrency is hardcoded at 2.
- Failure scenario: an operator edits the script directly while tuning production backfill, bypassing tested bounds.
- Suggested fix: document fixed concurrency, or implement a bounded env/CLI knob before advertising adjustability.

### AGG-C18-15 - Mobile home delays first photo behind a tag wall

- Severity: Medium
- Confidence: High
- Source findings: `DES-C18-01`, `UIUX-C18-01`
- Cross-agent agreement: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/components/home-client.tsx:287-330`, `apps/web/src/components/tag-filter.tsx:63-122`
- Problem: the public home page renders the heading and all tag chips before the masonry grid; live mobile evidence showed the tag group at `y=180 h=200` and first photo link at `y=412`.
- Failure scenario: phone visitors first see utility filtering instead of finished photography, and the problem grows with tag count.
- Suggested fix: show compact active-filter state above the grid and move the full tag list into a disclosure, sheet, or horizontal overflow rail on mobile.

### AGG-C18-16 - Admin image management remains table-first instead of a photo workbench

- Severity: Medium
- Confidence: High
- Source findings: `DES-C18-02`, `UIUX-C18-02`
- Cross-agent agreement: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`, `apps/web/src/components/image-manager.tsx:427-591`
- Problem: the admin dashboard uses a horizontally scrollable table with a small fixed preview, separated metadata/tags, and far-right actions.
- Failure scenario: admins on smaller screens can lose row context while editing tags/actions for visually similar photos.
- Suggested fix: add a responsive card/list workbench for non-wide desktop, keeping the dense table as the desktop compact mode.

### AGG-C18-17 - Admin navigation is one flat wrapping strip for unrelated workflows

- Severity: Low-Medium
- Confidence: High
- Source findings: `DES-C18-03`, `UIUX-C18-03`
- Cross-agent agreement: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/components/admin-nav.tsx:15-49`, `apps/web/src/components/admin-header.tsx:13-26`
- Problem: publishing, taxonomy, site settings, access/security, DB operations, and analytics are peer links in one wrapping nav row.
- Failure scenario: viewport width and translation length shift link positions, while high-risk operations appear visually equivalent to daily publishing tasks.
- Suggested fix: group navigation into stable sections and expose a drawer/sectioned menu on tablet/mobile.

### AGG-C18-18 - Live deployment/operator state remains outside static repo proof

- Severity: Low
- Confidence: High
- Source findings: `DBG-C18-MV-01`, `DOC-C18-MV-01`, `VER-03`
- Citations: `README.md:48`, `apps/web/README.md:80-88`, `CLAUDE.md:509-521`, `CLAUDE.md:553-631`, `apps/web/nginx/default.conf:59-71`
- Problem: repository code/docs cannot prove current production deploy state, nginx/proxy configuration, CLIP weights, DB mode row, or runtime env.
- Failure scenario: reports state that semantic search/proxy/deploy behavior is live from repo state alone while the deployed host differs.
- Suggested fix: keep requiring concrete deploy transcripts, health smokes, CLIP preflight, semantic/similar smoke when enabled, and proxy topology checks in completion ledgers.

### AGG-C18-19 - README "Live Demo" can be mistaken for source-default behavior

- Severity: Low
- Confidence: Medium
- Source findings: `PM-C18-RISK-01`
- Citations: `README.md:21-24`
- Problem: the demo link points to a live Atik deployment that may contain deployment-specific content/config.
- Failure scenario: an operator assumes the demo's dataset, branding, semantic-search state, or analytics reflects a fresh install.
- Suggested fix: rename it to "Example deployment" or add a short caveat near the link.

### AGG-C18-20 - "Photographer-grade color management" remains a subjective superlative

- Severity: Low
- Confidence: Medium
- Source findings: `PM-C18-RISK-02`
- Citations: `README.md:42-44`, `README.md:29`, `README.md:48`, `CLAUDE.md` Color & HDR Pipeline
- Problem: the implementation is qualified elsewhere, but the phrase can read like a reference-color or public-HDR guarantee.
- Failure scenario: a photographer expects end-to-end public HDR/reference delivery, then learns HDR ingest is gated and public derivatives remain SDR.
- Suggested fix: soften the heading to "Photographer-oriented color pipeline" or add an inline browser/codec/HDR caveat.

### AGG-C18-21 - Authenticated admin responsive behavior needs credentialed browser validation

- Severity: Low-Medium
- Confidence: Medium
- Source findings: `UIUX-C18-RISK-01`
- Citations: `apps/web/src/app/[locale]/admin/(protected)`, `apps/web/src/components/image-manager.tsx`
- Problem: protected admin pages could not be fully browsed locally without DB/admin credentials, leaving responsive/accessibility behavior unproven at runtime.
- Failure scenario: settings, DB restore, token, or analytics responsive defects are missed by source review.
- Suggested fix: run credentialed admin Playwright/browser snapshots for dashboard, settings, DB, tokens, and analytics when admin UI changes.

### AGG-C18-22 - RTL is structurally signaled but not supported as a product surface

- Severity: Low
- Confidence: Medium
- Source findings: `UIUX-C18-RISK-02`
- Citations: `apps/web/src/app/[locale]/layout.tsx`, physical left/right classes across nav/lightbox/admin components
- Problem: only EN/KO ship today, but adding an RTL locale would require a dedicated pass over physical positioning, chevrons, row/table alignment, and focus order.
- Failure scenario: Arabic/Hebrew is added to locale config and `dir="rtl"` changes text flow while controls remain LTR.
- Suggested fix: declare RTL unsupported until an RTL Playwright matrix exists, or replace physical positioning with logical utilities/mirrored icons before adding an RTL locale.

## Refuted / Clean Areas

- `code-reviewer` found no new code-quality findings after checking auth/session/PAT wrappers, server-action origin guards, public route rate-limit contracts, upload/LR ingest, backup/restore, image queue, restore fences, privacy selectors, migrations, service worker parity, deploy scripts, and relevant tests.
- Fresh static guard checks passed in review lanes: `lint:api-auth`, `lint:action-origin`, and `lint:public-route-rate-limit`.
- Prior Cycle 17 findings for token revoke labels, category alias delete labels, semantic-search Settings copy, and analytics country labels are fixed in current source and were not reopened.
