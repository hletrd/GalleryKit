# Cycle 16 Critic Review

Review target: current HEAD `3da74946a7e7a198041bf6067a0192411d61a860` in `/Users/hletrd/flash-shared/gallery`.

Role: cycle 16/100 reviewer lane, critic. I reviewed current HEAD only for product correctness, maintainability, security, UX, operational risk, and project policy drift. This is a review artifact only; no production source, migrations, dependencies, runtime data, or deployment state were changed.

## Inventory Summary

Required guidance read:
- `AGENTS.md` from the task prompt.
- `CLAUDE.md`.
- Code-review skill instructions.

Repository inventory at this HEAD:
- `git ls-tree -r --name-only HEAD`: 2557 tracked paths.
- Top-level footprint: `.context` 1755 files; `apps/web/src` 505 files; `apps/web/drizzle` 31 files; `apps/web/scripts` 27 files; `apps/web/public` 9 files; `apps/web/e2e` 8 files; plus root/app configs, deploy scripts, docs, and package metadata.
- Extension footprint: 1806 Markdown files, 425 TypeScript files, 104 TSX files, 80 PNG files, 28 SQL migrations, 22 JSON files, 20 log files, 12 PID files, 6 JS/MJS files each, 6 JPG files, 5 ICC profiles, and supporting shell/YAML/config files.

Review-relevant current surfaces inspected:
- Product/public routes: home, photo, share, group, map, search, Open Graph, service worker registration and cache policy.
- Admin routes/actions/API: image upload/delete/retry, Lightroom upload, DB backup/restore, settings, users/tokens, protected dashboard flows.
- Data/security boundaries: `apps/web/src/lib/data.ts`, schema/migrations, privacy omit guards, rate limiting, origin checks, API auth, CSP, upload path containment, restore SQL scanner.
- Operational/deploy surfaces: `apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `.env.deploy.example`, README/CLAUDE runbooks.
- Test/policy surfaces: custom auth/origin/rate-limit linters, Vitest privacy/touch/security/source-contract tests, Playwright E2E inventory, historical `.context/reviews` and `.context/plans` for recurring policy drift.

Validation evidence:
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed.
- `npm test --workspace=apps/web` passed: 260 test files passed, 2 skipped; 2418 tests passed, 4 skipped.

## Findings

Finding count: 5 total.
- Confirmed issues: 1
- Likely issues: 2
- Manual-validation risks: 2

### Confirmed Issues

#### CRIT16-01 - Checked-in nginx collapses real client identity when actually deployed behind the documented TLS edge/load balancer

Severity: Medium

Confidence: High

Category: Security operations / availability / rate limiting / documentation-contract drift

Code regions:
- `apps/web/nginx/default.conf:1-4` keys nginx connection and request zones by `$binary_remote_addr`.
- `apps/web/nginx/default.conf:25-29` says this nginx file is intended to run behind a TLS-terminating edge/load balancer.
- `apps/web/nginx/default.conf:67-70`, `apps/web/nginx/default.conf:83-87`, `apps/web/nginx/default.conf:100-104`, `apps/web/nginx/default.conf:116-120`, `apps/web/nginx/default.conf:140-144`, `apps/web/nginx/default.conf:157-161`, `apps/web/nginx/default.conf:179-183`, and `apps/web/nginx/default.conf:191-196` overwrite `X-Real-IP` and `X-Forwarded-For` with `$remote_addr` for all proxied traffic.
- `apps/web/docker-compose.yml:19-21` forces `TRUST_PROXY=true` for the app.
- `apps/web/src/lib/rate-limit.ts:163-193` trusts `X-Forwarded-For`/`X-Real-IP` only when `TRUST_PROXY=true`, then derives all app-level rate-limit identity from those headers.
- `README.md:152-154` documents the intended host-network + nginx deployment and notes that CDN/LB topologies require trusted-header normalization first.

Failure scenario:
In the topology described by the nginx file itself, a TLS edge or load balancer forwards traffic to this local nginx listener. Because nginx does not configure `real_ip_header` / `set_real_ip_from` and instead writes `$remote_addr` into both trusted client-IP headers, the app sees the edge/LB address, not the browser address. The nginx zones also key on that same edge/LB address. One abusive client can therefore consume login, admin, semantic search, share, upload, and connection budgets shared by legitimate users behind the same edge. This is an availability failure for public search/share and admin login, and it weakens forensic/IP attribution. The README contains the needed caveat, but the checked-in nginx comment and default headers still make the deployable template unsafe for the stated behind-edge topology unless operators know to add real-IP normalization.

Suggested fix:
Make the template encode one unambiguous topology. If nginx is behind a trusted TLS edge/LB, add a documented `real_ip_header X-Forwarded-For` plus explicit `set_real_ip_from` entries for trusted edge networks, then pass a normalized chain (`$proxy_add_x_forwarded_for`) or normalized client (`$realip_remote_addr`) consistently and set `TRUSTED_PROXY_HOPS` to the matching value. If the checked-in file is direct-edge-only, remove the "behind TLS-terminating edge/load balancer" claim from `default.conf` and fail loudly when `TRUSTED_PROXY_HOPS` is configured for a topology the template does not implement. Add a source/config test that ties `TRUST_PROXY`, nginx `X-Forwarded-For`, and the documented topology together.

### Likely Issues

#### CRIT16-02 - Lightroom upload cookie fallback loses uploader and audit attribution

Severity: Low

Confidence: Medium-High

Category: Auditability / maintainability

Code regions:
- `apps/web/src/app/api/admin/lr/upload/route.ts:67-73` accepts the request through `withAdminAuth(..., { allowTokenScope: 'lr:upload' })` and reads only `getAdminAuthToken(request)?.userId`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:433-441` stores `uploaded_by: tokenUserId`, explicitly degrading cookie-fallback requests to `NULL`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:518-525` logs the `lr_token_used` audit event with `tokenUserId`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:547` enables token scope auth but does not disable the wrapper's normal cookie fallback.
- `apps/web/src/lib/api-auth.ts:69-83` sets request token context only for valid token-authenticated requests.
- `apps/web/src/lib/api-auth.ts:111-131` then falls through to same-origin cookie admin auth and calls the handler without exposing the authenticated admin id.

