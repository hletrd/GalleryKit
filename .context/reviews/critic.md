# Critic Review — Cycle 1 Deep Review

**Recovered from read-only subagent output.**

## Inventory
Reviewed product-bearing repo surface excluding generated/runtime artifacts, including `apps/web/src/**`, `apps/web/e2e/**`, `apps/web/scripts/**`, migrations/messages, root docs/config/deploy files, nginx, and `.github/workflows/quality.yml`. Total reviewed artifact count reported by lane: 263.

## Verification
- `npm run lint --workspace=apps/web`: passed.
- `npm run typecheck --workspace=apps/web`: passed in critic lane.
- `npm run test --workspace=apps/web`: 52 files / 310 tests passed.
- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run build --workspace=apps/web`: passed.
- Playwright E2E was not rerun in critic lane.

## Findings

### CRIT-001 — Sitemap freshness semantics are internally contradictory and unstable
- **Type:** Confirmed issue
- **Severity:** Medium
- **Confidence:** High
- **Files/regions:** `apps/web/src/app/sitemap.ts:4-6`, `apps/web/src/app/sitemap.ts:25-48`
- **Problem:** The route exports both `dynamic = 'force-dynamic'` and `revalidate = 86400`, then emits request-time `new Date()` timestamps.
- **Concrete failure scenario:** Crawlers see changing timestamps for unchanged content and the daily revalidation intent is defeated.
- **Suggested fix:** Pick a cached sitemap with stable timestamps or a truly dynamic sitemap without fake `lastModified` churn.

### CRIT-002 — Custom OG image configuration does not propagate to Twitter cards on home/topic pages
- **Type:** Confirmed issue
- **Severity:** Medium
- **Confidence:** High
- **Files/regions:** `apps/web/src/app/[locale]/(public)/page.tsx:44-61`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:64-92`
- **Problem:** Home/topic metadata omits `twitter.images` when `seo.og_image_url` is configured, unlike photo/share pages.
- **Concrete failure scenario:** Admin expects branded X/Twitter cards but homepage/topic cards lack the custom image.
- **Suggested fix:** Set `twitter.images` on home/topic custom-OG paths and add metadata regression tests.

### CRIT-003 — Top-level Docker positioning over-promises relative to shipped deployment contract
- **Type:** Confirmed issue
- **Severity:** Medium
- **Confidence:** High
- **Files/regions:** `README.md:39`, `apps/web/README.md:31-32`, `apps/web/docker-compose.yml:10-22`
- **Problem:** Marketing says “Docker Ready — standalone output, single-command deployment,” but the compose path assumes Linux host networking, host MySQL, host reverse proxy, and a bind-mounted site config.
- **Concrete failure scenario:** Docker Desktop/macOS/Windows or self-contained-compose users hit deployment friction that contradicts the quick claim.
- **Suggested fix:** Ship a portable compose profile or downgrade/clarify the top-level claim and quick-start constraints.

### CRIT-004 — Filter-page SEO policy is inconsistent between home and topic routes
- **Type:** Likely risk
- **Severity:** Medium
- **Confidence:** Medium
- **Files/regions:** `apps/web/src/app/[locale]/(public)/page.tsx:18-38`, `apps/web/src/app/[locale]/(public)/page.tsx:85-101`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:46-54`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:73-78`
- **Problem:** Homepage filtered URLs can remain crawlable while topic filtered URLs canonicalize to the unfiltered topic despite filter-specific metadata.
- **Concrete failure scenario:** Search indexing behavior becomes inconsistent and difficult to reason about.
- **Suggested fix:** Choose one explicit filtered-page policy (base canonical, noindex, or self-canonical) and test it on both routes.

### CRIT-005 — Restore maintenance mode is process-local, not deployment-global
- **Type:** Likely risk
- **Severity:** Medium
- **Confidence:** Medium
- **Files/regions:** `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/app/[locale]/admin/db-actions.ts:258-305`, `apps/web/src/app/api/health/route.ts:7-16`
- **Problem:** Restore maintenance state is local memory while restore itself is a database-wide operation.
- **Concrete failure scenario:** In multi-process deployments, one process restores while another still accepts writes or reports healthy readiness.
- **Suggested fix:** Move maintenance state to shared coordination or document/enforce single-process restore/deployment constraints.

### CRIT-006 — Admin settings pages fail open to blank forms on initial fetch failure
- **Type:** Confirmed issue
- **Severity:** Low
- **Confidence:** High
- **Files/regions:** `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:6-10`, `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx:6-17`
- **Problem:** Fetch errors are converted to blank/default editors.
- **Concrete failure scenario:** Admin sees a normal-looking editor during DB outage and may overwrite settings unknowingly.
- **Suggested fix:** Render an explicit error/retry state and disable saves until authoritative values load.

## Final sweep
No missing admin auth wrappers, missing same-origin checks, public/private field leak, or failing core gates were found in the critic lane.
