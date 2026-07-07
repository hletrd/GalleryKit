# Review Aggregate - Run 10 Cycle 6

Date: 2026-07-07
Repo: `/Users/hletrd/flash-shared/gallery`

## Review Lanes

Completed lanes: `code-reviewer`, `perf-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`, `tracer`, `architect`, `debugger`, `document-specialist`, `designer`, `ui-ux-designer-reviewer`, `product-marketer-reviewer`.

Agent/tooling notes: native subagent concurrency was limited, so the fan-out ran in capacity-bounded waves. `security-reviewer` and `test-engineer` reported that a commit hook requested an OMX co-author trailer; repo policy forbids co-author trailers, so their review artifacts remained uncommitted during Prompt 1. No reviewer failed after retry.

## Merged Findings

### AGG-C6-01 - Maintenance sweeps can write during restore

- Severity/confidence: Medium / High
- Status: confirmed source defect
- Sources: `CQR6-01`, `TRC6-01`
- Citations: `apps/web/src/lib/maintenance-scheduler.ts:13-36`, `apps/web/src/instrumentation.ts:1-10`, `apps/web/src/app/[locale]/admin/db-actions.ts:538-556`, `apps/web/src/lib/restore-maintenance.ts:21-26`
- Summary: the independent startup/hourly scheduler deletes sessions, rate-limit buckets, audit rows, and view-retention rows without checking restore maintenance and without being drained before restore import.
- Required action: make maintenance restore-aware and drainable, then add regression coverage.

### AGG-C6-02 - Password-change auth mutations bypass the restore mutation barrier

- Severity/confidence: Medium / High
- Status: confirmed source defect
- Sources: `DBG-C6-01`
- Citations: `apps/web/src/app/actions/auth.ts:290-410`, `apps/web/src/lib/admin-mutation-barrier.ts:76-129`, `apps/web/src/app/[locale]/admin/db-actions.ts:538-556`
- Summary: `updatePassword()` checks restore once, then performs Argon2 work and mutates `admin_users`/`sessions` without holding `acquireAdminMutationSlot()`.
- Required action: acquire the admin mutation slot before long auth work and before the transaction; add source/behavior coverage.

### AGG-C6-03 - Dev/build dependency audit fails on nested vulnerable esbuild

- Severity/confidence: Medium / High
- Status: confirmed security issue
- Sources: `SR6-C01`
- Citations: `apps/web/package.json:77`, `package-lock.json:1261-1276`
- Summary: `drizzle-kit@0.31.10` pulls `@esbuild-kit/core-utils -> esbuild@0.18.20`; `npm audit --workspace=apps/web --audit-level=moderate` fails.
- Required action: upgrade/override without breaking Drizzle tooling; verify `npm audit` and `npm ls esbuild`.

### AGG-C6-04 - Nginx template hardcodes the demo domain

- Severity/confidence: Medium / High
- Status: confirmed operational/product defect
- Sources: `CRIT-C6-01`, `ARCH-C6-02`, `PM-C6-02`
- Citations: `apps/web/nginx/default.conf:46-49`, `README.md:48`, `apps/web/README.md:55-56`, `.context/plans/deferred-carry-forward.md:41`
- Summary: the checked-in self-hosting nginx template binds to `gallery.atik.kr`, creating a footgun for copied deployments.
- Required action: replace the active demo host with a host-neutral or templated value and add a source-contract test.

### AGG-C6-05 - SEO locale and site-config docs are split across code, UI, and docs

- Severity/confidence: Low-Medium / High
- Status: confirmed product/docs contract defect
- Sources: `CRIT-C6-02`, `ARCH-C6-01`, `DOC-C6-01`, `DOC-C6-02`, `PM-C6-01`
- Citations: `README.md:50-68`, `CLAUDE.md:148`, `CLAUDE.md:704-713`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:151-161`, `apps/web/src/lib/data.ts:1827-1834`, `apps/web/src/lib/locale-path.ts:63-74`, `apps/web/src/app/[locale]/layout.tsx:17-20`
- Summary: README says runtime SEO fields include locale; CLAUDE says locale is not DB-overridable; `seo_locale` is really an OpenGraph fallback while route locale wins for normal pages. README also makes build-time JSON fields sound live-editable.
- Required action: align README/CLAUDE/admin copy around runtime DB SEO fields versus build-time JSON fields.

### AGG-C6-06 - Product copy overstates self-service semantics for semantic search and teams

- Severity/confidence: Low-Medium / High
- Status: confirmed product expectation issue
- Sources: `PM-C6-03`, `PM-C6-04`
- Citations: `README.md:29`, `README.md:42-44`, `CLAUDE.md:5`, `CLAUDE.md:239`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:824-842`
- Summary: semantic search is real but operator-runbook-only for production mode, and "small teams" can imply assistant/client roles although all accounts are full root admins.
- Required action: clarify README audience and capability wording.

