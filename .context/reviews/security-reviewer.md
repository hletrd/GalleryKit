# Security Reviewer Report - Cycle 17/100

Review lane: `security-reviewer`
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `5e054f80`
Scope: current HEAD, repository-wide security review against OWASP Top 10 2025 categories and the requested areas: auth/authz, sessions, CSRF/origin, public route rate limits, uploads, file serving, SSRF, XSS, SQL/raw SQL, shell command use, backup/restore, secrets, privacy/PII, Docker/deploy scripts, and tests.

OWASP reference used: https://owasp.org/Top10/2025/en/

## Inventory

Tracked files at review time: 2,559.

Security-relevant files and flows inspected:

| Area | Files / flows |
| --- | --- |
| Auth, sessions, admin gating | `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/proxy.ts` |
| CSRF/origin and proxy-derived identity | `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile` |
| Admin actions/API | `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts` |
| Public APIs/actions | `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, OG routes, upload routes, feeds |
| Uploads and file serving | `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/serve-upload.ts`, upload route handlers, nginx upload locations |
| SSRF/open redirect/XSS | `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/og-sanitize.ts`, `apps/web/src/lib/atom-feed.ts`, public pages using `dangerouslySetInnerHTML` |
| SQL/raw SQL/restore | `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/sql-like.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, migration and backfill scripts |
| Privacy/PII | `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, map/share/feed helpers, privacy-field tests, EXIF/GPS handling |
| Supply chain/deploy/secrets | `package.json`, `apps/web/package.json`, `package-lock.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `apps/web/scripts/entrypoint.sh`, env examples, secret-pattern scans |

## Validation Evidence

