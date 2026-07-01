# Cycle 94 Security Review

Scope: current HEAD `33eca7b5e4102bd5097777dbb926ee2cb94c6d71` in `/tmp/gallery-recovery-check`.

Role: security reviewer. Source files were not edited. Review covered auth/authz, public and admin route guards, server actions, upload/file handling, rate limits, SSRF/origin handling, secrets handling, and deployment scripts.

## Inventory Inspected

- Repo instructions and security model: `AGENTS.md`, `CLAUDE.md`.
- Admin/session auth: `apps/web/src/lib/session.ts:16`, `apps/web/src/app/actions/auth.ts:77`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/api-auth.ts:58`, `apps/web/src/lib/admin-tokens.ts:52`.
- Origin/CSRF and middleware guards: `apps/web/src/lib/request-origin.ts:79`, `apps/web/src/lib/action-guards.ts:37`, `apps/web/src/proxy.ts:65`.
- Admin API routes: `apps/web/src/app/api/admin/db/download/route.ts:21`, `apps/web/src/app/api/admin/lr/upload/route.ts:84`.
- Public API/routes and rate-limited public SSR pages: `apps/web/src/app/api/search/semantic/route.ts:107`, `apps/web/src/app/api/search/similar/[id]/route.ts:68`, `apps/web/src/app/api/og/route.tsx:63`, `apps/web/src/app/api/og/photo/[id]/route.tsx:87`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:87`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:92`.
- Public derivative serving and upload storage: `apps/web/src/lib/serve-upload.ts:127`, `apps/web/src/lib/upload-paths.ts:68`, `apps/web/src/lib/process-image.ts:887`, `apps/web/src/lib/process-topic-image.ts:82`, `apps/web/src/lib/storage/local.ts`.
- Mutating server actions: `apps/web/src/app/actions/images.ts:128`, `apps/web/src/app/actions/admin-users.ts:77`, `apps/web/src/app/actions/topics.ts:85`, `apps/web/src/app/actions/tags.ts:42`, `apps/web/src/app/actions/sharing.ts:91`, `apps/web/src/app/actions/settings.ts:41`, `apps/web/src/app/actions/seo.ts:54`, `apps/web/src/app/actions/collections.ts:15`, `apps/web/src/app/actions/lr-tokens.ts:28`, `apps/web/src/app/actions/embeddings.ts:57`, `apps/web/src/app/actions/admin-backfill.ts:32`.
- DB backup/restore and subprocess handling: `apps/web/src/app/[locale]/admin/db-actions.ts:164`, `apps/web/src/app/[locale]/admin/db-actions.ts:365`, `apps/web/src/app/[locale]/admin/db-actions.ts:570`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`.
- SSRF/CSP/URL handling: `apps/web/src/lib/content-security-policy.ts:1`, `apps/web/src/lib/seo-og-url.ts:3`, `apps/web/src/lib/og-photo-fetch.ts:64`, `apps/web/scripts/ensure-site-config.mjs:23`.
- Secrets and deployment: `apps/web/src/__tests__/tracked-secrets.test.ts:7`, `apps/web/deploy.sh:15`, `scripts/deploy-remote.sh:55`, `apps/web/docker-compose.yml:18`, `apps/web/nginx/default.conf:58`, `apps/web/Dockerfile:1`, `apps/web/scripts/entrypoint.sh:4`.

## Confirmed Findings

No confirmed/high-signal security findings at current HEAD.

## High-Signal Checks

- Admin API exports are wrapped by `withAdminAuth(...)`; the static guard check passed for `db/download` and `lr/upload`.
- Mutating server actions enforce `requireSameOriginAdmin()` before privileged work; the static origin guard check passed for all scanned actions.
- Public mutating/expensive routes either use the expected rate-limit helper or carry an explicit exemption; the public-route rate-limit check passed.
- Session signing requires a production `SESSION_SECRET` and verifies HMAC using `timingSafeEqual`; production DB-stored secret fallback is refused in `apps/web/src/lib/session.ts:26`.
- Cookie admin API requests go through same-origin verification in `withAdminAuth`; PAT requests require valid token format, stored SHA-256 hash match, expiry check, and route scope in `apps/web/src/lib/api-auth.ts:72`.
- Upload serving is constrained to `jpeg`, `webp`, and `avif`, validates path segments/extensions, rejects symlinks, and verifies realpath containment in `apps/web/src/lib/serve-upload.ts:137`.
- Original upload path resolution validates basename-only filenames, rejects symlinks, and verifies realpath containment in `apps/web/src/lib/upload-paths.ts:120`.
- Per-photo OG internal fetches use the configured canonical origin, not the request origin, and fall back/fail closed on invalid canonical config in `apps/web/src/app/api/og/photo/[id]/route.tsx:176`.
- DB backup/restore subprocesses pass DB credentials through environment variables, sanitize stderr, use owner-only file modes, validate dump headers, scan restore SQL, and hold restore/upload/backfill advisory locks in `apps/web/src/app/[locale]/admin/db-actions.ts:221`.
- Deploy helpers refuse group/world-readable env files before sourcing or passing secrets to Docker Compose in `apps/web/deploy.sh:28` and `scripts/deploy-remote.sh:65`.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- tracked-secrets.test.ts` passed.
- `npm audit --workspace=apps/web --omit=dev` returned `found 0 vulnerabilities`.

## Residual Risk

- This was a source review plus targeted static/test validation, not a live deployment penetration test.
- Historical secret exposure is already documented as an operational rotation concern in repo plans/CLAUDE.md; HEAD contains placeholders only in the inspected tracked files.
