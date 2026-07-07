# Cycle 20 Security Review

Date: 2026-07-08 KST
Role lane: `security-reviewer`
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `bd0cc170`
Mode: review-only. No source fixes, commits, pushes, deploys, or live-host changes performed.
Write scope: this file only.

## Scope And Method

Read first:

- `AGENTS.md` and the project-specific AGENTS block for `/Users/hletrd/flash-shared/gallery`.
- `CLAUDE.md`, including security architecture, runtime topology, deploy, nginx, backup/restore, schema, privacy, and lint-gate sections.
- Local `security-review` skill instructions.

Inventory covered:

- Public/admin API routes: `apps/web/src/app/api/**/route.ts*`, public upload/feed/OG/search/health/live routes, `api/admin/db/download`, and `api/admin/lr/upload`.
- Server actions: `apps/web/src/app/actions/*.ts` and `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Auth/origin/session/token/rate-limit modules: `session.ts`, `api-auth.ts`, `admin-tokens.ts`, `request-origin.ts`, `action-guards.ts`, `rate-limit.ts`, `admin-mutation-barrier.ts`, restore-maintenance helpers, and advisory-lock helpers.
- Upload/image/file modules: `serve-upload.ts`, `process-image.ts`, `upload-paths.ts`, `upload-filenames.ts`, `gps-exif-strip.ts`, `process-topic-image.ts`, `og-photo-fetch.ts`, and derivative/original serving routes.
- Data/SQL/privacy modules: `data.ts`, `data-timeline.ts`, `search-enrichment-fields.ts`, `smart-collections.ts`, `sql-like.ts`, schema/migrations under `apps/web/drizzle/**`, `scripts/migrate.js`, and restore SQL scanner tests/contracts.
- Backup/restore/deploy/supply chain: `db-actions.ts`, `api/admin/db/download/route.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `mysql-cli-ssl.ts`, `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `scripts/deploy-remote.sh`, `nginx/default.conf`, env examples, package manifests, lockfiles, lint scripts, and security tests.

I did not read live local secret files such as `.env.local` or `.env.deploy`; tracked-secret checks were limited to tracked files/placeholders.

## Findings Summary

- Total findings: 5
- Critical: 0
- High: 0
- Medium: 2
- Low: 3
- Classification: confirmed design/config risks: SEC-20-03, SEC-20-04, SEC-20-05; likely issues: none; manual-validation risks: SEC-20-01, SEC-20-02.

No missing admin API auth wrapper, missing mutating server-action same-origin guard, direct SQL injection, upload path traversal, backup download traversal, confirmed SSRF primitive, live tracked secret, unauthenticated admin mutation, or public privacy projection leak survived this review.

## Findings

### SEC-20-01 - Public SSR page flood protection depends on manually applied host nginx config

- Severity: Medium
- Classification: Manual-validation risk.
- Confidence: High that deploy does not apply nginx; Medium for live exploitability because it depends on actual host config.
- Region:
  - `CLAUDE.md:247` states public pages are intentionally throttled only at the nginx edge and per-iteration deploys do not touch host nginx.
  - `CLAUDE.md:510-522` says `apps/web/nginx/default.conf` is an inert template until an operator applies and verifies it.
  - `apps/web/nginx/default.conf:274-295` applies `limit_req zone=public burst=40 nodelay` only in catch-all `location /`.
  - `apps/web/nginx/default.conf:290-293` explicitly requires manual `nginx -t` plus reload.
  - Public pages are uncached dynamic SSR, for example `apps/web/src/app/[locale]/(public)/page.tsx:17-19` and `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:40-42`.
- Scenario: A normal `npm run deploy` succeeds, but the live host is still running an older nginx config, a replacement proxy, or a bypass path without the committed public limiter. An attacker floods `/`, `/map`, `/timeline`, topic pages, photo pages, or collection/share pages. Because the app intentionally has no public-page limiter, these requests fan into Next SSR and database work until app or DB availability degrades.
- Fix: Make deploy or a required post-deploy check verify the live nginx config contains the expected public and next-image limiters, for example by comparing `nginx -T` output on the host and failing the deployment ledger if missing. Longer term, add a cheap app-layer fallback limiter around public page data loaders so a proxy misconfiguration cannot remove the final availability control.

### SEC-20-02 - Multi-instance deployment weakens process-local security controls while the singleton guard is warn-only

- Severity: Medium
- Classification: Manual-validation risk.
- Confidence: High for the code property; Medium for production exploitability because the documented topology is single instance.
- Region:
  - `CLAUDE.md:244-248` documents single web-instance assumptions, process-local upload quota/image queue/rate-limit state, and multiple root admins.
  - `apps/web/src/lib/single-writer-guard.ts:7-16` says the topology guard detects and warns but must not block startup.
  - `apps/web/src/lib/upload-tracker-state.ts:7-20` stores upload quota claims in a `globalThis` process map.
  - `apps/web/src/lib/rate-limit.ts:78-109` stores OG/share/feed buckets in process-local maps.
  - `apps/web/src/lib/rate-limit.ts:404-427` stores semantic search buckets in a process-local map.
  - `apps/web/src/lib/clip-embeddings.ts:36-48` allows semantic scans up to 25,000 rows by env cap, defaulting to 2,000.
- Scenario: An operator horizontally scales the web service or accidentally leaves two web containers sharing one database. The guard logs contention but both processes can keep serving. An attacker can distribute requests across instances to multiply public OG/share/feed/semantic budgets, bypass per-process upload quotas, or hit semantic routes with expensive embedding/vector scans on each instance. Restore and queue state also become harder to reason about because some coordination is process-local.
- Fix: Either make the singleton guard fail closed in production unless an explicit `ALLOW_MULTI_INSTANCE_UNSAFE=true` override is set, or move the listed controls to shared durable state such as MySQL/Redis/advisory locks. If scale-out is a future goal, start with shared semantic/OG/share/feed limiters, upload quota accounting, image queue state, and restore maintenance state before adding replicas.

### SEC-20-03 - Multiple root admins remain a deliberate single-factor authz model

- Severity: Low
- Classification: Confirmed design/authz risk.
- Confidence: High.
- Region:
  - `CLAUDE.md:248` states every admin can upload, edit, export/restore DB backups, change settings, and manage other admins.
  - `CLAUDE.md:649-650` permanently defers 2FA/WebAuthn.
  - `apps/web/src/app/actions/admin-users.ts:79-92` creates new admins after same-origin/admin checks but without roles/capability assignment.
  - `apps/web/src/app/actions/admin-users.ts:194-218` lets any current admin delete another admin except self/final-admin protections.
  - `apps/web/src/app/actions/auth.ts:216-253` creates one 24-hour admin session cookie after password authentication.
- Scenario: A single compromised admin password, browser session, or endpoint with cookie access grants the attacker full root privileges, including DB backup download/restore and PAT creation/revocation. Existing Argon2id, rate limiting, session rotation, and audit logging reduce likelihood and improve traceability, but there is no second factor or role boundary for the most destructive operations.
- Fix: If this risk is no longer acceptable for cycle 20+, add optional WebAuthn/TOTP for admin login and step-up authentication for DB restore, backup download, token creation, and admin-user management. A smaller alternative is a capability model that separates routine photo management from backup/restore and user/token administration.

### SEC-20-04 - Production CSP still allows inline styles

- Severity: Low
- Classification: Confirmed configuration hardening risk.
- Confidence: High.
- Region:
  - `apps/web/src/lib/content-security-policy.ts:182-190` documents the production style allowance and emits `style-src 'self' 'unsafe-inline'`.
  - Public JSON-LD sinks reviewed use `safeJsonLd`, for example `apps/web/src/app/[locale]/(public)/page.tsx:214-230` and `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:270-285`; `apps/web/src/lib/safe-json-ld.ts:14-19` escapes script-breaking characters.
- Scenario: I did not find a current script XSS sink. The residual risk is defense-in-depth: if a future feature accidentally renders attacker-controlled HTML/style attributes, the nonce-gated script policy blocks JavaScript but inline CSS can still support UI redress, deceptive overlays, hidden warnings, or CSS-based data-adjacent abuse in vulnerable DOM contexts.
- Fix: Keep the allowance only while framework/component constraints require it. Track it as CSP debt and test a stricter policy using nonce/hash-supported style tags, extracted CSS, or framework nonce propagation, then remove `'unsafe-inline'` after browser coverage confirms hydration and component styling remain stable.

### SEC-20-05 - Tracked historical review logs contain redacted secret-like lines and can normalize unsafe logging

- Severity: Low
- Classification: Confirmed repository hygiene risk.
- Confidence: High.
- Region:
  - `.context/reviews/logs-cycle4/security-reviewer.log:158-159` contains redacted `ADMIN_PASSWORD` and `SESSION_SECRET` lines.
  - `.context/reviews/logs-cycle4/security-reviewer.log:19495-19496` contains redacted `apps/web/.env.local` secret lines from a prior scan.
  - `README.md:152-153`, `CLAUDE.md:81-82`, and `apps/web/.env.local.example:27-33` contain placeholders, not live secrets.
- Scenario: I did not find live tracked credentials. The issue is operational: committed logs containing secret-shaped output create scanner noise and normalize storing command transcripts that include env-file paths. If a future redaction fails, the same pattern could commit real secrets, and alert fatigue may make the leak harder to notice.
- Fix: Keep committed review artifacts summarized rather than raw terminal transcripts, or add a tracked-secret guard that blocks `.context/reviews/logs-*` files containing secret assignment patterns unless they match a strict placeholder/redaction allowlist. Consider moving old raw logs outside the tracked tree after preserving any needed conclusions.

## Positive Security Evidence

Auth, sessions, and admin guards:

- `apps/web/src/lib/session.ts:16-36` requires `SESSION_SECRET` in production and refuses the DB fallback there.
- `apps/web/src/lib/session.ts:82-150` uses HMAC-signed session tokens, constant-time comparison, hashed DB storage, token age bounds, and expiry cleanup.
- `apps/web/src/lib/api-auth.ts:66-152` centralizes admin API auth, PAT scope auth for integrations, same-origin checks for cookie admin APIs, invalid-token rate limiting, and no-store/nosniff response defaults.
- `apps/web/src/app/actions/auth.ts:79-180` same-origin gates login and charges IP/account rate limits before Argon2 verification; `auth.ts:216-253` rotates sessions and sets HttpOnly/Secure/SameSite=Lax cookies.
- `npm run lint:api-auth --workspace=apps/web` and `npm run lint:action-origin --workspace=apps/web` passed.

Rate limiting and public routes:

- Login and account login have DB-backed counters with in-memory fast paths.
- Public action/API linting passed with `npm run lint:public-route-rate-limit --workspace=apps/web`.
- Semantic routes reject missing/oversized/chunked bodies, require same-origin provenance, and charge before expensive work (`apps/web/src/app/api/search/semantic/route.ts:107-184`).

Uploads, path traversal, and file serving:

- `apps/web/src/lib/serve-upload.ts:168-238` validates upload path segments, directory/extension pairing, symlinks, realpath containment, file type, and content type; `serve-upload.ts:304-369` streams from a descriptor statted through the same handle.
- `apps/web/src/lib/upload-paths.ts` keeps originals private, validates original filenames, rejects symlinks, and enforces realpath containment.
- `apps/web/src/lib/process-image.ts` bounds file size/pixels, rejects RAW-like formats, writes originals with restrictive permissions, and cleans partial files on failure.
- Lightroom upload is wrapped with `withAdminAuth(..., { allowTokenScope: 'lr:upload' })`, rejects chunked uploads, requires `Content-Length`, and enforces per-file/total caps.

Backup, restore, SQL, and child processes:

- `apps/web/src/app/[locale]/admin/db-actions.ts` same-origin/admin gates export, backup, and restore; uses static executable/argument arrays for `mysqldump`, `mysql`, and migration child processes; validates dump headers/trailers; scans restore SQL; and holds restore/maintenance fences.
- `apps/web/src/lib/sql-restore-scan.ts:87-155` blocks dangerous SQL classes, and `sql-restore-scan.ts:261-303` rejects schema-qualified or non-app write targets.
- `apps/web/src/app/api/admin/db/download/route.ts:21-89` wraps backup download in admin auth, validates filenames, checks realpath containment, validates the descriptor, audits, and emits no-store/nosniff headers.
- Reviewed user-controlled SQL paths use Drizzle/sql parameterization or static allowlisted SQL. Raw `conn.query(...)` call sites reviewed were migration/admin-lock/backup-restore paths with controlled SQL or parameter arrays.

XSS, SSRF, CSP, and headers:

- Public `dangerouslySetInnerHTML` use is JSON-LD with `safeJsonLd`, which escapes `<`, `>`, U+2028, and U+2029.
- `apps/web/src/lib/request-origin.ts:47-146` anchors production same-origin checks to configured origin and fails closed on missing/mismatched provenance by default.
- OG/photo URL helpers pin fetches to configured same-origin URLs and validate externally configured image base URLs.
- `apps/web/next.config.ts`, `apps/web/src/proxy.ts`, and `apps/web/src/lib/content-security-policy.ts` set no-sniff, frame, referrer, permissions, HSTS, CSP nonce, and strict API headers.

Secrets and dependencies:

- Tracked env examples contain placeholders. I did not inspect untracked/local secret env values.
- `npm audit --workspace=apps/web --omit=dev --json` and `npm audit --workspace=apps/web --json` both reported 0 vulnerabilities.
- Docker uses a digest-pinned Node 24 slim base and a non-root runtime path.

## Validation Evidence

Commands run and passed:

- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm audit --workspace=apps/web --omit=dev --json`
- `npm audit --workspace=apps/web --json`
- `npm test --workspace=apps/web -- src/__tests__/privacy-fields.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/request-origin.test.ts src/__tests__/session.test.ts src/__tests__/session-verify.test.ts src/__tests__/api-auth-response-headers.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/semantic-search-rate-limit.test.ts src/__tests__/tracked-secrets.test.ts` — 10 files / 201 tests passed.

Final missed-issues sweep:

- Re-scanned `TODO|FIXME|SECURITY|@action-origin-exempt|@public-no-rate-limit-required|dangerouslySetInnerHTML|eval|Function|spawn|queryRaw|sql.raw|.query(` across `apps/web/src`, `apps/web/scripts`, deploy, and nginx files.
- Re-scanned tracked files for common secret/token patterns. Only placeholders/redacted historical review-log lines were found.
- Rechecked existing dirty worktree state before writing; other modified review artifacts were `.context/reviews/architect.md`, `.context/reviews/code-reviewer.md`, `.context/reviews/critic.md`, `.context/reviews/debugger.md`, `.context/reviews/designer.md`, `.context/reviews/perf-reviewer.md`, `.context/reviews/tracer.md`, and `.context/reviews/verifier.md`. I did not modify them.

Not run:

- Full `npm test`, `npm run build`, and Playwright e2e. This was a review-only lane; targeted security/privacy/guard tests, lint gates, typecheck, and audits passed.

## Manual Follow-Up Areas

- Verify live host nginx with `nginx -T` and an actual burst test; source review cannot prove the committed template is loaded.
- Verify deployed TLS termination, proxy real-IP handling, DB grants, backup at-rest controls, filesystem permissions, and local secret file modes on the production host.
- If semantic search is enabled in production, load-test `/api/search/semantic` and `/api/search/similar/[id]` under the configured CLIP model and scan limit.

Stop condition: comprehensive source review completed, findings recorded with severity/confidence/region/scenario/fix, security gates validated, and only this review artifact changed by this lane.
