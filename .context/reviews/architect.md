# Architect Review — PROMPT 1 / Cycle 4

## Scope / inventory inspected
Reviewed architecture-relevant repo surfaces across docs/config (`README.md`, `CLAUDE.md`, package files, Docker/compose/nginx/Next config), app/runtime routes, admin/public pages, actions (`auth`, `images`, `sharing`, `topics`, `tags`, `settings`, `seo`, `admin-users`, DB actions), core libs (`data`, `session`, `request-origin`, `action-guards`, `rate-limit`, `auth-rate-limit`, `restore-maintenance`, `image-queue`, `process-image`, `process-topic-image`, `gallery-config*`, `upload-tracker*`, `upload-paths`, `serve-upload`, `storage/*`, `revalidation`, `audit`, `api-auth`, `validation`, `image-url`, `locale-path`, `photo-title`), DB schema/index, selected UI wiring, and build/init scripts.

## Summary
The repo is coherent for its intended single-node self-hosted deployment, but core behavior still depends on process-local state, undeclared write-once settings, and split configuration sources. Long-horizon risks are runtime coordination, durable job failure modeling, and root-equivalent admin accounts.

## Findings

### ARC-C4-01 — Process-local coordination is a hard runtime dependency, but only documented — not enforced
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed risk
- **Evidence:** `README.md:142-144`, `CLAUDE.md:157-159`, `apps/web/src/lib/restore-maintenance.ts:1-55`, `apps/web/src/lib/upload-tracker-state.ts:7-21,52-61`, `apps/web/src/lib/image-queue.ts:67-130`, `apps/web/src/lib/data.ts:11-41,48-108`
- **Failure scenario:** A second web instance or rolling deploy lets one node continue accepting writes during restore; upload quotas diverge; buffered view counts are lost; queue visibility becomes instance-dependent.
- **Suggested fix:** Enforce single-instance mode in startup/ops or move restore state, upload quotas, queue bookkeeping, and view-count buffering into shared coordination.

### ARC-C4-02 — Upload pipeline has no durable failed-job state or operator recovery path
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed risk
- **Evidence:** `apps/web/src/app/actions/images.ts:216-239`, `apps/web/src/lib/image-queue.ts:196-223,305-318,381-428`, `apps/web/src/components/image-manager.tsx:372-385`
- **Failure scenario:** A malformed or transiently failing image leaves `processed=false`; admin sees an indefinite spinner until restart/manual cleanup.
- **Suggested fix:** Add durable processing status/error/retry fields and an admin retry/dead-letter path.

### ARC-C4-03 — Storage layer is split between dormant abstraction and real filesystem pipeline
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed risk
- **Evidence:** `apps/web/src/lib/storage/index.ts:4-12`, `apps/web/src/lib/process-image.ts:12-13,242-247,362-444`, `apps/web/src/lib/serve-upload.ts:63-103`, `apps/web/src/lib/upload-paths.ts:11-46`
- **Failure scenario:** Future object-storage work partially lands and creates split-brain behavior between abstraction users and actual local-disk upload/serve paths.
- **Suggested fix:** Delete unused abstraction or route all upload/process/serve/delete paths through one backend contract.

### ARC-C4-04 — Configuration is fragmented across JSON, env, DB, and build-time Next config
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed risk
- **Evidence:** `apps/web/src/app/[locale]/layout.tsx:15-48,107-117`, `apps/web/src/lib/data.ts:870-894`, `apps/web/src/lib/constants.ts:6-14`, `apps/web/next.config.ts:6-43,89-118`
- **Failure scenario:** Operators change site settings in one place while metadata, analytics, canonical URLs, and image/CSP behavior come from different layers with different rebuild/reload semantics.
- **Suggested fix:** Define runtime-admin-editable, runtime-env-only, and build-time-only boundaries in code/docs; consolidate brand/site config or deliberately keep it deploy-time-only.

### ARC-C4-05 — Production semantic config is not validated; placeholder localhost config can ship
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed risk
- **Evidence:** `apps/web/src/site-config.json:1-11`, `apps/web/scripts/ensure-site-config.mjs:4-8`, `apps/web/src/app/sitemap.ts:13-18`, `apps/web/src/lib/data.ts:883-890`
- **Failure scenario:** Production build passes but canonical URLs/sitemap/OG point to `http://localhost:3000`.
- **Suggested fix:** Fail production builds on placeholder origins or require validated `BASE_URL` in production.

### ARC-C4-06 — Admin model has no capability boundaries: every admin is super-admin
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed risk
- **Evidence:** `README.md:31-39`, `CLAUDE.md:157-159`, `apps/web/src/app/actions/admin-users.ts:69-77,193-205`, `apps/web/src/app/actions/settings.ts:38-46`, `apps/web/src/app/[locale]/admin/db-actions.ts:33-45,102-113,245-253`
- **Failure scenario:** Any helper/editor account can create admins, change settings, export/restore DB backups, and perform destructive operations.
- **Suggested fix:** Introduce minimal roles/capabilities before broadening admin delegation.

### ARC-C4-07 — Settings expose mutable controls for values effectively write-once after first image
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed risk
- **Evidence:** `apps/web/src/app/actions/settings.ts:79-109,112-130`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:89-178`
- **Failure scenario:** Operators cannot adjust responsive sizes or GPS stripping after launch without emptying the gallery/manual surgery, but the UI presents normal editable controls.
- **Suggested fix:** Move these to install-time config or add versioned reprocessing/migration support.

## Architectural status
WATCH

## Missed-issues sweep / skipped
Checked public/private data boundaries, admin API auth wrapping, action-origin gates, queue/bootstrap/typecheck regressions; no additional repo-wide architectural breaks found. Skipped generated/noise-heavy artifacts, most test bodies, UI primitives, migration snapshots, and translations except where relevant.
