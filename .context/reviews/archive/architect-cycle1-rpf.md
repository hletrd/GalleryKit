# Architecture Review — Cycle 1 RPF

> Note: the architect subagent reported that its session was read-only and returned this artifact content for the orchestrator to save.

## Scope and inventory

Reviewed architecture-relevant files across root deploy/workspace files, app config/deploy files, schema/migrations/runtime scripts, app router/actions/API/proxy/instrumentation, db/lib/storage internals, and stateful client/admin orchestration components. Excluded generated output, binary assets/uploads, and low-level presentational UI primitives.

## Findings

### 1) Restore/queue maintenance is only process-local, so restore exclusivity is not durable
- **Severity:** High
- **Confidence:** High
- **Type:** Confirmed issue
- **Evidence:** `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/app/[locale]/admin/db-actions.ts:245-315`, `apps/web/src/app/api/health/route.ts:7-27`, `apps/web/src/lib/image-queue.ts:104-121`.
- **Failure scenario:** in multi-process/container deployments, one instance enters restore maintenance while other instances still accept writes and queue work.
- **Suggested fix:** move restore state to durable shared coordination (DB row/Redis/filesystem lock) and have all guarded surfaces read it.

### 2) Shared-group view counts are intentionally lossy under crash/outage conditions
- **Severity:** Medium
- **Confidence:** High
- **Type:** Confirmed issue
- **Evidence:** `apps/web/src/lib/data.ts:11-40`, `apps/web/src/lib/data.ts:48-108`, `apps/web/src/lib/data.ts:660-664`, `apps/web/src/instrumentation.ts:17-24`.
- **Failure scenario:** crash, hard kill, deploy restart, or prolonged DB outage loses buffered view increments.
- **Suggested fix:** use immediate atomic DB increments or a durable queue for view-count events if counts matter.

### 3) Container startup is coupled to schema reconciliation, migrations, filesystem migration, and admin bootstrapping
- **Severity:** High
- **Confidence:** High
- **Type:** Confirmed issue
- **Evidence:** `apps/web/Dockerfile:82-86`, `apps/web/scripts/migrate.js:48-85`, `apps/web/scripts/migrate.js:244-257`, `apps/web/scripts/migrate.js:479-539`.
- **Failure scenario:** every replica runs migration/bootstrap on boot; a DB privilege issue or slow DDL prevents the web server from starting.
- **Suggested fix:** split migration/init into a one-off job and keep steady-state web startup server-only.

### 4) The storage abstraction is not the real storage boundary
- **Severity:** Medium
- **Confidence:** High
- **Type:** Confirmed issue
- **Evidence:** `apps/web/src/lib/storage/index.ts:4-12`, `apps/web/src/lib/storage/types.ts:4-9`, `apps/web/src/app/actions/images.ts:7-23`, `apps/web/src/lib/process-image.ts:233-253`, `apps/web/src/lib/process-image.ts:362-460`, `apps/web/src/lib/serve-upload.ts:32-103`.
- **Failure scenario:** a future S3/MinIO backend appears implemented while live upload/process/delete/serve paths still assume local disk.
- **Suggested fix:** delete the abstraction until used, or route all create/read/delete/url-generation through it.

### 5) Configuration ownership is split across DB settings, env vars, and static JSON
- **Severity:** Medium
- **Confidence:** Medium
- **Type:** Likely risk
- **Evidence:** `apps/web/src/lib/data.ts:870-890`, `apps/web/src/app/[locale]/layout.tsx:73-119`, `apps/web/src/components/footer.tsx:27-35`, `apps/web/src/components/nav-client.tsx:45-48`, `apps/web/src/app/robots.ts:1-20`, `apps/web/src/app/sitemap.ts:8-13`.
- **Failure scenario:** admin-updated SEO/branding diverges from footer/home-link/analytics/robots/sitemap until file/env deploy.
- **Suggested fix:** define explicit immutable boot config vs mutable runtime config domains behind centralized accessors.

### 6) Server actions are acting as large orchestration services instead of thin adapters
- **Severity:** Medium
- **Confidence:** High
- **Type:** Confirmed maintainability risk
- **Evidence:** `apps/web/src/app/actions/images.ts:83-342`, `apps/web/src/app/actions/auth.ts:70-239`, `apps/web/src/app/[locale]/admin/db-actions.ts:32-471`.
- **Failure scenario:** upload/auth/restore changes have large rollback and policy-drift blast radius.
- **Suggested fix:** extract application services and keep server actions thin.

## Missed-issues sweep

The architect reviewed i18n routing, error boundaries, upload serving, and background queue shutdown/bootstrap. No additional high-confidence architecture defects were reported beyond the six above.
