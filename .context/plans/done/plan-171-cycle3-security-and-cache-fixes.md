# Plan 171 — Cycle 3 Security and Test-Surface Fixes

**Created:** 2026-04-20
**Status:** DONE
**Sources:** `.context/reviews/_aggregate.md`, `security-reviewer.md`, `code-reviewer.md`

## Scope
Fix the confirmed cycle-3 defects around share-page indexing, backup-download auditing, public health-response detail leakage, and Playwright admin credential handling.

## Planned items

### C171-01 — Explicitly noindex share surfaces
- **Findings:** `C3-01`
- **Goal:** Ensure bearer share pages (`/s/[key]`, `/g/[key]`) opt out of indexing/caching regardless of the locale layout defaults.
- **Files touched:**
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- **Outcome:** DONE — both share pages now return explicit `robots` metadata for found and not-found responses.

### C171-02 — Audit successful backup downloads
- **Findings:** `C3-02`
- **Goal:** Record download-specific audit events for the authenticated SQL-backup download route.
- **Files touched:**
  - `apps/web/src/app/api/admin/db/download/route.ts`
- **Outcome:** DONE — successful downloads now emit `db_backup_download` audit events with filename, requester IP, and file size metadata.

### C171-03 — Harden public health response details
- **Findings:** `C3-03`
- **Goal:** Reduce unauthenticated health-response detail leakage without breaking the existing container healthcheck contract.
- **Files touched:**
  - `apps/web/src/app/api/health/route.ts`
- **Outcome:** DONE — the endpoint now returns only `{ status }` while preserving the existing 200/503 readiness signal.

### C171-04 — Separate Playwright admin credentials from bootstrap admin secrets and keep local-origin defaults aligned
- **Findings:** `C3-04`
- **Goal:** Prevent Playwright admin login from using hashed `ADMIN_PASSWORD` values as form input and keep helper-local defaults consistent with Playwright’s normalized local base URL.
- **Files touched:**
  - `apps/web/e2e/helpers.ts`
  - `apps/web/README.md`
  - `apps/web/.env.local.example`
- **Outcome:** DONE — the helper now requires plaintext `E2E_ADMIN_PASSWORD` when needed, blocks remote admin runs unless explicitly opted in, and normalizes the default local origin the same way as Playwright config.

## Ralph progress
- 2026-04-20: Plan created from cycle-3 aggregate review.
- 2026-04-20: Added explicit noindex/nocache metadata for both share-page surfaces.
- 2026-04-20: Added audited backup-download logging with requester IP and file-size metadata.
- 2026-04-20: Reduced public health-response detail leakage to a minimal `{ status }` payload while preserving readiness status codes.
- 2026-04-20: Hardened Playwright admin credential resolution and documented the dedicated `E2E_ADMIN_PASSWORD` / `E2E_ALLOW_REMOTE_ADMIN` flow.
- 2026-04-20: Final verification passed: `npm run lint --workspace=apps/web`, `npm run lint:api-auth --workspace=apps/web`, `npm test --workspace=apps/web`, `npm run build --workspace=apps/web`, and `npm run test:e2e --workspace=apps/web`.
