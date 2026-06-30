# Cycle 48 Security / Privacy Review

Scope: HEAD `9d0dc208`.

## Reviewed Inventory

- Prior baseline: Cycle 47 aggregate/security/deferred reviewed. Cycle 47 security/privacy had no findings; carry-forward deferred items remain `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`.
- Current delta: `d30694c8..HEAD` changes only `.context/plans/README.md` and `.context/plans/cycle-47-2026-07-01-plan.md`; no source route/action/security code changed.
- Auth/authz: `apps/web/src/lib/api-auth.ts:72`, `apps/web/src/lib/api-auth.ts:114`, `apps/web/src/lib/action-guards.ts:37`, `apps/web/src/lib/request-origin.ts:87`.
- Rate limits: `apps/web/src/lib/rate-limit.ts:245`, `apps/web/src/lib/rate-limit.ts:279`, `apps/web/src/lib/rate-limit.ts:336`, `apps/web/src/lib/rate-limit.ts:366`.
- Public route mutation/expensive route gates: `apps/web/scripts/check-public-route-rate-limit.ts:1`.
- Privacy/public field separation: `apps/web/src/lib/data.ts:368`, `apps/web/src/lib/data.ts:410`, `apps/web/src/lib/data.ts:473`, `apps/web/src/__tests__/privacy-fields.test.ts:7`.
- Upload/path traversal/symlink safety: `apps/web/src/lib/upload-paths.ts:120`, `apps/web/src/lib/upload-paths.ts:139`, `apps/web/src/lib/serve-upload.ts:136`, `apps/web/src/lib/serve-upload.ts:181`.
- LR token upload safety: `apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/app/api/admin/lr/upload/route.ts:101`, `apps/web/src/app/api/admin/lr/upload/route.ts:188`, `apps/web/src/app/api/admin/lr/upload/route.ts:384`.
- SSRF/open redirect/OG safety: `apps/web/src/app/api/og/photo/[id]/route.tsx:97`, `apps/web/src/app/api/og/photo/[id]/route.tsx:249`, `apps/web/src/app/api/og/route.tsx:74`.
- CSV/export/backup/restore safety: `apps/web/src/lib/csv-escape.ts:41`, `apps/web/src/app/[locale]/admin/db-actions.ts:92`, `apps/web/src/app/[locale]/admin/db-actions.ts:170`, `apps/web/src/app/[locale]/admin/db-actions.ts:365`, `apps/web/src/app/api/admin/db/download/route.ts:21`.
- Secrets/deploy safety: `apps/web/src/__tests__/tracked-secrets.test.ts:7`, `apps/web/deploy.sh:56`, `apps/web/docker-compose.yml:24`.

## Findings

No real new security or privacy findings found.

No new evidence changes severity for the Cycle 47 deferred items, and none became scheduled by the current HEAD documentation-only commit.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Focused Vitest sweep passed: 21 files, 368 tests.
- `npm audit --workspace=apps/web --audit-level=moderate`: found 0 vulnerabilities.
- Tracked-secret regex sweep found no literal credential assignments.

## Final Sweep Note

Final sweep covered auth/authz, same-origin guards, public route rate limiting, upload/path traversal, SSRF/open redirect, secrets, PII/public-field leakage, admin-only color/HDR fields, CSV/export safety, backup/restore handling, and deploy/script safety. No new Cycle 48 security/privacy issue is recommended for scheduling.
