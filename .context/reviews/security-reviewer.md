# Security Review — `security-reviewer`

Repo: `/Users/hletrd/flash-shared/gallery`  
Review timestamp: `2026-04-29T01:16:28+09:00`  
Mode: read-only repository review except this report file.

## 1. Review-relevant inventory built first

I excluded vendor/build/runtime artifacts unless security-relevant: `.git/**`, `node_modules/**`, `.next/**`, `dist/**`, `build/**`, `coverage/**`, generated screenshots/logs, uploaded media/data directories, and historical agent/runtime state under `.omx/**`, `.omc/**`, `.context/**` (other than this output). I did inspect the untracked, gitignored deploy env file for inline secret material without copying its values into this report.

Review-relevant inventory examined:

- **Root, CI, dependency, and repo policy files**: `AGENTS.md`, `CLAUDE.md`, `README.md`, `.agent/rules/commit-and-push.md`, `.dockerignore`, `.env.deploy.example`, `.gitignore`, `.github/dependabot.yml`, `.github/workflows/quality.yml`, `.nvmrc`, `package.json`, `package-lock.json`, `tsconfig*.json` where present.
- **Deployment / runtime / reverse proxy**: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `scripts/deploy-remote.sh`, `apps/web/scripts/entrypoint.sh`, `apps/web/.dockerignore`, `apps/web/.env.local.example`, `apps/web/.gitignore`.
- **Next/app configuration**: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/playwright.config.ts`, `apps/web/drizzle.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/postcss.config.mjs`, `apps/web/tailwind.config.ts`, `apps/web/tsconfig*.json`, `apps/web/src/site-config.example.json`, `apps/web/src/site-config.json` when available.
- **API routes**: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/og/route.tsx`.
- **Public/admin pages and route handlers**: all files under `apps/web/src/app/**`, including localized public pages, admin pages, upload routes, auth pages, DB admin UI, layout metadata, error/not-found handling, and server/client component boundaries.
- **Server actions**: `apps/web/src/app/actions/admin-users.ts`, `auth.ts`, `images.ts`, `public.ts`, `seo.ts`, `settings.ts`, `sharing.ts`, `tags.ts`, `topics.ts`.
- **Security/data libraries**: all `apps/web/src/lib/**` files, with particular focus on `action-guards.ts`, `api-auth.ts`, `audit.ts`, `backup-filename.ts`, `content-security-policy.ts`, `csp-nonce.ts`, `data.ts`, `db-restore.ts`, `image-url.ts`, `mysql-ssl.ts`, `process-image.ts`, `process-topic-image.ts`, `rate-limit.ts`, `request-origin.ts`, `safe-json-ld.ts`, `sanitize.ts`, `serve-upload.ts`, `session.ts`, `settings-validation.ts`, `sharing.ts`, `sql-restore-scan.ts`, `storage/local.ts`, `upload-limits.ts`, `upload-paths.ts`, `upload-tracker.ts`, `validation.ts`.
- **Database schema/migrations**: `apps/web/src/db/**`, `apps/web/drizzle/**`, and migration scripts under `apps/web/scripts/**` (`migrate.js`, `mysql-connection-options.js`, `init-db.ts`, `seed-admin.ts`, `check-action-origin.mjs`, `check-api-auth.mjs`, etc.).
- **Components and client-side flows**: all `apps/web/src/components/**`, `apps/web/src/hooks/**`, `apps/web/src/i18n/**`, `apps/web/src/messages/**`, `apps/web/public/histogram-worker.js`, and static/public non-media assets.
- **Tests relevant to security claims**: unit and e2e tests covering auth, origin checks, upload path serving, DB restore scan/download, CSP, sessions, validation/sanitization, sharing, and route guards (`apps/web/src/__tests__/**`, `apps/web/*.spec.ts`, `apps/web/tests/**`). Tests/comments were used only as secondary evidence after tracing implementation flows.

No security-sensitive review-relevant file was intentionally skipped.

## 2. Executive summary

Findings:

| ID | Severity | Category | Finding |
| --- | --- | --- | --- |
| SEC-01 | High | Likely / manual runtime validation recommended | Global 2 GiB Server Actions/proxy body limit can be reached before action-level auth/origin checks, creating an unauthenticated large-body DoS risk. |
| SEC-02 | Medium | Confirmed | SQL restore denylist misses `CREATE DEFINER ... TRIGGER|VIEW|FUNCTION|PROCEDURE|EVENT`, including MySQL conditional-comment forms. |
| SEC-03 | Medium | Confirmed | Production dependency tree still contains vulnerable `postcss@8.4.31` nested below Next; `npm audit` reports a moderate XSS advisory. |
| SEC-04 | Low | Likely hardening issue | Production CSP keeps `style-src 'unsafe-inline'`, weakening XSS/UI-redress blast-radius containment. |

