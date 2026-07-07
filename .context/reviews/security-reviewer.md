# Cycle 18/100 Security Review

Date: 2026-07-08 KST
Role lane: security-reviewer
Repository: `/Users/hletrd/flash-shared/gallery`
Mode: review-only; no source fixes, commits, pushes, or deploys performed.

## Instructions And Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/cycle-17-2026-07-08-plan.md`, `.context/plans/cycle-17-2026-07-08-deferred.md`, and the `review-plan-fix` / `security-review` skill instructions.

Inventory was built with `rg --files` before findings. Security-relevant areas reviewed:

- Governance and release state: `AGENTS.md`, `CLAUDE.md`, `.context/plans/**`, `plan/plan-374-cycle18-fixes.md`, `plan/plan-375-cycle18-deferred.md`, `.context/reviews/**`.
- Auth/session/admin boundary: `apps/web/src/lib/session.ts`, `api-auth.ts`, `admin-tokens.ts`, `request-origin.ts`, `action-guards.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `pending-session-revocations.ts`, and auth/admin server actions.
- Admin/public route coverage: all `apps/web/src/app/api/**/route.*`, all `apps/web/src/app/actions/**`, public share/feed/OG/search routes, upload routes, admin DB routes, and proxy middleware.
- Upload/file/path boundaries: `upload-paths.ts`, `upload-filenames.ts`, `upload-limits.ts`, `serve-upload.ts`, `process-image.ts`, `process-topic-image.ts`, `gps-exif-strip.ts`, `storage/**`, `og-photo-fetch.ts`.
- Database/SQL/restore/privacy: `apps/web/src/db/**`, `apps/web/drizzle/**`, `data.ts`, `analytics-data.ts`, `data-timeline.ts`, `search-enrichment-fields.ts`, `smart-collections.ts`, `sql-like.ts`, `sql-restore-scan.ts`, `db-restore.ts`, `backup-filename.ts`, `mysql-cli-ssl.ts`, `db-child-watchdog.ts`, `restore-maintenance*.ts`, `scripts/migrate.js`, and MySQL helper scripts.
- Cache/CSP/service worker/CLIP: `content-security-policy.ts`, `next.config.ts`, `proxy.ts`, `safe-json-ld.ts`, `og-sanitize.ts`, `public/sw.template.js`, CLIP model/download/manifest/path files, semantic/similar routes.
- CI/deploy/dependencies: `.github/workflows/*.yml`, `.github/dependabot.yml`, `package*.json`, `apps/web/Dockerfile`, `docker-compose.yml`, `deploy.sh`, `scripts/deploy-remote.sh`, `nginx/default.conf`, env examples, and quality/security lint scripts.

## Findings Summary

- Confirmed code vulnerabilities: 0
- Likely code vulnerabilities: 0
- Manual-validation/security-ops risks: 1

No new confirmed OWASP/auth/CSRF/SSRF/path traversal/upload/secrets/SQL/token/CSP vulnerability survived source review. The one finding below is a security-operations traceability risk: the repository cannot prove from committed ledgers whether security-relevant Cycle 17 hardening is deployed or still pending.

## Manual-Validation Risks

### C18-SEC-MV-01 - Cycle 17 security hardening has stale deploy/release evidence

- Severity: Medium
- Confidence: High
- Status: Manual-validation risk, not a confirmed source-code exploit
- File/region:
  - `.context/plans/README.md:34-38` still lists Run-10 Cycle 17 as the active current-cycle plan/deferred pair from start HEAD `fc15b235`.
  - `.context/plans/cycle-17-2026-07-08-plan.md:3-7` says `IMPLEMENTED - GATES GREEN; COMMIT/PUSH/DEPLOY PENDING` from start HEAD `fc15b235`.
  - `.context/plans/cycle-17-2026-07-08-plan.md:141-158` marks all work packages and local gates complete, but says the commit/push/per-cycle deploy outcome is reported elsewhere and records no deploy evidence in this plan.
  - `plan/plan-374-cycle18-fixes.md:1-10` and `plan/plan-375-cycle18-deferred.md:1-7` describe a separate Cycle 18 fix/deferred ledger, so the active ledger surfaces disagree.
  - `git log --oneline --decorate -5` shows `a1863405 (HEAD -> master, origin/master, origin/HEAD) fix(cycle17): 🐛 harden review-plan-fix findings`, proving commit/push progressed beyond the plan's recorded pending state.
- Why this is a real problem: Several Cycle 17 work packages touched security-relevant controls: DB restore/backup error paths, advisory-lock ambiguity, Lightroom upload quota settlement, token-destructive dialog context, proxy metadata routing, and semantic-search operator copy. The committed plan ledger is the repo's handoff surface for future agents and operators, but it still leaves the security hardening in a pre-release/pending state while git history says it was pushed. That prevents a reviewer from distinguishing "fix merged but not deployed" from "fix deployed and verified".
- Concrete failure scenario: A future incident or review assumes Cycle 17 hardening is live because `origin/master` contains `a1863405`, while production still runs a prior image because no deploy evidence was committed. The stale active-plan pointer also lets a later planner start from the wrong release boundary and skip explicit deploy verification for security-sensitive restore/upload changes.
- Suggested fix: Update the Cycle 17 plan and `.context/plans/README.md` to a terminal state with exact final commit, push status, deploy command/result, and any explicit deploy gap if deploy was not run. If deploy evidence is unavailable, record that as a blocking manual validation item and make the next cycle's first security/ops task prove the live version.

## Confirmed Security Evidence

Auth and authorization:

- `apps/web/src/lib/session.ts:16-35` requires a real `SESSION_SECRET` in production; `session.ts:82-150` signs/verifies session tokens with HMAC-SHA256, constant-time comparison, hash-only DB lookup, and DB expiry checks.
- `apps/web/src/lib/api-auth.ts:58-145` centralizes admin API auth, scoped PAT auth for allowed token flows, same-origin checks for cookie-auth admin APIs, invalid token rate limiting, and no-store/nosniff response defaults.
- `apps/web/src/lib/admin-tokens.ts:53-108` creates high-entropy bearer tokens, stores SHA-256 hashes, validates format/scopes, and uses `timingSafeEqual` for stored hash comparison.
- `apps/web/src/app/actions/auth.ts:100-177` same-origin-gates login and charges rate limits before Argon2 work; `auth.ts:226-253` rotates sessions and sets httpOnly/secure/sameSite cookies.

CSRF/origin and public route admission:

- `apps/web/src/lib/request-origin.ts:47-146` anchors production origin checks to canonical `BASE_URL` or site config and fails closed when Origin/Referer is missing or mismatched.
- `apps/web/src/lib/action-guards.ts:37-40` centralizes same-origin checks for mutating non-auth server actions.
- `apps/web/src/app/api/search/semantic/route.ts:107-184` enforces same-origin, content-type, non-chunked/body-size limits, and rate limiting before semantic work.
- `apps/web/src/app/api/search/similar/[id]/route.ts` follows the same same-origin, maintenance, ID, rate-limit, and feature-gate shape.
- Share pages `/s/[key]` and `/g/[key]` validate base56 keys and apply rate limits before data lookup.

Uploads, path traversal, and file serving:

- `apps/web/src/app/api/admin/lr/upload/route.ts:84-186` wraps Lightroom upload in admin/PAT auth, rejects chunked uploads, requires bounded `Content-Length`, and uses multipart admission slots.
- `apps/web/src/lib/upload-paths.ts:49-170` keeps originals under a private root, validates filenames, rejects symlinks, uses `realpath`, and enforces root containment.
- `apps/web/src/lib/serve-upload.ts:162-238` allows only derivative directories/extensions, validates each path segment, rejects symlinks, and checks realpath containment before serving.
- `apps/web/src/lib/serve-upload.ts:304-369` opens/stats the validated descriptor and streams that descriptor, closing it on normal and error paths.

Backup/restore, SQL, and child process boundaries:

- `apps/web/src/app/[locale]/admin/db-actions.ts:128-212` same-origin/admin-gates dump creation, validates DB env/TLS configuration, creates owner-only backup directories, and invokes `mysqldump` with static executable/argument arrays.
- `apps/web/src/app/[locale]/admin/db-actions.ts:663-818` validates restore upload size/header/trailer, scans dangerous SQL, validates DB env/TLS, and invokes `mysql` without shell interpolation.
- `apps/web/src/lib/sql-restore-scan.ts:12-155` allowlists app backup tables and rejects dangerous SQL patterns and non-app write targets.
- `apps/web/src/app/api/admin/db/download/route.ts:21-90` wraps backup download in admin auth, validates filenames, enforces realpath containment, streams from a validated descriptor, and sends no-store/nosniff headers.
- Reviewed raw SQL paths use static SQL or Drizzle/sql parameterization for untrusted values; smart collections compile through bounded allowlisted predicates.

CSP/cache/privacy/SSRF:

- `apps/web/src/lib/content-security-policy.ts:139-199` builds a nonce-based production CSP with `object-src 'none'`; `apps/web/next.config.ts:87-107` adds API sandbox CSP and baseline security headers.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:176-196` constructs internal derivative fetch URLs from canonical `BASE_URL`, not request-derived host headers.
- `apps/web/src/lib/og-photo-fetch.ts:31-86` caps internal image fetch size and timeout.
- `apps/web/src/lib/safe-json-ld.ts:14-20` escapes JSON-LD inline payloads.
- `apps/web/public/sw.template.js` excludes admin-rendered pages, revocable share pages, and map/share routes from persistent offline HTML caching.
- `apps/web/src/lib/data.ts` and `search-enrichment-fields.ts` maintain narrow public field sets and type guards for privacy-sensitive fields.

Secrets and dependencies:

- Tracked source contains env examples/placeholders, not live runtime `.env` secrets. Local ignored secret files were intentionally not opened.
- `apps/web/deploy.sh` and `scripts/deploy-remote.sh` reject group/world-readable deploy env files before use.
- Local `npm audit --workspaces --audit-level=low --json` returned zero vulnerabilities across 756 total dependencies.
- `.github/workflows/quality.yml` runs prod dependency audit, auth/origin/public-route lint gates, unit tests, e2e, and build.

## Final Sweep

Reviewed requested areas: OWASP Top 10, auth/authz, CSRF/same-origin, SSRF, path traversal, upload safety, secrets, backup/restore, public route rate limits, CSP/headers, public/private data leakage, token handling, raw SQL, shell/process boundaries, service worker cache behavior, deploy scripts, and CI gates.

Skipped by design: generated dependencies/build output, runtime data/uploads/resources, binary media/font/ICC artifacts, ignored local env secret contents, and the existing untracked `.context/reviews/cycle-8-2026-07-07/perf-reviewer.md`.

Final status: no confirmed or likely repository-code security vulnerability found in this pass. One manual-validation risk remains around release/deploy evidence for already-pushed security-relevant hardening.
