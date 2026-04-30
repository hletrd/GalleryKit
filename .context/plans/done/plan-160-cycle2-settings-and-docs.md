# Plan 160 — Cycle 2 Settings Surface and Docs Alignment

**Created:** 2026-04-20
**Status:** DONE
**Sources:** `.context/reviews/_aggregate.md`, `architect.md`, `code-reviewer.md`, `critic.md`, `document-specialist.md`, `tracer.md`, `verifier.md`

## Scope
Resolve the settings/control-plane issues where the admin UI advertises behavior the runtime does not actually support.

## Planned items

### C160-01 — Remove unsupported settings from the admin control plane
- **Findings:** `AG2-01`, `AG2-02`, `AG2-03`
- **Goal:** Stop exposing storage backend switching, queue concurrency, upload-limit knobs, and grid-column knobs until they are backed by real runtime behavior.
- **Files to touch:**
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
  - `apps/web/src/app/actions/settings.ts`
  - `apps/web/src/lib/gallery-config-shared.ts`
  - `apps/web/src/lib/gallery-config.ts`
  - any directly related tests/messages/docs needed to keep the surface coherent
- **Implementation notes:**
  - Keep only the settings that are actually wired (`image_quality_*`, `image_sizes`, `strip_gps_on_upload`).
  - Prevent stale unsupported keys from being re-saved through `updateGallerySettings()`.
  - Remove the broken storage-backend rollback path entirely by removing the unsupported switch from the persisted settings flow.

### C160-02 — Revalidate the full app tree when supported gallery settings change
- **Findings:** `AG2-03` (public metadata/cache drift), critic finding about stale long-lived pages
- **Goal:** Ensure `image_sizes` and related supported settings invalidate the public pages that consume them, not just admin/home pages.
- **Files to touch:**
  - `apps/web/src/app/actions/settings.ts`
  - `apps/web/src/lib/revalidation.ts` (only if a helper adjustment is necessary)

### C160-03 — Bring docs/templates back in line with the supported product
- **Findings:** `AG2-01`, `AG2-03`, `AG2-07`, `AG2-13`
- **Goal:** Update root/docs/env templates so they no longer promise unsupported storage features or omit required deployment/auth configuration.
- **Files to touch:**
  - `README.md`
  - `CLAUDE.md`
  - `apps/web/.env.local.example`
  - `apps/web/src/site-config.example.json`
  - `apps/web/src/site-config.json`
- **Implementation notes:**
  - Document required auth/session vars accurately.
  - Remove or clarify unsupported S3/MinIO/storage-backend instructions.
  - Remove the unused `external_links` schema entry from the checked-in examples if it is not implemented anywhere.
  - Fix stale repo-layout references (for example the nonexistent `test/` directory).

## Ralph progress
- 2026-04-20: Plan created from cycle-2 aggregate review.
- 2026-04-20: Removed unsupported storage/upload/grid/queue settings from the admin control plane, restricted persisted gallery settings to the wired keys, revalidated the full app tree on settings changes, and updated root/env/site-config docs so they no longer advertise unsupported storage switching or the unused `external_links` field.
