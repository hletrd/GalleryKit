# Cycle 50 Security/Auth Review

Reviewer: security/auth lane
Date: 2026-07-01
Baseline inspected: `3a02f7ee`
Scope: read-only source review except this artifact.

## Result

No actionable new security/auth findings.

Finding count: 0

## Inventory

Guidance and prior-review filter:

- Read `AGENTS.md` and the security, privacy, upload, migration, deploy, and quality-gate sections of `CLAUDE.md`.
- Reviewed recent review context before source inspection:
  - `.context/reviews/cycle-42-2026-07-01/security-reviewer.md`
  - `.context/reviews/cycle-48-2026-07-01/security-privacy.md`
  - `.context/reviews/cycle-49-2026-07-01/_aggregate.md`
  - `.context/reviews/_aggregate.md`
  - `.context/plans/README.md`
- Did not re-raise deferred carry-forward items where current evidence did not change severity or scheduling: `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`.
- Checked current Cycle 49 security-adjacent closures: the topic delete path now uses the topic-route advisory lock, and remote deploy docs/helper now require `chmod 600` on the deploy env file.

Relevant source inventory:

- Auth/authz and CSRF/same-origin:
  - `apps/web/src/lib/api-auth.ts`
  - `apps/web/src/lib/request-origin.ts`
  - `apps/web/src/lib/action-guards.ts`
  - `apps/web/src/lib/session.ts`
  - `apps/web/src/app/actions/auth.ts`
  - `apps/web/src/proxy.ts`
- Admin APIs and admin actions:
  - `apps/web/src/app/api/admin/db/download/route.ts`
  - `apps/web/src/app/api/admin/lr/upload/route.ts`
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/src/app/actions/admin-users.ts`
  - `apps/web/src/app/actions/lr-tokens.ts`
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/app/actions/topics.ts`
  - `apps/web/src/app/actions/settings.ts`
  - `apps/web/src/app/actions/seo.ts`
  - `apps/web/src/app/actions/sharing.ts`
  - `apps/web/src/app/actions/tags.ts`
  - `apps/web/src/app/actions/collections.ts`
  - `apps/web/src/app/actions/embeddings.ts`
  - `apps/web/src/app/actions/admin-backfill.ts`
- Public APIs and rate limiting:
  - `apps/web/src/app/api/search/semantic/route.ts`
  - `apps/web/src/app/api/search/similar/[id]/route.ts`
  - `apps/web/src/app/api/og/route.tsx`
  - `apps/web/src/app/api/og/photo/[id]/route.tsx`
  - `apps/web/src/app/api/health/route.ts`
  - `apps/web/src/app/api/live/route.ts`
  - `apps/web/src/app/actions/public.ts`
  - `apps/web/src/lib/rate-limit.ts`
