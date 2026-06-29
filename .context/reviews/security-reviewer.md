# Security Review — review-plan-fix cycle 1/100, prompt 1

Scope: repository-wide security review of `/Users/hletrd/flash-shared/gallery`, covering OWASP Top 10, auth/authz, CSRF/origin, rate limits, SSRF, path traversal, upload handling, secrets, SQL/raw commands, backup/restore, privacy leaks, and deployment scripts.

Method: full inventory first, then file-by-file review of all security-relevant application entry points, shared security utilities, upload/serving code, database backup/restore paths, migration/ops scripts, nginx/Docker/deploy configuration, and committed env/docs. I did not intentionally sample within the relevant security surface. I did not open gitignored live secret files (`.env.deploy`, `apps/web/.env.local`) to avoid exposing local credentials.

Validation evidence:
- `npm audit --json`: 0 vulnerabilities across the audited dependency graph.
- `npm run lint:api-auth --workspace=apps/web`: passed; admin API exports are wrapped.
- `npm run lint:action-origin --workspace=apps/web`: passed; mutating Server Actions enforce same-origin provenance or carry explicit read-only exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; public mutating API routes have rate-limit coverage or explicit exemptions.

## Findings

### SEC-01 — Per-photo OG fallback builds redirects from attacker-controlled request origin

Severity: Medium

Confidence: High

Status: confirmed code path; exploitability depends on whether the public edge rejects arbitrary `Host` / `X-Forwarded-Host`.

Files and lines:
- `apps/web/src/app/api/og/photo/[id]/route.tsx:101-118` correctly documents that request origin is attacker-controllable for server-side fetches and therefore pins internal image fetches to `siteConfig.url`.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:251-285` does not apply the same rule to fallback redirects. It computes `reqOrigin = new URL(req.url).origin` at lines 261-263 and `origin = new URL(req.url).origin` at line 278, then emits `Location: ${origin}/` at lines 279-283.
- `apps/web/nginx/default.conf:191-200` forwards `Host $host` in the catch-all proxy location; more specific proxy locations also forward `$host` / `X-Forwarded-Host` at lines 65-69, 82-86, 99-103, 115-119, 139-143, and 156-160. The shipped config has `server_name gallery.atik.kr` at line 23, but the app-level route still trusts `req.url` rather than the canonical configured origin.

Failure scenario:
An attacker requests `/api/og/photo/not-a-number` or a non-existent photo id with a forged `Host: attacker.example` through any edge path that accepts or forwards the host. The route returns a 302 fallback. Because `buildFallbackResponse()` derives the redirect target from `new URL(req.url).origin`, the trusted gallery endpoint can redirect crawlers or browsers to `https://attacker.example/`. If an admin-configured `og_image_url` is an absolute canonical URL, the same wrong-origin comparison rejects it and falls through to the attacker-host site-root redirect.

This is not the older SSRF issue already fixed in the image-fetch path, because the fallback does not server-fetch the attacker origin. The impact is open redirect / host-header poisoning of a public OG-image endpoint, useful for phishing chains, crawler poisoning, and cache contamination.

Concrete fix:
Change `buildFallbackResponse()` to derive the fallback origin from the trusted canonical configuration (`seo.url` if available, otherwise `siteConfig.url`), not from `req.url`. Treat relative fallback OG paths as relative to that canonical origin. If the canonical URL is missing or invalid, fail closed with a 404/no-store response instead of redirecting to a request-derived origin.

Example shape:

```ts
function buildFallbackResponse(cacheControl: string, canonicalBaseUrl: string, ogImageUrl?: string): Response {
  let canonicalOrigin: string;
  try {
    canonicalOrigin = new URL(canonicalBaseUrl).origin;
  } catch {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': OG_ERROR_CACHE_CONTROL } });
  }

  const fallbackUrl = ogImageUrl
    ? new URL(ogImageUrl, canonicalOrigin)
    : new URL('/', canonicalOrigin);

  if (fallbackUrl.origin !== canonicalOrigin) {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': OG_ERROR_CACHE_CONTROL } });
  }

  return new Response(null, {
    status: 302,
    headers: { Location: fallbackUrl.toString(), 'Cache-Control': cacheControl },
  });
}
```

## Reviewed Security Surface

