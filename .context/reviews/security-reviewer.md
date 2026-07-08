# Cycle 35 Security Review - Security Reviewer

Date: 2026-07-08
Workspace: `/Users/hletrd/flash-shared/gallery`
Scope: whole-repository security review. Product code was not edited.

## Scope And Inventory

Required project guidance was read first: `AGENTS.md:1-50` and `CLAUDE.md:1-220`, including the documented auth/session/upload/deploy contracts and accepted operational risks.

Security-relevant inventory reviewed:

- Authority and architecture docs: `AGENTS.md`, `CLAUDE.md`, env examples, deployment notes, prior review artifact at this path.
- Auth, authz, CSRF, sessions, and admin API wrappers: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/proxy.ts`.
- Rate limits and public route gates: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, public actions/routes under `apps/web/src/app/actions/public.ts` and `apps/web/src/app/api/**`.
- Admin mutations and backup/restore: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`.
- Upload/file surfaces: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/gps-exif-strip.ts`, `apps/web/src/lib/storage/local.ts`.
- Privacy and public data contracts: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, map/timeline/feed/share/photo public pages, JSON-LD helpers.
- SSRF, URL, XSS, CSP, feed, and OG surfaces: `apps/web/src/app/api/og/**`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/next.config.ts`.
- SQL and restore scanning: raw SQL/Drizzle usages, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, migration scripts and journal handling.
- Deployment and supply chain: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, package lock/audit surface, CLIP model scripts.
- Security regression tests and lint gates under `apps/web/src/__tests__` and `apps/web/scripts/check-*.ts`.

## Findings

No new confirmed, likely, or risk-class security findings were identified in this cycle.

Evidence supporting the no-finding result:

- Auth/session: `apps/web/src/lib/session.ts:16-36` requires a sufficiently long `SESSION_SECRET` in production and refuses DB fallback; `apps/web/src/lib/session.ts:82-150` signs session tokens with HMAC-SHA256, verifies with `timingSafeEqual`, bounds token age, stores only token hashes, and deletes expired sessions.
- Login and account protection: `apps/web/src/app/actions/auth.ts:79-180` enforces same-origin before mutation, uses admin mutation slots, pre-increments IP and account login buckets before Argon2 work, and falls back to bounded in-memory limits if DB checks fail.
- Admin API auth: `apps/web/src/lib/api-auth.ts:66-152` wraps admin APIs, separates scoped PAT auth from cookie auth, requires same-origin for cookie auth, rate-limits token attempts, and adds no-store/nosniff headers.
- CSRF origin anchoring: `apps/web/src/lib/request-origin.ts:47-146` prefers canonical `BASE_URL`/production `siteConfig.url`, trusts forwarded proto/host only under `TRUST_PROXY`, and fails closed without matching `Origin` or `Referer`.
- Public IP attribution/rate limits: `apps/web/src/lib/rate-limit.ts:175-230` only trusts proxy headers when explicitly enabled and right-anchors trusted proxy hops; public route/action lint confirmed expensive or mutating public handlers are rate-limited or explicitly exempted.
- Upload/path traversal: `apps/web/src/lib/upload-paths.ts:49-170` creates private original storage with owner-only permissions and validates basename/realpath/symlink containment; `apps/web/src/lib/serve-upload.ts:168-369` whitelists derivative directories/extensions, rejects symlinks, checks realpath containment, and closes streams on abort.
- Upload processing safety: `apps/web/src/lib/process-image.ts:864-909` enforces byte and pixel caps, UUID disk names, private original mode `0600`, and Sharp decode bounds; `apps/web/src/app/api/admin/lr/upload/route.ts:114-294` rejects chunked/missing/oversized uploads, validates multipart and topic fields, checks restore state, and uses upload/DB locks.
- GPS/privacy stripping: `apps/web/src/app/api/admin/lr/upload/route.ts:420-449` fail-closes when mandatory GPS stripping cannot be verified; `apps/web/src/lib/gps-exif-strip.ts:1-39` documents byte-level GPS neutralization and anomaly fallback.
- Public privacy contract: `apps/web/src/lib/data.ts:368-488` omits admin-only fields from public selects and enforces compile-time guards; `apps/web/src/lib/search-enrichment-fields.ts:29-46` applies the same guard to semantic/similar search enrichment.
- Backup download path traversal: `apps/web/src/app/api/admin/db/download/route.ts:21-89` requires admin auth, validates backup filenames, resolves within `data/backups`, compares realpaths, opens the validated file handle, and streams from that handle.
- Restore safety: `apps/web/src/app/[locale]/admin/db-actions.ts:789-1027` caps restore upload size, writes mode `0600` temp files, validates dump shape/trailer, chunk-scans SQL, imports with `mysql --one-database`, minimal env, TLS args, watchdogs, and post-restore migrations.
- Restore SQL scanner: `apps/web/src/lib/sql-restore-scan.ts:88-156` blocks dangerous statements; `apps/web/src/lib/sql-restore-scan.ts:262-342` rejects disallowed/schema-qualified write targets and preserves cross-chunk detection.
- SSRF/open redirect: `apps/web/src/lib/constants.ts:21-26` centralizes `BASE_URL`; `apps/web/src/lib/og-photo-fetch.ts:64-94` fetches only canonical derivative URLs with time and byte caps; `apps/web/src/lib/seo-og-url.ts:3-43` rejects cross-origin and backslash-normalized OG URLs.
- XSS/CSP: JSON-LD script tags use `safeJsonLd`, whose implementation escapes `<`, `>`, U+2028, and U+2029 at `apps/web/src/lib/safe-json-ld.ts:14-19`; production CSP is built in `apps/web/src/lib/content-security-policy.ts:139-199`; API CSP hardening is configured in `apps/web/next.config.ts:87-92`.
- Deployment safety: `apps/web/deploy.sh:15-43` refuses unsafe runtime env permissions; `scripts/deploy-remote.sh:55-80` refuses unsafe deploy env permissions; `apps/web/Dockerfile:1-119` uses digest-pinned Node base images and reproducible `npm ci`; `apps/web/nginx/default.conf:1-311` defines edge body limits, admin/public/image rate limits, security headers, and explicit proxy-topology caveats.
- Prior cycle-34 seed cleanup issue is fixed: `apps/web/scripts/seed-e2e.ts:190-205` now validates DB-sourced cleanup filenames against expected seed basename patterns before `fs.rm`.

## Accepted Or Documented Risks Not Filed

These were reviewed but not filed as new findings because `CLAUDE.md` or inline docs already document the tradeoff and reviewed code matches the documented contract:

- Multiple root admins without role separation: documented in `CLAUDE.md:3-6` and the security architecture.
- Plaintext SQL backups at rest: backup files are protected by admin auth plus filesystem permissions, but encryption at rest remains an operator/host-boundary decision.
- Single-instance/process-local limits and shared view count approximation: documented as personal-gallery topology assumptions.
- Public SSR page rate limiting is partly edge-template/operator-applied: `apps/web/nginx/default.conf:274-295` documents the catch-all public limiter and manual nginx reload requirement.
- DB restore does not roll back host files or external backups: documented operational boundary.
- Service worker offline behavior can preserve cached public listing HTML briefly; direct photo/share/group/map routes are excluded by the reviewed SW contract, so this remains a PWA privacy tradeoff rather than a new access-control finding.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed; admin API routes are wrapped.
- `npm run lint:action-origin --workspace=apps/web`: passed; all mutating server actions enforce same-origin provenance or approved public-rate-limit paths.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; public mutating/expensive route handlers are rate-limited or explicitly exempted.
- `npm run audit:prod`: passed; 0 production dependency vulnerabilities at `moderate`.
- `npm test --workspace=apps/web -- --run src/__tests__/tracked-secrets.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/search-route-privacy.test.ts src/__tests__/upload-paths.test.ts src/__tests__/serve-upload.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/db-restore.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/request-origin.test.ts src/__tests__/rate-limit.test.ts src/__tests__/strip-gps-from-original.test.ts`: passed, 11 files and 163 tests.
- `npm run lint --workspace=apps/web`: passed.
- `npm run typecheck --workspace=apps/web`: passed, including app and script typechecks.

## Final Sweep And Skips

Final sweep covered route/action inventories, auth wrappers, origin checks, rate-limit gates, upload and derivative serving paths, path joins/resolves, raw SQL, child-process DB tools, `fetch`/URL construction, JSON-LD and CSP, backups/restores, deployment scripts, nginx topology, Docker supply-chain posture, secret-like tracked strings, and security regression tests.

Skipped deep manual reads:

- `node_modules`, build output, `test-results`, binary/static image fixtures, and historical archive screenshots.
- Local secret values in `.env.deploy` and `apps/web/.env.local`; I confirmed those files exist locally and are not tracked, but did not read their contents.
- Historical `.context/reviews/archive` media and non-runtime planning artifacts, except where useful to distinguish accepted/documented risks from current code.

Stop condition met: the requested whole-repo security review has one report artifact, no product code edits, no unverified security findings, and fresh validation evidence.