Positive controls observed: admin sessions are HMAC-signed and production requires `SESSION_SECRET`; mutating Server Actions use same-origin admin guards; admin API download route has auth + same-origin checks; public data selectors omit original filenames/GPS/admin fields; upload-serving paths validate segments, extensions, symlinks, and containment; JSON-LD output escapes `<`, U+2028, and U+2029; health endpoints avoid secret leakage; real secrets were not found by targeted scan.

## 3. Findings

### SEC-01 — Global 2 GiB Server Actions/proxy body limit permits pre-auth large-body DoS

- **Severity:** High
- **Confidence:** Medium-high
- **Category:** Likely; manual runtime validation recommended against a production-like Next/nginx deployment.
- **OWASP:** A05 Security Misconfiguration, A04 Insecure Design, A01 Broken Access Control impact on availability controls.
- **Files / regions:**
  - `apps/web/src/lib/upload-limits.ts:1-3` sets `DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024` and per-file upload cap at 200 MiB.
  - `apps/web/src/lib/upload-limits.ts:12-25` maps `UPLOAD_MAX_TOTAL_BYTES` to `NEXT_UPLOAD_BODY_SIZE_LIMIT`.
  - `apps/web/next.config.ts:70-75` applies that large value globally to `experimental.serverActions.bodySizeLimit` and `proxyClientMaxBodySize`.
  - `apps/web/nginx/default.conf:20-25` allows `client_max_body_size 2G` and 20 concurrent connections per IP at the front proxy.
  - `apps/web/src/app/actions/images.ts:116-129` performs admin/session and same-origin checks inside `uploadImages`, after the framework has accepted enough request data to dispatch the Server Action.
  - `apps/web/src/app/actions/auth.ts:70-95` similarly performs same-origin/rate-limit logic inside the action body for login.
- **Problem:** The application intentionally supports very large image batches, but the limit is wired into the global Server Actions parser/proxy instead of being scoped to the authenticated upload endpoint. In the Server Actions model, the request body must be accepted and parsed enough for Next to route/dispatch the action before application code can reject unauthenticated or cross-origin callers. This means the high global limit protects user experience for uploads at the cost of broad pre-auth resource exposure.
- **Concrete attack / failure scenario:** An unauthenticated client sends repeated large multipart/action POSTs up to the 2 GiB nginx/Next cap to any discoverable Server Action endpoint or action route. Even if the action eventually returns `unauthorized` or fails same-origin validation, the reverse proxy and Node process have already spent connection slots, bandwidth, request parsing, temp buffering, and/or memory/CPU budget on very large bodies. With the shipped `limit_conn connlimit 20` and 2 GiB per request, a small number of concurrent clients can create severe availability pressure before app-level upload trackers (`MAX_TOTAL_UPLOAD_BYTES`, rate limits, admin checks) run.
- **Suggested fix:**
  1. Lower the **global** Server Actions and nginx default body size to a small value appropriate for non-upload actions (for example, a few MiB).
  2. Move large image/topic/database uploads to dedicated route handlers that authenticate the session and validate same-origin before streaming large request bodies to disk.
  3. Add nginx location-specific `client_max_body_size` only for authenticated upload/restore routes, with stricter connection/request-rate limits on those locations.
  4. Add an integration test or deployment smoke test that unauthenticated oversized requests are rejected before large body acceptance.
- **Notes:** `apps/web/src/lib/db-restore.ts:1` separately caps restore files at 250 MiB inside application logic; this finding is about the global framework/proxy cap being reached before those app-level checks.

### SEC-02 — SQL restore scanner misses `CREATE DEFINER ...` routine/object syntax

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed.
- **OWASP:** A03 Injection, A08 Software and Data Integrity Failures.
- **Files / regions:**
  - `apps/web/src/lib/sql-restore-scan.ts:23-81` defines the restore denylist.
  - `apps/web/src/lib/sql-restore-scan.ts:63-73` blocks `CREATE TRIGGER`, `CREATE FUNCTION`, `CREATE PROCEDURE`, `CREATE EVENT`, and `CREATE VIEW` only when the object keyword immediately follows `CREATE` or `CREATE OR REPLACE`.
  - `apps/web/src/lib/sql-restore-scan.ts:89-98` extracts executable content from MySQL conditional comments before scanning.
  - `apps/web/src/lib/sql-restore-scan.ts:111-113` returns dangerous status by testing only the configured regex list.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:395-420` relies on `containsDangerousSql()` while scanning the uploaded restore file before execution.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:437-443` then invokes `mysql --one-database` with the uploaded SQL stream.
