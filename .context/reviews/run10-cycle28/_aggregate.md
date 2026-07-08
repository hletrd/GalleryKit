# Run-10 Cycle 28/100 Aggregate Review

Date: 2026-07-08 KST
Review start HEAD: `8753b939a780984b2c988fb6b75ed23ebad98ec9`

## Review Lanes

- `code-architect-debugger-tracer.md` - no new non-duplicative code/architecture/debug findings.
- `security-reviewer.md` - no confirmed security defect; one proxy-topology manual-validation risk.
- `perf-reviewer.md` - one current performance finding.
- `test-verifier.md` - four current test/gate coverage findings.
- `docs-critic.md` - one current release-ledger finding.
- `designer.md` - one current accessibility/landmark finding.

## Findings

### AGG-C28-01 - Grid thumbnails use base JPEG as normal JPEG fallback

Severity: Medium
Confidence: High
Source: `C28-PERF-01`
Cross-agent agreement: performance reviewer.

Citation:

- `apps/web/src/components/grid-picture.tsx:31-49`
- `apps/web/src/components/masonry-card.tsx:89-115`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:257-278`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:216-237`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:220-241`
- Existing safer precedent: `apps/web/src/lib/image-url.ts:72-95`

Problem: AVIF/WebP sources use grid-sized derivatives, but the `<img>` JPEG fallback and delegated fallback source use the base JPEG. JPEG-only clients and fallback paths can download full-size JPEGs for thumbnails.

Failure scenario: A JPEG-only embedded browser loads a masonry first viewport and downloads several multi-megabyte base JPEGs instead of 640/1536 px derivatives, increasing LCP bytes, decode time, and service-worker cache churn.

Disposition: scheduled in Cycle 28.

### AGG-C28-02 - Server-action scanner can miss top-level server-action modules outside approved directories

Severity: High
Confidence: Medium-high
Source: test/verifier finding 1.
Cross-agent agreement: test/verifier.

Citation:

- `apps/web/scripts/check-action-origin.ts:13-22`
- `apps/web/scripts/check-action-origin.ts:92-113`
- `CLAUDE.md:691-704`
- `apps/web/src/__tests__/check-action-origin.test.ts:1039-1087`

Problem: Next accepts top-level `'use server'` modules outside `src/app/actions/`, but the lint gate scans only the approved action directory, `db-actions.ts`, and the compatibility barrel.

Failure scenario: A future admin route adds `src/app/[locale]/admin/(protected)/analytics/actions.ts` with a mutating export. It is a valid server-action module, but current discovery would not inspect it for same-origin or mutation-barrier guards.

Disposition: scheduled in Cycle 28.

### AGG-C28-03 - Public restore-maintenance page ordering is only substring-checked

Severity: Medium
Confidence: High
Source: test/verifier finding 2.
Cross-agent agreement: test/verifier.

Citation:

- `CLAUDE.md:449`
- `CLAUDE.md:462`
- `apps/web/src/__tests__/cycle-28-source-contracts.test.ts:27-44`
- Representative correct source: `apps/web/src/app/[locale]/(public)/page.tsx:155-177`

Problem: The source contract confirms the maintenance guard and component exist, but not that the guard precedes DB-backed reads in default page bodies.

Failure scenario: A refactor moves `getSeoSettings()` above the maintenance branch while leaving a later `<PublicRestoreMaintenance />`; tests pass while restore windows still query the DB before returning maintenance UI.

Disposition: scheduled in Cycle 28.

### AGG-C28-04 - Public `revalidate = 0` freshness contract is not locked by a dedicated test

Severity: Medium
Confidence: High
Source: test/verifier finding 3.
Cross-agent agreement: test/verifier.

Citation:

- `CLAUDE.md:449`
- `CLAUDE.md:462`
- `apps/web/src/app/[locale]/(public)/page.tsx:17-19`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:40-42`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`

Problem: Docs require dynamic freshness for DB-backed public gallery/photo/share/map/timeline pages, but no source contract enumerates those files and fails if `revalidate = 0` is removed.

Failure scenario: ISR returns on a public photo or share page without an invalidation plan; lint/typecheck/unit tests pass while production serves stale state.

Disposition: scheduled in Cycle 28.

### AGG-C28-05 - Authenticated Playwright coverage omits SEO, tokens, and analytics admin pages

Severity: Medium
Confidence: High
Source: test/verifier finding 4.
Cross-agent agreement: test/verifier.

Citation:

- `apps/web/src/components/admin-nav.tsx:15-25`
- `apps/web/e2e/admin.spec.ts:20-43`
- `apps/web/e2e/admin.spec.ts:73-103`

Problem: The authenticated browser smoke does not visit every first-class admin destination.

Failure scenario: `/admin/seo`, `/admin/tokens`, or `/admin/analytics` breaks due to hydration, translations, or a runtime import while unit/source tests still pass.

Disposition: deferred; see Cycle 28 deferred register.

### AGG-C28-06 - Cycle 27 terminal release/deploy ledger is still open

Severity: Medium
Confidence: High
Source: `DOC-CRIT-C28-01`
Cross-agent agreement: docs/critic and local verification.

Citation:

- `.context/plans/run10-cycle27/plan.md:3`
- `.context/plans/run10-cycle27/plan.md:48-70`
- `.context/plans/run10-cycle27/plan.md:78-94`
- `.context/plans/README.md:34-37`

Problem: Cycle 27 was committed and pushed as signed `8753b939`, but its plan still says signed push/deploy/live smoke are pending and the index still treats it as active.

Failure scenario: A later operator cannot tell whether Cycle 27 was deployed, or whether production closure is expected from the next per-cycle deploy.

Disposition: scheduled in Cycle 28.

### AGG-C28-07 - Restore-maintenance component nests a second `<main>` inside layout-owned main landmarks

Severity: Medium
Confidence: High
Source: `DES-C28-01`
Cross-agent agreement: designer.

Citation:

- `apps/web/src/components/public-restore-maintenance.tsx:9-13`
- `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`
- `apps/web/src/app/[locale]/admin/layout.tsx:34-35`
- `apps/web/src/app/[locale]/admin/page.tsx:16-18`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:16-18`

Problem: Layouts already own `<main id="main-content">`, but `PublicRestoreMaintenance` renders another `<main>`, producing nested/duplicate main landmarks during maintenance.

Failure scenario: A keyboard or screen-reader user activates "Skip to content" during restore maintenance and lands on the outer main while landmark navigation exposes another main for the same content.

Disposition: scheduled in Cycle 28.

### AGG-C28-08 - Deployed nginx/proxy rate-limit identity needs manual validation

Severity: Medium
Confidence: Medium
Source: security reviewer manual-validation risk.
Cross-agent agreement: security reviewer.

Citation:

- `apps/web/nginx/default.conf:20-28`
- `apps/web/nginx/default.conf:59-71`

Problem: Edge/app per-IP behavior depends on nginx seeing the true client IP and app `TRUSTED_PROXY_HOPS` matching the actual proxy chain.

Failure scenario: An LB/CDN-fronted deployment without real-IP support can collapse many visitors into one rate-limit identity or weaken abuse attribution.

Disposition: deferred; see Cycle 28 deferred register.

## Not Re-Reported

The following are current but already tracked in Cycle 27 deferred records, so they are not counted as new Cycle 28 findings:

- `AGG-C27-02` restore-action ordering design.
- `AGG-C27-04` restore finalizer behavior-test hardening.
- `AGG-C27-05` prior UI render/e2e hardening.
