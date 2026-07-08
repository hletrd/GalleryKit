# Cycle 32 Code / Performance / Security Review

Role lane: code-reviewer + perf-reviewer + security-reviewer  
Review HEAD: `4a728335ada304371743689de7f5bbf8670985b5`  
Date: 2026-07-08 KST

## Scope And Inventory

Reviewed the current product/source state plus the latest carry-forward ledgers. Current HEAD differs from Cycle 31 start only in committed plan/review provenance files; no production source file changed after Cycle 31. The source inventory covered 262 files under `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/scripts`, and `apps/web/drizzle`.

High-risk inventory inspected:

- Admin auth/API/PAT: `apps/web/src/lib/api-auth.ts:80-150`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-158`, `apps/web/src/app/api/admin/db/download/route.ts:21-109`.
- Mutating server actions and upload/delete paths: `apps/web/src/app/actions/images.ts:87-227`, `apps/web/src/app/actions/images.ts:325-581`, `apps/web/src/app/actions/images.ts:730-883`, plus all action exports through `lint:action-origin`.
- Public expensive routes: semantic/similar search at `apps/web/src/app/api/search/semantic/route.ts:107-368` and `apps/web/src/app/api/search/similar/[id]/route.ts:68-285`; OG/feed/upload-serving routes through `lint:public-route-rate-limit`.
- Restore/backup/child-process/SQL safety: `apps/web/src/app/[locale]/admin/db-actions.ts:421-722`, `apps/web/src/app/[locale]/admin/db-actions.ts:752-1060`, `apps/web/src/lib/sql-restore-scan.ts:12-32`, `apps/web/src/lib/sql-restore-scan.ts:262-304`.
- File serving/path containment: `apps/web/src/lib/serve-upload.ts:172-238`, `apps/web/src/lib/serve-upload.ts:265-369`, backup download realpath/open flow at `apps/web/src/app/api/admin/db/download/route.ts:31-90`.
- Privacy/XSS/CSP surfaces: public select guards at `apps/web/src/lib/data.ts:380-488`, semantic enrichment guard at `apps/web/src/lib/search-enrichment-fields.ts:29-47`, JSON-LD escaping at `apps/web/src/lib/safe-json-ld.ts:14-20` and usage at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:272-284`, CSP construction at `apps/web/src/lib/content-security-policy.ts:139-199`.
- Dedupe/current-ledger context: `.context/reviews/run10-cycle31/*`, `.context/plans/deferred-carry-forward.md`, `.context/plans/run10-cycle31/plan.md`, `.context/plans/README.md`.

## Findings

No new current, non-duplicative defects were confirmed at HEAD `4a728335ada304371743689de7f5bbf8670985b5`.

Evidence:

- Admin API routes are wrapped by `withAdminAuth`; cookie auth requires trusted same-origin and PAT auth requires the configured token scope before handler execution (`apps/web/src/lib/api-auth.ts:80-150`).
- Mutating admin server actions retain same-origin and restore-mutation-barrier coverage; the scanner passed across all action exports.
- Public expensive routes are same-origin/rate-limited or explicitly exempted with a reason; semantic/similar search charge before DB/embedding work and bound query/body/scan size (`apps/web/src/app/api/search/semantic/route.ts:107-368`, `apps/web/src/app/api/search/similar/[id]/route.ts:68-285`).
- LR/PAT upload mirrors browser upload controls: body-size gates, tracker preclaim/settle, topic validation, GPS stripping, HDR gating, processing-setting snapshots, post-commit JSON success (`apps/web/src/app/api/admin/lr/upload/route.ts:101-158`, `apps/web/src/app/api/admin/lr/upload/route.ts:217-281`, `apps/web/src/app/api/admin/lr/upload/route.ts:407-502`, `apps/web/src/app/api/admin/lr/upload/route.ts:532-625`).
- Restore/backup paths keep minimal child env, scan restore SQL for disallowed write targets/dangerous statements, hold maintenance/locks, and keep maintenance active on uncertain restore finalization (`apps/web/src/app/[locale]/admin/db-actions.ts:421-722`, `apps/web/src/app/[locale]/admin/db-actions.ts:752-1060`, `apps/web/src/lib/sql-restore-scan.ts:262-304`).
- Public privacy projections omit sensitive/admin-only fields with compile-time guards; semantic/similar enrichment uses a shared guarded select (`apps/web/src/lib/data.ts:380-488`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`).
- The current Cycle 31 product-code lanes also found no new product-code correctness/security/perf defects, and the only Cycle 31 findings were documentation/ledger issues later repaired in current HEAD.

## Dedupe Notes

Not re-filed as Cycle 32 findings:

- Buffered upload/restore RSS and streaming-ingress work remain tracked carry-forward architecture/perf items, not a new regression at this HEAD.
- Shared background DB-pool budget, vector-scan scaling, map marker scaling, service-worker cache-cost, host-nginx/proxy validation, and authenticated admin e2e expansion remain existing deferred/operator/test-infra items.
- `deleteImages` per-image pending-file-deletion insert batching is already `D10b-05 / AGG-C10b-03`; current code at `apps/web/src/app/actions/images.ts:808-835` is unchanged and correctness-sensitive.
- Restore auth/maintenance ordering and finalizer test-strength gaps remain `C27-02` / `C27-04`; no new restore failure path was confirmed.
- The untracked `.context/reviews/cycle32-critic-verifier-test.md` existed before this review file was written and was not modified.

## Validation

Passed:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `git diff --check HEAD`
- `npm test --workspace=apps/web -- --run src/__tests__/tracked-secrets.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/request-origin.test.ts src/__tests__/rate-limit.test.ts src/__tests__/semantic-search-rate-limit.test.ts` — 8 files, 296 tests.
- `npm audit --workspace=apps/web --audit-level=moderate` — found 0 vulnerabilities.

Not run: full ESLint, full typecheck, production build, full Vitest, Playwright e2e, live production deploy/smoke, host-nginx validation, and load/RSS tracing. Those are broader gates than this read-only review lane and remain covered by repo cycle policy or existing deferred operator/test-infra rows.

## Final Sweep

Searched and inspected auth/authz, rate limiting, same-origin, raw SQL, child processes, file path containment, upload parsing, restore/backup, JSON-LD/script sinks, CSP, privacy selects, semantic/vector scanning, image serving, and current carry-forward ledgers. No actionable current bug with a concrete failure scenario was found that is not already fixed, scheduled, or explicitly carried in the existing deferred register.
