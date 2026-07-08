# Cycle 26 Code + Security Review

Date: 2026-07-08 KST
Review lane: code-security-reviewer, read-only source review
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `101ebef57ae2a379cce4b5fa04dccd538c438b0c`

## Scope and Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, `/Users/hletrd/.agents/skills/security-review/SKILL.md`, prior Cycle 25 aggregate/code/security reviews, and the current HEAD commit that closed Cycle 25 findings.

Primary files inspected:

- Auth/origin/API guard surface: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/proxy.ts`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`.
- Admin/server actions and restore: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/advisory-lock-release.ts`, `apps/web/src/lib/db-child-watchdog.ts`, `apps/web/src/lib/sql-restore-scan.ts`.
- Upload/re-encode/config: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`.
- Public routes/privacy/sanitization: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, OG/feed/upload route handlers, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/og-sanitize.ts`, `apps/web/src/lib/content-security-policy.ts`.
- Changed Cycle 25 UI files checked for security-relevant regressions: topic/tag/SEO managers and `apps/web/src/components/search.tsx`.
- Tests/guards checked: privacy fields, API auth lint, action-origin lint, public route rate-limit lint, restore tests, strict detached config wiring, admin backfill leak, upload serving, JSON-LD, CSP, tracked-secret scan.

## Findings

No substantive current code quality, logic, security, auth/authz, privacy, admin/public-boundary, or correctness defect was found in the working tree at `101ebef57ae2a379cce4b5fa04dccd538c438b0c`.

Evidence for not re-filing prior issues:

- Cycle 25's high-risk color re-encode fail-open issue is fixed in current code: `getGalleryConfigDetachedStrict()` is exported in `apps/web/src/lib/gallery-config.ts:182-188`, used by the in-app backfill runner at `apps/web/src/lib/admin-backfill-runner.ts:701`, and used by the sidecar at `apps/web/scripts/backfill-color-pipeline.ts:355`.
- Cycle 25's restore temp cleanup edge case is fixed in current code: `cleanupTransferredToRestoreProcess = true` is now set after `spawn('mysql')` returns and after handlers are registered, immediately before piping at `apps/web/src/app/[locale]/admin/db-actions.ts:973-976`; the fallback `finally` cleanup remains at `apps/web/src/app/[locale]/admin/db-actions.ts:978-981`.
- Security lint gates pass on current HEAD: admin API routes wrap `withAdminAuth`, mutating server actions enforce same-origin plus mutation-barrier coverage, and public expensive/mutating routes have rate-limit pre-increments or documented exemptions.
- Targeted tests pass: 12 files / 282 tests covering privacy projection, search privacy, auth/origin/rate-limit lint gates, DB restore, strict detached config wiring, admin backfill failure cleanup, upload serving, JSON-LD escaping, CSP, and tracked secrets.
- `npm audit --workspace=apps/web --audit-level=low` reports 0 vulnerabilities.

## Non-Findings / Not Re-Filed

- Reverse-proxy topology, plaintext backup-at-rest policy, Server Action multipart memory envelope, shared background resource budgeting, duplicate browser/LR upload ingestion, warn-only single-writer enforcement, bounded semantic scan recall, map/search scale limits, and CSV export memory shape remain documented or deferred risks from Cycle 25. I did not re-file them as new Cycle 26 findings because current HEAD either explicitly defers them or they require architectural/operational decisions rather than a newly discovered current-code bug.
- The restore SQL scanner remains regex/denylist based, but I found no concrete bypass in current code, and the restore scanner/DB restore tests passed.
- Secret-like grep hits are documentation examples, tests, schema field names, or historical deferred notes; the tracked-secret test passed and no runtime `.env` secret file was inspected.

## Validation

Commands run:

- `git rev-parse HEAD` -> `101ebef57ae2a379cce4b5fa04dccd538c438b0c`
- `npm run lint:api-auth --workspace=apps/web` -> pass
- `npm run lint:action-origin --workspace=apps/web` -> pass
- `npm run lint:public-route-rate-limit --workspace=apps/web` -> pass
- `npm audit --workspace=apps/web --audit-level=low` -> 0 vulnerabilities
- `npm test --workspace=apps/web -- --run ...` targeted security/config suites -> 12 test files passed, 282 tests passed

Final sweep note: I checked current route/action exports, dangerous sinks (`dangerouslySetInnerHTML`, fetch/URL construction, redirects, file streaming, child process spawn, advisory locks, raw SQL separators), config read semantics on write paths, privacy select guards, upload/backup path containment, and the Cycle 25 fix diff. No new confirmed issue remained after that sweep.
