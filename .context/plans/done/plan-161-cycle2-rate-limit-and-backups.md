# Plan 161 — Cycle 2 Rate-Limit, Backup, and Deployment Hardening

**Created:** 2026-04-20
**Status:** DONE
**Sources:** `.context/reviews/_aggregate.md`, `code-reviewer.md`, `debugger.md`, `security-reviewer.md`, `tracer.md`, `verifier.md`

## Scope
Fix the confirmed security/correctness defects in rate limiting, database backup/download flow, and shipped proxy deployment defaults.

## Planned items

### C161-01 — Honor configured rate-limit boundaries in pre-increment flows
- **Findings:** `AG2-05`
- **Goal:** Keep the TOCTOU-resistant pre-increment design, but stop rejecting the final nominally allowed request.
- **Files to touch:**
  - `apps/web/src/lib/rate-limit.ts`
  - `apps/web/src/app/actions/admin-users.ts`
  - `apps/web/src/app/actions/public.ts`
  - `apps/web/src/app/actions/sharing.ts`
  - relevant rate-limit tests

### C161-02 — Harden the shipped reverse-proxy deployment path
- **Findings:** `AG2-07`
- **Goal:** Make the documented compose deployment trustworthy by default when it relies on nginx/forwarded headers.
- **Files to touch:**
  - `apps/web/docker-compose.yml`
  - `apps/web/Dockerfile`
  - `README.md`
  - `CLAUDE.md` (if deployment guidance needs to match)
- **Implementation notes:**
  - Ensure the app binds only to localhost inside the host-network deployment so direct clients cannot spoof proxy headers.
  - Ensure the shipped compose path sets `TRUST_PROXY=true` when using the documented nginx reverse proxy.

### C161-03 — Make backup generation/download permissions and filenames consistent
- **Findings:** `AG2-06`, `AG2-08`
- **Goal:** Ensure downloaded backups actually work and are created with explicit owner-only permissions.
- **Files to touch:**
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/src/app/api/admin/db/download/route.ts`
  - related tests

### C161-04 — Keep shared-group view-count flushes retrying after failed batches
- **Findings:** confirmed portion of `AG2-10`
- **Goal:** When a flush re-buffers counts after a total failure, schedule the next retry instead of silently stalling until a new view arrives.
- **Files to touch:**
  - `apps/web/src/lib/data.ts`
  - related tests if coverage exists or can be added narrowly

## Ralph progress
- 2026-04-20: Plan created from cycle-2 aggregate review.
- 2026-04-20: Fixed the pre-increment rate-limit boundary checks for search/share/admin-user creation, hardened the documented host-network compose deployment with `HOSTNAME=127.0.0.1` + `TRUST_PROXY=true`, and unified backup filename validation plus owner-only dump permissions.
- 2026-04-20: Fixed C161-04 by rescheduling buffered shared-group view-count flushes after fully failed batches so retries continue without requiring a new page view to arrive first.
- 2026-04-20: Final verification passed: `npm run lint --workspace=apps/web`, `npm run lint:api-auth --workspace=apps/web`, `npm test --workspace=apps/web`, `npm run build --workspace=apps/web`, and `npm run test:e2e --workspace=apps/web`.
