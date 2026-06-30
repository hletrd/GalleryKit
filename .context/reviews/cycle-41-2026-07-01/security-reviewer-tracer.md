# Cycle 41 Security Reviewer + Tracer

Scope: current `master` HEAD `ae71bd5a` (`fix(cycle-40): align download labels and scanners`).
Mode: deep review only; no implementation changes.

## Result

No new actionable security findings.

The Cycle 40 -> Cycle 41 code delta is small and security-relevant primarily in guardrail code:

- `apps/web/scripts/check-action-origin.ts` now discovers nested action files and recognizes Drizzle relational protected reads.
- `apps/web/scripts/check-public-route-rate-limit.ts` now treats imported DB/data/serve helpers as expensive public route work.
- `apps/web/src/lib/download-labels.ts` centralizes JPEG download copy selection; callers only changed labels/descriptions, not download URLs or serving paths.

I did not re-raise prior deferred/carry-forward items. No new evidence in this lane changes their severity or makes them scheduled now.

## Inventory Reviewed

### Auth / Authz / Session / Token Boundaries

- `apps/web/src/lib/api-auth.ts:58-144` — `withAdminAuth`, cookie-vs-PAT auth split, token-scope authorization, same-origin check, no-store/nosniff defaults.
- `apps/web/src/lib/request-origin.ts:45-107` — trusted origin/proxy normalization and fail-closed Origin/Referer policy.
- `apps/web/src/lib/action-guards.ts:37-44` — canonical server-action same-origin helper.
- `apps/web/src/app/actions/auth.ts:77-260` — login origin gate, rate-limit pre-increment, Argon2 verification, session creation.
- `apps/web/src/lib/session.ts:16-150` — production `SESSION_SECRET` requirement, HMAC session token validation, hashed session storage.
- `apps/web/src/lib/admin-tokens.ts:52-168` — PAT generation, hashing, constant-time digest comparison, scope/expiry verification.

### CSRF / Same-Origin / Scanner Guardrails

- `apps/web/scripts/check-action-origin.ts:58-108`, `410-489`, `622-708`, `763-1030`.
- `apps/web/scripts/check-public-route-rate-limit.ts:37-88`, `203-246`, `380-497`, `499-752`.
- `apps/web/src/proxy.ts:65-129` — middleware admin cookie shape precheck and production CSP request headers.

### Public APIs / Rate Limits / Expensive Reads

- `apps/web/src/app/api/search/semantic/route.ts:107-365`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:68-271`.
- `apps/web/src/app/api/og/route.tsx:61-136`.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:39-295`.
- `apps/web/src/lib/rate-limit.ts` and targeted scanner tests.

### Upload / File Serving / Path Traversal

- `apps/web/src/app/actions/images.ts:240-610` — browser upload quota claim, topic validation, GPS strip, DB insert, enqueue snapshot.
- `apps/web/src/app/api/admin/lr/upload/route.ts:84-579` — PAT/cookie upload API, content-length bounds, upload tracker, parsing slot, validation, locks, GPS strip, insert/enqueue.
- `apps/web/src/lib/upload-paths.ts:49-193` — private original root, safe original filename, realpath containment, symlink rejection.
- `apps/web/src/lib/serve-upload.ts:126-328` — public derivative serving allowlist, extension mapping, segment validation, lstat/realpath containment, no symlink serving, nosniff.

### Backup / Restore / Commands / SQL

- `apps/web/src/app/[locale]/admin/db-actions.ts:164-260`, `365-780` — backup/restore auth, advisory locks, maintenance lifecycle, temp file handling, `mysqldump`/`mysql` spawn calls.
- `apps/web/src/app/api/admin/db/download/route.ts:21-109` — authenticated backup download with filename validation and realpath containment.
- `apps/web/src/lib/sql-restore-scan.ts:12-252` — restore table allowlist, destructive SQL detector, schema-qualified target rejection.
- Raw command surface sweep: `spawn('mysqldump', [...])`, `spawn('mysql', [...])`, and `spawn(process.execPath, [scriptPath])` use argument arrays, not shell execution.

