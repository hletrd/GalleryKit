# Security Reviewer Report - Cycle 8

Date: 2026-07-07 KST
Reviewer lane: security-reviewer
HEAD reviewed: `eca554146776`
Scope: whole-repository security/privacy review. Read-only source review plus this artifact only.

## Result Summary

- Critical/High findings: 0
- Medium findings: 2
- Low findings: 1
- Source-level auth bypass, CSRF gap, SQL injection, path traversal, SSRF, secret leak, or private-original exposure found: none confirmed.
- Validation note: I did not run e2e or DB-backed checks because the lane was explicitly told not to mutate or touch the temporary MySQL container.

The strongest controls are centralized admin API auth, same-origin gates on mutating Server Actions, bounded/rate-limited public expensive routes, private original-upload storage, strict upload serving containment, restore scanner/advisory locks, and compile/test-guarded public privacy projections.

## Inventory

Security-relevant inventory built before detailed review:

- Instructions/docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, current `.context/reviews/security-reviewer.md`.
- Auth/session/admin gates: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/proxy.ts`, admin layouts under `apps/web/src/app/[locale]/admin/**/layout.tsx`.
- CSRF/origin/rate limits: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, and lint gates in `apps/web/scripts/check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`.
- Server Actions/admin APIs: all `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/**/route.ts`.
- Public APIs/pages: upload routes, feed routes, OG routes, semantic/similar search routes, public share/photo/topic/map/timeline/year pages, public actions in `apps/web/src/app/actions/public.ts`.
- Upload/download/storage/image: `apps/web/src/lib/upload-paths.ts`, `serve-upload.ts`, `process-image.ts`, `og-photo-fetch.ts`, `image-url.ts`, Lightroom upload route, browser upload actions, backup download route.
- SQL/Drizzle/restore/migrations: `apps/web/src/db/**`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`, `mysql-connection-options.js`, `apps/web/src/lib/sql-restore-scan.ts`, `db-restore.ts`, `mysql-cli-ssl.ts`.
- Privacy/data projections: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `search-enrichment-fields.ts`, analytics files, privacy/map/secret tests.
- Headers/CSP/service worker: `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/components/register-service-worker.tsx`, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/nginx/default.conf`.
- Secrets/env/deploy: `.env.deploy.example`, `apps/web/.env.local.example`, gitignored local env file status/modes, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/scripts/entrypoint.sh`.
- Dependencies/tests: root/app `package.json`, `package-lock.json`, selected security/privacy tests and lint gates.

## Findings

### C8-SEC-01 - Medium - Next bundles vulnerable PostCSS in the production dependency graph

Severity: Medium
Confidence: High
Status: confirmed dependency advisory

Evidence:

- `apps/web/package.json:57` depends on `next@^16.2.10`.
- `package-lock.json:9334-9335` installs `node_modules/next/node_modules/postcss` at `8.4.31`.
- Direct `postcss` is current enough at `apps/web/package.json:80`, but Next's nested copy is not.
- `npm audit --workspace=apps/web --omit=dev` failed with GHSA-qx2v-qp2m-jg93: PostCSS `<8.5.10`, "XSS via Unescaped </style> in its CSS Stringify Output", through `next`; 2 moderate vulnerabilities, 0 high/critical.
- `npm view next version dist-tags --json` reported `latest: 16.2.10`, and `npm view next@latest dependencies.postcss --json` reported `8.4.31`, so no newer stable Next release was available during this review.

Concrete scenario:

If any runtime/build path stringifies attacker-influenced CSS with the vulnerable nested PostCSS, a crafted CSS value containing `</style>` can break out of a style context and enable XSS. I did not find a current app route that accepts arbitrary public CSS, so this is a confirmed vulnerable dependency with a likely-low current exploit path, not a confirmed reachable app exploit.

Suggested fix:

Track the next stable Next release that raises its bundled PostCSS to a fixed version, upgrade, and rerun `npm audit --workspace=apps/web --omit=dev`. If upstream lags, test an npm `overrides` pin for `postcss >=8.5.10` against `npm run build --workspace=apps/web` and the security/privacy test suite before adopting it. Do not use `npm audit fix --force`; audit suggested an invalid downgrade path for this Next 16 app.

### C8-SEC-02 - Medium - Runtime MySQL TLS ignores `DB_SSL_CA`, creating a private-CA downgrade pressure

Severity: Medium
Confidence: High for code behavior, Medium for deployment impact
Status: risk

Evidence:

- Runtime pool enables TLS for non-local DB hosts with only `ssl: { rejectUnauthorized: true }` in `apps/web/src/db/index.ts:6-12`.
- Shared script helper used by migrations/guards does the same in `apps/web/scripts/mysql-connection-options.js:11-23`.
- Backup/restore CLI paths have a stricter CA contract: `apps/web/src/lib/mysql-cli-ssl.ts:13-24` requires `DB_SSL_CA` for non-local CLI TLS unless `DB_SSL=false`.
- Docs expose `DB_SSL_CA` as the verified MySQL CLI TLS CA path in `apps/web/.env.local.example:9-10`, `README.md:154-170`, and `CLAUDE.md:93-94`, but runtime `mysql2` connections never read that CA.

Concrete scenario:

On a non-local MySQL deployment using a private/internal CA, the app runtime and migration scripts cannot validate the server with the provided `DB_SSL_CA`. Operators may be forced to set `DB_SSL=false` to make runtime connections work, sending credentials and gallery metadata over plaintext inside whatever network segment exists. Backup/restore CLI calls fail closed, but normal app traffic does not get the same explicit CA path.

Suggested fix:

Teach both `apps/web/src/db/index.ts` and `apps/web/scripts/mysql-connection-options.js` to read `DB_SSL_CA` and pass `ssl: { ca: readFileSync(DB_SSL_CA), rejectUnauthorized: true }` for non-local hosts. Add tests that non-local DB hosts use TLS, honor `DB_SSL_CA`, and fail clearly when the CA file is unreadable unless `DB_SSL=false` is explicitly set.

### C8-SEC-03 - Low - Optional Google Analytics is injected from the locale root, so enabling it also tracks admin routes

Severity: Low
Confidence: High
Status: privacy risk

Evidence:

- `apps/web/src/site-config.json:10` currently has `"google_analytics_id": ""`, so this is disabled in the reviewed checkout.
- When configured, GA scripts are injected in the root locale layout at `apps/web/src/app/[locale]/layout.tsx:154-168`, which wraps both public and admin route groups.
- Admin route groups are nested below the same locale root: `apps/web/src/app/[locale]/admin/layout.tsx:21-34` and protected layout `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:5-17`.
- Project docs describe the setting as public-page analytics opt-in: `apps/web/README.md:48` says setting it loads Google Analytics on public pages.

Concrete scenario:

If an operator enables `google_analytics_id`, admin dashboard, DB restore/download, user-management, upload, and settings page visits can send route/path and browser metadata to Google. That leaks owner/admin behavior to a third party and contradicts the documented "public pages" boundary, even though the current checked-in config leaves GA disabled.

Suggested fix:

Move the GA script injection from `apps/web/src/app/[locale]/layout.tsx` into `apps/web/src/app/[locale]/(public)/layout.tsx`, or add a route-aware server gate that suppresses GA for `/admin` and other private surfaces. Add a source test asserting the root/admin layouts do not inject GA and the public layout does when configured.

## Controls Verified

- Admin API: `apps/web/src/lib/api-auth.ts:58-144` centralizes `withAdminAuth`; PAT requests validate `x-gallerykit-token`, scope, and auth spray rate limit before route execution, while cookie requests require trusted same-origin before `isAdmin()`.
- Admin pages: `apps/web/src/proxy.ts:72-107` only prefilters cookie shape, and the protected admin layout performs the cryptographic session/admin check in `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:12-17`.
- Login/session: `apps/web/src/app/actions/auth.ts:99-246` uses same-origin checks, per-IP/account limits, Argon2 dummy hash timing, transactional session rotation, and secure httpOnly SameSite=Lax cookies; `apps/web/src/lib/session.ts:16-36` requires production `SESSION_SECRET`.
- Server Action CSRF: `npm run lint:action-origin --workspace=apps/web` passed and reported all mutating actions protected or explicitly public/rate-limited.
- Public route rate limits: `npm run lint:public-route-rate-limit --workspace=apps/web` passed for OG, search, similar, topic feed, and exempt bounded routes.
- Uploads/originals: browser and LR upload paths validate size/type/metadata and run original storage through private basename-only paths; `apps/web/src/lib/upload-paths.ts:68-193` enforces safe filenames, realpath containment, symlink rejection, and private original root.
- Public derivative serving: `apps/web/src/lib/serve-upload.ts:162-260` allowlists top-level derivative directories/extensions, validates path segments, rejects symlinks, and checks realpath containment.
- Public privacy projection: `apps/web/src/lib/data.ts:368-488` omits original filename, user filename, GPS except map-visible flow, upload owner, color/internal fields, processing diagnostics, and has privacy-sensitive type guards; targeted privacy/map tests passed.
- Map GPS: `apps/web/src/lib/data.ts:409-444` marks map projection as the only public latitude/longitude select and documents the `topics.map_visible` query requirement.
- Search privacy: semantic/similar routes enrich only from guarded public select fields and strip internal scores before returning.
- Backup/restore/download: `apps/web/src/app/api/admin/db/download/route.ts:21-90` is wrapped by admin auth and validates backup filename plus realpath containment; `apps/web/src/app/[locale]/admin/db-actions.ts:404-634` uses same-origin/admin checks, advisory locks, maintenance markers, and mutation drains; `apps/web/src/lib/sql-restore-scan.ts:61-265` blocks dangerous SQL classes.
- SSRF/open redirect: per-photo OG fetch pins the canonical `BASE_URL` origin instead of request host at `apps/web/src/app/api/og/photo/[id]/route.tsx:176-201`; fallback redirects validate same-origin in `route.tsx:329-375`; SEO OG image URLs are same-origin/relative only in `apps/web/src/lib/seo-og-url.ts:3-43`.
- Service worker: `apps/web/public/sw.template.js:525-560` bypasses admin routes and revocable share/map pages; HTML cache excludes admin-rendered responses via `x-gk-admin-render` at `sw.template.js:438-472` and `apps/web/src/proxy.ts:113-124`.
- Secrets/env: `.env.deploy` and `apps/web/.env.local` are gitignored and mode `0600`; tracked examples contain placeholders only; `apps/web/src/__tests__/tracked-secrets.test.ts:7-58` scans tracked text files for literal credential assignments.
- Deploy/Docker: `apps/web/deploy.sh:15-43` refuses missing or group/world-readable runtime env files; `apps/web/scripts/entrypoint.sh:1-47` creates writable directories and sets private original permissions; `apps/web/Dockerfile` runs as `node` after build setup.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed. Admin routes found: DB backup download and LR upload, both wrapped.
- `npm run lint:action-origin --workspace=apps/web`: passed. All mutating Server Actions enforce same-origin provenance; public analytics actions identified as public rate-limited actions.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed. Public expensive/mutating API routes are rate-limited or explicitly exempted.
- `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/map-privacy.test.ts src/__tests__/tracked-secrets.test.ts src/__tests__/sw-template-contract.test.ts src/__tests__/admin-api-routes.test.ts src/__tests__/action-origin-lint.test.ts src/__tests__/public-route-rate-limit-lint.test.ts`: passed, 4 files / 56 tests selected by Vitest.
- `npm audit --workspace=apps/web --omit=dev`: failed with 2 moderate PostCSS/Next advisories, 0 high/critical in the reported output.
- `npm view next version dist-tags --json`: `latest` was `16.2.10`; `npm view next@latest dependencies.postcss --json`: `8.4.31`.

## Final Sweep

Final sweep covered auth/authz, admin API guards, Server Actions, public API rate limits, upload/download/storage paths, image processing, SQL/Drizzle and raw SQL usage, backup/restore, secrets/env handling, CSP/headers, CSRF/origin checks, cookies/session handling, telemetry/analytics, service worker behavior, Docker/deploy scripts, dependency audit, and security/privacy tests.

No source code, commits, pushes, deploys, service stops, file removals, or MySQL container mutations were performed. The only file changed by this lane is `.context/reviews/security-reviewer.md`. Remaining risk is concentrated in a vulnerable nested dependency with no stable upstream fix at review time, DB TLS CA handling for private-CA remote databases, and optional GA route scoping.
