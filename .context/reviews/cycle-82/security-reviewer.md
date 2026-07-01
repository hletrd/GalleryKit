# Cycle 82 Security Review

Date: 2026-07-01
Branch: `master`
Reviewed HEAD: `1c505d2f`
Source baseline: latest source change is `c272c521` (`fix(map): preserve meaningful marker titles`); later commits on this branch are review artifacts only.

## Result

No confirmed actionable security issue found.

Severity summary: Critical 0, High 0, Medium 0, Low 0.
Confidence: High for the reviewed surfaces below.
Source modifications: None.

## Concise Inventory

- Auth, sessions, PATs, and admin route gates: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/proxy.ts`, `apps/web/src/app/actions/auth.ts`.
- Same-origin / CSRF controls for server actions: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Public and admin rate limits: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/app/api/search/*`, `apps/web/src/app/api/og/*`, `apps/web/src/app/actions/public.ts`, upload actions/routes.
- Upload and path containment: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/gps-exif-strip.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Backup/restore and process spawning: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`.
- SSRF/open-redirect/XSS/hardening: `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/next.config.ts`, `apps/web/src/lib/safe-json-ld.ts`.
- Privacy field boundaries: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, public map/timeline/search tests.
- Secret handling checks: docs/placeholders, deploy contract tests, env loading and deploy helper references.

## Confirmed Findings

None.

## Reviewed Controls

| Area | Severity if failed | Confidence | Evidence | Failure scenario checked | Suggested fix if regressed |
| --- | --- | --- | --- | --- | --- |
| Admin API auth/PAT scope | High | High | Token path verifies presented PAT and scope before handler in `apps/web/src/lib/api-auth.ts:72`; cookie path requires same-origin then `isAdmin()` in `apps/web/src/lib/api-auth.ts:114`; session secret refuses production DB fallback in `apps/web/src/lib/session.ts:16`; PAT lookup is hashed and constant-time checked in `apps/web/src/lib/admin-tokens.ts:141`. | Admin API route accepts cross-origin cookie request, cacheable admin response, or unscoped PAT. | Keep every admin API export wrapped in `withAdminAuth(...)`; keep PAT scope explicit per route and no-store/nosniff success headers. |
| Server action same-origin / CSRF | High | High | `hasTrustedSameOrigin` fails closed unless Origin/Referer matches in `apps/web/src/lib/request-origin.ts:87`; `requireSameOriginAdmin()` centralizes the guard in `apps/web/src/lib/action-guards.ts:37`; DB restore checks it before auth work in `apps/web/src/app/[locale]/admin/db-actions.ts:365`; upload action checks it before parsing files in `apps/web/src/app/actions/images.ts:134`. | Cross-site form/action invokes a mutating admin server action with the victim's cookies. | Preserve early-return `requireSameOriginAdmin()` on mutating non-auth actions; require explicit exempt comments only for read-only or separately rate-limited public actions. |
| Public route and expensive-work rate limits | Medium | High | Semantic search charges before config/body/embedding work in `apps/web/src/app/api/search/semantic/route.ts:173`; OG photo generation charges before DB/internal fetch work in `apps/web/src/app/api/og/photo/[id]/route.tsx:100`; client IP trust is gated in `apps/web/src/lib/rate-limit.ts:166`. | Anonymous client causes CPU/DB/CLIP/OG amplification or spoofs proxy headers to avoid limits. | Keep pre-increment before expensive work; rollback only before meaningful work starts; keep `TRUST_PROXY` deployment-specific. |
| Upload, original retention, and path traversal | High | High | Original upload dir is owner-only in `apps/web/src/lib/upload-paths.ts:49`; original filenames must be basename-only and resolved under real root with symlink rejection in `apps/web/src/lib/upload-paths.ts:120`; public derivatives allow only jpeg/webp/avif and safe segments in `apps/web/src/lib/serve-upload.ts:15` and `apps/web/src/lib/serve-upload.ts:154`; realpath containment and `lstat` symlink rejection happen before open in `apps/web/src/lib/serve-upload.ts:176`; browser upload atomically claims quota before awaits in `apps/web/src/app/actions/images.ts:252`; GPS is nulled and stripped from originals when configured in `apps/web/src/app/actions/images.ts:402`; Lightroom upload mirrors size, filename, quota, and GPS stripping in `apps/web/src/app/api/admin/lr/upload/route.ts:101`, `apps/web/src/app/api/admin/lr/upload/route.ts:202`, and `apps/web/src/app/api/admin/lr/upload/route.ts:406`. | Attacker uploads traversal filename, races quota checks, serves private originals through public route, or leaves GPS in retained originals. | Keep UUID/generated storage names, basename validation, realpath containment, symlink rejection, synchronous quota claim, and original GPS stripping on both browser and PAT upload paths. |
| SSRF and open redirect | High | High | OG photo route pins internal fetch origin to canonical `BASE_URL` and refuses request-origin fallback in `apps/web/src/app/api/og/photo/[id]/route.tsx:176`; internal photo fetch has timeout and byte caps in `apps/web/src/lib/og-photo-fetch.ts:64`; fallback redirect requires same canonical origin in `apps/web/src/app/api/og/photo/[id]/route.tsx:329`. | Attacker-controlled Host/X-Forwarded-Host coerces server fetch to attacker origin or poisons configured OG fallback into an open redirect. | Keep internal fetches on trusted canonical origin only; keep same-origin redirect validation and bounded fetch budgets. |
| Backup/download/restore | Critical | High | CSV export uses formula-safe escaping before return in `apps/web/src/app/[locale]/admin/db-actions.ts:129`; backup spawn avoids password argv and writes `0o600` files in `apps/web/src/app/[locale]/admin/db-actions.ts:216`; backup stderr is redacted in `apps/web/src/app/[locale]/admin/db-actions.ts:255`; backup download is wrapped in `withAdminAuth` and validates filename/path/realpath in `apps/web/src/app/api/admin/db/download/route.ts:21` and `apps/web/src/app/api/admin/db/download/route.ts:51`; restore takes restore/upload/backfill locks before import in `apps/web/src/app/[locale]/admin/db-actions.ts:365`; restore validates dump header and chunk-scans before `mysql --one-database` in `apps/web/src/app/[locale]/admin/db-actions.ts:597`, `apps/web/src/app/[locale]/admin/db-actions.ts:620`, and `apps/web/src/app/[locale]/admin/db-actions.ts:674`; SQL scanner restricts app tables and blocks dangerous primitives in `apps/web/src/lib/sql-restore-scan.ts:12`, `apps/web/src/lib/sql-restore-scan.ts:61`, and `apps/web/src/lib/sql-restore-scan.ts:210`. | Crafted restore dump drops or writes outside app schema, leaks DB password through process args/logs, or path-traverses backup download. | Preserve no-shell spawn with env-only password, stderr redaction, owner-only backup files, authenticated realpath-checked downloads, lock ordering, header validation, chunk scanner, and `--one-database`. |
| Public privacy boundaries | High | High | Public selects explicitly omit sensitive/admin-only fields in `apps/web/src/lib/data.ts:368`; map select is the only public GPS exception and is guarded by compile-time sensitive-key checks in `apps/web/src/lib/data.ts:410` and `apps/web/src/lib/data.ts:473`; map data requires `topics.map_visible = true` and non-null GPS in `apps/web/src/lib/data.ts:1716`; map marker title display uses the title helper without adding new fields in `apps/web/src/app/[locale]/(public)/map/page.tsx:51`; semantic/similar result enrichment has its own compile-time privacy guard in `apps/web/src/lib/search-enrichment-fields.ts:29`. | Public pages/API leak original filenames, GPS for hidden topics, processing internals, upload attribution, or similarity scores. | Add any new admin-only column to `PrivacySensitiveKeys`, omit blocks, fixtures, and public-select guards; keep map GPS behind `map_visible`. |
| XSS, CSP, headers, and secrets | Medium | High | CSP image base URL rejects credentials/query/hash and non-HTTPS production URLs in `apps/web/src/lib/content-security-policy.ts:1`; production CSP uses nonce/self scripts and object/base/form restrictions in `apps/web/src/lib/content-security-policy.ts:111`; global headers set nosniff, frame, referrer, permissions policy, and production HSTS in `apps/web/next.config.ts:75`; JSON-LD escapes script-breaking and line-separator characters in `apps/web/src/lib/safe-json-ld.ts:14`; secrets scan matched only placeholders, historical redacted notes, and test fixtures. | Stored metadata breaks out of JSON-LD script, public response misses hardening headers, or committed env secret leaks credentials. | Keep `safeJsonLd` for all JSON-LD sinks, maintain CSP/header tests, and keep real secrets out of tracked docs/tests. |

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` passed: both admin API routes OK.
- `npm run lint:action-origin --workspace=apps/web` passed: all mutating server actions enforce same-origin provenance or carry approved exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed: expensive/mutating public routes use rate-limit helpers or approved exemptions.
- `npm --workspace=apps/web exec vitest run ...security-focused files...` passed: 26 test files, 457 tests.
- `npm audit --workspace=apps/web --audit-level=high` passed: found 0 vulnerabilities.
- Secret-pattern `rg` scan matched only documented placeholders, historical redacted notes, and test fixtures.

Not run: full `npm test`, full build, or e2e. This was a read-only security lane, and the targeted gates above cover the reviewed security surfaces.

## Prior Items

Cycle 80 and Cycle 81 security/privacy reviews had no confirmed security findings. The only source change since Cycle 81 was the map title fallback fix; current evidence keeps GPS exposure constrained to `map_visible` topics and does not add new public fields, so no old deferred item is re-raised.