- Upload/path traversal/SSRF/inline script sinks:
  - `apps/web/src/lib/upload-paths.ts`
  - `apps/web/src/lib/serve-upload.ts`
  - `apps/web/src/lib/upload-filenames.ts`
  - `apps/web/src/lib/validation.ts`
  - `apps/web/src/lib/sanitize.ts`
  - `apps/web/src/lib/og-photo-fetch.ts`
  - `apps/web/src/lib/seo-og-url.ts`
  - `apps/web/src/lib/safe-json-ld.ts`
  - `apps/web/src/app/uploads/[...path]/route.ts`
  - `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- Privacy-sensitive fields:
  - `apps/web/src/lib/data.ts`
  - `apps/web/src/lib/search-enrichment-fields.ts`
  - `apps/web/src/app/[locale]/(public)/map/page.tsx`
  - `apps/web/src/__tests__/privacy-fields.test.ts`
  - `apps/web/src/__tests__/search-route-privacy.test.ts`
- Backup/restore/deploy/secrets:
  - `apps/web/src/lib/db-restore.ts`
  - `apps/web/src/lib/sql-restore-scan.ts`
  - `apps/web/src/lib/backup-filename.ts`
  - `apps/web/deploy.sh`
  - `scripts/deploy-remote.sh`
  - `.env.deploy.example`
  - `.dockerignore`
  - `apps/web/.dockerignore`
  - `apps/web/docker-compose.yml`
  - `apps/web/nginx/default.conf`

## Evidence

Auth/authz and CSRF/same-origin:

- Admin API wrapper has two explicit auth modes. Cookie-backed admin API requests must pass same-origin provenance before `isAdmin()` (`apps/web/src/lib/api-auth.ts:114`), and successful admin API responses get no-store plus nosniff defaults (`apps/web/src/lib/api-auth.ts:134`). Scoped token requests are rate-limited before verification (`apps/web/src/lib/api-auth.ts:75`), require `tokenHasScope(...)` (`apps/web/src/lib/api-auth.ts:82`), and receive the same no-store/nosniff defaults (`apps/web/src/lib/api-auth.ts:98`).
- Same-origin verification fails closed when `Origin`/`Referer` is missing (`apps/web/src/lib/request-origin.ts:87`) and trusts `X-Forwarded-*` only when `TRUST_PROXY=true` (`apps/web/src/lib/request-origin.ts:45`, `apps/web/src/lib/request-origin.ts:58`).
- Server action helper returns early on missing/mismatched same-origin provenance (`apps/web/src/lib/action-guards.ts:37`).
- Session signing requires a 32-byte minimum secret in production (`apps/web/src/lib/session.ts:19`), signs random session tokens with HMAC-SHA256 (`apps/web/src/lib/session.ts:82`), compares signatures with `timingSafeEqual` and enforces expiry (`apps/web/src/lib/session.ts:126`).
- Login, logout, and password update actions check same-origin before mutating (`apps/web/src/app/actions/auth.ts:98`, `apps/web/src/app/actions/auth.ts:274`, `apps/web/src/app/actions/auth.ts:294`). Login and password update pre-increment auth rate limits before Argon2 work (`apps/web/src/app/actions/auth.ts:129`, `apps/web/src/app/actions/auth.ts:344`).

Admin API wrappers, upload controls, and backup download:

- The admin DB backup download route is wrapped by `withAdminAuth` (`apps/web/src/app/api/admin/db/download/route.ts:21`), validates the backup filename (`apps/web/src/app/api/admin/db/download/route.ts:23`), checks path containment before and after `realpath` (`apps/web/src/app/api/admin/db/download/route.ts:31`, `apps/web/src/app/api/admin/db/download/route.ts:51`), and streams from the already-opened validated descriptor (`apps/web/src/app/api/admin/db/download/route.ts:75`).
- The Lightroom upload route is wrapped by `withAdminAuth(..., { allowTokenScope: 'lr:upload' })` (`apps/web/src/app/api/admin/lr/upload/route.ts:84`). It rejects chunked uploads and requires bounded `Content-Length` before multipart parsing (`apps/web/src/app/api/admin/lr/upload/route.ts:101`, `apps/web/src/app/api/admin/lr/upload/route.ts:109`), applies per-actor file/byte windows before accepting work (`apps/web/src/app/api/admin/lr/upload/route.ts:130`), and serializes multipart parsing (`apps/web/src/app/api/admin/lr/upload/route.ts:152`).
- Lightroom upload validates stored user filenames through `getSafeUserFilename` (`apps/web/src/app/api/admin/lr/upload/route.ts:202`), validates topic slugs (`apps/web/src/app/api/admin/lr/upload/route.ts:215`), sanitizes title/description (`apps/web/src/app/api/admin/lr/upload/route.ts:221`), holds the upload-processing contract lock during save/insert/enqueue setup (`apps/web/src/app/api/admin/lr/upload/route.ts:270`), rejects HDR when disabled (`apps/web/src/app/api/admin/lr/upload/route.ts:384`), and strips GPS from both DB values and retained originals when configured (`apps/web/src/app/api/admin/lr/upload/route.ts:394`).
- The Cycle 49 topic-delete race fix is present: `deleteTopic` validates same-origin/admin (`apps/web/src/app/actions/topics.ts:413`) and now runs its image check plus delete inside `withTopicRouteMutationLock` (`apps/web/src/app/actions/topics.ts:433`).

Public route rate limiting and SSRF:

- Semantic search requires same-origin, strict JSON content type, bounded non-chunked `Content-Length`, and a public-search pre-increment rate limit before request-body parsing and vector work (`apps/web/src/app/api/search/semantic/route.ts:107`, `apps/web/src/app/api/search/semantic/route.ts:117`, `apps/web/src/app/api/search/semantic/route.ts:136`, `apps/web/src/app/api/search/semantic/route.ts:173`).
- Similar-image search requires same-origin, validates positive integer IDs, and pre-increments its search route rate limit before target/vector work (`apps/web/src/app/api/search/similar/[id]/route.ts:68`, `apps/web/src/app/api/search/similar/[id]/route.ts:86`, `apps/web/src/app/api/search/similar/[id]/route.ts:98`).
- OG routes rate-limit before DB or expensive image work (`apps/web/src/app/api/og/route.tsx:74`, `apps/web/src/app/api/og/photo/[id]/route.tsx:45`). The photo OG fallback only accepts same-origin canonical/fallback URLs (`apps/web/src/app/api/og/photo/[id]/route.tsx:249`), and the fetch helper builds internal derivative URLs from the configured origin plus fixed upload path segments with timeout/body caps (`apps/web/src/lib/og-photo-fetch.ts:69`, `apps/web/src/lib/og-photo-fetch.ts:81`).
- `normalizeSameOriginOgPath` rejects scheme-relative and backslash bypasses for relative paths, and only allows absolute http(s) URLs that match the expected origin (`apps/web/src/lib/seo-og-url.ts:9`, `apps/web/src/lib/seo-og-url.ts:26`).

Upload/path traversal and private originals:

- Original uploads resolve under a private root, create directories with mode `0700`, validate filenames as basename-only, and reject symlinks plus realpath escapes (`apps/web/src/lib/upload-paths.ts:27`, `apps/web/src/lib/upload-paths.ts:49`, `apps/web/src/lib/upload-paths.ts:120`, `apps/web/src/lib/upload-paths.ts:129`).
- Public upload serving only allows `jpeg`, `webp`, and `avif` top-level directories, validates each segment, enforces extension-to-directory matches, rejects symlinks, checks realpath containment, and streams from the validated descriptor (`apps/web/src/lib/serve-upload.ts:14`, `apps/web/src/lib/serve-upload.ts:90`, `apps/web/src/lib/serve-upload.ts:132`, `apps/web/src/lib/serve-upload.ts:153`, `apps/web/src/lib/serve-upload.ts:175`, `apps/web/src/lib/serve-upload.ts:181`, `apps/web/src/lib/serve-upload.ts:189`, `apps/web/src/lib/serve-upload.ts:278`).
- Inline JSON-LD script sinks use `safeJsonLd`, which JSON serializes and escapes `<`, `>`, U+2028, and U+2029 (`apps/web/src/lib/safe-json-ld.ts:14`).

Privacy-sensitive fields:

- Public selects explicitly omit GPS, original filenames, user filenames, original format/size, processing state, HDR/color internals, upload actor, processing diagnostics, ICC profile names, and pipeline version (`apps/web/src/lib/data.ts:368`).
- Compile-time privacy guards fail if sensitive fields enter `publicSelectFields` or `publicMapSelectFields` beyond the deliberate map latitude/longitude exception (`apps/web/src/lib/data.ts:459`, `apps/web/src/lib/data.ts:479`).
- Public search enrichment has a single compile-guarded select shape for semantic and similar search routes (`apps/web/src/lib/search-enrichment-fields.ts:29`, `apps/web/src/lib/search-enrichment-fields.ts:43`).

Backup/restore, deploy safety, and secrets:

- Restore SQL scanning blocks privilege/user/database/procedure/view/definer/file-output/dangerous write patterns while allowing only expected app-table dump shapes (`apps/web/src/lib/sql-restore-scan.ts:61`, `apps/web/src/lib/sql-restore-scan.ts:210`, `apps/web/src/lib/sql-restore-scan.ts:242`).
- Remote deploy helper refuses to source missing or group/world-readable `.env.deploy` files (`scripts/deploy-remote.sh:55`, `scripts/deploy-remote.sh:65`), and `.env.deploy.example` now documents `chmod 600` (`.env.deploy.example:1`).
- Deploy script gates on required local env/config, health-checks the live service before cleanup, and prunes only after successful `up -d` plus health confirmation; bind-mounted data and host MySQL are documented as out of Docker prune scope (`apps/web/deploy.sh:15`, `apps/web/deploy.sh:32`, `apps/web/deploy.sh:34`, `apps/web/deploy.sh:56`).

## Validation

Passed:

- `npm run lint:api-auth --workspace=apps/web`
  - Confirmed both admin API exports are wrapped: `src/app/api/admin/db/download/route.ts`, `src/app/api/admin/lr/upload/route.ts`.
- `npm run lint:action-origin --workspace=apps/web`
  - Confirmed mutating server actions enforce same-origin provenance; read-only/session exemptions were recognized by the scanner.
- `npm run lint:public-route-rate-limit --workspace=apps/web`
  - Confirmed public expensive/mutating routes are rate-limited or explicitly exempt.
- Focused Vitest security/privacy regression set:
  - `npm test --workspace=apps/web -- check-api-auth.test.ts check-action-origin.test.ts check-public-route-rate-limit.test.ts privacy-fields.test.ts search-route-privacy.test.ts tracked-secrets.test.ts api-auth-response-headers.test.ts request-origin.test.ts backup-download-route.test.ts serve-upload.test.ts upload-paths.test.ts semantic-route.test.ts similar-route.test.ts og-photo-fallback.test.ts seo-og-url.test.ts map-privacy.test.ts topics-actions.test.ts sw-template-contract.test.ts`
  - Result: 16 files passed, 335 tests passed.
- `npm audit --omit=dev --workspace=apps/web`
  - Result: 0 vulnerabilities.
- `npm run typecheck --workspace=apps/web`
  - Result: passed app and script type checks.
- `npm run lint --workspace=apps/web`
  - Result: passed.
- Tracked-secret scan for common assignment patterns found only documented placeholders in README/CLAUDE/historical planning notes; `tracked-secrets.test.ts` also passed in the focused regression set.

## Residual Risk

This was a lane review, not a production penetration test. I did not run deploy, end-to-end browser flows, database restore drills, or destructive checks. No new actionable source-level security/auth issue was found in the reviewed scope.
