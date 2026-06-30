# Cycle 38 Code/Correctness Review

Cycle: 38/100
Date: 2026-06-30 KST
Reviewed HEAD: `564a7679`

## Inventory

- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-37-2026-06-30/_aggregate.md`
- `.context/plans/cycle-37-2026-06-30-deferred.md`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/scripts/migrate.js`

## Findings

### C38-CODE-01 - `lint:action-origin` accepts unreasoned exemption tags

Severity: Low
Confidence: High

File/line:

- `apps/web/scripts/check-action-origin.ts:106`

The action-origin scanner treats any leading `@action-origin-exempt` text as an exemption even though the scanner header and repo rules require `@action-origin-exempt: <reason>`.

Failure scenario: a future action lands with `/** @action-origin-exempt */`; the gate skips it without recording why the export is safe to exempt. That weakens the audit trail on a security-critical scanner.

Suggested fix: require a non-empty reason after `:` and add fixtures for bare/empty exemption tags.

## Notes

- Cycle 37 scheduled scanner findings appear implemented at current HEAD.
- The Cycle 37 deferred FK convergence and CLIP live bootstrap findings were not re-opened because current evidence matches the existing deferral rationale.
- Validation observed by this lane: `lint:action-origin`, `lint:public-route-rate-limit`, and `lint:api-auth` passed at reviewed HEAD.
