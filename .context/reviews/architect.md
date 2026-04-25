# Cycle 5 Architectural Review

> Note: the architect lane completed in a read-only subagent and returned paste-ready content; this file preserves its Cycle 5 findings for provenance.

## Inventory
Reviewed docs/deploy/workspace (`README.md`, `apps/web/README.md`, package files, Docker/compose/deploy/entrypoint), build/runtime config (`next.config.ts`, Drizzle/Playwright/Vitest/TS configs), DB schema/index, core runtime libs (`data`, `gallery-config*`, `process-image`, `image-queue`, `rate-limit`, `auth-rate-limit`, `session`, `restore-maintenance`, `upload-tracker*`, `storage/*`, `serve-upload`, `upload-paths`, `sql-restore-scan`, `db-restore`, `audit`, `mysql-cli-ssl`, `request-origin`, `action-guards`), actions/routes/pages/components, and representative tests.

## Findings

### 1) Process-local coordination is still a hard architectural boundary
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:** `README.md:145`; `apps/web/src/lib/restore-maintenance.ts:1-18,21-27,44-56`; `apps/web/src/lib/upload-tracker-state.ts:7-21,52-60`; `apps/web/src/app/actions/images.ts:122-145,179-185`; `apps/web/src/lib/data.ts:11-26,28-42,48-95`; `apps/web/src/lib/image-queue.ts:67-132`.
- **Failure scenario / tradeoff:** A rolling deploy or accidental scale-out can let one instance enter restore maintenance while another accepts writes; upload quotas become node-local; buffered shared-group view counts can be lost before flush.
- **Suggested fix:** Enforce singleton deployment at runtime or move restore state, upload claims, queue coordination, and buffered counters into shared storage.

### 2) Public live search is architecturally destined for scan-heavy behavior
- **Severity:** Medium
- **Confidence:** High
- **Status:** Likely
- **Evidence:** `apps/web/src/components/search.tsx:83-98`; `apps/web/src/app/actions/public.ts:43-107`; `apps/web/src/lib/data.ts:744-757,775-794,802-820`; `apps/web/src/db/schema.ts:61-66,68-80`; no repo `FULLTEXT`, `MATCH`, or `AGAINST` usage.
- **Failure scenario / tradeoff:** As image count grows, each debounced keystroke becomes multi-table wildcard scans and sorts.
- **Suggested fix:** Move search to MySQL FULLTEXT/search table/external search, or downgrade UX to explicit submit/prefix search with documented corpus caps.

### 3) Runtime configuration is split across JSON, env, and DB-backed key/value settings
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:** `README.md:43-58`; `apps/web/src/lib/data.ts:870-891`; `apps/web/src/app/[locale]/layout.tsx:17-49,109-119`; `apps/web/src/components/nav-client.tsx:51-53`; `apps/web/src/components/footer.tsx:37`; `apps/web/src/app/sitemap.ts:10-14`.
- **Failure scenario / tradeoff:** Admin-updated branding/SEO can diverge from navigation/footer/GA behavior until rebuild or redeploy.
- **Suggested fix:** Define build-time, deploy-time, and runtime-admin-editable config categories and route reads through one config service.

### 4) The storage abstraction is not the real storage architecture yet
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:** `apps/web/src/lib/storage/index.ts:1-12`; `apps/web/src/lib/process-image.ts:12,47-59,224-253`; `apps/web/src/lib/upload-paths.ts:11-46`; `apps/web/src/lib/serve-upload.ts:32-103`; `apps/web/docker-compose.yml:22-24`.
- **Failure scenario / tradeoff:** Future S3/object-storage work can appear implemented through `getStorage()` while actual upload/process/serve paths still bypass it.
- **Suggested fix:** Remove the abstraction until needed or wire upload, derivative generation, deletion, and URL serving through one storage boundary.

### 5) Background retention work is coupled to image-queue bootstrap
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:** `apps/web/src/instrumentation.ts:3-6`; `apps/web/src/lib/image-queue.ts:435-446`; `apps/web/src/lib/audit.ts:42-56`; `apps/web/src/lib/rate-limit.ts:268-275`.
- **Failure scenario / tradeoff:** If image processing moves out of the web node or queue bootstrap fails, session/rate-limit/audit retention silently stops.
- **Suggested fix:** Move retention work into a dedicated maintenance runner or scheduled job.

### 6) DB backup/restore is embedded in the web tier's request path
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:** `apps/web/src/app/[locale]/admin/db-actions.ts:102-235,245-469`; `apps/web/src/lib/db-restore.ts:1-17`; `apps/web/Dockerfile:10-16`; `apps/web/docker-compose.yml:22-24`.
- **Failure scenario / tradeoff:** Large backup/restore operations contend with live request handling; backup locality and CLI availability become hidden runtime requirements.
- **Suggested fix:** Move DB admin operations into a dedicated ops path or clearly gate them as single-node-only maintenance features.

## Final missed-issues sweep
Re-swept config/deploy, image pipeline, public search, admin DB tooling, queue/bootstrap coupling, and large UI surfaces. Large UI files were not elevated as primary architectural issues by themselves.

## Files reviewed
`README.md`, `apps/web/README.md`, package files, build/test/deploy config, `apps/web/src/db/*`, core `apps/web/src/lib/*` infrastructure, main actions/routes/pages/components, and representative tests listed in the returned subagent content.
