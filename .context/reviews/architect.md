# Architect Review — Cycle 3 (2026-04-24)

## Inventory and method

Reviewed the repo’s architecture/design surfaces with emphasis on coupling, layering, boundaries, data flow/state consistency, deployment/runtime assumptions, multi-user/admin model, and storage/queue boundaries.

Primary files inspected:

- Auth/admin boundaries:
  - `apps/web/src/app/actions/auth.ts`
  - `apps/web/src/app/actions/admin-users.ts`
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/src/lib/{action-guards,api-auth,request-origin,session,rate-limit,audit}.ts`
  - `apps/web/src/proxy.ts`
- Data/state/queue/storage:
  - `apps/web/src/db/{schema,index}.ts`
  - `apps/web/src/lib/{data,image-queue,process-image,upload-paths,restore-maintenance,upload-tracker,gallery-config,gallery-config-shared,image-url,validation}.ts`
  - `apps/web/src/lib/storage/{index,local,types}.ts`
- UI/runtime consumers:
  - `apps/web/src/app/[locale]/(public)/**`
  - `apps/web/src/app/[locale]/admin/(protected)/dashboard/{page,dashboard-client}.tsx`
  - `apps/web/src/components/{image-manager,upload-dropzone,home-client}.tsx`
  - `apps/web/src/app/uploads/[...path]/route.ts`
  - `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- Deployment/runtime config:
  - `apps/web/{next.config.ts,Dockerfile,docker-compose.yml}`
  - `apps/web/nginx/default.conf`
  - `README.md`
  - `CLAUDE.md`

Final sweep used targeted searches for:
- `processed: false`, `giving up`, `Symbol.for('gallerykit`, `globalThis`
- `storage`, `switchStorageBackend`, `/uploads/`
- `isAdmin()`, `GET_LOCK`, `TRUST_PROXY`, `network_mode: host`

## Findings summary

| ID | Severity | Confidence | Status | Summary |
|---|---|---|---|---|
| ARC-C3-01 | HIGH | High | confirmed | Image processing has no terminal failure state, so failed jobs fall into silent admin limbo |
| ARC-C3-02 | HIGH | High | risk | Restore/maintenance and queue control are process-local, so scaled deployments are unsafe |
| ARC-C3-03 | MEDIUM | High | confirmed | Upload quota enforcement is process-local and IP-scoped, which conflicts with multi-user admin use |
| ARC-C3-04 | MEDIUM | High | confirmed | Storage is split across an unused abstraction, direct filesystem code, and nginx static serving |
| ARC-C3-05 | MEDIUM | High | confirmed | “Multi-user admin” is a flat super-admin model with no capability boundaries |

---

## Detailed findings

### ARC-C3-01 — Image processing has no terminal failure state, so failed jobs fall into silent admin limbo

- **Severity:** HIGH
- **Confidence:** High
- **Status:** confirmed
- **Files / exact regions:**
  - `apps/web/src/db/schema.ts:16-66` — `images` has only `processed` as lifecycle state; there is no `processing_state`, `processing_error`, or retry metadata
  - `apps/web/src/app/actions/images.ts:248-271` — uploads insert DB rows immediately with `processed: false`
  - `apps/web/src/app/actions/images.ts:321-370` — upload action returns success after enqueue, before derivatives exist
  - `apps/web/src/lib/image-queue.ts:279-312` — queue marks `processed: true` only on success, retries 3 times, then logs and gives up
  - `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:14-18` — admin dashboard explicitly includes unprocessed rows
  - `apps/web/src/components/image-manager.tsx:372-385` — unprocessed rows render only as a spinner/loading placeholder
- **Code region:** upload inserts row → background queue owns completion → queue can permanently stop retrying without persisting failure reason
- **Concrete failure scenario:** a HEIC/RAW upload or a transient disk/runtime issue causes conversion to fail three times. The row remains `processed=false`, the admin UI shows an endless spinner, the public gallery never receives the image, and there is no in-product retry/error path.
- **Suggested fix:** add an explicit processing state machine (`pending`, `processing`, `failed`, `ready`) plus `processing_error`/timestamps; surface failed jobs in admin with retry/delete actions; optionally move failures to a dead-letter table or cleanup policy.

### ARC-C3-02 — Restore/maintenance and queue control are process-local, so scaled deployments are unsafe

- **Severity:** HIGH
- **Confidence:** High
- **Status:** risk
- **Files / exact regions:**
  - `apps/web/src/lib/restore-maintenance.ts:1-55` — restore maintenance is a `globalThis` boolean
  - `apps/web/src/lib/image-queue.ts:110-128` — queue state is a `globalThis` singleton
  - `apps/web/src/lib/image-queue.ts:453-482` — restore pause/resume only touches local queue state
  - `apps/web/src/app/[locale]/admin/db-actions.ts:258-311` — restore acquires DB lock, then uses local maintenance + local queue quiesce/resume
  - `apps/web/src/app/api/health/route.ts:7-16` — readiness reports restore maintenance only from local memory
  - `apps/web/docker-compose.yml:1-22` — shipped deployment is a single `web` service, implying single-instance assumptions
- **Code region:** distributed safety depends on local in-memory flags, while only restore-vs-restore is globally coordinated
- **Concrete failure scenario:** in a two-instance deployment, instance A starts DB restore and enters local maintenance; instance B keeps accepting uploads/admin mutations because its `globalThis` flag is false. B can continue queue work and writes during or immediately after restore, causing restored DB state and filesystem/queue state to diverge.
- **Suggested fix:** either (a) explicitly enforce single-writer/single-instance deployment at runtime, or (b) move restore maintenance / queue-quiesce state into a shared store (DB/Redis) and make health/readiness depend on that shared state.

### ARC-C3-03 — Upload quota enforcement is process-local and IP-scoped, which conflicts with multi-user admin use

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **Files / exact regions:**
  - `apps/web/src/app/actions/images.ts:80-104` — cumulative upload tracker is an in-memory `Map`
  - `apps/web/src/app/actions/images.ts:145-209` — quota key is `uploadIp`; quota is claimed/reconciled per process only
  - `apps/web/src/lib/upload-tracker.ts:12-25` — reconciliation logic mutates local memory only
  - `apps/web/src/lib/rate-limit.ts:61-87` — IP identity depends on proxy config and can collapse to `"unknown"`
  - `apps/web/src/db/schema.ts:106-111` — repo supports multiple admin users, but upload quota is not keyed to admin identity
- **Code region:** upload limiting is not DB-backed/shared and does not use authenticated user identity
- **Concrete failure scenario:** two admins behind the same office NAT share one upload budget and can block each other; after a restart the quota resets; in a multi-instance deployment, alternating requests across instances bypasses the cumulative cap entirely.
- **Suggested fix:** key upload quotas by authenticated admin user ID (optionally combined with IP) and persist them in a shared store; keep the in-memory map only as a fast-path cache.

### ARC-C3-04 — Storage is split across an unused abstraction, direct filesystem code, and nginx static serving

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **Files / exact regions:**
  - `apps/web/src/lib/storage/index.ts:1-18` — storage abstraction explicitly says it is not wired into the live pipeline
  - `apps/web/src/lib/storage/index.ts:52-128` — backend switching exists only for explicit callers
  - `apps/web/src/lib/process-image.ts:47-60` — live pipeline creates directories directly
  - `apps/web/src/lib/process-image.ts:362-444` — live derivatives are written directly to filesystem paths
  - `apps/web/src/lib/serve-upload.ts:32-103` — Node upload serving reads directly from `UPLOAD_ROOT`
  - `apps/web/nginx/default.conf:89-106` — production serves `/uploads/*` directly from nginx, bypassing Node
- **Code region:** three different storage/serving layers exist, but only one is actually abstracted
- **Concrete failure scenario:** a future backend migration or policy change updates `@/lib/storage` or `serve-upload.ts`, but uploads/deletes/production serving still use direct local paths and nginx rules. Dev and prod behavior drift, and “backend switching” appears to work in tests while the real pipeline still depends on local disk.
- **Suggested fix:** choose one path: either delete the experimental storage abstraction until a real migration starts, or route upload/process/delete/serve through a single storage contract and derive nginx/static config from the same source of truth.

### ARC-C3-05 — “Multi-user admin” is a flat super-admin model with no capability boundaries

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **Files / exact regions:**
  - `README.md:37` and `CLAUDE.md:5` — repo describes “multi-user admin authentication”
  - `apps/web/src/db/schema.ts:106-111` — `admin_users` stores only `id`, `username`, `password_hash`
  - `apps/web/src/app/actions/auth.ts:52-54` — authorization collapses to boolean `isAdmin()`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:33-44`, `102-113`, `245-252` — CSV export / DB dump / DB restore require only `isAdmin()`
  - `apps/web/src/app/actions/admin-users.ts:69-76`, `193-200` — user creation/deletion also require only admin presence
  - `apps/web/src/app/actions/settings.ts:37-44` — settings changes also require only admin presence
- **Code region:** every admin account is effectively root; there is authentication, but no authorization model
- **Concrete failure scenario:** an owner creates a second account for routine content work; that account automatically gains power to dump/restore the database, create/delete admins, and change global settings/SEO because the system has no role separation.
- **Suggested fix:** either add roles/capabilities (`owner`, `editor`, etc.) or explicitly narrow product messaging/docs to “multiple root admins” so the security boundary is clear.

---

## Final sweep

Rechecked the inspected surfaces and ran targeted searches for global in-memory state, queue lifecycle, storage routing, upload serving, admin authorization, proxy/runtime assumptions, and advisory locks.

No additional current architecture/design risks were found beyond the five listed above.
