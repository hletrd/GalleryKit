# Cycle 96/100 Deferred Findings

Deferred items preserve the original severity/confidence. Repo policy still applies when these are picked up: GPG-signed conventional commits with gitmoji, no `--no-verify`, required gates, and deploy after pushed `master` commits.

The cycle hard constraint was to implement only safe, narrow fixes. Broad schema migrations, cross-action concurrency barriers, route/E2E coverage expansions, deploy-template policy decisions, and responsive redesign work are therefore recorded here with exit criteria instead of being silently dropped.

## Newly Deferred Cycle 96 Findings

### C96-04 - Atom feed routes bypass restore-maintenance behavior and can cache partial restore data

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/architect.md:91`, `.context/reviews/cycle-96-2026-07-01/tracer.md:28`, `apps/web/src/app/feed.xml/route.ts:36`, `apps/web/src/app/[topic]/feed.xml/route.ts:36`.
- Reason for deferral: Requires route/cache product policy and route-level tests for feed maintenance behavior; not safe to change cache semantics without targeted coverage.
- Exit criterion: Feed routes return a tested no-store maintenance response or an explicitly approved restore-safe feed policy while preserving conditional ETag behavior after restore.

### C96-07 - Shipped nginx template hardcodes the demo domain

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/product-marketer-reviewer.md:101`.
- Reason for deferral: Requires deploy-template policy and docs review; changing nginx templates can affect production deploy assumptions.
- Exit criterion: NGINX template uses documented configurable hostnames or clearly documents demo-domain-only behavior, with deploy docs updated.

### C96-08 - i18n copy overstates localized SEO/brand content

- Original severity/confidence: Low-Medium / Medium.
- Citations: `.context/reviews/cycle-96-2026-07-01/product-marketer-reviewer.md:133`.
- Reason for deferral: Product policy decision: either document global SEO/branding or add per-locale settings; not a narrow code fix.
- Exit criterion: Product docs/UI copy accurately describe global-vs-localized SEO/branding, or per-locale SEO/footer settings ship with tests.

### C96-09 - SEO settings form has toast-only validation despite field-specific server errors

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/ui-ux-designer-reviewer.md:39`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:39`, `apps/web/src/app/actions/seo.ts:78`.
- Reason for deferral: Requires structured field-error return contract or translation-to-field mapping across the SEO form.
- Exit criterion: SEO settings render persistent field-level errors with `aria-invalid`, `aria-describedby`, `role="alert"`, and focus-first-invalid behavior.

### C96-10 - Topic/category create and edit dialogs rely on toast-only form errors

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/ui-ux-designer-reviewer.md:68`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90`, `topic-manager.tsx:204`, `topic-manager.tsx:362`.
- Reason for deferral: Requires a focused admin dialog form-error pass and regression tests.
- Exit criterion: Topic create/edit dialogs show persistent field-level server validation errors and preserve focus/ARIA state after rejection.

### C96-11 - Database restore file-size rejection clears the selected file with only a toast

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/ui-ux-designer-reviewer.md:95`.
- Reason for deferral: Restore form UX changes need careful validation around destructive restore workflows.
- Exit criterion: Oversized restore files leave a persistent inline error and clear or preserve selection according to an explicit, tested UX decision.

### C96-12 - Mobile admin photo toolbar can overflow when Share is available

- Original severity/confidence: Medium / Medium.
- Citations: `.context/reviews/cycle-96-2026-07-01/ui-ux-designer-reviewer.md:122`.
- Reason for deferral: Requires responsive toolbar design and browser verification; local browser startup was blocked in this review lane.
- Exit criterion: Mobile toolbar wraps/collapses without horizontal overflow with Share enabled, verified by Playwright or browser screenshot/accessibility evidence.

### C96-13 - Color metadata lacks semantic `<dl>` structure

- Original severity/confidence: Low / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/ui-ux-designer-reviewer.md:151`, `apps/web/src/components/color-details-section.tsx:346`.
- Reason for deferral: Low severity component semantics pass; not required for the narrow fixes scheduled this cycle.
- Exit criterion: Color detail term/value groups render as semantic `<dl>/<dt>/<dd>` without visual regression.

### C96-14 - Zoomed mobile photo panning can accidentally trigger previous/next navigation

- Original severity/confidence: Medium / Medium-High.
- Citations: `.context/reviews/cycle-96-2026-07-01/designer.md:32`, `apps/web/src/components/photo-viewer.tsx:667`, `apps/web/src/components/photo-navigation.tsx:72`, `apps/web/src/components/image-zoom.tsx:232`.
- Reason for deferral: Coupled with existing zoom keyboard-panning redesign and needs touch/browser validation.
- Exit criterion: Photo navigation disables or ignores swipes while zoomed/panning, with tests or browser evidence proving no accidental navigation.