### AGG-C6-07 - Desktop click-to-zoom is blocked by ImageZoom's own role guard

- Severity/confidence: High / High
- Status: confirmed UI defect
- Sources: `UXR-C6-01`
- Citations: `apps/web/src/components/image-zoom.tsx:180-200`, `apps/web/src/components/image-zoom.tsx:355-380`, `apps/web/src/components/photo-viewer.tsx:693-730`
- Summary: `handleClick()` ignores clicks when `target.closest('[role="button"]')` matches the zoom container itself, so the advertised pointer interaction does nothing.
- Required action: guard only nested interactive descendants and add regression coverage.

### AGG-C6-08 - Auto-lightbox state reads sessionStorage during first render

- Severity/confidence: Medium / High
- Status: confirmed hydration/source defect
- Sources: `UXR-C6-02`
- Citations: `apps/web/src/components/photo-viewer.tsx:76-82`, `apps/web/src/components/photo-viewer.tsx:566`, `apps/web/src/components/photo-viewer.tsx:1013-1032`, `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx:7-18`
- Summary: `showLightbox` initializes from `sessionStorage`, so client first render can diverge from server HTML.
- Required action: initialize deterministically and consume the flag after mount; audit the loading fallback.

### AGG-C6-09 - Smart collections remain public-readable but not admin-operable