### Privacy / CSP / Headers / Deploy

- `apps/web/src/lib/data.ts:368-489` — canonical public select omissions and compile-time privacy guards.
- `apps/web/src/lib/search-enrichment-fields.ts:29-47` — public semantic/similar enrichment field guard.
- `apps/web/src/lib/content-security-policy.ts:68-123`, `apps/web/next.config.ts:51-90`, `apps/web/src/proxy.ts:21-49`.
- `apps/web/deploy.sh:56-85`, `scripts/deploy-remote.sh:55-86` — deploy env permission checks and documented prune-after-health behavior.

## High-Risk Flow Traces

### Flow 1: Browser Admin Upload -> Private Original -> DB Row -> Processing Queue -> Public Derivative

Trace:

1. Mutating upload action is covered by `lint:action-origin`, and the actual action uses the shared origin/auth posture before privileged work (`apps/web/src/app/actions/images.ts`, gate verified by scanner output).
2. Upload quota is claimed before awaited expensive work to avoid concurrent bypass (`apps/web/src/app/actions/images.ts:252-262`).
3. Topic slug is format-validated and existence-checked before files are accepted into the durable record path (`apps/web/src/app/actions/images.ts:287-313`).
4. Originals are saved with UUID-derived names by `saveOriginalAndGetMetadata`; the public serving path never includes the `original` directory.
5. If `stripGpsOnUpload` is enabled, DB GPS fields are nulled and the retained original is stripped on disk before insert (`apps/web/src/app/actions/images.ts:399-416`).
6. Inserted public rows receive only safe/public fields on anonymous read surfaces; sensitive fields stay out of `publicSelectFields` (`apps/web/src/lib/data.ts:368-489`).
7. Queue jobs carry the upload-time processing snapshot, including color/HDR knobs and semantic mode (`apps/web/src/app/actions/images.ts:520-551`).
8. Public derivative serving allows only `jpeg`, `webp`, `avif`, validates every path segment, enforces extension-directory matching, rejects symlinks, checks realpath containment, and serves from an already-opened descriptor (`apps/web/src/lib/serve-upload.ts:126-328`).

Non-finding: I did not find a path traversal or original-file exposure path in this flow. The browser download-label change does not alter `href`; it only switches copy through `getJpegDownloadCopy` (`apps/web/src/lib/download-labels.ts:6-21`).

### Flow 2: Lightroom/PAT Upload -> Token Scope -> Upload Bounds -> GPS Strip -> Audit

Trace:

1. `withAdminAuth` checks `X-GalleryKit-Token` first only when `allowTokenScope` is configured, rate-limits token auth attempts, verifies token hash/expiry/scopes, and requires the route-specific scope (`apps/web/src/lib/api-auth.ts:68-111`).
2. PAT verification hashes plaintext locally and uses parameterized Drizzle SQL for lookup; plaintext never becomes a SQL parameter (`apps/web/src/lib/admin-tokens.ts:141-168`).
3. The LR route requires non-chunked `Content-Length`, enforces total and per-file upload bounds before `formData()` materialization, and limits multipart parsing to one in-flight parse (`apps/web/src/app/api/admin/lr/upload/route.ts:101-186`).
4. User filename, topic slug, title, and description are sanitized/validated before DB insert (`apps/web/src/app/api/admin/lr/upload/route.ts:188-250`).
5. The route holds the upload-processing contract lock across save -> insert -> enqueue, checks restore maintenance both before and after save, and deletes the original if maintenance begins mid-upload (`apps/web/src/app/api/admin/lr/upload/route.ts:270-429`).
6. GPS strip parity with browser upload is enforced on retained originals (`apps/web/src/app/api/admin/lr/upload/route.ts:394-413`).
7. Inserted rows include upload attribution and a serialized processing-settings snapshot; enqueue forwards all processing knobs (`apps/web/src/app/api/admin/lr/upload/route.ts:431-543`).
8. Successful token uploads write an audit event with sanitized filename, and response headers are no-store/nosniff (`apps/web/src/app/api/admin/lr/upload/route.ts:552-574`; wrapper defaults at `apps/web/src/lib/api-auth.ts:93-105`).