- **Problem:** MySQL permits `CREATE DEFINER = ... TRIGGER`, `CREATE DEFINER = ... VIEW`, and similar syntax. The denylist regexes miss that valid form because they do not allow a `DEFINER = ...` clause between `CREATE` and the object kind. Because the scanner expands executable conditional comments, mysqldump-style forms such as `/*!50003 CREATE*/ /*!50017 DEFINER=...*/ /*!50003 TRIGGER ...*/` normalize to an equivalent missed `CREATE DEFINER ... TRIGGER` sequence.
- **Confirmed reproduction:** A local scanner check showed:
  - `containsDangerousSql('CREATE TRIGGER ...') === true`
  - ``containsDangerousSql('CREATE DEFINER=`root`@`%` TRIGGER ...') === false``
  - ``containsDangerousSql('/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER ...*/;') === false``
- **Concrete attack / failure scenario:** Restore is admin-only, but the scanner is explicitly intended to prevent dangerous SQL in uploaded backups. A malicious backup or compromised admin account can upload a dump that passes the scanner and installs a trigger, view, routine, or event if the DB account has the relevant privileges. That object can persist hidden database behavior, mutate future image/admin/session records, reintroduce data after deletion, or run with definer semantics that differ from the app's intended table-only backup model. `--one-database` limits cross-database writes but does not neutralize in-database triggers/routines/views.
- **Suggested fix:** Replace the narrow denylist entries with patterns that tolerate allowed MySQL modifiers, for example scanning normalized SQL for ``CREATE\s+(?:OR\s+REPLACE\s+)?(?:DEFINER\s*=\s*(?:CURRENT_USER|`[^`]+`(?:@`[^`]+`)?|[^\s]+)\s+)?(?:TRIGGER|FUNCTION|PROCEDURE|EVENT|VIEW)\b``, and consider also flagging `SQL SECURITY DEFINER`. Prefer an allowlist restore parser/validator for the known application dump shape (`DROP TABLE IF EXISTS` only for known tables, `CREATE TABLE`, `INSERT`, safe session settings) over expanding the denylist. Add regression tests for both plain and conditional-comment `CREATE DEFINER` samples.

### SEC-03 — `npm audit` reports vulnerable nested PostCSS in the production dependency tree

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed dependency finding.
- **OWASP:** A06 Vulnerable and Outdated Components, A03/XSS when affected stringify paths are reachable.
- **Files / regions:**
  - `package.json:7-10` attempts a root override for `postcss` to `^8.5.10`.
  - `apps/web/package.json:61-66` declares top-level `postcss` `^8.5.10` for the web workspace.
  - `package-lock.json:8116-8138` still contains `node_modules/next/node_modules/postcss` at version `8.4.31`.
- **Problem:** The repository has attempted to move PostCSS to a patched version, but the lockfile still includes a nested `postcss@8.4.31` below Next. `npm audit --workspace=apps/web --omit=dev --json` reports a moderate advisory for PostCSS `<8.5.10`: unescaped `</style>` in CSS stringify output can produce XSS if attacker-controlled CSS reaches that stringify path. Audit also flags `next` and `next-intl` through that nested dependency.
- **Concrete attack / failure scenario:** This app does not appear to accept arbitrary user CSS, so immediate exploitability looks limited. However, if any current or future build/runtime path stringifies user-influenced CSS (theme settings, imported metadata, admin-supplied style content, third-party content transformed through PostCSS), a crafted CSS payload containing `</style>` can break out of a style context and execute script in a browser. The vulnerable dependency remains in the production dependency graph, so this is a supply-chain/dependency hygiene issue even if direct app reachability is currently low.
- **Suggested fix:** Refresh the lockfile/dependency tree so no production path installs PostCSS `<8.5.10`. If the nested copy is pinned by Next, upgrade Next to a release that pulls a patched PostCSS or use an override/resolution that actually applies to the nested dependency, then run `npm ci`, `npm ls postcss --workspace=apps/web --all`, and `npm audit --workspace=apps/web --omit=dev` to verify zero remaining advisory hits. Also reconcile local `node_modules` because `npm ls` showed an invalid/stale installed top-level PostCSS despite the lockfile containing `8.5.10` at the root.

### SEC-04 — Production CSP allows inline styles

