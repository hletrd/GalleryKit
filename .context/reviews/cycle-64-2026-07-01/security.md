# Cycle 64 Security Review

Start HEAD: `efdbaf9a4971e8c59051fe422c8b44d6e9dd455f`

Review-only lane. No files modified.

## Context Read

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/plans/cycle-63-2026-07-01-plan.md`
- `.context/plans/cycle-63-2026-07-01-deferred.md`
- `.context/reviews/cycle-63-2026-07-01/security.md`

`HEAD` differs from Cycle 63 implementation commit `254a68c2` only in plan/ledger docs; no app source files changed since the prior security review.

## Scope Reviewed

- Auth/session/origin: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/proxy.ts`.
- Admin APIs/actions: `apps/web/src/app/api/admin/**`, `apps/web/src/app/actions/**`, `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Public expensive/mutating routes/actions: semantic/similar search, OG routes, load-more/search/view-recording actions.
- Upload/original handling, backup/restore, SQL/raw query helpers, privacy guards, SSRF/open redirect, deploy/config safety.

## Findings

No new security findings.

## Evidence

- Admin API auth remains centralized: `withAdminAuth` enforces PAT scope before token bypass at `apps/web/src/lib/api-auth.ts:72`, cookie same-origin at `apps/web/src/lib/api-auth.ts:114`, admin auth at `apps/web/src/lib/api-auth.ts:123`, and no-store/nosniff success defaults at `apps/web/src/lib/api-auth.ts:134`.
- Session posture remains sound: production refuses DB fallback session secrets at `apps/web/src/lib/session.ts:30`, HMAC verification uses `timingSafeEqual` at `apps/web/src/lib/session.ts:117`, and Argon2id parameters are explicit at `apps/web/src/lib/password-hashing.ts:10`.
- Mutating server actions are origin-gated by `requireSameOriginAdmin()` at `apps/web/src/lib/action-guards.ts:37`; the scanner confirmed all mutating exports.
- Public expensive routes are gated/rate-limited before protected work: semantic route gates at `apps/web/src/app/api/search/semantic/route.ts:107`, similar route gates at `apps/web/src/app/api/search/similar/[id]/route.ts:68`, OG route limiter at `apps/web/src/app/api/og/route.tsx:88`, and per-photo OG limiter/fallback policy at `apps/web/src/app/api/og/photo/[id]/route.tsx:55`.
- Original uploads remain private: private root at `apps/web/src/lib/upload-paths.ts:28`, `0700` directory mode at `apps/web/src/lib/upload-paths.ts:49`, `0600` original write at `apps/web/src/lib/process-image.ts:905`, public serving allowlist excludes `original` at `apps/web/src/lib/serve-upload.ts:14`, startup blocks legacy public originals at `apps/web/src/instrumentation.ts:5`, and nginx returns 404 for `/uploads/original/` at `apps/web/nginx/default.conf:165`.
- Privacy guards remain symmetric: public select omission at `apps/web/src/lib/data.ts:368`, compile-time sensitive-key guard at `apps/web/src/lib/data.ts:473`, search enrichment guard at `apps/web/src/lib/search-enrichment-fields.ts:43`, and fixture mirror at `apps/web/src/__tests__/privacy-fields.test.ts:7`.
- SSRF/open redirect surfaces remain pinned: per-photo OG internal fetch uses canonical `BASE_URL` at `apps/web/src/app/api/og/photo/[id]/route.tsx:117`, fetch helper only builds canonical derivative paths with timeout/1 MiB caps at `apps/web/src/lib/og-photo-fetch.ts:64`, and fallback redirects require same-origin `ogImageUrl` at `apps/web/src/app/api/og/photo/[id]/route.tsx:275`.

## Validation

- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- `npm test --workspace=apps/web -- privacy-fields sql-restore-scan backup-download-route og-route-rate-limit-behavior og-photo-fallback semantic-search-rate-limit similar-route upload-paths api-auth action-origin public-route-rate-limit` - pass: 12 files, 287 tests.
- `npm audit --workspace=apps/web --audit-level=high` - pass: 0 vulnerabilities.
