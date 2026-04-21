# Plan 183 — Cycle 6 Ultradeep Fixes

**Created:** 2026-04-22
**Status:** DONE
**Purpose:** Fix the highest-signal cycle-6 restore/runtime consistency issues while preserving the bounded review-plan-fix lane.

## Scheduled fixes

### C183-01: Harden the restore child-process stream boundary
**Severity:** HIGH | **Confidence:** High
**Sources:** `C6-01` in `.context/reviews/_aggregate.md`, `.context/reviews/debugger.md`, `.context/reviews/dependency-expert.md`, `.context/reviews/verifier.md`

Implementation:
1. Add a small restore-stream error classifier/helper under `apps/web/src/lib/db-restore.ts`.
2. Register `restore.stdin` error handling in `apps/web/src/app/[locale]/admin/db-actions.ts` before piping the upload into `mysql`.
3. Ignore expected broken-pipe/destroyed-stream errors that simply reflect the child closing early; preserve structured failure handling for real stdin I/O errors.
4. Update nearby comments to clarify that the restore cap is intentionally lower than the generic server-action body limit.

### C183-02: Keep the fatal error shell aligned with live SEO branding
**Severity:** MEDIUM | **Confidence:** High
**Sources:** `C6-02` in `.context/reviews/_aggregate.md`, `.context/reviews/code-reviewer.md`, `.context/reviews/architect.md`, `.context/reviews/designer.md`

Implementation:
1. Add a pure helper that resolves the fatal-shell brand from live document/root-layout data with safe fallbacks.
2. Have the localized root layout expose the live SEO title/nav title on the root HTML element.
3. Update `apps/web/src/app/global-error.tsx` to prefer the live brand bridge instead of static file branding.

### C183-03: Add regression coverage for the new restore/error-shell contracts
**Severity:** LOW | **Confidence:** High
**Sources:** `C6-03` in `.context/reviews/_aggregate.md`, `.context/reviews/test-engineer.md`, `.context/reviews/verifier.md`

Implementation:
1. Add unit tests for the restore-pipe error classifier/helper.
2. Add unit tests for fatal-shell brand derivation and fallback behavior.

### U183-01: Honor the user-injected self-resolving deploy requirement without prompting again
**Severity:** user-injected TODO | **Confidence:** High
**Sources:** user TODOs (`"deeper"`, `"ultradeep comprehensive"`, `"find yourself and make sure to not ask again."`), existing `.env.deploy`

Implementation:
1. Verify that the gitignored root `.env.deploy` still self-resolves the active `gallery.atik.kr` deploy target.
2. Do not prompt for deploy details again during this cycle.

## Verification target
- `npm run lint --workspace=apps/web`
- `npm run build`
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`
- per-cycle remote deploy command via SSH

## Progress
- [x] C183-01: restore stdin boundary hardened
- [x] C183-02: fatal shell branding aligned with live SEO title/nav title
- [x] C183-03: regression tests added
- [x] U183-01: deploy env verified (no new prompt required)
- [x] `npm run lint --workspace=apps/web`
- [x] `npm run build`
- [x] `npm run test --workspace=apps/web`
- [x] `npm run test:e2e --workspace=apps/web`
