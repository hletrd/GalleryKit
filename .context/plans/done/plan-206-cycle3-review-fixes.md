# Plan 206 — Cycle 3 Review Fixes

**Status:** DONE
**Source reviews:** `.context/reviews/_aggregate.md`, `.context/reviews/code-reviewer.md`, `.context/reviews/security-reviewer.md`, `.context/reviews/verifier.md`, `.context/reviews/test-engineer.md`, `.context/reviews/perf-reviewer.md`
**Goal:** Fix the current-cycle confirmed correctness/security issues with minimal, reversible changes; add regression coverage; keep full-gate compatibility.

## Findings mapped to this plan

| Finding | Severity | Confidence | Action | Status |
|---|---|---|---|---|
| AGG3-01 | MEDIUM | HIGH | IMPLEMENT | DONE |
| AGG3-02 | MEDIUM | HIGH | IMPLEMENT | DONE |
| AGG3-03 | HIGH | HIGH | IMPLEMENT | DONE |
| AGG3-04 | MEDIUM | HIGH | IMPLEMENT | DONE |
| AGG3-09 | MEDIUM | MEDIUM | IMPLEMENT | DONE |
| TE3-01 / TE3-02 | LOW/MEDIUM | HIGH | COVER WITH REGRESSION TESTS INSIDE AGG3-01/02 | DONE |

## Completed items

### 206-01 — Reserve locale-prefixed route segments for topics and aliases — DONE
- Updated `apps/web/src/lib/validation.ts` to reserve locale codes from `LOCALES` alongside the existing static path segments.
- Added regression coverage in `apps/web/src/__tests__/validation.test.ts` and `apps/web/src/__tests__/topics-actions.test.ts` for locale-coded slugs and aliases.

### 206-02 — Correlate histogram worker responses to the active image request — DONE
- Added request IDs and abort-aware listener cleanup in `apps/web/src/components/histogram.tsx`.
- Updated `apps/web/public/histogram-worker.js` to echo the request ID and return a structured histogram payload.
- Added `apps/web/src/__tests__/histogram.test.ts` to lock overlapping-request behavior.

### 206-03 — Harden example secret guidance and rotation documentation — DONE
- Replaced weak live-looking DB password examples with `<change-me>` placeholders.
- Added explicit rotation guidance for environments seeded from older checked-in examples in `apps/web/.env.local.example`, `README.md`, and `CLAUDE.md`.

### 206-04 — Remove the known-vulnerable AWS SDK chain from production deps — DONE
- Deleted the unused experimental S3/MinIO backend implementations (`apps/web/src/lib/storage/s3.ts`, `apps/web/src/lib/storage/minio.ts`).
- Simplified `apps/web/src/lib/storage/index.ts` to the local-only backend that matches the documented product contract.
- Removed the unused AWS SDK dependencies from `apps/web/package.json` and refreshed `package-lock.json`.
- Verified `npm audit --omit=dev --json` returns zero prod vulnerabilities.

### 206-05 — Apply same-origin checks consistently to current sensitive mutation/download surfaces — DONE
- Added `hasTrustedSameOrigin()` enforcement to `updatePassword()` in `apps/web/src/app/actions/auth.ts`.
- Added same-origin enforcement to `apps/web/src/app/api/admin/db/download/route.ts` with request host/protocol fallbacks for `NextRequest` tests.
- Extended backup-download regression coverage for cross-origin rejection.

## Verification
- `npm audit --omit=dev --json` ✅ (0 prod vulnerabilities)
- `npm run lint --workspace=apps/web` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅
- `npm test --workspace=apps/web` ✅
- `npm run test:e2e --workspace=apps/web` ✅
- `npm run build` ✅