- **Severity:** Low
- **Confidence:** High
- **Category:** Likely hardening issue.
- **OWASP:** A05 Security Misconfiguration, XSS defense-in-depth.
- **Files / regions:**
  - `apps/web/src/lib/content-security-policy.ts:78-88` builds production CSP.
  - `apps/web/src/lib/content-security-policy.ts:81` sets `style-src 'self' 'unsafe-inline'`.
  - `apps/web/src/proxy.ts:21-50` applies nonce-backed production CSP headers, but that nonce is only used for scripts.
- **Problem:** The production CSP is strong for scripts (`script-src` uses `'self'`, nonce, and no `unsafe-inline`), but style injection remains globally allowed. Inline styles are not equivalent to script execution in modern browsers, but allowing them weakens CSP as a containment layer: injected markup can perform visual deception, clickjacking-like overlays within the page, history-sniffing-style CSS tricks where browser behavior permits, or prepare UI-redress attacks if any HTML injection bug appears later.
- **Concrete attack / failure scenario:** A future low-grade HTML injection in a title, tag, SEO setting, translated string, or admin-rendered field may not execute JavaScript due to script CSP, but it can still inject inline CSS that hides security-relevant controls, overlays fake login/admin UI, or exfiltrates limited state through CSS-controlled network requests if another directive later permits it. This increases blast radius for otherwise-contained markup bugs.
- **Suggested fix:** Inventory which framework/components require inline styles. Prefer moving inline styles to static CSS modules/Tailwind classes where possible. If inline style attributes are unavoidable, evaluate CSP nonce/hash support for style blocks and remove `'unsafe-inline'` from `style-src`; at minimum add tests that production CSP remains nonce-backed for scripts and document why inline styles remain necessary.

## 4. Cross-file security sweep

### Auth/authz and sessions

- Admin session cookies are signed with HMAC and stored hashed in the DB (`apps/web/src/lib/session.ts:8-24`, `session.ts:82-110`). Production refuses to fall back to a DB-stored session secret when `SESSION_SECRET` is missing or short (`apps/web/src/lib/session.ts:26-35`).
- Mutating Server Actions consistently call `requireSameOriginAdmin()` after admin/session checks. Static guard scripts passed for all mutating actions.
- Admin API route `apps/web/src/app/api/admin/db/download/route.ts:13-32` wraps the handler in `withAdminAuth()` and enforces same-origin on GET downloads.
- `apps/web/src/proxy.ts:53-99` protects admin pages at the routing layer, but this is correctly treated as UX/early-deny only because individual actions and API routes perform their own auth.
- No confirmed broken-access-control issue found beyond the body-size pre-auth availability risk in SEC-01.

### CSRF / origin checks

- Origin checks are centralized in `apps/web/src/lib/request-origin.ts` and fail closed for missing source on protected admin API downloads (`apps/web/src/app/api/admin/db/download/route.ts:27`).
- `TRUST_PROXY=true` causes expected origin construction to trust `x-forwarded-proto` and `x-forwarded-host` (`apps/web/src/lib/request-origin.ts:45-68`). This is appropriate for the documented nginx deployment where the app binds to localhost (`apps/web/docker-compose.yml:13-20`), but it is operationally sensitive: if the Node app is exposed directly to untrusted clients with `TRUST_PROXY=true`, forged forwarded headers can change the expected-origin calculation. I did not raise this as a standalone finding because the shipped compose file sets `HOSTNAME: 127.0.0.1` and nginx is documented as the trusted edge.

### XSS / output encoding

- JSON-LD uses `safeJsonLd()` to escape `<`, U+2028, and U+2029 before `dangerouslySetInnerHTML` (`apps/web/src/lib/safe-json-ld.ts:14-18`), and page usages were limited to structured data.
- React text rendering is used for user-controlled labels/tags in public and OG surfaces (`apps/web/src/app/api/og/route.tsx:68-80`, `og/route.tsx:135-179`) after slug/tag validation.
- Production script CSP is nonce-backed through middleware/proxy; inline style allowance is tracked as SEC-04.

### SSRF and remote fetches

- I did not find user-controlled server-side fetch to arbitrary URLs. The public OG endpoint renders from validated topic/tag inputs and DB/site config, not remote user URLs (`apps/web/src/app/api/og/route.tsx:26-90`).
- `IMAGE_BASE_URL` is config-controlled and validated as HTTPS/no credentials/query/hash for production CSP/image patterns (`apps/web/src/lib/content-security-policy.ts:1-25`, `apps/web/next.config.ts:77-80`). No SSRF finding.