### C96-15 - CLIP backfill sidecar/runbook examples are stale

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/document-specialist.md:29`.
- Reason for deferral: Requires operator command verification against the deploy host sidecar pattern; cycle explicitly forbids network/NFS/deploy-host repair outside deploy.
- Exit criterion: CLIP backfill command is verified in a non-production sidecar or documented dry-run and runbook is updated.

### C96-16 - CLIP manifest pointer comment is stale

- Original severity/confidence: Low-Medium / Medium.
- Citations: `.context/reviews/cycle-96-2026-07-01/document-specialist.md:38`.
- Reason for deferral: Should be handled with the CLIP runbook sweep to avoid piecemeal stale docs.
- Exit criterion: CLIP manifest/path comments and docs agree with current scripts and model-root contract.

### C96-17 - Color backfill runbook predicate is stale relative to current script behavior

- Original severity/confidence: Medium / Medium.
- Citations: `.context/reviews/cycle-96-2026-07-01/document-specialist.md:55`, `apps/web/scripts/backfill-color-pipeline.ts`.
- Reason for deferral: Requires operator-facing runbook verification and possibly sample SQL/predicate validation.
- Exit criterion: Backfill runbook predicate matches current candidate selection and retry/force-reencode behavior, with a source-contract test or documented verification.

## Carry-Forward Deferred Findings Reaffirmed In Cycle 96

### C94-04 / C93-05 - Lightroom upload API lacks route-level behavior coverage

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/critic.md:47`, `apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1`.
- Reason for deferral: Requires a route-level multipart test harness and broad branch coverage.
- Exit criterion: Mocked route tests cover auth/scope rejection, maintenance `503`, content-length branches, over-limit branches, success shape, and cleanup after failures.

### C94-05 / C93-06 - Admin Playwright coverage omits first-class pages

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/critic.md:55`, `apps/web/src/components/admin-nav.tsx:15`, `apps/web/e2e/admin.spec.ts:20`.
- Reason for deferral: Requires authenticated e2e fixture expansion.
- Exit criterion: Playwright covers every `AdminNav` destination with one stable landmark/control assertion per page.

### C94-06 / C93-09 - Zoomed photos are not keyboard-pannable

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/code-reviewer.md:54`, `apps/web/src/components/image-zoom.tsx:197`, `apps/web/src/components/lightbox.tsx:328`.
- Reason for deferral: Requires zoom interaction redesign across keyboard and lightbox navigation.
- Exit criterion: Zoomed image focus supports keyboard pan/reset and prevents conflicting slide navigation, with accessibility tests.

### C94-07 / C93-10 - Mobile admin navigation remains a wrapped multi-link header

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/designer.md:119`, `apps/web/src/components/admin-nav.tsx:15`.
- Reason for deferral: Requires responsive navigation design and browser validation.
- Exit criterion: Mobile admin nav uses an accessible compact pattern with `aria-current`, focus restoration, and no wrapped link cloud.

### C94-08 / C93-11 - Admin image management remains desktop-table-first on mobile

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/designer.md:140`, `apps/web/src/components/image-manager.tsx:424`.
- Reason for deferral: Requires a mobile card/list layout and interaction testing.
- Exit criterion: Mobile admin image management exposes labeled fields/actions without horizontal table scrolling.

### C94-09 / C77-ARCH-01 - Restore maintenance does not fence already-in-flight foreground admin mutations

- Original severity/confidence: High / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/security-reviewer.md:34`, `apps/web/src/app/[locale]/admin/db-actions.ts:365`, `apps/web/src/app/actions/settings.ts:41`, `apps/web/src/app/actions/tags.ts:42`, `apps/web/src/app/actions/sharing.ts:91`.
- Reason for deferral: Broad correctness/integrity work requiring a shared foreground write barrier across many mutating actions. No repo rule explicitly allows deferring correctness issues; this remains deferred only because the cycle hard constraint limits implementation to safe narrow fixes.
- Exit criterion: Restore owns a foreground write barrier/advisory lock that prevents mutations passing an old precheck from writing during restore, with representative race tests.

### C94-10 / C88-03 - `image_embeddings` cannot retain/stage multiple model versions per image

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/code-reviewer.md:36`, `apps/web/src/db/schema.ts:284`, `apps/web/drizzle/0012_image_embeddings.sql:5`, `apps/web/src/lib/image-queue.ts:352`.
- Reason for deferral: Requires schema migration, Drizzle metadata, reconcile updates, route/query/backfill changes, and tests.
- Exit criterion: Embeddings store one row per `(image_id, model_version)` and inactive model rows survive rollout/rollback until explicit GC.

### C94-11 - First-page public listings force exact `COUNT(*) OVER()` through grouped tag joins

- Original severity/confidence: Medium / High.
- Citations: `.context/reviews/cycle-96-2026-07-01/code-reviewer.md:45`, `apps/web/src/lib/data.ts:898`, `apps/web/src/lib/data.ts:1495`, `apps/web/src/components/home-client.tsx:267`.
- Reason for deferral: Requires product count policy and query/source-contract changes across listing paths.
- Exit criterion: Initial public listings avoid grouped `COUNT(*) OVER()` or intentionally preserve exact counts with measured/cached performance evidence.

## Manual-Only Risks Preserved

- Sidecar color backfill queues all candidates before draining: Medium / High; reopen when galleries exceed current personal-gallery scale or when runbook verification starts.
- Semantic/similar vector scan limits, public leading-wildcard search, map marker count, timeline predicates, and shutdown drain budget: preserve as performance validation risks until load/EXPLAIN/browser evidence is gathered.
- Unit coverage instrumentation and broader browser matrix remain testing-strategy risks.
- Dependency advisory status remains unvalidated until `npm audit` can run on a networked CI/workstation.
- Single-instance deployment assumption remains an operational invariant per `CLAUDE.md`.