Non-finding: I did not find a PAT authz bypass. Cross-origin PAT use is deliberate; functional authorization is the token scope set, not browser same-origin.

### Flow 3: DB Restore -> Admin Origin -> Locks/Maintenance -> SQL Scan -> `mysql`

Trace:

1. `restoreDatabase` returns early unless the request is same-origin and admin-authenticated (`apps/web/src/app/[locale]/admin/db-actions.ts:365-372`).
2. Restore uses a dedicated MySQL connection for advisory locks, then acquires DB restore, upload-processing, color backfill, and semantic backfill locks before entering the import window (`apps/web/src/app/[locale]/admin/db-actions.ts:374-447`).
3. Durable maintenance starts before queue quiescing and background-write draining; teardown resumes queues only after verified completion or safe failure state (`apps/web/src/app/[locale]/admin/db-actions.ts:449-565`).
4. Uploaded restore file is capped, streamed to a `restore-${randomUUID()}.sql` temp file with mode `0600`, and deleted on every pre-import reject path (`apps/web/src/app/[locale]/admin/db-actions.ts:570-649`).
5. Header validation rejects non-dump inputs; chunked scan calls `containsDangerousSql` before invoking MySQL (`apps/web/src/app/[locale]/admin/db-actions.ts:597-649`).
6. The scanner allows only app backup table write targets, rejects schema-qualified writes, user/privilege statements, routines/triggers/views, `LOAD DATA`, `OUTFILE`, `SOURCE`, `PREPARE/EXECUTE`, and unapproved destructive table operations (`apps/web/src/lib/sql-restore-scan.ts:12-252`).
7. The `mysql` child process uses an argument array with `--one-database`; credentials are passed via env, not command-line flags, and stderr is redacted (`apps/web/src/app/[locale]/admin/db-actions.ts:651-716`).
8. Post-restore migrations run before clearing maintenance on success (`apps/web/src/app/[locale]/admin/db-actions.ts:718-747`).

Non-finding: I did not find command injection in backup/restore. There is no `shell: true`, and command arguments are fixed arrays plus validated/controlled DB env values.

### Flow 4: Public Search/OG -> Same-Origin/Rate Limit -> Public Selectors/SSRF Controls

Trace:

1. Semantic search requires same-origin, JSON content type, non-chunked body, valid `Content-Length`, a hard 8 KiB body cap, and per-IP pre-increment before the DB-backed mode lookup (`apps/web/src/app/api/search/semantic/route.ts:107-184`).
2. Semantic mode fails closed unless explicitly `stub` or `production`; production and stub scan only their own model versions and hard-limit the scan count (`apps/web/src/app/api/search/semantic/route.ts:186-279`).
3. Similar-photo search requires same-origin, restore-maintenance check, positive integer ID, and shared semantic rate-limit pre-increment before mode/embedding DB work (`apps/web/src/app/api/search/similar/[id]/route.ts:68-126`).
4. Both search routes enrich results through `searchEnrichmentSelectFields`, which has a compile-time guard against `PrivacySensitiveKeys` (`apps/web/src/lib/search-enrichment-fields.ts:29-47`).
5. Topic OG validates topic slug and tag names, rate-limits before DB/Satori work, charges post-DB 404s, and sanitizes rendered strings (`apps/web/src/app/api/og/route.tsx:61-136`).
6. Photo OG rate-limits before DB work, validates numeric IDs, does not refund DB/Sharp failures, pins internal derivative fetches to canonical `BASE_URL` instead of inbound Host, caps fallback redirects to the canonical origin, and sanitizes title/site strings (`apps/web/src/app/api/og/photo/[id]/route.tsx:39-295`).

