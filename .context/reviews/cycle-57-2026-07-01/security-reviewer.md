# Cycle 57 Security/Privacy Review

- Role: security-reviewer
- Date: 2026-07-01
- Repo: `/Users/hletrd/flash-shared/gallery`
- HEAD reviewed: `677a8410933a9aaabbd43721dcc5a0bdb6eee786`
- Write scope honored: this review artifact only
- Finding count: 0

## Findings

No confirmed new actionable security or privacy findings in this cycle.

I avoided re-raising carry-forward/deferred items from earlier cycle artifacts unless new evidence changed severity or scheduling. The current HEAD includes the deploy secret-permission hardening from the Cycle 55/56 line and the admin photo viewer now calls the viewer-aware query path, so those were treated as closed/currently covered rather than re-filed.

## Inventory Reviewed

### Auth, Authz, Sessions, Admin API Wrappers

- Admin API exports are guarded by `withAdminAuth(...)`; the wrapper validates personal access tokens, same-origin admin sessions, and adds no-store/nosniff headers on success: `apps/web/src/lib/api-auth.ts:58`, `apps/web/src/lib/api-auth.ts:72`, `apps/web/src/lib/api-auth.ts:114`, `apps/web/src/lib/api-auth.ts:130`.
- PAT generation/verification uses random tokens, hashed storage, timing-safe comparison, expiry, scope checks, and one-time token marking: `apps/web/src/lib/admin-tokens.ts:52`, `apps/web/src/lib/admin-tokens.ts:68`, `apps/web/src/lib/admin-tokens.ts:141`, `apps/web/src/lib/admin-tokens.ts:170`.
- Session tokens fail closed when `SESSION_SECRET` is missing in production, are HMAC protected, timing-safe compared, and checked against DB session state/max age: `apps/web/src/lib/session.ts:16`, `apps/web/src/lib/session.ts:82`, `apps/web/src/lib/session.ts:94`.
- Admin DB download is wrapped, validates backup filenames, resolves within the configured backup directory, rejects symlinks/non-files, and serves attachment headers: `apps/web/src/app/api/admin/db/download/route.ts:21`, `apps/web/src/app/api/admin/db/download/route.ts:31`, `apps/web/src/app/api/admin/db/download/route.ts:58`, `apps/web/src/app/api/admin/db/download/route.ts:69`.
- Evidence: `npm run lint:api-auth --workspace=apps/web` passed for both admin API route files.

### Server Actions and Origin Guards

- Same-origin validation requires an origin/referer match against the expected host/protocol and fails closed when provenance is absent: `apps/web/src/lib/request-origin.ts:45`, `apps/web/src/lib/request-origin.ts:79`.
- The shared admin action guard returns early unless the request is a trusted same-origin admin request: `apps/web/src/lib/action-guards.ts:37`.
- Auth actions validate same-origin provenance before login rate limiting/session mutation, logout, and password update paths: `apps/web/src/app/actions/auth.ts:77`, `apps/web/src/app/actions/auth.ts:129`, `apps/web/src/app/actions/auth.ts:267`, `apps/web/src/app/actions/auth.ts:290`.
- Evidence: `npm run lint:action-origin --workspace=apps/web` passed and reported that all mutating server actions enforce same-origin provenance.

### Public Rate Limits and Expensive Routes

