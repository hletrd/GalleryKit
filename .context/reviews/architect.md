# Architectural Review — GalleryKit Cycle 1

**Recovered from read-only architect subagent output.**

## Inventory
Reviewed repo/runtime/deploy/config, all app routes/actions, all components, lib modules, DB/schema, migrations, unit/e2e tests, and messages. Excluded generated/runtime artifacts (`.context`, `.omx`, `.omc`, `node_modules`, `.git`, `test-results`).

## Findings

### ARCH-001 — Restore maintenance is process-local, but restore locking is database-global
- **Type:** Confirmed issue
- **Severity:** High
- **Confidence:** High
- **Files/regions:** `apps/web/src/lib/restore-maintenance.ts:1-55`, `apps/web/src/app/[locale]/admin/db-actions.ts:254-311`, `apps/web/src/app/api/health/route.ts:7-16`, `apps/web/src/app/actions/public.ts:23-46`
- **Problem:** Restore acquires a MySQL advisory lock but maintenance state is a per-process `globalThis` flag.
- **Concrete failure scenario:** Instance A restores while instance B does not observe maintenance and keeps accepting writes.
- **Suggested fix:** Move restore maintenance state into shared storage or explicitly enforce/document single-process operation.

### ARCH-002 — Pending image processing bootstrap is one-shot and not self-healing after startup DB failure
- **Type:** Confirmed issue
- **Severity:** Medium-High
- **Confidence:** High
- **Files/regions:** `apps/web/src/instrumentation.ts:1-6`, `apps/web/src/lib/image-queue.ts:330-381`, `apps/web/src/app/actions/images.ts:298-307`
- **Problem:** Bootstrap runs once and skips on DB refusal without retry.
- **Concrete failure scenario:** App starts before MySQL, logs “Skipping,” and old `processed = false` rows remain stranded.
- **Suggested fix:** Retry bootstrap with backoff until success or trigger it opportunistically after DB is reachable.

### ARCH-003 — The storage abstraction is dead code in production flow
- **Type:** Confirmed issue
- **Severity:** Medium
- **Confidence:** High
- **Files/regions:** `apps/web/src/lib/storage/index.ts:4-12`, `apps/web/src/lib/storage/types.ts:6-9`, `apps/web/src/app/actions/images.ts:198-248`, `apps/web/src/lib/process-image.ts:233-459`, `apps/web/src/lib/serve-upload.ts:32-115`
- **Problem:** The abstraction advertises a boundary but uploads, processing, and serving are still hardwired to local filesystem helpers.
- **Concrete failure scenario:** A maintainer switches storage backend and expects production behavior to change, but live upload/process/serve paths remain local.
- **Suggested fix:** Delete the unused abstraction until real or route all file IO through it with end-to-end tests.

### ARCH-004 — Rate and analytics controls rely on process-local memory
- **Type:** Likely risk
- **Severity:** Medium
- **Confidence:** High
- **Files/regions:** `apps/web/src/app/actions/images.ts:56-61`, `apps/web/src/app/actions/images.ts:122-186`, `apps/web/src/lib/data.ts:11-109`, `apps/web/src/instrumentation.ts:16-24`
- **Problem:** Upload quotas and buffered shared-group view counts are per-process.
- **Concrete failure scenario:** Multi-instance deployments split upload budgets and can lose buffered analytics on crash.
- **Suggested fix:** Persist counters in DB/Redis or document them as single-instance/best-effort.

### ARCH-005 — Admin API origin protection is not centralized in the API auth wrapper
- **Type:** Likely risk
- **Severity:** Medium
- **Confidence:** High
- **Files/regions:** `apps/web/src/lib/api-auth.ts:5-18`, `apps/web/scripts/check-api-auth.ts:1-178`, `apps/web/src/app/api/admin/db/download/route.ts:13-31`
- **Problem:** Current route manually adds same-origin checks, but the lint gate only enforces `withAdminAuth`.
- **Concrete failure scenario:** A future mutating admin API route passes CI with auth only and ships without same-origin protection.
- **Suggested fix:** Add same-origin to a stronger wrapper or add a mutating-admin-API origin lint gate.

### ARCH-006 — Typecheck is coupled to volatile `.next/dev` generated artifacts
- **Type:** Confirmed issue
- **Severity:** Medium
- **Confidence:** High
- **Files/regions:** `apps/web/tsconfig.json:31-38`, `apps/web/package.json:15`, `.github/workflows/quality.yml:54-55`
- **Problem:** Normal `tsc --noEmit` includes `.next/dev/types/**/*.ts`, so local dev-generated artifacts can break the quality gate.
- **Concrete failure scenario:** Running `next dev` generates incompatible `.next/dev` types and typecheck fails even when source code is valid.
- **Suggested fix:** Remove `.next/dev/types/**/*.ts` from normal include or use a dedicated CI tsconfig/type-generation flow.

### ARCH-007 — Core boundaries are too broad in data, image actions, and UI clusters
- **Type:** Likely risk
- **Severity:** Medium-Low
- **Confidence:** High
- **Files/regions:** `apps/web/src/lib/data.ts:11-894`, `apps/web/src/app/actions/images.ts:56-623`, `apps/web/src/components/photo-viewer.tsx:40-586`, `apps/web/src/components/image-manager.tsx:62-498`
- **Problem:** Several files combine unrelated responsibilities and act as change magnets.
- **Concrete failure scenario:** Small changes to sharing, EXIF, SEO, or metadata regress unrelated behavior due broad files.
- **Suggested fix:** Split by domain boundary in staged refactors.

## Verification
- `npm run lint --workspace=apps/web`: passed.
- `npm run lint:api-auth --workspace=apps/web && npm run lint:action-origin --workspace=apps/web`: passed.
- `npm test --workspace=apps/web`: 52 files / 310 tests passed.
- `npm run typecheck --workspace=apps/web`: failed in architect lane due generated `.next/dev/types/validator.ts`; source-side cause is `apps/web/tsconfig.json:31-38`.
