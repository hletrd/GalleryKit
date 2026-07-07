# Cycle 21 Security Review

Date: 2026-07-08 KST
Role lane: `security-reviewer`
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `45b32d1db373e03d82a29511f53832051c770880`
Mode: review-only. No source fixes, commits, pushes, deploys, or live-host changes performed.
Write scope: this file only.

## Required Reads

- `AGENTS.md`, including the project-specific Gallery workspace rules.
- `CLAUDE.md`, including security architecture, runtime topology, deploy, nginx, backup/restore, schema, privacy, and lint-gate sections.
- `.context/plans/README.md`, including the active/deferred plan guidance.
- Local `security-review` skill instructions.

## Security Inventory

Middleware/proxy and headers:

- `apps/web/src/proxy.ts`
- `apps/web/next.config.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/request-origin.ts`

Auth, authz, sessions, origin, tokens, and rate limits:

- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/pending-session-revocations.ts`
- `apps/web/src/lib/admin-mutation-barrier.ts`
- `apps/web/src/lib/advisory-locks.ts`
- `apps/web/src/lib/advisory-lock-release.ts`
- `apps/web/src/lib/single-writer-guard.ts`

API routes:

- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/feed.xml/route.ts`
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`

Server actions:

- `apps/web/src/app/actions/admin-backfill.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/actions/embeddings.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`

Upload, image processing, file serving, and SSRF-adjacent media fetches:

- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-filenames.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/gps-exif-strip.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/storage/types.ts`
- `apps/web/src/lib/og-photo-fetch.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`

Database, backup/restore, migrations, SQL, privacy, and public projections:

- `apps/web/src/db/**`
- `apps/web/drizzle/**`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/lib/sql-like.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/restore-maintenance-durable.ts`
- `apps/web/src/lib/restore-drain-checklist.ts`
- `apps/web/src/lib/db-child-watchdog.ts`
- `apps/web/scripts/migrate.js`
- migration helper scripts under `apps/web/scripts/`

Tests and static security gates:

- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/request-origin.test.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`
- `apps/web/src/__tests__/serve-upload.test.ts`
- `apps/web/src/__tests__/db-restore.test.ts`
- `apps/web/src/__tests__/sql-restore-scan.test.ts`
- `apps/web/src/__tests__/api-auth-response-headers.test.ts`
- `apps/web/src/__tests__/check-api-auth.test.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- `apps/web/src/__tests__/auth-actions-behavior.test.ts`
- `apps/web/src/__tests__/auth-rate-limit.test.ts`
- `apps/web/src/__tests__/admin-tokens.test.ts`
- `apps/web/src/__tests__/lr-upload-route-behavior.test.ts`
- tracked secret, nginx, deploy, migration, and TLS tests where they intersected this review.

Deploy, nginx, container, CI, and supply chain:

- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/nginx/default.conf`
- `.github/workflows/quality.yml`
- `.github/workflows/clip-preflight.yml`
- `.github/dependabot.yml`
- root and workspace package manifests/lockfiles.

## Findings Summary

- Confirmed vulnerabilities at current HEAD: 0.
- Manual-validation risks: 3 Medium.
- Confirmed residual/design risks: 2 Low.
- No missing admin API auth wrapper, missing mutating server-action same-origin guard, direct SQL injection, upload path traversal, backup download traversal, confirmed SSRF primitive, live tracked secret, unauthenticated admin mutation, or public privacy projection leak survived this review.

## Findings

### SEC-21-01 - Public SSR flood protection depends on live host nginx matching the committed template

- Severity: Medium
- Confidence: High that deploy does not apply nginx; Medium for exploitability until the live host is checked.
- Status: Manual-validation risk, not a confirmed source-code vulnerability.
- Region:
  - `CLAUDE.md:247` says public pages are dynamic, app-layer limiters cover API/actions only, and public pages are intentionally throttled at nginx.
  - `CLAUDE.md:510-522` says `apps/web/nginx/default.conf` is a template and production is not protected until an operator applies and verifies it.
  - `apps/web/nginx/default.conf:1-19` defines the public and next-image rate-limit zones.
  - `apps/web/nginx/default.conf:254-272` applies the dedicated `/_next/image` limiter.
  - `apps/web/nginx/default.conf:274-295` applies `limit_req zone=public burst=40 nodelay` to catch-all public page traffic and explicitly notes the manual apply requirement.