Failure scenario:
The primary Lightroom publish path is token-authenticated and gets correct attribution. However, the route also supports same-origin cookie admin auth through the shared wrapper. A browser/manual/admin-side request to the same endpoint can successfully create an image, but `uploaded_by` and the audit-log user id are `NULL` because the route only reads token context. That makes a supported admin-authenticated upload path less attributable than the normal browser upload path, and it contradicts the multi-admin audit model described in the route comments.

Suggested fix:
Expose authenticated admin identity from `withAdminAuth` to handlers for cookie-authenticated API requests, or call the existing current-user helper inside the LR route when `getAdminAuthToken(request)` is absent. Use the resolved actor id for `uploaded_by`, audit event `user_id`, and warning payloads. Add a route/unit test covering same-origin cookie fallback attribution separately from PAT attribution.

#### CRIT16-03 - Checked-in nginx hardcodes the production hostname inside an otherwise reusable deploy template

Severity: Low

Confidence: High

Category: Project policy drift / portability / operations

Code regions:
- `apps/web/nginx/default.conf:21-23` hardcodes `server_name gallery.atik.kr`.
- `README.md:148-154` and `.env.deploy.example:6-14` present production URL/host/deploy values as environment- or operator-configured.

Failure scenario:
The repository otherwise treats deployment identity as config-driven, with production origins and remote deploy fields coming from environment or gitignored deploy files. The checked-in nginx template is the exception: a fresh operator, fork, or restored host can deploy the template with the wrong virtual host. Depending on the edge configuration, that can reject the intended host, serve this app for an unintended host, or cause confusing TLS/Host debugging during recovery.

Suggested fix:
Convert `server_name` to a neutral placeholder (`_` or `example.com`) plus explicit deployment instructions, or generate nginx config from the same configured canonical host used by the build/deploy flow. Add a small static check that the checked-in template does not contain a site-specific hostname unless this repo intentionally remains single-site/non-template.