Project instructions read first: `AGENTS.md` and `CLAUDE.md`.

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed; both admin API routes are wrapped by `withAdminAuth`.
- `npm run lint:action-origin --workspace=apps/web` - passed; mutating server actions enforce same-origin or carry explicit exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm audit --workspace=apps/web --audit-level=moderate` - `found 0 vulnerabilities`.
- Secret inventory via `git ls-files | rg '(^|/)\\.env|\\.pem$|\\.key$|secret|credential|token'` and targeted secret-value pattern search found no current tracked plaintext secret assignment in source/config. Hits were examples, tests, code reading env vars, and historical review prose.

I did not run the full `npm test`, `npm run typecheck`, or e2e suite because this was a read-only security review and the security-specific gates plus manual inspection were the useful validation surface for this task.

## Confirmed Issues

### C17-SEC-01 - `strip_gps_on_upload` can silently retain GPS metadata in private originals

Severity: Medium
Confidence: High
OWASP: A02 Cryptographic Failures / A04 Insecure Design / privacy data minimization

Code region:

- `apps/web/src/app/actions/images.ts:381-388` nulls DB latitude/longitude and calls `stripGpsFromOriginal(...)` for browser uploads.
- `apps/web/src/app/api/admin/lr/upload/route.ts:367-380` mirrors that behavior for Lightroom/PAT uploads.
- `apps/web/src/lib/process-image.ts:1733-1736` documents the stripping function as best-effort and states that the original remains at risk if stripping fails.
- `apps/web/src/lib/process-image.ts:1793-1802` logs and returns without modifying the original for structurally anomalous HEIC/HEIF or unknown extensions.

Risk:

When `strip_gps_on_upload` is enabled, the application removes public DB coordinates but does not guarantee that the retained original file is scrubbed. A crafted or malformed HEIC/HEIF with GPS data can take the no-HEVC-encoder branch, log an error, and still complete upload. Public derivatives and DB fields are protected, but the private original at rest can still contain precise location data.

Concrete scenario:

An admin enables GPS stripping, then uploads a phone HEIC that has a structural anomaly in its metadata container. The upload succeeds. Later, an operator-side original-download feature, filesystem backup, host compromise, support bundle, or manual file transfer exposes the retained original. The admin reasonably expected the original to be scrubbed because the setting was enabled, but the code accepted a best-effort failure.

Suggested fix:

Make GPS stripping mandatory when `stripGpsOnUpload` is true. Change `stripGpsFromOriginal` to return a typed result such as `{ ok: true, stripped: boolean } | { ok: false, reason: string }`, and have both upload paths reject or quarantine the image if GPS cannot be confidently removed. If product policy prefers availability over rejection, persist an explicit `original_gps_strip_status`/warning and block any future original-download/export path unless the status is clean.

## Likely Issues

No likely code vulnerabilities were identified after the full inventory review and final missed-issue sweep.

Notable reviewed controls that held up under inspection:

- Session tokens are HMAC-signed, DB-hashed, age-limited, and production refuses missing/short `SESSION_SECRET` instead of falling back to a DB-stored secret (`apps/web/src/lib/session.ts:16-35`, `apps/web/src/lib/session.ts:82-150`).
- Login rate limiting is pre-incremented before Argon2 verification and includes both IP and account buckets (`apps/web/src/app/actions/auth.ts:91-150`).
- Admin API cookie requests require same-origin plus `isAdmin()`, while PAT requests require a valid scoped token and invalid token attempts are rate-limited (`apps/web/src/lib/api-auth.ts:68-143`).
- Public semantic search enforces same-origin, body/content-length caps, mode gates, pre-incremented rate limits, bounded scans, and compile-guarded public enrichment fields (`apps/web/src/app/api/search/semantic/route.ts:168-329`, `apps/web/src/lib/search-enrichment-fields.ts:29-46`).
- Similar search is same-origin, production-only, rate-limited, and filters to processed production embeddings before enrichment (`apps/web/src/app/api/search/similar/[id]/route.ts:60-228`).
- Upload serving allows only derivative directories, validates path segments/extensions, rejects symlinks, checks realpath containment, and emits `nosniff` (`apps/web/src/lib/serve-upload.ts:127-309`). Nginx also blocks `/uploads/original/` (`apps/web/nginx/default.conf:164-166`).
- JSON-LD and feed XML sinks use dedicated escaping helpers (`apps/web/src/lib/safe-json-ld.ts:14-20`, `apps/web/src/lib/atom-feed.ts:21-28`), and public pages using `dangerouslySetInnerHTML` call `safeJsonLd` at the sink.
- Smart collection SQL compiles from an allowlisted, depth/node-limited AST and binds values through Drizzle templates (`apps/web/src/lib/smart-collections.ts:19-49`, `apps/web/src/lib/smart-collections.ts:316-498`).
- Backup/restore paths require admin same-origin checks, use advisory/maintenance locks, stream to owner-only temp files, scan SQL before restore, and spawn `mysqldump`/`mysql` without shell interpolation (`apps/web/src/app/[locale]/admin/db-actions.ts:163-172`, `apps/web/src/app/[locale]/admin/db-actions.ts:453-550`).
- CLIP model runtime loading is offline-only and pinned to a commit SHA; the seeding script verifies key artifact SHA-256 values after download (`apps/web/src/lib/clip-model.ts:101-118`, `apps/web/src/lib/clip-model-id.ts:12-25`, `apps/web/scripts/clip-model-manifest.ts:29-59`).

## Risks Needing Manual Validation

### C17-MVR-01 - Direct app exposure with `TRUST_PROXY=true` would weaken rate-limit identity and origin reconstruction

Severity: Medium
Confidence: Medium
OWASP: A05 Security Misconfiguration

Code region:

- `apps/web/Dockerfile:88-90` defaults the app listener to `127.0.0.1`.
- `apps/web/docker-compose.yml:14-21` uses host networking, sets `HOSTNAME=127.0.0.1`, and enables `TRUST_PROXY=true`.
- `apps/web/nginx/default.conf:66-70`, `apps/web/nginx/default.conf:140-144`, and `apps/web/nginx/default.conf:191-196` overwrite `X-Forwarded-Host`, `X-Forwarded-For`, and `X-Forwarded-Proto` before proxying.
- `apps/web/src/lib/request-origin.ts:45-68` trusts forwarded host/proto only when `TRUST_PROXY=true`.
- `apps/web/src/lib/rate-limit.ts:163-185` trusts forwarded client IP when `TRUST_PROXY=true`.

Risk:

The committed Docker/nginx topology is coherent: the app binds loopback and nginx overwrites forwarding headers. The risk appears if production drifts from that topology. If the Next app becomes reachable directly while `TRUST_PROXY=true`, non-browser clients can spoof `X-Forwarded-For` to rotate rate-limit identities. Depending on headers and deployment, spoofed forwarded host/proto can also make origin reconstruction disagree with the real browser-facing origin.

Concrete scenario:

A firewall or host-network change exposes port 3000 externally. An attacker hits login or PAT-auth endpoints directly and rotates `X-Forwarded-For`; IP-scoped throttles are bypassed or made noisy. Account-scoped login throttling still helps against one username, but endpoint-level abuse controls no longer represent client identity.

Suggested fix:

Add a production startup assertion that refuses `TRUST_PROXY=true` unless the listener is loopback/private and a trusted proxy contract is explicitly configured. Document and monitor that port 3000 is not externally reachable. Consider only trusting forwarded headers from known proxy source IPs or having nginx inject an internal header that the app requires before honoring forwarded metadata.

### C17-MVR-02 - Historical checked-in secrets remain an operational rotation requirement

Severity: Medium
Confidence: Medium
OWASP: A02 Cryptographic Failures / A05 Security Misconfiguration

Code region:

- `CLAUDE.md:84-86` states that environments seeded from older checked-in examples must rotate `SESSION_SECRET` and bootstrap/admin credentials and treat historical git values as compromised.
- `README.md:144-146` repeats the same warning.
- Current HEAD examples use placeholders (`CLAUDE.md:74-82`, `README.md:124-132`), and the current tracked-file secret sweep found no live hardcoded secret assignment.

Risk:

This is not a current-HEAD source leak, but it is still an operational security item. If any deployed `.env.local`, DB password, bootstrap admin password, or `SESSION_SECRET` was copied from an older committed example before placeholders replaced it, that value should be considered compromised by anyone with repo history access.

Concrete scenario:

A production deployment still uses a historical `SESSION_SECRET`. Anyone who can read the old commit and obtain or plant a session row has a much easier path to session forgery than intended. A historical bootstrap/admin password reused in production also remains valid credential material.

Suggested fix:

Verify deployed values are unique and were generated after the historical exposure. Rotate `SESSION_SECRET`, admin/bootstrap passwords, and DB credentials if there is any uncertainty. Do not rewrite git history or rotate production secrets without an explicit operator-approved runbook, because both are destructive/credential-gated actions.

### C17-MVR-03 - Container base images and apt packages are not digest/version pinned

Severity: Low
Confidence: High
OWASP: A08 Software and Data Integrity Failures

Code region:

- `apps/web/Dockerfile:1` and `apps/web/Dockerfile:10` use the mutable `node:24-slim` tag.
- `apps/web/Dockerfile:4-16` installs Debian packages with `apt-get install` without version pins.
- npm dependencies are lockfile-backed (`apps/web/Dockerfile:21-24`, `apps/web/Dockerfile:44-56`, `apps/web/Dockerfile:60-62`) and `npm audit` found 0 vulnerabilities.

Risk:

Rebuilding the same commit at a later date can pull a different base image and different apt package versions. That is normal for many small deployments and aligns with the project preference for latest versions, but it weakens incident reproducibility and makes supply-chain review depend on registry state at build time.

Concrete scenario:

A compromised or vulnerable package lands in a newly published `node:24-slim` image or Debian mirror. A routine redeploy of unchanged app code consumes it. The app source review and npm audit still look clean because the change came from the base image/package layer.

Suggested fix:

For production, pin `node:24-slim` by digest and update it intentionally through a patched-base-image workflow. Add container image scanning to deploy/CI. If exact apt pins are too heavy, at least record the resolved image digest and package versions in deployment artifacts.

## Areas Reviewed With No Finding

- Auth/authz: all admin APIs are wrapper-protected; mutating server actions are same-origin gated; no role separation exists, but CLAUDE.md documents all admins as root-equivalent.
- Sessions/cookies: HMAC token shape, DB hash storage, production `SESSION_SECRET` requirement, httpOnly/secure/sameSite cookie behavior, and password-change session rotation were inspected.
- CSRF/origin: browser admin actions and cookie-backed admin APIs require `Origin`/`Referer` matching reconstructed origin; missing source fails closed.
- Rate limits: login, account login, public search, semantic/similar, view counters, and invalid PAT auth paths were inspected. The main residual risk is proxy topology drift in C17-MVR-01.
- Uploads: browser and Lightroom upload paths cap size/count, require concrete `Content-Length` for Lightroom, validate filenames/topics, store originals under a private root, and use UUID derivative filenames. C17-SEC-01 is the residual privacy gap.
- File serving: public route handlers and nginx serve only derivatives, not originals; symlink/path traversal protections were present.
- SSRF/open redirect: OG photo fallback uses configured canonical origin and same-origin validation, not arbitrary request origin; no general user-controlled server fetch was found.
- XSS: React escaping covers normal text paths; JSON-LD and Atom XML have explicit escaping; OG image text is sanitized before rendering into image output.
- SQL/raw SQL: reviewed raw `db.execute(sql\`...\`)` and template SQL paths. Values are parameterized or constrained by allowlists; restore SQL is scanned before piping to `mysql`.
- Shell command use: `mysqldump`, `mysql`, and migration child processes use fixed executable names/argument arrays; no user-controlled shell string interpolation was found in production request paths.
- Backup/restore: backup download path validates filenames and realpath containment; restore uses size/header/dangerous-SQL checks and maintenance locks.
- Secrets: current HEAD contains placeholders and tests, not live secret assignments. Historical exposure remains C17-MVR-02.
- Docker/deploy: app runs as `node` after entrypoint permission fixes (`apps/web/scripts/entrypoint.sh:41-42`), app binds loopback in the committed compose/Docker topology, and nginx supplies security headers/body caps.

## Final Missed-Issue Sweep

Final sweeps covered:

- Route/action inventory under `apps/web/src/app`.
- `withAdminAuth`, `requireSameOriginAdmin`, `hasTrustedSameOrigin`, `getClientIp`, PAT token verification, and session verification call chains.
- `dangerouslySetInnerHTML`, JSON-LD, Atom XML, redirects, `fetch`, `new URL`, raw `sql`, `db.execute`, `formData`, and `arrayBuffer` sinks.
- Secret-ish filenames and secret-value patterns across tracked source/config, excluding dependency lock noise.
- Upload/private-original/derivative serving interactions across Next route handlers, nginx, and filesystem helpers.
- Docker, compose, nginx, deploy, entrypoint, CLIP model seeding/runtime, and backup/restore scripts.

Not inspected dynamically:

- Live production `.env.local` / `.env.deploy` values, firewall state, TLS edge behavior, and real host file permissions.
- Actual seeded CLIP model files on the deploy host.
- Full browser e2e behavior and full unit test suite.

No additional confirmed or likely issues were found in the missed-issue sweep.