- Scenario: A normal `npm run deploy` rebuilds the app container but leaves an older host nginx config in place, or a replacement proxy/CDN omits the equivalent limiter. An unauthenticated attacker floods `/`, `/[topic]`, `/p/[id]`, `/map`, `/timeline`, `/year/*`, `/c/*`, or uncached `/_next/image` tuples. Because page-level throttling is deliberately outside the app, the requests reach dynamic SSR, database reads, Sharp image optimization, and disk cache writes until the app or database degrades.
- Suggested fix: Add a deployment verification step that checks the live `nginx -T` output for `zone=public` and `zone=nextimage`, runs `nginx -t`, reloads safely, and records a burst-test result. If host nginx cannot be guaranteed, add a cheap app-layer fallback limiter for public page data loaders and `/_next/image` equivalents.

### SEC-21-02 - Client-IP security controls depend on proxy topology and X-Forwarded-For handling

- Severity: Medium
- Confidence: High for the code/deploy property; Medium for exploitability until production proxy topology is validated.
- Status: Manual-validation risk, not a confirmed source-code vulnerability.
- Region:
  - `apps/web/docker-compose.yml:15-23` uses host networking and sets `TRUST_PROXY=true`.
  - `apps/web/src/lib/rate-limit.ts:175-214` trusts proxy headers only when `TRUST_PROXY=true`, right-anchors `X-Forwarded-For` using `TRUSTED_PROXY_HOPS`, and falls back to a shared `unknown` bucket when proxy trust is absent.
  - `apps/web/nginx/default.conf:20-28` warns that nginx `$binary_remote_addr` limiters need `realip` or PROXY protocol in load-balancer-fronted topologies.
  - `apps/web/nginx/default.conf:59-71` documents that the shipped config overwrites `X-Forwarded-For` with `$remote_addr` and is correct only when that peer is the real client.
  - `CLAUDE.md:97-98` documents `TRUST_PROXY` and `TRUSTED_PROXY_HOPS`; `CLAUDE.md:748` notes the shared-bucket degradation when proxy trust is wrong.
- Scenario: A TLS terminator or CDN sits in front of nginx and connects from its own IP, but nginx continues to overwrite `X-Forwarded-For` with `$remote_addr` and does not use `real_ip` or append mode. All visitors can collapse into the load balancer's single address. One attacker can burn shared login/search/feed/OG/semantic budgets, cause unrelated users to see 429s, or make rate-limit telemetry misleading. In a different misconfiguration where app proxy trust is disabled, every user can fall into the `unknown` bucket.
- Suggested fix: Verify production with a real request trace: client IP at edge, nginx `$remote_addr`, forwarded headers, and app `getClientIp` result. For LB/CDN-fronted deployments, configure nginx `real_ip`/PROXY protocol for edge limiters, use append-mode `X-Forwarded-For` where appropriate, and set `TRUSTED_PROXY_HOPS` to the true hop count. Add a startup or health diagnostic that fails/warns when all requests appear to share one proxy address.

### SEC-21-03 - Multi-instance deployments weaken process-local coordination while the singleton guard is warn-only

- Severity: Medium
- Confidence: High for code behavior; Medium for exploitability because the documented production topology is single instance.
- Status: Manual-validation risk, not a confirmed vulnerability under the documented topology.
- Region:
  - `CLAUDE.md:244-246` documents the single web-instance/single-writer topology, process-local upload quota/image queue/rate-limit state, and warn-only singleton guard.
  - `apps/web/src/lib/single-writer-guard.ts:7-16` says the guard warns but must not block startup.
  - `apps/web/src/lib/single-writer-guard.ts:218-235` logs the second-instance warning and explicitly continues startup.
  - `apps/web/src/lib/rate-limit.ts:299-427` keeps OG/share/feed/semantic fast-path rate-limit buckets in process memory.
  - `apps/web/src/lib/pending-session-revocations.ts:17-24` documents an accepted process-local restore-window revocation queue.
  - `apps/web/src/lib/admin-mutation-barrier.ts:6-31` documents the process-local foreground mutation fence used during restore windows.
