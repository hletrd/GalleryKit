# Plan 166 — Cycle 1 Admin, Upload, Test, UX, and Docs Hardening

**Created:** 2026-04-20
**Status:** DONE
**Sources:** `.context/reviews/_aggregate.md`, `debugger.md`, `designer.md`, `researcher.md`, `security-reviewer.md`, `test-engineer.md`

## Scope
Fix the confirmed admin/upload/test/docs issues that currently produce false confidence, weak bootstrap guidance, race-prone admin deletion, and poor mobile landscape affordances.

## Planned items

### C166-01 — Reject weak bootstrap admin secrets in docs and seed scripts
- **Findings:** `AG1-05`, `AG1-11`
- **Goal:** Stop documenting or silently accepting trivially weak bootstrap admin passwords, and align root setup docs with the actual runtime env surface.
- **Files to touch:**
  - `README.md`
  - `CLAUDE.md`
  - `apps/web/.env.local.example`
  - `apps/web/scripts/seed-admin.ts`
  - `apps/web/scripts/migrate-admin-auth.ts`
- **Implementation notes:**
  - Remove `ADMIN_PASSWORD=password` style guidance.
  - Add clear strong-secret requirements (or pre-hashed Argon2 guidance).
  - Keep docs aligned with the actual compose command and required env vars.

### C166-02 — Roll back failed upload quota claims and replace the false-confidence upload tracker test
- **Findings:** `AG1-06`
- **Goal:** Ensure all-failed upload batches do not consume quota and make the upload-tracker test exercise the real implementation instead of duplicate arithmetic.
- **Files to touch:**
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/__tests__/upload-tracker.test.ts`
  - any small helper extracted specifically to make the real quota math testable
- **Implementation notes:**
  - Prefer a small shared helper over a large action rewrite.
  - The regression test must fail against the old all-failed-batch behavior.

### C166-03 — Serialize last-admin deletion so concurrent requests cannot remove every admin
- **Findings:** `AG1-08`
- **Goal:** Preserve the “at least one admin remains” invariant even under concurrent deletes.
- **Files to touch:**
  - `apps/web/src/app/actions/admin-users.ts`
  - targeted tests only if a narrow helper can be exercised safely this cycle
- **Implementation notes:**
  - Use an explicit serialization/locking strategy that is compatible with the current MySQL runtime.
  - Do not weaken the existing no-self-delete protection.

### C166-04 — Make local Playwright/admin E2E flows deterministic
- **Findings:** `AG1-09`
- **Goal:** Stop local admin E2E from depending on the remote demo origin, ambiguous localhost URL parsing, or topic-option ordering.
- **Files to touch:**
  - `apps/web/e2e/helpers.ts`
  - `apps/web/playwright.config.ts`
  - `apps/web/e2e/admin.spec.ts`
  - optionally `apps/web/scripts/seed-e2e.ts` if fixture alignment needs a small cleanup
- **Implementation notes:**
  - Keep the repo defaulting to local verification unless `E2E_BASE_URL` explicitly points remote.
  - Select the seeded topic by stable value rather than index.

### C166-05 — Keep the mobile landscape photo toolbar visible enough to preserve navigation affordances
- **Findings:** `AG1-10`
- **Goal:** Prevent small-landscape mobile photo browsing from hiding the only obvious back/info controls.
- **Files to touch:**
  - `apps/web/src/app/[locale]/globals.css`
  - `apps/web/src/components/photo-viewer.tsx` only if a minimal structural tweak is required
- **Implementation notes:**
  - Prefer a compact toolbar/overlay adaptation over removing controls entirely.

## Ralph progress
- 2026-04-20: Plan created from cycle-1 aggregate review.
- 2026-04-20: Hardened bootstrap admin guidance/scripts so weak plaintext defaults are rejected and docs/env samples require a strong secret or Argon2 hash.
- 2026-04-20: Extracted real upload-tracker reconciliation into `apps/web/src/lib/upload-tracker.ts`, fixed failed-batch quota rollback in `apps/web/src/app/actions/images.ts`, and rewrote `apps/web/src/__tests__/upload-tracker.test.ts` to cover the shared implementation.
- 2026-04-20: Serialized last-admin deletion with a DB advisory lock in `apps/web/src/app/actions/admin-users.ts`.
- 2026-04-20: Made local Playwright/admin flows deterministic by defaulting helpers/config to the local app and selecting the seeded upload topic by stable value.
- 2026-04-20: Restored small-landscape photo-viewer toolbar visibility in `apps/web/src/app/[locale]/globals.css`.
- 2026-04-20: Final verification passed: `npm run lint --workspace=apps/web`, `npm run lint:api-auth --workspace=apps/web`, `npm test --workspace=apps/web`, `npm run build --workspace=apps/web`, and `npm run test:e2e --workspace=apps/web`.