Non-finding: I did not find a current SSRF path in OG generation. The only internal fetch host is canonical config-derived origin (`apps/web/src/app/api/og/photo/[id]/route.tsx:97-122`), and an invalid canonical URL fails closed to fallback (`apps/web/src/app/api/og/photo/[id]/route.tsx:109-117`).

## Category Review

### Auth/Authz

No new finding. Admin API routes both wrap `withAdminAuth`; server-action scanner covers the current action surface and reports all mutating actions guarded. PAT upload scope checks are enforced through `tokenHasScope`.

### CSRF / Same-Origin

No new finding. Cookie-authenticated admin APIs require `hasTrustedSameOrigin`; token-authenticated LR uploads intentionally bypass same-origin but require PAT scope. Server actions use `requireSameOriginAdmin` or reasoned read-only exemptions.

### Public API Rate Limits

No new finding. The Cycle 40 scanner fix strengthens detection of imported expensive-read helpers and unresolved re-exports. Current public route scan passes all route files.

### SSRF

No new finding. The per-photo OG internal fetch is pinned to `BASE_URL` and does not use request Host. `IMAGE_BASE_URL` parsing requires absolute HTTP(S), HTTPS in production, and no credentials/query/hash (`apps/web/src/lib/content-security-policy.ts:1-25`).

### Path Traversal / File Handling

No new finding. Public derivative serving and backup download both use strict filename/path validation plus realpath containment. Original uploads are private and legacy public originals are detected by startup safety helpers.

### SQL / Command Injection

No new finding. Application DB operations are Drizzle-parameterized or fixed SQL with parameter placeholders. Raw CLI restore/backup uses `spawn` argument arrays, not shell strings. Restore SQL is scanned before import.

### Secrets / Session / Tokens

No new finding. Production session secret fallback is disabled; sessions store SHA-256 hashes of HMAC-signed plaintext cookies. PATs are one-time plaintext, SHA-256-hashed at rest, scope/expiry checked, and constant-time compared. Tracked-secret test passed.

### Upload / Privacy

No new finding. Browser and LR upload paths both strip GPS from retained originals when configured, omit sensitive fields from public selectors, and keep admin-only color/HDR/source metadata out of anonymous search/listing payloads.

### CSP / Headers

No new finding. Production CSP is nonce-based for scripts and disallows objects; dev-only CSP is explicitly looser. Global headers include nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, and production HSTS. Admin APIs add no-store/nosniff defaults.

### Backup / Restore / Deployment Safety

No new finding. Restore is admin/same-origin gated and lock/maintenance fenced. Backup downloads are authenticated and no-store. Deploy script prunes after successful health check and uses bind-mounted persistence; remote deploy helper refuses group/world-readable env files before sourcing.

## Verification Evidence

Commands run at HEAD `ae71bd5a`:

- `npm run lint:api-auth --workspace=apps/web` — pass; `src/app/api/admin/db/download/route.ts` and `src/app/api/admin/lr/upload/route.ts` OK.
- `npm run lint:action-origin --workspace=apps/web` — pass; all mutating server actions enforce same-origin provenance.
- `npm run lint:public-route-rate-limit --workspace=apps/web` — pass; 10 public route files OK, including OG/search expensive reads.
- `npm audit --omit=dev --workspace=apps/web` — `found 0 vulnerabilities`.
- `npm test --workspace=apps/web -- check-action-origin.test.ts check-public-route-rate-limit.test.ts privacy-fields.test.ts search-route-privacy.test.ts backup-download-route.test.ts tracked-secrets.test.ts download-labels.test.ts` — 7 files passed, 164 tests passed.

## Deferred Filter

Not re-raised:

- Cycle 40 deferred JS script semantic typecheck gap. Current scanner fixes improve guardrail coverage, but do not change that deferred scope or make it a live vulnerability.
- Prior indexing/performance/deploy polish items. No new security evidence changes their risk.
- Older non-exploitable transitive/build-time dependency notes. Current production audit is clean.

## Disposition

Security posture for this cycle: clean. No CRITICAL/HIGH/MEDIUM/LOW actionable security findings were identified in current HEAD.