- Scenario: An operator accidentally runs two `gallerykit-web` processes against the same database during a manual restart, host migration, or attempted horizontal scale-out. Both processes can continue after a loud log. An attacker can distribute requests across instances to multiply process-local OG/share/feed/semantic budgets, upload quota tracking can diverge, and restore/session-revocation barriers become harder to reason about because some state is not shared.
- Suggested fix: Keep production explicitly single-instance. If multi-instance is desired, first move the listed controls to shared durable state such as MySQL/Redis/advisory-lock-backed counters and queues. For the current product, consider failing closed in production on confirmed singleton-lock contention unless an explicit `ALLOW_MULTI_INSTANCE_UNSAFE=true` override is set for emergency operation.

### SEC-21-04 - DB backups are plaintext SQL at rest and DB restore is not a full filesystem rollback

- Severity: Low
- Confidence: High.
- Status: Confirmed residual operational risk, not an app auth bypass.
- Region:
  - `CLAUDE.md:226-227` states DB dumps are plaintext SQL under `data/backups/`, served by authenticated API, and host/storage encryption is the operator boundary; restore does not snapshot host files.
  - `apps/web/src/app/api/admin/db/download/route.ts:21-89` properly restricts backup downloads to admin-authenticated requests, validates filename/realpath containment, audits, and returns no-store/nosniff headers.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:430-720` acquires restore/advisory locks, enters durable maintenance, and drains in-flight writers before import.
  - `apps/web/src/lib/sql-restore-scan.ts:87-155` blocks dangerous SQL classes; `apps/web/src/lib/sql-restore-scan.ts:293-330` scans chunk bridges for dangerous statements.
  - `apps/web/src/lib/upload-paths.ts:13-66` separates private originals from public derivatives.
- Scenario: The app's HTTP surface does not expose backups directly, but a host compromise, overly broad host backup job, misplaced filesystem permissions, or off-host copy can expose plaintext SQL containing gallery metadata, admin password hashes, sessions, token hashes, audit data, and private operational state. Separately, restoring a DB dump alone can roll metadata back without rolling the corresponding original/derivative/resource files, creating integrity gaps that may require manual reconciliation.
- Suggested fix: Encrypt DB backup artifacts at rest with an operator-owned key, define retention/rotation, and keep backup copies out of public or broadly readable paths. Pair DB restore runbooks with host-level filesystem backup/restore or reconciliation steps for `data/uploads/original`, `public/uploads`, and `public/resources`.

### SEC-21-05 - Multiple root admins remain a deliberate single-factor authorization model

- Severity: Low
- Confidence: High.
- Status: Confirmed design risk.
- Region:
  - `CLAUDE.md:248` states every admin can upload, edit, export/restore DB backups, change settings, and manage other admins.
  - `CLAUDE.md:649-650` permanently defers 2FA/WebAuthn.
  - `apps/web/src/app/actions/auth.ts:79-160` protects login with same-origin and IP/account rate limits before Argon2 verification.
  - `apps/web/src/app/actions/auth.ts:226-253` creates a rotated 24-hour HttpOnly/Secure/SameSite=Lax session after successful login.
  - `apps/web/src/lib/api-auth.ts:66-152` provides admin API authorization and scoped PAT auth, but admin browser sessions remain root-equivalent.
- Scenario: A compromised admin password, session cookie, or admin browser can perform destructive root operations, including backup download, restore, token creation, setting changes, uploads, and user administration. Existing Argon2id, same-origin checks, session rotation, audit logging, and rate limiting reduce likelihood and improve traceability, but there is no second factor, step-up prompt, or role boundary for the highest-impact actions.
- Suggested fix: If this risk exceeds the personal-gallery threat model, add optional WebAuthn/TOTP and require step-up authentication for DB restore, backup download, admin-token creation, and admin-user management. A smaller alternative is a capability model that separates photo management from backup/restore/user/token administration.

## Positive Security Evidence

Auth, sessions, and admin API:

- `apps/web/src/lib/session.ts:16-36` requires `SESSION_SECRET` in production and uses a dev/test fallback only outside production.
- `apps/web/src/lib/session.ts:82-150` uses HMAC-signed session tokens, constant-time signature comparison, hashed DB storage, token age bounds, and expiry cleanup.
- `apps/web/src/lib/api-auth.ts:66-152` centralizes admin API auth, PAT scope auth for integration requests, same-origin checks for cookie admin APIs, invalid-token rate limiting, and no-store/nosniff defaults.
- `apps/web/src/app/actions/auth.ts:79-160` same-origin gates login and charges IP/account rate limits before expensive password verification.
- `apps/web/src/app/actions/auth.ts:226-253` rotates sessions and sets HttpOnly/Secure/SameSite=Lax cookies.

CSRF/origin:

- `apps/web/src/lib/request-origin.ts:47-146` anchors production expected origin to configured `BASE_URL` or `siteConfig.url`, normalizes trusted proxy protocol, and fails closed without matching `Origin` or `Referer`.
- `npm run lint:action-origin --workspace=apps/web` passed and reported all mutating non-auth server actions enforce same-origin provenance or have explicit approved exemptions.

Rate limits and public unauthenticated routes:

- `apps/web/src/lib/rate-limit.ts:175-214` avoids trusting spoofable proxy headers unless `TRUST_PROXY=true`.
- `apps/web/src/lib/rate-limit.ts:265-427` pre-increments token-auth, OG, share, feed, and semantic buckets before guarded work.
- `apps/web/src/app/api/search/semantic/route.ts:107-184` requires same-origin provenance, rejects chunked/missing/oversized bodies, and charges before semantic mode/body admission work.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed for public mutating/expensive route coverage.

Uploads, file serving, SSRF, and path traversal:

- `apps/web/src/app/api/admin/lr/upload/route.ts:84-188` wraps upload with admin/PAT scope auth, rejects chunked uploads, requires `Content-Length`, enforces file/total caps, and serializes multipart parsing.
- `apps/web/src/app/api/admin/lr/upload/route.ts:190-275` validates file presence/size, sanitizes client filename, validates topic slugs and metadata, rechecks restore maintenance, and acquires the upload-processing lock.
- `apps/web/src/lib/upload-paths.ts:13-66` keeps originals outside public uploads and creates the original directory with private permissions.
- `apps/web/src/lib/upload-paths.ts:120-202` validates original filenames, rejects symlinks, and enforces realpath containment.
- `apps/web/src/lib/serve-upload.ts:162-340` allowlists public upload directories/extensions, validates segments, rejects symlinks and root escapes, emits nosniff/cache headers, and streams from a descriptor statted through the same handle.
- `apps/web/src/lib/process-image.ts:864-930` enforces size limits, writes originals with mode `0600`, validates with Sharp `limitInputPixels`, and removes partial files on invalid image metadata.
- `apps/web/src/lib/og-photo-fetch.ts:30-118` fetches only same-origin derivative paths with a 1 MB cap and bounded timeouts.

Backup, restore, SQL, and privacy:

- `apps/web/src/app/api/admin/db/download/route.ts:21-89` wraps backup downloads with admin auth, filename validation, path/realpath containment, descriptor validation, audit logging, no-store, and nosniff.
- `apps/web/src/app/[locale]/admin/db-actions.ts:430-720` serializes restore with DB/advisory locks, durable maintenance, upload-processing lock, and foreground/background drain checks before import.
- `apps/web/src/lib/sql-restore-scan.ts:1-31` maintains the allowlist of app backup tables; `apps/web/src/lib/sql-restore-scan.ts:87-155` blocks dangerous SQL classes; `apps/web/src/lib/sql-restore-scan.ts:293-330` bridges chunk boundaries during scanning.
- `apps/web/src/lib/data.ts:368-487` derives public select fields by omitting sensitive/admin-only columns and enforces compile-time privacy guards.
- `apps/web/src/__tests__/privacy-fields.test.ts:41-249` locks the public privacy contract and sensitive-key symmetry.

XSS and output encoding:

- `apps/web/src/lib/safe-json-ld.ts:14-19` escapes JSON-LD script-breaking characters.
- Public `dangerouslySetInnerHTML` uses reviewed in photo/page JSON-LD sinks go through `safeJsonLd`.
- `apps/web/src/lib/atom-feed.ts:15-28` XML-escapes and strips forbidden C0 controls before composing Atom feeds.
- `apps/web/src/lib/sql-like.ts:1-10` escapes LIKE wildcards for search patterns.

Secrets, deployment, and supply chain:

- `CLAUDE.md:85-87` correctly treats historical checked-in secret values as compromised and requires rotation if reused.
- `apps/web/deploy.sh:28-43` refuses unsafe runtime env-file permissions before deploy.
- `apps/web/docker-compose.yml:15-32` uses host networking for local MySQL, binds persistent data directories, and mounts site config read-only.
- `apps/web/Dockerfile` uses a digest-pinned Node 24 slim base and non-root runtime ownership.
- `.github/workflows/quality.yml` includes the security lint gates and `npm audit --omit=dev --audit-level=moderate`; `.github/dependabot.yml` keeps npm/docker update monitoring active.

## OWASP Coverage Notes

- A01 Broken Access Control: admin API wrapper lint passed; mutating action origin lint passed; backup/download/upload/restore routes reviewed.
- A02 Cryptographic Failures: session HMAC, production `SESSION_SECRET`, secure cookies, plaintext backup residual risk noted.
- A03 Injection: Drizzle parameterization, SQL restore scanner, LIKE escaping, CSV/XML/JSON-LD escaping reviewed.
- A04 Insecure Design: root-admin/no-2FA and single-instance assumptions recorded as residual design risks.
- A05 Security Misconfiguration: nginx/manual-apply and proxy topology risks recorded.
- A06 Vulnerable Components: `npm audit --workspace=apps/web --audit-level=low` returned 0 vulnerabilities.
- A07 Identification/Auth Failures: Argon2 login flow, IP/account rate limits, session rotation, PAT scopes reviewed.
- A08 Software/Data Integrity Failures: signed sessions, restore scanner, migrations/reconcile path, CI gates reviewed.
- A09 Logging/Monitoring Failures: backup download audit and admin mutation audit surfaces reviewed; live alerting was not inspected.
- A10 SSRF: OG/media fetch paths are same-origin/pinned and size/time capped; no confirmed SSRF primitive found.

## Validation Evidence

Commands run and passed:

- `git rev-parse HEAD` -> `45b32d1db373e03d82a29511f53832051c770880`
- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm audit --workspace=apps/web --audit-level=low` -> `found 0 vulnerabilities`
- `npm test --workspace=apps/web -- src/__tests__/tracked-secrets.test.ts src/__tests__/request-origin.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/serve-upload.test.ts src/__tests__/db-restore.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/api-auth-response-headers.test.ts` -> 8 files / 92 tests passed.
- `npm test --workspace=apps/web -- src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/auth-actions-behavior.test.ts src/__tests__/auth-rate-limit.test.ts src/__tests__/admin-tokens.test.ts src/__tests__/lr-upload-route-behavior.test.ts` -> 7 files / 283 tests passed.

Not run:

- Full `npm test`, `npm run build`, and Playwright e2e. This was a review-only lane; targeted security/privacy/guard tests, lint gates, typecheck, and dependency audit passed.
- Live production host checks, including `nginx -T`, burst tests, TLS/proxy real-IP validation, DB grants, filesystem permissions, and local secret-file contents.

## Final Sweep

No requested source category was intentionally skipped. I did not inspect generated artifacts such as `node_modules`, `.next`, coverage/test-results, or runtime-only host files because they are not source-of-truth code in this repository. I also did not read local secret files such as `.env.local`, `.env.deploy`, or the configured deploy env file.

Existing unrelated dirty files before this write were `.context/reviews/code-reviewer.md`, `.context/reviews/critic.md`, and `.context/reviews/verifier.md`; I left them untouched. This lane changed only `.context/reviews/security-reviewer.md`.

Stop condition: comprehensive repository security review completed, findings recorded with severity/confidence/region/scenario/fix, confirmed vulnerabilities separated from manual-validation/residual risks, validation evidence captured, and no commit or push performed.
