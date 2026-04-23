# Code Reviewer - Cycle 13 (current run, 2026-04-23)

Note: Earlier cycle-13 file `code-reviewer-cycle13-historical-2026-04-19.md` is preserved for provenance; its findings were fully implemented in plan-122 (C13-01..03, CR-13-04, DBG-13-02) and deployed.

Scope: full-repo re-review of server actions, rate-limit flows, sanitization, error handling, transaction boundaries, and consistency with cycles 1-12 RPL precedents.

HEAD at review start: `0000000f649f123fea8c5964caec77dbf42e2afe` (cycle 12 deploy-success docs).

## Inventory of examined files

- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/proxy.ts`

## Findings

No new CRITICAL, HIGH, MEDIUM, or LOW findings.

### Re-verification of historical cycle-13 fixes

- `gallery-config.ts` line 72 uses `parseImageSizes()` — fix for the earlier C13-01 (unsorted sizes) is in force.
- `gallery-config.ts` line 62-66 `validatedNumber` helper falls back to defaults on invalid DB rows — earlier C13-02 fix is in force.
- `process-image.ts` line 373 adds defensive `[...sizes].sort((a, b) => a - b)` inside `processImageFormats` — belt-and-suspenders.

### Pattern consistency re-verified

1. Every mutating action starts with `isAdmin()` / `requireSameOriginAdmin()` / `getRestoreMaintenanceMessage()`.
2. Every user input is `stripControlChars()`-sanitized BEFORE length/format validation (C46-01 pattern).
3. Every rate-limit-guarded action validates form fields BEFORE the rate-limit pre-increment (AGG9R-RPL-01, AGG10R-RPL-01 pattern).
4. Every rate-limit pre-increment has symmetric rollback on over-limit, infra-error, duplicate-entry, and retry-exhausted branches (C11R-FRESH-01 pattern).
5. `createAdminUser` `ER_DUP_ENTRY` rolls back both in-memory and DB counters.
6. `updatePassword` clears rate-limit only AFTER transaction commit (C1R-02).
7. All mutating actions pass the automated `check-action-origin` gate (18/18 coverage).

### Gate snapshot (pre-fix)

- eslint: PASS (0 errors, 0 warnings)
- lint:api-auth: PASS
- lint:action-origin: PASS (18 mutating server actions)
- vitest: 298/298 PASS (50 files, 2.68s)
- next build: PASS (25 routes, standalone output)
- playwright e2e: PASS

## Confidence: High

No action needed this cycle beyond documentation + gate verification + deploy. Two consecutive zero-findings cycles (12 and 13) are strong convergence evidence.
