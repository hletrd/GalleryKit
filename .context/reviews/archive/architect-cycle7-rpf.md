# Architect Review — Cycle 7 RPF

## Summary

The current architecture is coherent for the documented **single web-instance / single-writer** deployment, but several coordination mechanisms remain **process-local** rather than shared. That creates long-horizon operational risk when future deployment changes introduce multiple writers. I also found a boundary problem in the storage layer: the repo exposes an experimental `StorageBackend`, but the live upload/process/serve pipeline still bypasses it with direct filesystem calls.

## Inventory / Coverage

Reviewed architecture-relevant surfaces:

- Repo rules/docs: `AGENTS.md`, `README.md`, `apps/web/README.md`, `CLAUDE.md`.
- Build/runtime/config: `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/playwright.config.ts`, `apps/web/drizzle.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/tailwind.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/src/site-config.json`.
- DB/schema/migrations: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, Drizzle migrations/meta.
- App/router/action surface: all files under `apps/web/src/app/**`.
- Library/runtime surface: all files under `apps/web/src/lib/**`.
- UI boundary files: app-specific files under `apps/web/src/components/*.tsx`; generic `src/components/ui/*` wrappers inventoried.
- Scripts/guardrails: `apps/web/scripts/*`, especially `check-action-origin.ts` and `check-api-auth.ts`.
- Tests: all `apps/web/src/__tests__/**` and `apps/web/e2e/**`.
- Deeper AGENTS: no deeper `AGENTS.md` under `apps/web/`.

Final sweep result: no additional architecture-relevant file outside the surfaces above.

## Findings

### ARCH-C7RPF-01 — Process-local coordination state is safe only under the documented singleton topology, but not technically enforced

- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Citations:** `apps/web/src/lib/restore-maintenance.ts:1-55`; `apps/web/src/app/[locale]/admin/db-actions.ts:271-311`; `apps/web/src/lib/image-queue.ts:67-132,382-489`; `apps/web/src/lib/upload-tracker-state.ts:7-21,52-61`; `apps/web/src/app/actions/settings.ts:74-78`; `apps/web/src/app/api/health/route.ts:7-16`; `apps/web/docker-compose.yml:13-25`; `README.md:145-146`.

**Why this is a problem:** restore maintenance state, image-processing queue state, upload quota tracking, settings locks, and readiness signaling all live in the current Node process. That is acceptable only when exactly one app writer is active. Docs state the single web-instance/single-writer requirement, but the code does not enforce it.

**Concrete failure scenario:** an operator scales to two app instances. Instance A starts `restoreDatabase()`, sets its local maintenance flag, and drains only its local queue. Instance B remains healthy and accepts uploads/settings writes because its local restore flag and upload claims are empty. The restore then overwrites DB state while B accepted new writes, leaving DB/files out of sync.

**Suggested fix:** either enforce singleton ownership at runtime (startup guard or DB-backed singleton lease around admin-write/restore surfaces) or move restore state, upload claims, queue claims/leases, and view-count buffering to shared DB/Redis-backed coordination.

### ARCH-C7RPF-02 — Storage abstraction is not a real boundary yet; live paths bypass it

- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Citations:** `apps/web/src/lib/storage/index.ts:4-12`; `apps/web/src/lib/storage/types.ts:4-15`; `apps/web/src/app/actions/images.ts:7-8,202-245,301-316`; `apps/web/src/lib/process-image.ts:12,45-60,224-253`; `apps/web/src/lib/image-queue.ts:236-285`; `apps/web/src/lib/serve-upload.ts:6,32-115`.

**Why this is a problem:** `StorageBackend` suggests backend-swappable storage, but originals, derivative generation, queue verification, public serving, and cleanup still use local filesystem helpers directly. Future maintainers could switch the abstraction and still have most live paths writing/reading local disk.

**Concrete failure scenario:** a future S3/MinIO backend is added via `switchStorageBackend(...)`. Uploads and processing still use local paths, while any new code using the backend writes elsewhere. Some images disappear, never process, or fail to serve because the app has two competing storage authorities.

**Suggested fix:** either delete/quarantine the experimental abstraction until backend switching is real, or finish the migration so original writes, derivative writes, serving, deletion, queue verification, and backup/restore assumptions all go through one authoritative boundary.

### ARCH-C7RPF-03 — Share-group view counts are best-effort but look authoritative

- **Severity:** Medium
- **Confidence:** High
- **Status:** Likely
- **Citations:** `apps/web/src/lib/data.ts:11-20,28-40,32-35,52-77,83-94,660-664`; `apps/web/src/instrumentation.ts:8-35`.

**Why this is a problem:** shared-group views are buffered in memory and flushed later. Failed DB updates are re-buffered in memory only, the buffer drops increments at capacity, and graceful shutdown is the only flush-on-exit path. That is fine for approximate analytics, but the stored `view_count` field and admin-facing copy can imply an authoritative count.

**Concrete failure scenario:** during a DB outage or process crash, shared pages keep rendering and increments accumulate. The process is killed or the buffer fills, losing increments permanently. Admins later see lower persisted counts than actual delivered views.

**Suggested fix:** explicitly document/UI-label `view_count` as approximate analytics, or persist increments durably with synchronous writes, append-only events, or a durable queue.

## Architectural Status

`WATCH`

## Final Sweep

Swept public/admin boundary enforcement, shared mutable state, route/action/auth layering, storage/queue/runtime topology, DB restore lifecycle, readiness/liveness interaction, and tests vs runtime assumptions. The strongest unresolved risk remains hidden dependence on singleton deployment topology.