### SQL injection / database integrity

- Application SQL through Drizzle/mysql2 uses parameterization for user-influenced inputs in reviewed flows.
- Public search escapes LIKE wildcards before querying.
- The significant issue is restore-file SQL grammar validation (SEC-02), not ordinary query construction.

### File/image handling and path traversal

- Processed public upload serving restricts top-level dirs, segment characters, extensions, symlinks, and realpath containment (`apps/web/src/lib/serve-upload.ts:7-17`, `serve-upload.ts:54-84`). It sets `nosniff` and immutable cache headers (`serve-upload.ts:95-101`).
- Original uploads are stored outside the public tree by default and written with restrictive file modes (`apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/storage/local.ts`).
- Image processing validates extensions and relies on Sharp metadata/pixel limits. Topic images have separate, smaller limits.
- Backup download validates filenames and realpath containment (`apps/web/src/app/api/admin/db/download/route.ts:34-74`). There is a narrow TOCTOU class between `lstat`/`realpath` and `createReadStream` in both upload serving and backup download, but practical exploitation would require local filesystem write/race capability inside protected directories; I did not elevate it to a finding for remote threat models.

### Secrets and environment leakage

- Targeted secret scan found no real AWS/GitHub/OpenAI/private-key style secrets in tracked source. `.env.local.example` uses placeholders and explicitly warns to rotate historical/example secrets (`apps/web/.env.local.example:18-30`).
- `.github/workflows/quality.yml:27-37` uses test-only DB/admin/session values in CI.
- The untracked `.env.deploy` file exists locally and was inspected for inline private key material or obvious token/secret values; values were not copied into this report. It appears to contain operational deploy coordinates/key path, not embedded key material. It remains gitignored.
- Health endpoints return only status and no DB error detail (`apps/web/src/app/api/health/route.ts:18-42`, `apps/web/src/app/api/live/route.ts:3-9`).

### Headers and browser isolation

- `apps/web/next.config.ts:47-66` sets `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, broad `Permissions-Policy`, HSTS in production, and dev CSP.
- `apps/web/nginx/default.conf` also disables server tokens and adds security headers. Production CSP is generated in middleware/proxy. Style CSP is the only header hardening finding (SEC-04).

### Dependency and supply chain

- Dependabot is configured weekly for npm and Docker (`.github/dependabot.yml:1-19`).
- CI runs lint, typecheck, security guard scripts, unit tests, e2e, and build (`.github/workflows/quality.yml:54-79`).
- `npm audit` still reports the PostCSS issue in SEC-03.
- Deployment scripts source operator-controlled env files and execute configured remote commands (`scripts/deploy-remote.sh:52-63`). This is powerful by design and should remain limited to trusted operators/filesystem permissions; no repository-remote exploit path was identified.

## 5. Verification performed

Read-only commands and checks run during review:

- Inventory and targeted code search over tracked source, configs, scripts, migrations, tests, and public non-media assets, excluding vendor/build/runtime artifacts as described above.
- Secret scan with regexes for private keys, common cloud/API tokens, and hardcoded password/secret/token assignments. Result: no real secrets found in tracked source; only dummy/test strings/log message words appeared.
- `npm audit --workspace=apps/web --omit=dev --json` — completed with **3 moderate** findings rooted in nested PostCSS/Next/next-intl (SEC-03).
- `npm run lint:api-auth --workspace=apps/web` — passed; admin API route auth coverage OK.
- `npm run lint:action-origin --workspace=apps/web` — passed; mutating Server Actions have same-origin guards.
- `npm run test --workspace=apps/web -- action-guards request-origin check-action-origin check-api-auth sql-restore-scan content-security-policy backup-download-route serve-upload upload-limits` — passed **9 test files / 73 tests**.
- Manual scanner validation with `containsDangerousSql()` confirmed the `CREATE DEFINER ... TRIGGER` bypass described in SEC-02.

## 6. Final sweep and skipped files

Final sweep covered OWASP Top 10 areas requested: auth/authz, origin/CSRF, secrets, SSRF, XSS/CSP, SQL injection/restore integrity, path traversal, upload/image handling, unsafe headers, dependency advisories, and environment leakage.

Security-sensitive files skipped: **none known**.

Excluded as non-review inputs: vendor dependencies, generated build/cache/coverage output, uploaded media and database runtime data, screenshots/log archives, and historical agent/workflow state. Those were excluded to avoid treating generated/runtime artifacts as source of truth; security-relevant examples, deploy configs, CI configs, source, migrations, and tests were included.
