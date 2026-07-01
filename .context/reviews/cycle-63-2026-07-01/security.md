# Cycle 63 Security Review

Start HEAD: `ecfda466`

Scope reviewed:

- Authentication/session/auth-origin surfaces: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/proxy.ts`.
- Admin APIs/actions: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Public mutating/expensive surfaces: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`.
- Upload/original handling: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/instrumentation.ts`, `apps/web/nginx/default.conf`.
- Backup/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/app/api/admin/db/download/route.ts`.
- SQL/raw query helpers and privacy guards: `apps/web/src/lib/sql-like.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/rate-limit.ts`.
- SSRF/open redirect and deploy/config safety: `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/constants.ts`, `apps/web/next.config.ts`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`.

Prior context read:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/plans/cycle-62-2026-07-01-plan.md`
- `.context/plans/cycle-62-2026-07-01-deferred.md`
- `.context/reviews/cycle-62-2026-07-01/_aggregate.md`

Deferred handling:

- Did not re-raise carried-forward deferred items (`C62-04`, `C61-06`, `C61-07`, `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`). No new security evidence changed their scheduling.

## Findings

No new security findings.

## Evidence

- Admin API auth contract is enforced by `withAdminAuth(...)` on both admin routes:
  - `apps/web/src/app/api/admin/db/download/route.ts:21`
  - `apps/web/src/app/api/admin/lr/upload/route.ts:84`
  - The wrapper verifies PAT scope before bypassing same-origin for integration clients and enforces same-origin for cookie auth at `apps/web/src/lib/api-auth.ts:72` and `apps/web/src/lib/api-auth.ts:114`.
- Mutating server actions return early on same-origin/admin checks:
  - Central helper: `apps/web/src/lib/action-guards.ts:37`
  - Auth-specific origin checks: `apps/web/src/app/actions/auth.ts:99`, `apps/web/src/app/actions/auth.ts:294`
  - DB backup/restore checks: `apps/web/src/app/[locale]/admin/db-actions.ts:171`, `apps/web/src/app/[locale]/admin/db-actions.ts:368`
- Session/auth posture remained sound:
  - Production refuses DB-stored fallback signing secret when `SESSION_SECRET` is missing or short at `apps/web/src/lib/session.ts:30`.
  - HMAC session verification uses `timingSafeEqual` at `apps/web/src/lib/session.ts:117`.
  - Argon2id parameters are explicit at `apps/web/src/lib/password-hashing.ts:10`.
- Public expensive/mutating routes are bounded before protected work:
  - Semantic search same-origin, maintenance, body-size, and limiter gates: `apps/web/src/app/api/search/semantic/route.ts:107`.
  - Similar search same-origin, maintenance, id validation, and limiter gates: `apps/web/src/app/api/search/similar/[id]/route.ts:68`.
  - OG route rate limit before ImageResponse generation: `apps/web/src/app/api/og/route.tsx:88`.
  - Per-photo OG route rate limit and invalid-id rollback: `apps/web/src/app/api/og/photo/[id]/route.tsx:55`, `apps/web/src/app/api/og/photo/[id]/route.tsx:60`.
  - Public server actions validate/limit search/load-more/view recording before DB writes at `apps/web/src/app/actions/public.ts:121`, `apps/web/src/app/actions/public.ts:236`, and `apps/web/src/app/actions/public.ts:417`.
- Original uploads are kept out of the public serving path:
  - Private original root defaults to `data/uploads/original` at `apps/web/src/lib/upload-paths.ts:27`.
  - Original directory is created/chmodded `0700` at `apps/web/src/lib/upload-paths.ts:49`.
  - Public upload serving allowlist excludes `original` at `apps/web/src/lib/serve-upload.ts:14`.
  - Startup fails production when legacy public originals remain at `apps/web/src/instrumentation.ts:5`.
  - Nginx also denies `/uploads/original/` at `apps/web/nginx/default.conf:165`.
- Upload write/metadata/GPS handling is bounded:
  - Originals are streamed to disk with `0600` mode at `apps/web/src/lib/process-image.ts:905`.
  - Sharp uses `limitInputPixels` on metadata validation at `apps/web/src/lib/process-image.ts:922`.
  - GPS-strip failure returns `false`, and upload callers reject/quarantine when strip is configured at `apps/web/src/lib/process-image.ts:1737`.
  - Lightroom upload deletes the saved original and returns an error when GPS stripping cannot be guaranteed at `apps/web/src/app/api/admin/lr/upload/route.ts:407`.
- Backup/restore is authenticated, origin-gated, and constrained:
  - Backup filenames are generated server-side and downloaded only through authenticated route validation at `apps/web/src/app/api/admin/db/download/route.ts:23`.
  - Backup directory/file modes are `0700`/`0600` at `apps/web/src/app/[locale]/admin/db-actions.ts:185` and `apps/web/src/app/[locale]/admin/db-actions.ts:230`.
  - Restore takes DB/upload/backfill advisory locks before import at `apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`, `apps/web/src/app/[locale]/admin/db-actions.ts:413`, and `apps/web/src/app/[locale]/admin/db-actions.ts:429`.
  - Restore writes temp SQL uploads as `0600`, validates dump headers, scans chunks, then imports with `--one-database` at `apps/web/src/app/[locale]/admin/db-actions.ts:581`, `apps/web/src/app/[locale]/admin/db-actions.ts:597`, `apps/web/src/app/[locale]/admin/db-actions.ts:620`, and `apps/web/src/app/[locale]/admin/db-actions.ts:674`.
  - Dangerous restore SQL patterns block cross-schema writes, privilege changes, routines/triggers/views, loaders, shell/server operations, and arbitrary destructive statements at `apps/web/src/lib/sql-restore-scan.ts:61`.
- Raw SQL reviewed in the security paths uses parameterized `mysql2` calls or Drizzle `sql` placeholders. No user input concatenation was found in reviewed auth/admin/upload/search/restore paths.
- Privacy-sensitive field guards are symmetric:
  - Public select destructuring omits sensitive/internal fields at `apps/web/src/lib/data.ts:368`.
  - Compile-time `PrivacySensitiveKeys` guard at `apps/web/src/lib/data.ts:473`.
  - Search enrichment has its own type-only privacy guard at `apps/web/src/lib/search-enrichment-fields.ts:43`.
  - Test fixture mirrors the sensitive key contract at `apps/web/src/__tests__/privacy-fields.test.ts:7`.
- SSRF/open redirect surfaces were constrained:
  - Per-photo OG internal fetch uses canonical `BASE_URL` origin, not request origin, at `apps/web/src/app/api/og/photo/[id]/route.tsx:117`.
  - Fallback redirect validates same-origin `ogImageUrl` before redirecting at `apps/web/src/app/api/og/photo/[id]/route.tsx:275`.
  - Fetch helper only requests canonical-origin JPEG derivative paths and enforces timeout/1 MiB caps at `apps/web/src/lib/og-photo-fetch.ts:64`.
- Deploy/config safety:
  - `IMAGE_BASE_URL` remote image configuration is parsed through the CSP image-base validator at `apps/web/next.config.ts:8`.
  - Deploy refuses group/world-readable runtime env files at `apps/web/deploy.sh:28`.
  - Nginx keeps narrow default/admin body caps and explicit upload/restore exceptions at `apps/web/nginx/default.conf:31`, `apps/web/nginx/default.conf:74`, `apps/web/nginx/default.conf:91`, and `apps/web/nginx/default.conf:124`.

## Validation

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- privacy-fields sql-restore-scan backup-download-route og-route-rate-limit-behavior semantic-search-rate-limit` passed: 5 files, 50 tests.