Application entry points inventoried and reviewed:
- Public routes: `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/uploads/[...path]/route.ts`.
- Admin actions/API: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/*.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Public API routes: `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.
- Public share pages: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`.
- Shared security/data utilities: auth/session/token/rate-limit/origin guards, upload path processing/serving, SQL restore scanning, backup filename validation, data privacy selects, SEO URL validation, sanitization, audit logging, CLIP model loading/pathing.
- Operational surface: `apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/scripts/*.ts`, `apps/web/scripts/*.js`, `apps/web/scripts/*.mjs`, env examples, gitignore, and relevant deployment/secret guidance in `CLAUDE.md`.

## Positive Controls Confirmed

Authentication and session security:
- Production refuses a missing/short `SESSION_SECRET` and does not fall back to a DB-stored signing key (`apps/web/src/lib/session.ts:16-36`).
- Session tokens are HMAC-SHA256 signed, random, age-bounded, timing-safe compared, hashed before DB lookup, and DB-bound (`apps/web/src/lib/session.ts:82-150`).
- Login checks same-origin before authentication work, uses per-IP and per-account rate limits, increments before Argon2 verification, and uses a dummy Argon2 hash to reduce username timing disclosure (`apps/web/src/app/actions/auth.ts:91-180`).
- Password change requires current user, same-origin, current password, rate limiting, and rotates all sessions in the same transaction (`apps/web/src/app/actions/auth.ts:300-445`).

Authorization and CSRF/origin:
- Admin API wrapper enforces same-origin for cookie-authenticated calls and only bypasses it for scoped PAT routes (`apps/web/src/lib/api-auth.ts:49-121`).
- Same-origin validation fails closed if both `Origin` and `Referer` are absent and only trusts forwarded host/proto when `TRUST_PROXY=true` (`apps/web/src/lib/request-origin.ts:45-107`).
- Static lint gates passed for admin API wrapping and mutating Server Action origin checks.

Rate limits and abuse controls:
- IP extraction only trusts proxy headers when explicitly enabled; otherwise it uses a shared `unknown` bucket and logs a production warning (`apps/web/src/lib/rate-limit.ts:152-183`).
- OG, semantic search, share-link creation, login, password change, and uploads use pre-increment or bounded counters in their sensitive paths (`apps/web/src/lib/rate-limit.ts:220-270`, `apps/web/src/app/api/search/semantic/route.ts:190-247`, `apps/web/src/app/actions/sharing.ts:38-82`).
- Public route rate-limit lint passed.

Upload handling and path traversal:
- Public derivative serving whitelists `jpeg`, `webp`, and `avif`, validates each path segment, enforces extension-to-directory matching, rejects symlinks/non-files, uses `realpath` containment, and streams from the resolved path (`apps/web/src/lib/serve-upload.ts:127-309`).
- Upload processing rejects unsupported extensions/known RAW files, enforces max upload size, uses random UUID filenames for disk storage, and cleans up originals on downstream metadata/detection failures (`apps/web/src/lib/process-image.ts:385-462`, `apps/web/src/lib/process-image.ts:945-993`).
- Lightroom upload uses the same admin/token auth boundary, user-filename guard, topic validation, restore-maintenance check, upload-processing contract lock, disk preflight, and cumulative quota tracking (`apps/web/src/app/api/admin/lr/upload/route.ts:57-235`).

SQL, backup, restore, and command execution:
- Backup and restore require admin plus same-origin (`apps/web/src/app/[locale]/admin/db-actions.ts:119-130`, `apps/web/src/app/[locale]/admin/db-actions.ts:266-277`).
- Backup writes to a non-public directory with owner-only directory/file modes, uses `spawn('mysqldump', argv)` without shell interpolation, avoids credentials on argv, redacts stderr, verifies non-empty output, and exposes only an authenticated download URL (`apps/web/src/app/[locale]/admin/db-actions.ts:132-257`).
- Restore streams the upload to a 0600 temp file, caps size, validates plausible dump header, scans chunks for dangerous SQL, runs `mysql --one-database` without shell interpolation, redacts stderr, and deletes the temp file on completion/error (`apps/web/src/app/[locale]/admin/db-actions.ts:363-520`).
- Backup download validates filename shape, path containment, symlink/non-file status, realpath containment, no-store headers, and audit logging (`apps/web/src/app/api/admin/db/download/route.ts:22-101`; filename regex in `apps/web/src/lib/backup-filename.ts:1-12`).
- Restore scanner blocks dangerous statements including user/privilege changes, arbitrary table/database destruction, `LOAD DATA`, `OUTFILE`, `SOURCE`, routines, triggers, events, views, prepared statements, and global settings, while allowing only app-table drops from app backups (`apps/web/src/lib/sql-restore-scan.ts:12-150`).

Privacy and public data minimization:
- `CLAUDE.md` documents which `images` columns are admin-only and the privacy model for EXIF/color/HDR fields (`CLAUDE.md:154-170`).
- Semantic search enrichment uses a shared compile-guarded select instead of selecting the full image row (`apps/web/src/app/api/search/semantic/route.ts:289-335`).
- Share actions audit fingerprints of share keys rather than logging plaintext keys (`apps/web/src/app/actions/sharing.ts:30-31`, `apps/web/src/app/actions/sharing.ts:140-145`).
- Public shared pages are key-based and noindex-oriented; no metadata DB lookup was found before key validation/rate limiting in the reviewed page paths.

Secrets and dependency/deployment posture:
- Committed env examples contain placeholders and rotation warnings, not live values (`apps/web/.env.local.example:1-72`, `.env.deploy.example:1-14`).
- `.gitignore` excludes `.env.local`, `.env.deploy`, app data, local DBs, logs, and transient test artifacts (`.gitignore:1-30`).
- `CLAUDE.md` explicitly treats historical checked-in secrets as compromised and requires rotation (`CLAUDE.md:83-85`, `CLAUDE.md:624-652`).
- Runtime DB connections and migration config enable TLS automatically for non-localhost DB hosts unless explicitly disabled (`apps/web/src/db/index.ts:6-12`, `apps/web/drizzle.config.ts:6-22`, `apps/web/scripts/mysql-connection-options.js:11-23`).
- Docker runtime uses the Node user via entrypoint `gosu`, mounts persisted data, and sets `TRUST_PROXY=true` in the documented host-network compose path (`apps/web/Dockerfile:77-143`, `apps/web/scripts/entrypoint.sh:1-39`, `apps/web/docker-compose.yml:14-26`).
- CLIP runtime loads model weights offline (`allowRemoteModels=false`), with a pinned revision and download-time checksum/loader-fatal verification in the seeding script (`apps/web/src/lib/clip-model.ts:81-99`, `apps/web/scripts/download-clip-models.ts:111-139`, `apps/web/scripts/clip-model-manifest.ts:29-59`).

## Final Sweep

Commonly missed issue classes checked:
- Broken access control: admin pages/actions/API have layered middleware, action/API auth, same-origin gates, and lint coverage. No missing admin auth wrapper was found in current route exports.
- CSRF: mutating Server Actions and admin API cookie paths use same-origin checks. PAT routes intentionally bypass same-origin only after scoped token verification.
- SSRF: the per-photo OG internal fetch pins to `siteConfig.url`; no remaining server fetch of user-supplied arbitrary URLs was found. The redirect fallback finding above is host-header/open-redirect, not SSRF.
- Path traversal and symlinks: public upload serving and backup download both use segment/filename validation plus realpath containment and symlink rejection.
- Upload abuse: per-file and cumulative limits, file extension allowlists, Sharp input-pixel caps, private originals, disk preflight, and cleanup paths were present.
- Raw SQL/commands: reviewed raw SQL/helper paths and child-process invocations. Security-sensitive command execution uses fixed executables/argv and no shell interpolation except deploy helper escape hatches controlled by local deploy env configuration.
- Secrets: no committed live secret values were found at HEAD in examples/config. I did not inspect ignored live env files. Historical secret exposure is documented as an operational rotation item, not a HEAD code defect.
- Privacy leaks: public selects/enrichment avoid admin-only fields; privacy guard fixtures are part of the repo’s test posture per AGENTS/CLAUDE. No direct public selection of full `images` rows was identified in the reviewed public search/share/feed/OG paths.
- Backup/restore: reviewed for path traversal, symlink, command injection, credential leakage, dangerous SQL, temp-file cleanup, maintenance locking, and audit logging. No additional finding beyond the OG redirect issue.
- Deployment scripts: reviewed nginx, Dockerfile, compose, local deploy script, remote deploy helper, entrypoint, migration and CLIP scripts. No additional code defect found; deploy helper’s `DEPLOY_CMD` is an explicit local operator escape hatch, not externally reachable app behavior.

Skipped or irrelevant:
- Live ignored secret files were intentionally not read.
- Production edge/CDN configuration outside this repository was not available. The OG redirect finding should be treated as exploitable unless every public edge strictly rejects non-canonical `Host` and forwarded-host values before nginx/app handling.
- Full git-history secret forensics and history rewriting were not performed; the repo documentation already records historical exposure as requiring operator rotation, and history rewriting/secret rotation is destructive or credential-gated.