- Severity/confidence: Medium / High
- Status: already tracked carry-forward, still open
- Sources: `DES-C6-D1`, `UXR-C6-03`
- Citations: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-164`, `apps/web/src/app/actions/collections.ts:16-150`, `apps/web/src/components/admin-nav.tsx:15-25`, `CLAUDE.md:162`
- Summary: public route and hardened actions exist, but admins still cannot author collections through UI.
- Disposition: deferred carry-forward unless this cycle explicitly builds the admin workflow.

### AGG-C6-10 - Archive/date queries remain non-sargable

- Severity/confidence: Low today, Medium at larger scale / High
- Status: performance issue
- Sources: `PERF-C6-01`
- Citations: `apps/web/src/lib/data-timeline.ts:88-116`, `apps/web/src/lib/data-timeline.ts:125-207`
- Summary: `YEAR()`, `MONTH()`, and `DAY()` predicates limit index use on uncached archive/home renders.
- Disposition: deferred performance/schema work.

### AGG-C6-11 - Public text search uses leading-wildcard LIKE scans

- Severity/confidence: Low today, Medium at larger scale / Medium-High
- Status: performance issue
- Sources: `PERF-C6-02`
- Citations: `apps/web/src/app/actions/public.ts:248-329`, `apps/web/src/lib/data.ts:1573-1704`
- Summary: `%term%` metadata/tag/topic branches can scan heavily despite rate limits and response caps.
- Disposition: deferred search-index work.

### AGG-C6-12 - Cached images can wait on HEAD revalidation before paint

- Severity/confidence: Low / Medium
- Status: performance issue
- Sources: `PERF-C6-03`
- Citations: `apps/web/public/sw.template.js:376-430`, `apps/web/src/lib/serve-upload.ts:42-106`
- Summary: stale image responses can wait up to 300 ms on conditional `HEAD` before returning cached bytes.
- Disposition: deferred service-worker performance work.

### AGG-C6-13 - CSP allows inline styles in production

- Severity/confidence: Low / Medium
- Status: likely security hardening issue
- Sources: `SR6-L01`
- Citations: `apps/web/src/lib/content-security-policy.ts:138-155`
- Summary: production `style-src` includes `'unsafe-inline'`; script policy is stricter.
- Disposition: deferred hardening unless browser compatibility work proves removal safe.

### AGG-C6-14 - Deployment/operator validation risks remain

- Severity/confidence: Medium evidence risks / Medium-High
- Status: manual validation
- Sources: `SR6-M01`, `SR6-M02`, `SR6-M03`, `SR6-M04`, `CRIT-RISK-C6-01`, `ARCH-C6-R1`, `VER-C6-R2`
- Citations: `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:46-69`, `apps/web/docker-compose.yml:15-22`, `CLAUDE.md:483-495`, `scripts/deploy-remote.sh:55-93`, `apps/web/deploy.sh:51-104`
- Summary: TLS edge, proxy trust/IP attribution, historical secret rotation, plaintext backup handling, and live nginx limiter application need operator evidence.
- Disposition: deferred/manual validation; do not claim closed on source commits alone.

### AGG-C6-15 - Storage abstraction remains a local-only product-boundary trap

- Severity/confidence: Low-Medium / High
- Status: architectural carry-forward
- Sources: `CRIT-RISK-C6-02`, `ARCH-C6-R2`
- Citations: `CLAUDE.md:150`, `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/storage/types.ts`, `.context/plans/deferred-carry-forward.md:75`
- Summary: storage interfaces exist while upload/processing/serving/backup remain local-filesystem only.
- Disposition: deferred product decision.

### AGG-C6-16 - Restore/import and upload-stream edge coverage gaps

- Severity/confidence: Low to Medium / Medium
- Status: likely issue and validation risk
- Sources: `DBG-C6-02`, `DBG-C6-03`, `CQR6-RISK-03`
- Citations: `apps/web/src/lib/serve-upload.ts:330-366`, `apps/web/src/app/[locale]/admin/db-actions.ts:42-80`, `apps/web/src/app/[locale]/admin/db-actions.ts:760-848`
- Summary: upload abort listener cleanup is likely harmless but unclean; restore child-process failure paths are mostly source-shape tested.
- Disposition: defer listener cleanup and broader restore harness after core restore barriers are fixed.

### AGG-C6-17 - Test/e2e/coverage gaps remain

- Severity/confidence: Low to Medium / High
- Status: test coverage findings
- Sources: `TE-C6-01` through `TE-C6-06`, `VER-C6-R1`, `DES-C6-M1`
- Citations: `apps/web/package.json:13-27`, `apps/web/vitest.config.ts:16-39`, `apps/web/e2e/public.spec.ts:4-153`, `apps/web/scripts/seed-e2e.ts:36-267`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-609`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-280`, `apps/web/e2e/nav-visual-check.spec.ts:58-85`, `apps/web/e2e/origin-guard.spec.ts:27-73`
- Summary: no coverage thresholds, missing positive public route e2e flows, missing real LR PAT upload integration, token UI interaction gaps, visual screenshots not compared, CLIP teardown flake risk, and authenticated origin-guard/data-backed browser flows need configured environments.
- Disposition: deferred test-infra/e2e work except targeted tests required for this cycle's fixes.

### AGG-C6-18 - CLIP and analytics validation risks remain

- Severity/confidence: Low-Medium to Medium / Medium-High
- Status: manual validation / design risk
- Sources: `CQR6-RISK-01`, `CQR6-RISK-02`, `TE-C6-06`
- Citations: `apps/web/src/lib/background-db-writes.ts:42-75`, `apps/web/src/app/actions/public.ts:436-525`, `apps/web/src/lib/clip-model.ts:200-229`, `apps/web/src/__tests__/clip-offline-load.test.ts:23-65`
- Summary: admitted analytics writes can be dropped at queue capacity by design; real CLIP model activation remains opt-in/manual and carries native teardown flake risk.
- Disposition: deferred/manual validation.

### AGG-C6-19 - UI performance, data-backed browser, and future RTL evidence gaps remain

- Severity/confidence: Low to Medium / Medium-High
- Status: manual validation
- Sources: `DES-C6-M1`, `DES-C6-M2`, `DES-C6-M3`
- Citations: `apps/web/src/app/[locale]/layout.tsx:103-109`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/masonry-card.tsx`, `apps/web/src/components/photo-viewer.tsx`
- Summary: local DB outage prevented live data-backed UI review; Web Vitals and future RTL layout need representative validation.
- Disposition: deferred/manual validation.

## Prompt 2 Handoff

Schedule AGG-C6-01 through AGG-C6-08 for this cycle because they are correctness, security, operator-template, product-contract, or high-impact user-facing defects that are narrow enough to fix now. Record AGG-C6-09 through AGG-C6-19 in the plan directory as deferred/manual work with original severity/confidence and exit criteria.