### Manual-Validation Risks

#### CRIT16-04 - Deploy command override is a trusted arbitrary-shell escape hatch

Severity: Low

Confidence: Medium

Category: Operational safety / secrets hygiene

Code regions:
- `scripts/deploy-remote.sh:61-72` sources `.env.deploy`, accepts `DEPLOY_CMD`, and executes it through `exec bash -lc "$deploy_cmd"`.
- `.env.deploy.example:13-14` documents `DEPLOY_CMD` as an optional complete override of the derived SSH command.

Failure scenario:
This is not a confirmed vulnerability because `.env.deploy` is gitignored and operator-controlled. The risk is operational: if that file is created by automation, copied from chat, committed elsewhere, or made writable by an untrusted local process, `npm run deploy` becomes arbitrary local shell execution with the developer's credentials and SSH keys. The project policy says deploy credentials are config-driven, but the override broadens the trust boundary beyond typed deploy fields.

Suggested fix:
Keep the derived SSH command as the normal path and document `chmod 600 .env.deploy` plus "do not generate this file from untrusted input." Consider printing a prominent warning when `DEPLOY_CMD` is set, or replacing it with narrower fields unless a truly arbitrary local command is required.

#### CRIT16-05 - Admin SQL restore safety remains dependent on regex scanning and should stay covered by real-dump drills

Severity: Low

Confidence: Medium

Category: Operational recovery / database safety

Code regions:
- `apps/web/src/app/[locale]/admin/db-actions.ts:491-519` scans uploaded SQL dump chunks before restore and rejects detected dangerous SQL.
- `apps/web/src/lib/sql-restore-scan.ts:113-155` strips comments/literals and checks regex patterns over sanitized SQL forms.

Failure scenario:
The current scanner is materially hardened and covered by tests, so I am not promoting a specific bypass. The residual risk is that SQL restore is a destructive admin operation and the safety layer is necessarily heuristic: MySQL dump syntax, conditional comments, encodings, or future backup-format changes can create parser gaps or false positives. A false negative can execute unsafe SQL during restore; a false positive can block the emergency restore path when it is needed most.

Suggested fix:
Keep the scanner tests, but add a periodic manual restore drill with a current production-shaped dump into a disposable database, plus a small corpus of malicious/edge-case dump fragments. If restore remains a core admin feature, consider replacing regex screening with a stricter allowlist restore pipeline or parser-backed validation for the subset of SQL this app's own backup command emits.

## Final Missed-Issues Sweep

Checked and not promoted:
- Auth wrappers and origin/rate-limit policy: custom lint gates passed for admin API auth, mutating server action origin checks, and public mutating route rate limits.
- Type/test health: typecheck passed and the full Vitest suite passed, including privacy-field guards and touch-target audit coverage.
- Product policy drift: source and docs sweeps did not find reintroduced paid-download/Stripe flows, culling/scoring features, or photo-editing tools. Existing edit language is metadata/topic/tag/admin editing, not photographer image editing.
- Privacy projections: public data selectors, map GPS selectors, search enrichment fields, and sensitive-key tests remain in place; no new public PII leak was promoted.
- HTML/script sinks: `dangerouslySetInnerHTML` usage found in current source is structured JSON-LD/CSP-related, not arbitrary user HTML rendering.
- Upload/path containment: current upload/original path helpers and LR/browser upload paths include filename sanitization, body caps, contract locking, maintenance guards, and current tests/source contracts.
- Service worker: current cache rules exclude admin and sensitive dynamic surfaces and honor no-store/admin-render headers; no cache leak was promoted.
- Migration/journal state: Drizzle journal and migration files are present through the current schema; no missing current migration file was promoted.

Residual gaps:
- I did not run production-scale browser profiling, MySQL `EXPLAIN ANALYZE`, or a live restore/deploy drill in this review lane.
- Historical `.context/**` archives were inventoried and searched for recurring policy drift, while direct current-behavior inspection focused on HEAD source, tests, configs, docs, and operational scripts.