- Public rate-limit buckets cover auth/search/admin token flows and OG/share throttles: `apps/web/src/lib/rate-limit.ts:66`, `apps/web/src/lib/rate-limit.ts:78`.
- Client IP extraction is proxy-aware only when trusted proxy mode is configured and falls back conservatively otherwise: `apps/web/src/lib/rate-limit.ts:166`.
- The expensive per-photo OG endpoint pre-increments before DB/fetch/Satori/Sharp work and keeps failed/fallback attempts charged where work was consumed: `apps/web/src/app/api/og/photo/[id]/route.tsx:45`, `apps/web/src/app/api/og/photo/[id]/route.tsx:48`, `apps/web/src/app/api/og/photo/[id]/route.tsx:68`, `apps/web/src/app/api/og/photo/[id]/route.tsx:124`, `apps/web/src/app/api/og/photo/[id]/route.tsx:231`.
- Semantic and similar-search public routes enforce same-origin/rate-limit gating before expensive vector/search work: `apps/web/src/app/api/search/semantic/route.ts:107`, `apps/web/src/app/api/search/semantic/route.ts:263`, `apps/web/src/app/api/search/similar/[id]/route.ts:68`, `apps/web/src/app/api/search/similar/[id]/route.ts:135`.
- Explicit public exemptions were reviewed for bounded/cheap behavior: root feed and topic feed are limited/cached, upload derivative routes delegate to safe static serving, health/live are cheap operational endpoints: `apps/web/src/app/feed.xml/route.ts:15`, `apps/web/src/app/feed.xml/route.ts:41`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:41`, `apps/web/src/app/uploads/[...path]/route.ts:18`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:16`, `apps/web/src/app/api/health/route.ts:7`, `apps/web/src/app/api/live/route.ts:3`.
- Evidence: `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

### Upload, File, and Image Safety

- Lightroom upload route is admin/PAT-gated, enforces size and upload-tracker limits, validates topic/filename/string lengths, checks disk space, uses upload-contract locking, strips GPS from original uploads, and audits completion: `apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/app/api/admin/lr/upload/route.ts:101`, `apps/web/src/app/api/admin/lr/upload/route.ts:130`, `apps/web/src/app/api/admin/lr/upload/route.ts:188`, `apps/web/src/app/api/admin/lr/upload/route.ts:279`, `apps/web/src/app/api/admin/lr/upload/route.ts:310`, `apps/web/src/app/api/admin/lr/upload/route.ts:394`, `apps/web/src/app/api/admin/lr/upload/route.ts:552`.
- Browser/admin image upload action performs same-origin/admin checks, validates files/topic/tags, uses the upload tracker and disk precheck, strips GPS from originals, and cleans up derivatives/originals on delete paths: `apps/web/src/app/actions/images.ts:128`, `apps/web/src/app/actions/images.ts:141`, `apps/web/src/app/actions/images.ts:191`, `apps/web/src/app/actions/images.ts:267`, `apps/web/src/app/actions/images.ts:399`, `apps/web/src/app/actions/images.ts:648`, `apps/web/src/app/actions/images.ts:722`.
- Image processing validates size, writes private originals with restrictive mode, validates metadata through Sharp, and cleans up on metadata/color failures: `apps/web/src/lib/process-image.ts:887`, `apps/web/src/lib/process-image.ts:909`, `apps/web/src/lib/process-image.ts:916`, `apps/web/src/lib/process-image.ts:988`.
- Upload path helpers create the private original directory as `0700`, validate filenames, resolve real paths, reject symlinks, and enforce containment: `apps/web/src/lib/upload-paths.ts:49`, `apps/web/src/lib/upload-paths.ts:68`, `apps/web/src/lib/upload-paths.ts:120`.
- Static upload serving allowlists derivative directories, rejects unsafe path segments/symlinks/out-of-root paths, restricts content type, and streams descriptor-safely: `apps/web/src/lib/serve-upload.ts:126`, `apps/web/src/lib/serve-upload.ts:175`, `apps/web/src/lib/serve-upload.ts:197`, `apps/web/src/lib/serve-upload.ts:277`.

### SSRF, XSS, CSV, and Unicode Injection

- Per-photo OG internal fetch is pinned to trusted `BASE_URL` rather than attacker-controlled request origin, fails closed if canonical URL is invalid, and same-origin-validates fallback redirects: `apps/web/src/app/api/og/photo/[id]/route.tsx:97`, `apps/web/src/app/api/og/photo/[id]/route.tsx:109`, `apps/web/src/app/api/og/photo/[id]/route.tsx:267`.
- OG photo fetches are bounded by timeout, byte cap, and total chain budget: `apps/web/src/lib/og-photo-fetch.ts:31`, `apps/web/src/lib/og-photo-fetch.ts:41`, `apps/web/src/lib/og-photo-fetch.ts:54`, `apps/web/src/lib/og-photo-fetch.ts:72`, `apps/web/src/lib/og-photo-fetch.ts:81`, `apps/web/src/lib/og-photo-fetch.ts:85`.
- OG text sanitization strips C0 and Unicode formatting controls: `apps/web/src/lib/og-sanitize.ts:27`.
- JSON-LD output uses a dedicated escaping helper for `<`, `>`, and line separators, including the public photo page that excludes GPS from structured data: `apps/web/src/lib/safe-json-ld.ts:14`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:176`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:263`.
- CSV export uses injection-safe escaping and strips risky controls/formatting characters: `apps/web/src/lib/csv-escape.ts:41`.

### Secrets, Deploy Scripts, Backup/Restore

- Remote deploy refuses missing, non-owned, or group/world-readable `.env.deploy` before sourcing it: `scripts/deploy-remote.sh:55`, `scripts/deploy-remote.sh:67`, `scripts/deploy-remote.sh:82`.
- Web deploy refuses missing, non-owned, or group/world-readable runtime `.env.local` before Docker compose uses it, and post-deploy prune does not use destructive volume `-a`: `apps/web/deploy.sh:15`, `apps/web/deploy.sh:26`, `apps/web/deploy.sh:55`, `apps/web/deploy.sh:99`.
- DB export/restore actions are same-origin/admin guarded, keep backup files in a `0700` directory with `0600` files, pass DB password through environment rather than CLI args, sanitize stderr, scan restore SQL for dangerous statements, and use advisory locks: `apps/web/src/app/[locale]/admin/db-actions.ts:81`, `apps/web/src/app/[locale]/admin/db-actions.ts:185`, `apps/web/src/app/[locale]/admin/db-actions.ts:221`, `apps/web/src/app/[locale]/admin/db-actions.ts:230`, `apps/web/src/app/[locale]/admin/db-actions.ts:255`, `apps/web/src/app/[locale]/admin/db-actions.ts:365`, `apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:620`, `apps/web/src/app/[locale]/admin/db-actions.ts:674`.
- Backup filename validation is centralized and constrained to the expected dump naming pattern: `apps/web/src/lib/backup-filename.ts:3`.

### Privacy-Sensitive Fields and Photographer Metadata

- `adminSelectFields` is explicitly marked full/admin-only and contains raw filenames, GPS, upload user, processing diagnostics, pipeline/color internals, and original file metadata: `apps/web/src/lib/data.ts:251`.
- `publicSelectFields` is derived by omission and excludes GPS, original/user filenames, original metadata, processing diagnostics, HDR/color pipeline internals, upload user, and pipeline version: `apps/web/src/lib/data.ts:368`.
- The public map select is the only unauthenticated GPS exposure path and is paired with a topic-level `map_visible` SQL predicate plus runtime assertion: `apps/web/src/lib/data.ts:410`, `apps/web/src/lib/data.ts:1691`, `apps/web/src/lib/data.ts:1706`, `apps/web/src/lib/data.ts:1710`, `apps/web/src/lib/data.ts:1718`.
- Compile-time privacy guards cover public, public-map, and search select shapes: `apps/web/src/lib/data.ts:459`, `apps/web/src/lib/data.ts:479`, `apps/web/src/lib/data.ts:1555`.
- Public share-key queries use public select fields rather than the admin field set: `apps/web/src/lib/data.ts:1208`, `apps/web/src/lib/data.ts:1226`.
- Viewer-aware photo page fetches admin fields only for admin viewers: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:143`, `apps/web/src/lib/data.ts:1204`.
- Evidence tests lock the sensitive-key list, public omission behavior, search omission behavior, and map-visible GPS predicates/runtime guard: `apps/web/src/__tests__/privacy-fields.test.ts:7`, `apps/web/src/__tests__/privacy-fields.test.ts:60`, `apps/web/src/__tests__/privacy-fields.test.ts:86`, `apps/web/src/__tests__/privacy-fields.test.ts:126`, `apps/web/src/__tests__/map-privacy.test.ts:89`, `apps/web/src/__tests__/map-privacy.test.ts:97`.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm audit --workspace=apps/web --audit-level=high` reported `found 0 vulnerabilities`.
- Focused security/privacy regression suite passed: 23 files, 444 tests.

Focused test command:

```sh
npm test --workspace=apps/web -- --run src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/map-privacy.test.ts src/__tests__/upload-paths.test.ts src/__tests__/serve-upload.test.ts src/__tests__/upload-filenames.test.ts src/__tests__/csv-escape.test.ts src/__tests__/sanitize-admin-string.test.ts src/__tests__/sanitize-for-og-global.test.ts src/__tests__/og-sanitize.test.ts src/__tests__/og-photo-fallback.test.ts src/__tests__/og-route-rate-limit-behavior.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/db-restore.test.ts src/__tests__/tracked-secrets.test.ts src/__tests__/api-auth-response-headers.test.ts src/__tests__/request-origin.test.ts src/__tests__/admin-tokens.test.ts src/__tests__/auth-rate-limit.test.ts src/__tests__/strip-gps-from-original.test.ts src/__tests__/lr-upload-hdr-gate.test.ts
```

Not run: full app build, full typecheck, full unit suite, or Playwright e2e. This review used the security lint gates, dependency audit, and focused security/privacy tests appropriate for the read-only review scope.

## Missed-Issues Sweep

Final sweep covered route inventories, server action inventories, `withAdminAuth` usage, same-origin guards, public rate-limit exemptions, upload/download path containment, symlink rejection, backup/restore process spawning and stderr handling, JSON-LD/OG/CSV sanitizers, canonical-origin OG fetch behavior, privacy-sensitive select sets, map GPS exposure, PAT/session handling, deploy secret permission checks, and recent Cycle 55/56 review carry-forward items. I found no new evidence that changes the severity or scheduling of deferred carry-forward items.
