# Cycle 23 Security Review - Security Reviewer Lane

Date: 2026-07-08
Scope: review only, no implementation.
Workspace: `/Users/hletrd/flash-shared/gallery`

## Inventory Built First

Security-relevant inventory was built before issue analysis using `rg --files`, route/action scans, and focused code reads.

Primary application surfaces examined:

- Auth/session/admin: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/proxy.ts`, `apps/web/src/db/schema.ts`.
- CSRF/same-origin/rate limiting: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, admin/public lint tests and scripts.
- Admin APIs/server actions: `apps/web/src/app/api/admin/**/route.ts`, `apps/web/src/app/[locale]/admin/**/*actions*.ts`, `apps/web/src/app/actions/*.ts`.
- Public mutating/expensive routes: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/**`, feed and upload-serving routes.
- Uploads/file serving/path traversal: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/gps-exif-strip.ts`.
- SQL/raw query/restore/backup: `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/db/**`, `apps/web/drizzle/**`.
- Secrets/config/deploy/proxy: `.env.example`, `.env.deploy.example`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `CLAUDE.md`, `.context/plans/README.md`.
- Cross-file invariants: privacy omit guards, admin API wrapper lint, action-origin lint, public route rate-limit lint, single-writer topology, restore maintenance, pending file deletion recovery.

Validation evidence:

- `npm audit --workspace=apps/web --audit-level=moderate`: 0 vulnerabilities.
- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- Targeted Vitest security suite passed: `tracked-secrets`, `session-verify`, `request-origin`, `sql-restore-scan`, `db-restore`, `backup-download-route`, `admin-tokens`, `api-auth-response-headers`, `content-security-policy`, `check-action-origin`, `check-api-auth`, `check-public-route-rate-limit`, `privacy-fields` (13 files, 359 tests).
- Secret scan found only placeholders, tests, and historical review text. No active plaintext production secrets were identified in the repo.

## Findings

### SEC-23-01 - Large multipart ingress still materializes bodies before domain backpressure

Severity: High
Confidence: High
Status: Confirmed source condition
OWASP: A04 Insecure Design, A05 Security Misconfiguration, availability/resource exhaustion

Evidence:

- `apps/web/next.config.ts:111-119` raises the Server Action body ceiling to `NEXT_SERVER_ACTION_BODY_SIZE_LIMIT`, bounded by the largest restore upload.
- `apps/web/src/app/actions/images.ts:87-106` receives already-parsed browser upload `FormData` and enumerates `files` after framework admission.
- `apps/web/src/app/api/admin/lr/upload/route.ts:174-181` performs prechecks but then calls `request.formData()`, which materializes multipart content before route-level per-file logic.
- `apps/web/src/app/[locale]/admin/db-actions.ts:421-427` receives the restore SQL file through a Server Action `FormData`; `apps/web/src/app/[locale]/admin/db-actions.ts:725-745` streams that `File` to disk only after framework multipart parsing has already admitted it.

Failure scenario:

An authenticated admin session or scoped PAT client sends several valid large uploads/restores near the configured 200-250 MiB limits. The app does have auth, length checks, quota accounting, and Sharp pixel limits, but the largest multipart bodies can still be buffered by framework parsing before domain semaphores/backpressure get control. Under concurrent photo processing, CLIP work, or restore activity, this can exhaust memory, trigger GC stalls, or restart the single web process.

Suggested fix:

Move the high-volume upload and restore surfaces to streaming route handlers. Enforce `Content-Length` before body parsing, stream parts to temp files with per-part and aggregate caps, and hand only bounded temp-file descriptors to image processing or SQL restore. Add a shared large-body admission semaphore so upload, PAT upload, and restore cannot independently admit enough memory/disk work to destabilize the process.

### SEC-23-02 - Browser and PAT upload paths duplicate the ingest security contract

Severity: High
Confidence: High
Status: Confirmed cross-file invariant risk
OWASP: A04 Insecure Design, A01 Broken Access Control by future drift

Evidence:

- `apps/web/src/app/actions/images.ts:87-230` implements browser upload auth, same-origin, maintenance, quota, config, topic, and filename validation.
- `apps/web/src/app/actions/images.ts:325-455` implements browser upload original persistence, metadata handling, HDR/GPS behavior, DB insert, tag linking, audit, and queueing.
- `apps/web/src/app/api/admin/lr/upload/route.ts:84-190` implements parallel PAT upload auth, maintenance, content-length, quota, multipart, config, topic, and filename gates.
- `apps/web/src/app/api/admin/lr/upload/route.ts:254-520` mirrors the browser path's original persistence, metadata, HDR/GPS handling, DB insert, tag linking, audit, and queueing.

Failure scenario:

The current paths appear intentionally hardened, but they encode the same security/privacy pipeline twice. A future fix to GPS stripping, color profile handling, audit logging, quota rollback, pending deletion recovery, or queue admission can land in one path and miss the other. The result would be a reachable admin/PAT bypass for a security invariant that reviewers expect to be global.

Suggested fix:

Extract a shared ingest service that owns all security-sensitive upload invariants after the adapter-specific auth/body-read layer. Keep separate browser/PAT adapters only for authentication, request parsing, and response shape. Add parity tests that feed equivalent files and assert identical database, audit, GPS, HDR, queue, quota, and cleanup outcomes.

### SEC-23-03 - Public SSR page limiter is a committed nginx template until the host applies it

Severity: Medium
Confidence: Medium
Status: Manual-validation required
OWASP: A05 Security Misconfiguration, A04 Insecure Design

Evidence:

- `apps/web/nginx/default.conf:1-10` defines shared nginx limit zones, including the public page limiter.
- `apps/web/nginx/default.conf:274-310` applies `limit_req zone=public burst=40 nodelay` only in the host nginx catch-all `location /`.
- `apps/web/deploy.sh:51-58` performs git pull/build/compose deploy for the container and does not copy or reload host nginx configuration.
- `CLAUDE.md:511-523` explicitly states that nginx config changes are inert in production until an operator applies and verifies them.

Failure scenario:

If production host nginx predates the committed template, unauthenticated dynamic public pages such as `/`, `/[topic]`, `/p/[id]`, `/map`, `/timeline`, `/year/*`, and `/c/*` remain outside app-layer API/action limiters. A bot can repeatedly force SSR/database work while the repo appears to contain the intended protection.

Suggested fix:

Record live `nginx -T` and burst-test evidence for the current host in the cycle ledger. Longer term, either make deploy validate/apply the required nginx snippet or add an app-layer fallback for public SSR page budgets when the expected edge header/limiter is absent.

### SEC-23-04 - IP-based controls depend on exact live proxy topology

Severity: Medium
Confidence: Medium
Status: Manual-validation required
OWASP: A05 Security Misconfiguration, A07 Identification and Authentication Failures

Evidence:

- `apps/web/nginx/default.conf:20-32` warns that `$binary_remote_addr` is only correct if the host peer is the real client and calls out CDN/load-balancer caveats.
- `apps/web/nginx/default.conf:59-72` overwrites forwarded headers with `$remote_addr`, `$host`, and `$scheme`.
- `apps/web/src/lib/rate-limit.ts:175-216` derives client IP from forwarded headers only when trusted-proxy settings and hop counts are configured as expected; otherwise it can collapse to `unknown`.
- `apps/web/src/lib/request-origin.ts:81-107` uses configured base-origin checks first, then trusted header fallbacks.

Failure scenario:

If the live topology changes to include a CDN, reverse proxy, tunnel, or load balancer without matching nginx `real_ip`/PROXY protocol and `TRUSTED_PROXY_HOPS` settings, IP-based controls can either bucket all visitors under one proxy address or trust spoofable client-supplied forwarding headers. That weakens login throttling, PAT auth throttling, public search/OG/semantic rate limits, and origin normalization.

Suggested fix:

Treat proxy topology as a deploy-time security invariant. Capture live request-header evidence from the app, `nginx -T` evidence for `real_ip`/forwarding behavior, and configured `TRUSTED_PROXY_HOPS`/base URL values. Add a startup or health diagnostic that fails or clearly alerts when production sees ambiguous forwarded chains.

### SEC-23-05 - Multi-instance deployment remains warn-only while security state is process-local

Severity: Medium
Confidence: High
Status: Confirmed accepted topology risk
OWASP: A04 Insecure Design, A05 Security Misconfiguration

Evidence:

- `CLAUDE.md:244-247` documents a single web-instance/single-writer topology and lists process-local restore, quota, queue, and rate-limit state.
- `apps/web/src/lib/single-writer-guard.ts:6-18` states the startup guard cannot enforce single-instance operation and must not fail startup.
- `apps/web/src/lib/single-writer-guard.ts:218-235` emits a loud warning when another live instance holds the singleton lock, then continues startup.

Failure scenario:

A compose scale-out, accidental second container, or blue/green overlap beyond the tolerated window splits process-local controls. Restore maintenance fencing, upload quota fast paths, queue status, and several rate-limit fast paths no longer have one authority. Some controls have DB backing, but the documented posture is not multi-instance safe.

Suggested fix:

Preserve the single-instance invariant operationally and monitor for the loud guard message. If horizontal scaling is required, move restore fences, quota accounting, queue state, and all public/admin rate-limit authority to shared durable storage, then make persistent singleton contention fail closed outside a controlled rolling-deploy window.

### SEC-23-06 - Backup confidentiality and full rollback are operator boundaries

Severity: Low
Confidence: High
Status: Confirmed residual risk
OWASP: A02 Cryptographic Failures, A05 Security Misconfiguration

Evidence:

- `CLAUDE.md:223-228` documents that SQL dumps are plaintext at rest in non-public storage and that DB restore does not snapshot or roll back host upload/resource files.
- `apps/web/src/app/[locale]/admin/db-actions.ts:228-243` creates backup files under the configured backup directory and passes DB credentials to `mysqldump` through environment variables.
- `apps/web/src/app/api/admin/db/download/route.ts:21-89` authenticates backup downloads, validates filenames, sets no-store/nosniff headers, and streams the selected backup.

Failure scenario:

A host-level compromise, overly broad filesystem backup, or misconfigured backup storage exposes plaintext SQL dumps. Separately, a database restore can intentionally rewind database rows without rolling back `data/uploads/original`, `public/uploads`, or `public/resources`, leaving orphaned or mismatched files until reconciliation/operator cleanup.

Suggested fix:

Keep documenting this as an operator boundary unless the threat model changes. For stronger posture, encrypt backups at rest with managed host/storage keys, restrict backup directory permissions, and pair DB backups with filesystem snapshots or an explicit post-restore reconciliation workflow.

### SEC-23-07 - Admin authentication is password-only; no second factor or role boundary

Severity: Low
Confidence: High
Status: Confirmed design gap / accepted product decision
OWASP: A07 Identification and Authentication Failures, A01 Broken Access Control

Evidence:

- `apps/web/src/db/schema.ts:193-200` stores admin accounts as username plus password hash, with no MFA credential table.
- `apps/web/src/app/actions/auth.ts:79-150` implements login with same-origin checks, per-IP and per-account rate limits, and Argon2 verification.
- `apps/web/src/app/actions/auth.ts:217-253` issues a 24-hour HttpOnly, Secure-in-production, SameSite=Lax session cookie.
- `apps/web/src/db/schema.ts:225-241` stores scoped PATs, but browser admins are still root admins.
- `CLAUDE.md:248-248` documents that all admins are root admins with no role/capability model.

Failure scenario:

A stolen admin password, session token, or unlocked admin browser gives full access to upload, edit, export/restore backups, change settings, and manage admins. Existing password hashing, throttling, session fixation protection, and PAT hashing reduce risk, but do not provide phishing-resistant or least-privilege controls.

Suggested fix:

If this gallery's exposure or operator risk increases, add optional WebAuthn/TOTP MFA with recovery codes, session reauthentication for backup/restore/admin-management actions, and at least coarse admin capability boundaries.

### SEC-23-08 - Public keyword search and smart-collection contains predicates can force leading-wildcard scans

Severity: Medium
Confidence: High
Status: Confirmed source condition; live impact depends corpus size
OWASP: A04 Insecure Design, A05 Security Misconfiguration

Evidence:

- `apps/web/src/app/actions/public.ts:247-317` exposes public search with sanitization and per-IP rate limiting, then calls `searchImages`.
- `apps/web/src/lib/sql-like.ts:5-10` escapes LIKE metacharacters but intentionally builds `%term%` contains patterns.
- `apps/web/src/lib/data.ts:1574-1655` searches public image fields with multiple `containsLike` predicates and a date/id order.
- `apps/web/src/lib/data.ts:1693-1737` adds tag and topic-alias branches that can perform additional contains matching when the main result set is short.
- `apps/web/src/lib/smart-collections.ts:221-267` compiles admin-defined smart-collection `contains` predicates, including tag subqueries, to LIKE contains scans.

Failure scenario:

The current public search rate limit is useful, but allowed two-character/common-substring searches can still drive non-index-friendly `%term%` scans and tag/alias subqueries. A crawler or bot staying inside the per-IP budget can consume disproportionate DB CPU as the gallery corpus grows.

Suggested fix:

Move public keyword search to a bounded indexed search primitive, such as MySQL full-text/ngram indexes or a maintained search table. Alternatively, add a cost-aware limiter for expensive query shapes, minimum selectivity rules, or tighter per-IP budgets for public contains searches. For smart collections, restrict public-facing contains predicates or precompute collection membership.

### SEC-23-09 - Public semantic/similar routes synchronously scan embedding vectors per request

Severity: Low
Confidence: High
Status: Confirmed bounded availability risk
OWASP: A04 Insecure Design, A05 Security Misconfiguration

Evidence:

- `apps/web/src/app/api/search/semantic/route.ts:1-17` documents that the public same-origin endpoint embeds a query and scans up to `SEMANTIC_SCAN_LIMIT` embeddings.
- `apps/web/src/lib/clip-embeddings.ts:36-48` allows `SEMANTIC_SCAN_LIMIT` up to a hard max of 25,000, with default 2,000.
- `apps/web/src/app/api/search/semantic/route.ts:263-311` loads recent embeddings, decodes/scored vectors, and ranks `topK` in the request path.
- `apps/web/src/app/api/search/similar/[id]/route.ts:1-29` documents the same shared semantic budget for image-to-image similarity.
- `apps/web/src/app/api/search/similar/[id]/route.ts:177-214` scans embeddings, computes dot products, and ranks results in the request path.
- `apps/web/src/lib/rate-limit.ts:24-35` documents that these routes are charged after expensive semantic work is admitted.

Failure scenario:

Same-origin gating and rate limits reduce internet-wide abuse, but admitted requests still perform synchronous vector scans in the Node request path. If `SEMANTIC_SCAN_LIMIT` is raised for quality, if the corpus grows, or if many clients share one trusted origin, semantic search can become a CPU/DB availability pressure point.

Suggested fix:

Keep `SEMANTIC_SCAN_LIMIT` conservative in production and monitor latency/CPU. For larger corpora, move similarity search to a vector index or precomputed nearest-neighbor table, and add a concurrency cap for semantic work separate from the per-IP request budget.

## Positive Controls Observed

- Admin API route exports are covered by `withAdminAuth(...)` linting and the current admin API files pass the gate.
- Mutating server actions are covered by same-origin linting; read-only exemptions are explicit and current lint passed.
- Public mutating/expensive routes are covered by the public-route rate-limit lint and current lint passed.
- Session cookies are HttpOnly, Secure when HTTPS/production, SameSite=Lax, and regenerated through an insert/delete transaction after successful login.
- Login throttling is both IP-scoped and account-scoped, with pre-increment before Argon2 verification.
- Upload/file-serving paths use UUID filenames, directory whitelists, path normalization checks, derivative-only public serving, `nosniff`, and original-file exclusion.
- SQL restore includes header scanning and restore postconditions; current tests for raw SQL restore scanning passed.
- Pending file deletion recovery is present and tied into maintenance scheduling/restore completion.
- Public data privacy fields are protected by compile-time guards and tests.
- No active plaintext production secrets were found in the repository scan.

## OWASP Top 10 Coverage Notes

- A01 Broken Access Control: reviewed admin auth wrappers, server action guards, PAT scopes, root-admin model, public/private data selection, and backup download access.
- A02 Cryptographic Failures: reviewed session tokens, cookie properties, password/PAT hashing posture, plaintext backup boundary, and secret storage patterns.
- A03 Injection: reviewed Drizzle usage, raw SQL restore/maintenance surfaces, LIKE escaping, SQL restore scan, CSV/OG/string sanitizers, and query validation.
- A04 Insecure Design: findings cover upload body admission, duplicated ingest invariants, process-local single-writer assumptions, public search cost, and semantic vector scans.
- A05 Security Misconfiguration: findings cover nginx template application, proxy topology, single-instance deployment, body limits, and backup operator boundaries.
- A06 Vulnerable and Outdated Components: `npm audit --workspace=apps/web --audit-level=moderate` reported 0 vulnerabilities.
- A07 Identification and Authentication Failures: reviewed login throttling, sessions, admin password-only design, PAT verification, and proxy-derived IP assumptions.
- A08 Software and Data Integrity Failures: reviewed migration/restore postconditions, backup/restore flow, and pending file deletion recovery.
- A09 Security Logging and Monitoring Failures: reviewed audit logging around admin/PAT/backup/upload flows and noted topology/proxy/nginx evidence gaps as operational validation issues.
- A10 SSRF: reviewed OG canonical-origin posture in docs, internal derivative fetch guidance, and request-origin helpers; no active SSRF finding was identified in this pass.

## Final Missed-Issues Sweep

Final sweep re-checked the highest-risk cross-file invariants against code and tests:

- Admin APIs: route exports and response headers covered by lint/tests.
- Server actions: mutating action same-origin guard lint passed.
- Public routes: route-rate-limit lint passed for currently registered expensive/mutating handlers.
- Uploads: traversal controls and derivative serving look sound; residual issues are body admission and duplicated ingest logic.
- SQL/raw queries: restore scanner tests passed; raw SQL surfaces reviewed without finding string-concatenated untrusted SQL.
- Secrets: repo scan found placeholders/tests/historical report text only.
- SSRF: no current request-origin-derived internal fetch issue found; canonical-base documentation is explicit.
- Backup/restore: no unauthenticated access found; residual risks are confidentiality-at-rest and DB/filesystem rollback scope.

Finding count: 9.
