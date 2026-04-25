# Architecture Review — Cycle 6

Architectural status: WATCH. The repo is coherent for a single-instance, trusted-admin deployment but has maintainability and scale blockers.

## Findings

### ARCH6-01 — Schema authority is split between committed migrations and an imperative runtime reconciler
- **Location:** `apps/web/drizzle/0001_sync_current_schema.sql:1-81`, `apps/web/drizzle/0002_fix_processed_default.sql:1`, `apps/web/drizzle/0003_audit_created_at_index.sql:1`, `apps/web/scripts/migrate.js:244-494`, `apps/web/scripts/init-db.ts:24-31`
- **Severity/confidence:** High / High
- **Status:** Confirmed.
- **Failure scenario:** Legacy and clean migration-only environments can reach working but not identical schemas; rollback and drift reasoning become ambiguous.
- **Suggested fix:** Make Drizzle migrations canonical; move legacy reconciliation to an explicit one-time upgrade command; add drift check.

### ARCH6-02 — Multiple admins are multiple roots with no capability boundary
- **Location:** `README.md:37`; `CLAUDE.md:5,158-159`; `apps/web/src/db/schema.ts:106-111`; `apps/web/src/components/admin-nav.tsx:15-24`; admin actions gated by `isAdmin()` only.
- **Severity/confidence:** High / High
- **Status:** Confirmed by design.
- **Failure scenario:** Any admin can restore DB, manage users, and change settings/SEO.
- **Suggested fix:** Introduce capabilities/roles before expanding admin features.

### ARCH6-03 — Core coordination state is process-local, so topology is single-writer
- **Location:** `README.md:146`; `CLAUDE.md:158`; `apps/web/src/lib/restore-maintenance.ts:1-19`; `apps/web/src/lib/upload-tracker-state.ts:7-21`; `apps/web/src/lib/data.ts:11-109`; `apps/web/src/lib/image-queue.ts:67-132`
- **Severity/confidence:** Medium / High
- **Status:** Manual-validation risk, documented topology.
- **Failure scenario:** Horizontal scaling splits maintenance/upload/queue/view-count state across processes.
- **Suggested fix:** Enforce single-writer deployment or externalize coordination into DB/Redis/worker.

### ARCH6-04 — Configuration ownership is fragmented across file/env/DB settings
- **Location:** `README.md:41-58`; `apps/web/src/lib/data.ts:870-891`; `apps/web/src/app/[locale]/layout.tsx:76-123`; `apps/web/src/components/footer.tsx:27-38`; `apps/web/src/lib/constants.ts:9-14`; `apps/web/src/db/schema.ts:82-85`
- **Severity/confidence:** Medium / High
- **Status:** Confirmed.
- **Failure scenario:** Operators change one config plane and only some surfaces update.
- **Suggested fix:** Define immutable deploy config vs mutable DB-backed content config vs secrets and centralize composition.

### ARCH6-05 — The storage abstraction is not the storage architecture
- **Location:** `apps/web/src/lib/storage/index.ts:4-12`; direct filesystem paths in `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-topic-image.ts`; docs `CLAUDE.md:99`; stale messages `apps/web/messages/en.json:458,565-566`
- **Severity/confidence:** Medium / High
- **Status:** Confirmed.
- **Failure scenario:** Future S3/MinIO work misses real file call sites because the abstraction is not in the live pipeline.
- **Suggested fix:** Delete the unused abstraction until backend switching is real, or fully route upload/processing/serving through it.
