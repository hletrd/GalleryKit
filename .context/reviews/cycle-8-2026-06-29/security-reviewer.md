# Security Reviewer - Cycle 8

Role: `security-reviewer`
HEAD reviewed: `d43f9fc50990`
Date: 2026-06-29
Scope: current HEAD in `/Users/hletrd/flash-shared/gallery`; report-only pass. No implementation files edited.

## Inspection Inventory

Read first, before source review:
- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/security-review/SKILL.md`

Prior review/plan context read to avoid duplicates:
- `.context/reviews/run9-cycle8/security-reviewer.md`
- `.context/reviews/run9-cycle8/_aggregate.md`
- `.context/reviews/security-reviewer.md`
- Current HEAD delta from `17124135..d43f9fc5`, including cycle-7 plan/review files and the upload-processing hardening commit.

Review-relevant inventory covered:
- Project docs/config: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, root/app package manifests, lockfile, Next config, Dockerfile, compose, nginx, deploy helper, env examples, Drizzle migrations/journal, migration scripts.
- All API routes under `apps/web/src/app/api/**/route.{ts,tsx}`.
- All server actions under `apps/web/src/app/actions/*.ts` plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Auth/authz/session/origin/rate-limit: `api-auth.ts`, `session.ts`, `request-origin.ts`, `action-guards.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `admin-tokens.ts`, `password-hashing.ts`, `proxy.ts`.
- Upload/path/file handling: browser upload, Lightroom PAT upload, upload paths/filenames/limits/tracker, queue, image processing, topic image processing, GPS strip, storage local backend, public upload serving.
- Backup/restore: DB actions, admin download route, backup filename validation, SQL restore scanner, MySQL CLI SSL args, migration/reconcile, post-restore migration runner.
- Public/privacy/output safety: `data.ts`, `data-timeline.ts`, `search-enrichment-fields.ts`, search/similar routes, public pages, OG routes/helpers, JSON-LD helper, OG sanitizer, CSV sanitizer, CSP, image URL/SEO URL validation, service worker boundaries.
- Tests/scripts used as evidence: auth/session/token/origin/rate-limit checks, public/admin route lint guards, privacy guards, restore/upload/search/SSRF/path traversal tests, source-contract tests.

Intentionally not treated as current application source: binary/static assets, screenshots, fonts, ICC fixtures, runtime upload/data directories, `.next`, `node_modules`, and local ignored env values. Ignored env files were detected but not copied into this report.

## Confirmed Findings

### SEC-C8-01 - Tracked review log discloses credential material

Severity: High
Confidence: High
Status: Confirmed
OWASP: A02 Cryptographic Failures; A05 Security Misconfiguration

File/region:
- `.context/reviews/logs-cycle4/security-reviewer.log:19495-19496`
- `.context/reviews/logs-cycle4/security-reviewer.log:26298-26302`

Problem:
The tracked review log contains live-looking `.env.local` credential values, including admin password material, `SESSION_SECRET`, and a database password. These are not just placeholders in example files; `git ls-files` includes the log, and a tracked-file secret sweep matched concrete values in that file. I have redacted the values here deliberately.

Concrete failure scenario:
Anyone with repository read access, access to an exported archive, or access to a fork containing this history can recover the logged secret values. If any value is still current or reused in another environment, an attacker can sign valid admin sessions using the exposed `SESSION_SECRET`, attempt admin login with the exposed admin password, or connect to the database with the exposed DB password if network access allows it. Even if these were local-only values, the committed secret pattern normalizes leaking ignored env files into durable repo artifacts.

Concrete fix:
Rotate every exposed credential immediately: admin password, `SESSION_SECRET`, and DB password for any environment where these values were ever used. Remove or redact the tracked log file content and consider history rewriting only after rotation, because history cleanup alone does not revoke already-exposed secrets. Add a secret-scanning gate that covers `.context/**`, `plan/**`, and generated logs before commit, and either stop tracking raw `logs-*` artifacts or force redaction before persistence.

## Likely Issues

No additional likely application-security issues were identified in the reviewed source. The post-cycle-7 upload-processing changes fail closed on unreadable admin settings, persist pending-row processing snapshots as admin-only/internal data, clear those snapshots after successful processing, and restore them during queue bootstrap.

## Prior Risks Not Re-filed

The cycle-7 report already recorded these operational/topology risks, and I did not duplicate them as new findings:
- TLS/HSTS depends on the external edge matching the documented topology.
- Client-IP attribution depends on exact proxy-chain/real-IP configuration.
- Several controls are process-local and assume the documented single web-instance deployment.

Those remain operational validation items, not new application defects from this cycle.

## Positive Security Evidence

- Admin API routes are wrapped by `withAdminAuth`; the wrapper enforces PAT scope for Lightroom uploads or same-origin plus admin session for cookie auth (`apps/web/src/lib/api-auth.ts:54-133`).
- Sessions use HMAC-signed random tokens, DB-stored token hashes, timing-safe comparison, production `SESSION_SECRET` fail-closed behavior, and expiration checks (`apps/web/src/lib/session.ts:16-150`).
- Browser and Lightroom uploads enforce auth/origin or token scope, content/size/quota checks, safe user filenames, topic validation, strict settings reads, private originals, GPS stripping, HDR ingest policy, cleanup, and processing snapshot persistence (`apps/web/src/app/actions/images.ts:112-188`, `apps/web/src/app/actions/images.ts:371-419`, `apps/web/src/app/api/admin/lr/upload/route.ts:60-252`, `apps/web/src/app/api/admin/lr/upload/route.ts:374-489`).
- `processing_settings_json` is included in admin selects but omitted from public, map, and search enrichment privacy surfaces, and is part of the compile-time `PrivacySensitiveKeys` guard (`apps/web/src/lib/data.ts:374-407`, `apps/web/src/lib/data.ts:416-487`, `apps/web/src/lib/search-enrichment-fields.ts:29-46`).
- Queue bootstrap skips durable failed rows and restores valid pending-row processing snapshots; success clears `processing_settings_json` (`apps/web/src/lib/image-queue.ts:119-163`, `apps/web/src/lib/image-queue.ts:544-548`, `apps/web/src/lib/image-queue.ts:815-868`).
- Backup/restore uses admin plus same-origin checks, random temp files with `0o600`, dangerous-SQL scanning, `mysql`/`mysqldump` argument arrays, sanitized stderr, advisory locks, and post-restore migration validation (`apps/web/src/app/[locale]/admin/db-actions.ts:119-257`, `apps/web/src/app/[locale]/admin/db-actions.ts:266-629`).
- Public derivative and backup download paths use strict filename/path validation, symlink rejection, realpath containment, and `nosniff`/cache controls (`apps/web/src/lib/serve-upload.ts:127-309`, `apps/web/src/app/api/admin/db/download/route.ts:22-101`).
- OG photo internal fetch is pinned to configured canonical origin, uses byte/time caps, and avoids request-host-derived SSRF fallback (`apps/web/src/app/api/og/photo/[id]/route.tsx:100-132`, `apps/web/src/lib/og-photo-fetch.ts:64-118`).
- JSON-LD sinks route through `safeJsonLd`; OG strings route through shared `sanitizeForOg`; production CSP is nonce-based with `object-src 'none'`, `base-uri 'self'`, and `form-action 'self'`.

## Automated Validation

Passed:
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm audit --workspace=apps/web --audit-level=low --json` - 0 vulnerabilities
- `npm test --workspace=apps/web -- --run ...` targeted security/privacy suite - 21 files passed, 242 tests passed

Targeted tests included cycle-7 source contracts, privacy fields, admin API auth, action origin, public route rate limit, safe JSON-LD, OG sanitizer imports, request origin, API auth headers, backup download, DB restore, SQL restore scan, upload paths, local storage, semantic/similar search, search privacy, Lightroom upload, upload quota TOCTOU, restore/upload locking, and upload-processing contract locking.

## Final Missed-Issue Sweep

- Auth/authz: no unwrapped admin API route found; no mutating server action missing same-origin protection found by the dedicated lint gate.
- CSRF/origin: cookie-auth admin mutations use same-origin checks; token-auth Lightroom upload intentionally bypasses origin only through scoped PAT auth.
- Rate limiting: public mutating API gate passed; semantic/similar/OG/share/search/view/login/upload budgets were traced. GET-heavy OG routes were manually inspected because the public-route lint only scans mutating handlers.
- SSRF/open redirect: OG photo fetch and fallback use configured canonical origins; SEO OG URL validation rejects cross-origin absolute URLs and scheme-relative/backslash tricks.
- Upload/path traversal: browser upload, Lightroom upload, derivative serving, local storage, topic images, backup download, and cleanup paths were checked for basename normalization, extension allowlists, symlink rejection, and containment.
- SQL/raw shell: raw SQL was reviewed for parameterized `sql` templates or constant/schema-maintenance strings; child processes use argument arrays and no `shell: true`.
- XSS/HTML/metadata: `dangerouslySetInnerHTML` occurrences are JSON-LD script sinks with `safeJsonLd`; admin-controlled metadata is React/Satori text-rendered or sanitized/validated.
- Secrets: tracked source/examples mostly contain placeholders, but committed `.context/reviews/logs-cycle4/security-reviewer.log` contains credential material; this is the confirmed finding above.
- Backup/restore/deploy hardening: restore locks, maintenance flags, scanner, and migration postconditions are present; deploy/TLS/proxy/scale assumptions remain prior operational risks, not re-filed.

Conclusion: one confirmed high-severity secret exposure in tracked review logs. No new auth, CSRF, injection, SSRF, path traversal, public privacy, backup/restore, or dependency vulnerability was found in the current application code.
