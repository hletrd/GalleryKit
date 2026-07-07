# Security Reviewer Report - Cycle 7 Lane B

Date: 2026-07-07 KST
Reviewer lane: security-reviewer
HEAD reviewed: `cae5fbd9b88f`
Scope: read-only source review plus this artifact. No source code edits.

## Result Summary

- Confirmed app Critical/High vulnerabilities: 0
- Confirmed issues: 1 Medium dependency issue
- Likely issues: 1 Low CSP hardening issue
- Manual-validation risks: 3 deployment/operator risks

The current source has strong security boundaries for the highest-risk paths I reviewed: admin API access is centralized through `withAdminAuth`, mutating server actions enforce same-origin checks, public expensive routes are rate-limited or explicitly exempted with bounded behavior, upload/download paths defend against traversal and symlink swaps, backup/restore uses locks and scanner gates, and public data projections omit private/admin fields. The remaining confirmed issue is in the dependency graph surfaced by `npm audit`, not a confirmed source-code exploit in the reviewed app paths.

## Inventory Built First

Inventoried 5,292 repository files before detailed review, excluding generated/heavy directories (`.git`, `node_modules`, `.next`, nested `.claude/worktrees`) and TypeScript build info.

Reviewed categories:

- Guidance and project docs: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/**`, deploy/runbook docs.
- Auth/authz/session: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/proxy.ts`.
- Server actions and admin APIs: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/**/route.ts`.
- Public APIs and pages: public upload routes, feed routes, OG routes, semantic/similar search, share pages, public search/load-more actions.
- Upload/restore/download paths: `upload-paths.ts`, `serve-upload.ts`, `process-image.ts`, `actions/images.ts`, Lightroom upload route, DB backup/restore/download helpers.
- Migrations/schema/data privacy: `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`, `apps/web/src/db/**`, `apps/web/src/lib/data.ts`, privacy tests.
- Rate limits/CSP/SSRF: `rate-limit.ts`, `auth-rate-limit.ts`, `request-origin.ts`, `content-security-policy.ts`, `og-photo-fetch.ts`, `next.config.ts`, `nginx/default.conf`.
- SQL/raw shell/deploy: raw SQL scans, `spawn`/child-process use, Docker/deploy scripts, MySQL connection option helpers.
- Tests/docs: security-relevant unit tests, lint gate scripts, restore scanner tests, secret tracking tests, API auth/origin/rate-limit lint scripts.

## Findings

### SEC-B-01 - Medium - Moderate dependency advisories remain in the app dependency graph

Severity: Medium
Confidence: High
Validation: confirmed by `npm audit --workspace=apps/web --audit-level=moderate`

Evidence:

- `apps/web/package.json:57` depends on `next@^16.2.9`; `apps/web/package.json:77` depends on `drizzle-kit@^0.31.10`; `apps/web/package.json:80` depends on direct `postcss@^8.5.15`.
- `package-lock.json:764-782` still contains nested `node_modules/@esbuild-kit/core-utils/node_modules/esbuild` at `0.18.20`.
- `package-lock.json:9334-9352` still contains `node_modules/next/node_modules/postcss` at `8.4.31`.
- `npm audit --workspace=apps/web --audit-level=moderate --json` returned 6 moderate advisories: `esbuild <=0.24.2` through the `@esbuild-kit`/`drizzle-kit` chain, and `postcss <8.4.32` through Next's nested dependency. It reported 0 high and 0 critical advisories.

Concrete failure scenario:

On a developer, CI, or operator host, affected dev/build tooling can expose vulnerable dependency behavior if the vulnerable code path is reachable. The esbuild advisory is primarily a development-server exposure; the Next/PostCSS advisory depends on CSS parsing/stringifying paths and user-controlled CSS reachability. I did not find a direct production route that exposes either path to arbitrary users, but the audit gate is red and the dependencies remain vulnerable in the installed graph.

Suggested fix:

Track and apply upstream `next` and `drizzle-kit` updates that remove the vulnerable nested dependencies, then rerun `npm audit --workspace=apps/web --audit-level=moderate`. Do not apply `npm audit fix --force` blindly: npm's suggested fixes include downgrade/semver-major paths that may be inappropriate for this Next 16 app. If no patched upstream exists, document a temporary accepted risk with the exact vulnerable paths and keep dev servers bound to localhost.

### SEC-B-02 - Low - Production CSP still allows inline styles

Severity: Low
Confidence: Medium
Validation: likely security hardening issue, source-confirmed configuration

Evidence:

- `apps/web/src/lib/content-security-policy.ts:138-142` documents the production inline-style allowance for framework/component compatibility.
- `apps/web/src/lib/content-security-policy.ts:143-155` emits `style-src 'self' 'unsafe-inline'`.
- Production scripts are tighter: `apps/web/src/lib/content-security-policy.ts:125-131` builds nonce-aware script sources, and `apps/web/src/lib/content-security-policy.ts:145` emits that script policy without `unsafe-inline`.

Concrete failure scenario:

If a future HTML/style injection bug reaches rendered user-controlled content, inline CSS would be allowed. That is not direct script execution, but it can enable UI redress, click deception, or limited data inference depending on browser behavior and page structure.

Suggested fix:

Keep this only as an explicit compatibility tradeoff. When feasible, move inline style needs to static classes or nonce/hash-governed style blocks and verify hydration/component behavior in browsers before tightening the directive.

## Manual-Validation Risks

### SEC-B-03 - Conditional High - TLS depends on the deployed edge topology

Severity: Conditional High
Confidence: Medium
Validation: manual deployment validation required

Evidence: `apps/web/nginx/default.conf:46-57` listens on port 80 and documents that this config is intended as an internal HTTP hop behind TLS termination. `apps/web/nginx/default.conf:90-97` adds HSTS/security headers but does not itself terminate TLS.

Concrete failure scenario:

If this nginx listener is exposed directly to the public internet over HTTP, admin credentials, restore/download requests, and session establishment traffic can cross the network in cleartext.

Suggested fix:

Verify the live public endpoint redirects HTTP to HTTPS and terminates TLS before forwarding internally. If nginx is the public edge, add a certificate-backed 443 server block and redirect port 80 before serving the app.

### SEC-B-04 - Medium - Proxy trust and per-IP rate limits require topology validation

Severity: Medium
Confidence: Medium
Validation: manual deployment validation required

Evidence: app-side IP attribution trusts forwarded headers only under the configured proxy contract in `apps/web/src/lib/rate-limit.ts:175-205`; nginx zones key on `$binary_remote_addr` in `apps/web/nginx/default.conf:1-29`; nginx comments at `apps/web/nginx/default.conf:59-71` warn that overwriting `X-Forwarded-For` is correct only when the TCP peer is the real client.

Concrete failure scenario:

Behind a load balancer that connects from a shared IP, every visitor can collapse into one rate-limit bucket, causing lockouts or throttling. With a wrong trusted-hop count, app-side origin/IP reconstruction can diverge from the real client.

Suggested fix:

Validate the deployed chain with spoofed `X-Forwarded-*` headers and real client traffic. Configure nginx `realip`/PROXY protocol and `TRUSTED_PROXY_HOPS` to match the live topology.

### SEC-B-05 - Medium - Historical secret rotation cannot be proven from source

Severity: Medium
Confidence: High that the historical risk exists; Low on current production state
Validation: manual operator validation required

Evidence: `CLAUDE.md` warns that older checked-in example values must be rotated; current runtime code requires a strong production session secret in `apps/web/src/lib/session.ts:19-35`. Static HEAD scans found placeholders/redacted examples, not live tracked secrets.

Concrete failure scenario:

If production still uses a historical `SESSION_SECRET`, admin session tokens may be forgeable by anyone with repo history. If old bootstrap/admin/database credentials remain live, they can be reused directly.

Suggested fix:

Verify production `SESSION_SECRET`, admin passwords, PATs, and DB credentials differ from historical examples. Rotate if uncertain, invalidate sessions after session-secret rotation, and revoke/recreate long-lived admin tokens.

## Controls Verified

- Admin API auth: token requests require valid token, allowed scope, and rate-limit pre-increment; cookie requests require trusted same-origin before `isAdmin()` in `apps/web/src/lib/api-auth.ts:68-143`.
- Server action CSRF: `npm run lint:action-origin --workspace=apps/web` passed; `auth.ts` and mutating admin actions use same-origin guards.
- Public route rate limits: `npm run lint:public-route-rate-limit --workspace=apps/web` passed; OG/search/share/feed surfaces are covered or explicitly exempted with bounded behavior.
- Upload path safety: originals are basename-only/private/symlink-checked in `apps/web/src/lib/upload-paths.ts:68-193`; transformed upload serving allowlists directories/extensions and validates realpath containment in `apps/web/src/lib/serve-upload.ts:162-238`.
- Backup/download/restore: backup download validates filename and realpath containment in `apps/web/src/app/api/admin/db/download/route.ts:21-90`; restore scans dangerous SQL in `apps/web/src/lib/sql-restore-scan.ts:61-265`; restore drains foreground mutations before import in `apps/web/src/app/[locale]/admin/db-actions.ts:539-568`.
- SSRF: OG photo fetches use configured `BASE_URL`, not request origin, and fetch only bounded same-app upload paths via `apps/web/src/lib/og-photo-fetch.ts:30-118`.
- XSS/JSON-LD: JSON-LD script content is emitted through `safeJsonLd` at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:270-284`, and `safeJsonLd` escapes script-breaking characters in `apps/web/src/lib/safe-json-ld.ts:14-19`.
- Data privacy: public select fields omit admin/private fields and have compile-time guards in `apps/web/src/lib/data.ts:368-488`; targeted privacy tests passed.
- Shell/env handling: deploy env files are refused unless private in `scripts/deploy-remote.sh:55-85` and `apps/web/deploy.sh:15-43`; MySQL child processes pass credentials through minimal environment, not argv, in the restore/backup code reviewed.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm test --workspace=apps/web -- migration-journal.test.ts migration-journal-monotonicity.test.ts migrate-pending-migrations.test.ts sql-restore-scan.test.ts tracked-secrets.test.ts privacy-fields.test.ts` - passed, 6 files / 63 tests.
- `npm audit --workspace=apps/web --audit-level=moderate --json` - failed with 6 moderate advisories, 0 high, 0 critical.

## Final Sweep

Final sweep covered auth/authz, admin/public APIs, server actions, upload/restore/download paths, migrations, privacy projections, rate limits, CSP, SSRF, raw SQL, shell/process execution, deploy scripts, tests, docs, and secret patterns. I did not modify source code or plans. Residual risk is concentrated in dependency upgrades and live deployment/operator validation, not in a confirmed source-level auth bypass, CSRF gap, path traversal, SQL injection, SSRF, or secret leak in current HEAD.
