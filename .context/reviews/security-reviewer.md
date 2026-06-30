# Security Reviewer - Cycle 20

Date: 2026-06-30
Scope: whole-repo security/privacy review for OWASP classes, auth/authz, CSRF, SSRF, path traversal, secrets, rate limits, deploy hardening, data exposure, and sensitive operational flows. This pass did not edit implementation code.

## Inventory

Repository and policy context:
- `AGENTS.md`
- `CLAUDE.md`
- `.gitignore`
- `.context/reviews/security-reviewer.md`

Auth, sessions, admin APIs, and CSRF:
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- all `apps/web/src/app/api/**/route.ts(x)` admin/public handlers
- all mutating server action files under `apps/web/src/app/actions/*.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`

Uploads, file access, SSRF-adjacent fetches, and storage:
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/og-photo-fetch.ts`

Public routes, rate limits, privacy, and data exposure:
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/next.config.ts`

Backup, restore, migrations, and deployment:
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/Dockerfile`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `.env.deploy.example`
- `apps/web/.env.local.example`

Relevant tests inspected or executed:
- auth/origin/rate-limit/privacy/upload/search/backup/source-contract tests under `apps/web/src/__tests__/`
- Playwright e2e inventory under `apps/web/e2e/`

## Validation Evidence

- `npm audit --workspace=apps/web --omit=dev --json`: passed, `0` production vulnerabilities.
- `npm run lint:api-auth --workspace=apps/web`: passed; admin API exports are wrapped by `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web`: passed; mutating server actions are covered by `requireSameOriginAdmin()` or explicit exemption.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; public mutating API route scan found no missing pre-increment helpers.
- `npm test --workspace=apps/web -- tracked-secrets privacy-fields rate-limit request-origin nginx-config og-route-source-contracts og-photo-fallback load-more-rate-limit semantic-search-route similar-route backup-download-route`: passed, 20 files / 217 tests.
- Final source sweep: targeted `rg` scan for `dangerouslySetInnerHTML`, `eval`, `new Function`, rollback helpers, `tags.split`, `X-Forwarded-For`, `TRUST_PROXY`, `createReadStream`, `realpath`, `lstat`, `withAdminAuth`, and `requireSameOriginAdmin`.

## Findings

### SEC-01 - Smart-collection load-more refunds the rate limit after attacker-controlled DB lookup

Severity: Medium
Confidence: High
Status: Confirmed

Exact file and region:
- `apps/web/src/app/actions/public.ts:197-203` pre-increments the public load-more limiter.
- `apps/web/src/app/actions/public.ts:207-211` runs `getSmartCollectionBySlugCached(slug)` and then calls `rollbackLoadMoreAttempt(...)` when the collection is missing or private.
- `apps/web/src/lib/rate-limit.ts:44-57` documents the intended public CPU/DB posture: rollback only for syntactic pre-DB rejections; keep the charge once protected work has run.

Attack/failure scenario:
An unauthenticated client can call `loadMoreSmartCollectionImages` with many syntactically valid nonexistent or private smart-collection slugs. Each request reaches the collection lookup before the limiter is refunded, so a single IP can generate uncharged DB/cache work and enumerate existence/private-state timing or response differences without consuming its load-more rate-limit budget.

Suggested fix:
Do not call `rollbackLoadMoreAttempt(...)` after `getSmartCollectionBySlugCached(...)` has run. Keep refunds only for syntax-only rejections that happen before any DB/cache work. Add a behavior or source-contract test asserting nonexistent/private smart-collection slugs remain charged after lookup.

### SEC-02 - Topic OG route splits unbounded `tags` query before limiting tag count

Severity: Low to Medium
Confidence: Medium
Status: Likely; depends on deployed request-line limits

Exact file and region:
- `apps/web/src/app/api/og/route.tsx:35-39` reads `tags` without a length guard while `topic` is capped at 200 characters.
- `apps/web/src/app/api/og/route.tsx:46-62` applies an IP rate limit, but admitted requests continue to render-time tag processing.
- `apps/web/src/app/api/og/route.tsx:84-88` executes `tags.split(',').filter(Boolean).slice(0, 20)...`; the full split allocation happens before the `20` tag cap.

Attack/failure scenario:
If nginx or the Next runtime admits a very large query string, one allowed public OG request can allocate and iterate over a large array before reducing to 20 tags. The route is public and image-rendering-oriented, so this is a per-request memory/CPU hardening gap even with the IP rate limit in place.

Suggested fix:
Reject `tags` above a small byte/codepoint limit before calling `split`, and prefer a bounded parser that stops after 20 accepted tags. Add a route source-contract or behavior test for oversized `tags`. If infrastructure request-line limits are the intended control, document the exact deployed cap and test the nginx template/edge policy.

### SEC-03 - Forwarded client IP is spoofable if nginx is directly exposed or the edge preserves incoming XFF

Severity: Medium
Confidence: Medium
Status: Deploy-hardening risk

Exact file and region:
- `apps/web/docker-compose.yml:16-21` sets `TRUST_PROXY: "true"` for the app container.
- `apps/web/nginx/default.conf:57-71`, `73-88`, `90-105`, `107-121`, `132-145`, `149-162`, `173-184`, and `186-201` forward `X-Forwarded-For` using `$proxy_add_x_forwarded_for`.
- `apps/web/src/lib/rate-limit.ts:163-193` trusts the configured `X-Forwarded-For` chain when `TRUST_PROXY=true`.
- `apps/web/.env.local.example:51-62` warns not to expose this nginx template to clients that can supply arbitrary `X-Forwarded-For`.
- `apps/web/src/__tests__/nginx-config.test.ts:33-45` currently locks the preserve-chain behavior rather than a sanitize-at-edge behavior.

Attack/failure scenario:
If the nginx listener is reachable by untrusted clients, or if the TLS/load-balancer edge forwards user-supplied `X-Forwarded-For` instead of stripping/normalizing it, an attacker can choose the apparent client IP. With `TRUST_PROXY=true`, that lets the attacker rotate rate-limit buckets for public OG/search/share endpoints, invalid PAT attempts, and other IP-limited paths. Account-scoped login throttles still reduce direct account brute force, but public/API DoS and token-spray throttles become weaker.

Suggested fix:
Make the deployment template self-contained safe for this trust boundary: configure nginx `real_ip_header` / `set_real_ip_from` for the actual trusted edge, then rebuild a sanitized forwarded chain, or set `X-Forwarded-For` to the trusted real client IP instead of appending arbitrary incoming values. Keep `TRUSTED_PROXY_HOPS` aligned with the actual chain. Add a contract test for spoofed incoming `X-Forwarded-For` through the nginx config.

### SEC-RISK-01 - Backup download validation is path-backed, not descriptor-backed

Severity: Low
Confidence: Medium
Status: Residual risk

Exact file and region:
- `apps/web/src/app/api/admin/db/download/route.ts:50-58` performs `lstat(...)`, rejects symlinks/non-files, and resolves `realpath(...)`.
- `apps/web/src/app/api/admin/db/download/route.ts:72-77` documents the remaining path-replacement window and streams via `createReadStream(resolvedFilePath)`.
- `apps/web/src/app/api/admin/db/download/route.ts:80-85` sends `Content-Length` from the earlier `stats` object.

Attack/failure scenario:
A same-host actor with write access to the backup directory can replace the validated file between `lstat`/`realpath` and `createReadStream`. The admin-authenticated route could then stream bytes from a different file than the one whose metadata was validated. This is not an unauthenticated web path-traversal issue, but it is a TOCTOU residual risk in a sensitive data export path.

Suggested fix:
Use a descriptor-backed flow: open the file after containment checks, `fstat` the descriptor, reject non-regular files on the descriptor, derive `Content-Length` from descriptor metadata, and stream from the file handle. If this is intentionally accepted, document backup-directory write access as equivalent to local admin trust.

## Positive Security Evidence / Non-Findings

- Admin API auth is centralized in `apps/web/src/lib/api-auth.ts:58-144`; cookie auth requires same-origin, token auth is scoped and rate-limited, and default responses carry no-store/nosniff.
- Session handling in `apps/web/src/lib/session.ts:16-36` and `82-150` uses HMAC tokens, timing-safe comparison, DB-stored hashes, 24-hour expiry, and production `SESSION_SECRET` strength checks.
- Admin page middleware in `apps/web/src/proxy.ts:76-140` is correctly treated as a UX/pre-filter; API routes and actions perform real authorization.
- Mutating server action CSRF posture is guarded by `requireSameOriginAdmin()` and the passing `lint:action-origin` gate.
- Lightroom/admin upload in `apps/web/src/app/api/admin/lr/upload/route.ts:68-360` requires admin/PAT auth, scope checks, declared `Content-Length`, upload quota, sanitized metadata, topic existence, processing-contract locks, and disk-space checks.
- Upload serving in `apps/web/src/lib/serve-upload.ts:127-280` allowlists derivative directories/extensions, validates segments, rejects symlinks, checks realpath containment, and sets cache/content headers.
- Original upload path helpers in `apps/web/src/lib/upload-paths.ts:58-161` use basename validation, `lstat`, symlink rejection, `realpath`, and containment.
- Semantic and similar search routes enforce same-origin, maintenance gates, strict request body limits, query length checks, mode gates, and privacy-guarded enrichment.
- Public privacy field selection in `apps/web/src/lib/data.ts:368-489` and `1660-1697` excludes sensitive fields and gates GPS/map exposure; `apps/web/src/__tests__/privacy-fields.test.ts:7-132` locks the symmetric privacy guard.
- JSON-LD injection uses `safeJsonLd` in `apps/web/src/lib/safe-json-ld.ts:14-19`; `dangerouslySetInnerHTML` occurrences reviewed are JSON-LD only.
- OG/photo fetch behavior in `apps/web/src/lib/og-photo-fetch.ts:64-118` is byte/time bounded, and route-side fallback redirect remains same-origin.
- SQL restore scanning in `apps/web/src/lib/sql-restore-scan.ts:12-156` rejects dangerous statements before import; DB CLI calls pass secrets through environment variables rather than command arguments.
- Production dependency audit reported zero vulnerabilities, and tracked secret tests passed.

## Final Missed-Issue Sweep

I performed a final pass over route/action inventories, public rollback paths, forwarded-header trust, path traversal/file streaming, `dangerouslySetInnerHTML`, dynamic code execution patterns, backup/restore paths, upload serving, semantic/OG routes, privacy field guards, nginx/deploy config, ignored env files, and targeted security tests. I found no additional high-confidence issues beyond SEC-01, SEC-02, SEC-03, and SEC-RISK-01 above.
