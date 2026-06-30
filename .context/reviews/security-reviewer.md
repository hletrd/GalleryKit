# Cycle 34 Security Reviewer Report

Reviewed HEAD: `e1f124a265998ea51297d6716df6c03a2056a96c`
Scope: `/Users/hletrd/flash-shared/gallery`
Mode: read-only review; source/tests/plans/git untouched.

## Inventory

Required guidance read first:

- `AGENTS.md`
- `CLAUDE.md` security architecture, privacy, restore, upload, rate-limit, SSRF, CSV, OG, and lint-gate sections
- Security-review skill at `/Users/hletrd/.agents/skills/security-review/SKILL.md`

High-risk surfaces inspected:

- Auth/session/origin: `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/proxy.ts`
- Admin mutations and credentials: `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/lib/admin-tokens.ts`
- Admin APIs: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`
- Public APIs/routes: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, public upload route handling, health/live routes
- Upload/restore/file handling: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`
- Rate limiting: `apps/web/src/lib/rate-limit.ts`, upload tracker state/settlement paths
- SSRF/OG/CSV/sanitization/privacy: `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/src/lib/csv-escape.ts`, `apps/web/src/lib/og-sanitize.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`
- Prior review context: current `.context/reviews/_aggregate.md`, prior `.context/reviews/security-reviewer.md`, and Cycle 34 archive summaries. Existing Cycle 33 items were not re-raised unless the current HEAD added fresh evidence.

Validation evidence:

- `npm run lint:api-auth --workspace=apps/web`: passed; 2 admin routes wrapped.
- `npm run lint:action-origin --workspace=apps/web`: passed; mutating actions covered, including `auth.ts`.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; public route handlers covered/exempted.
- `npm test --workspace=apps/web -- --run ...`: passed; 12 security/privacy files, 198 tests.
- `npm audit --workspace=apps/web --audit-level=low --json`: 0 vulnerabilities.
- Secret-pattern sweep found placeholders, docs, tests, and known historical/deferred references; no new live secret at HEAD.

## Findings

### SEC-C34-01 - Lightroom upload quota rejections leak the global multipart parse slot

Severity: Medium
Confidence: High
OWASP: A04 Insecure Design, A05 Security Misconfiguration / Availability

Evidence:

- `apps/web/src/app/api/admin/lr/upload/route.ts:60-73` defines a process-wide `lrMultipartParseInFlight` semaphore with max in-flight count `1`; callers must invoke the returned release function.
- `apps/web/src/app/api/admin/lr/upload/route.ts:130-136` acquires that slot before the per-token/IP upload-window checks.
- `apps/web/src/app/api/admin/lr/upload/route.ts:147-158` returns `429` for file-count or cumulative-byte quota exhaustion without calling `releaseMultipartParseSlot`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:177-185` releases the slot only in the `request.formData()` `finally`, which quota-exceeded branches never reach.
- The existing Cycle 33 aggregate item `AGG-C33-05` said LR route parity is mostly source-locked, not behavior-locked; this is fresh current-HEAD evidence of an executable cleanup-order bug, not just a test-quality concern.

Exploit/failure scenario:

An actor with a valid `lr:upload` PAT, or an authenticated admin using the cookie fallback, first exhausts the LR upload window for its tracker key, then sends one more request with a valid `Content-Length`. The route acquires the single global parse slot, observes `tracker.count + 1 > UPLOAD_MAX_FILES_PER_WINDOW` or `tracker.bytes + declaredUploadBytes > MAX_TOTAL_UPLOAD_BYTES`, returns `429`, and leaves `lrMultipartParseInFlight` at `1`. All later Lightroom/PAT uploads in that Node process fail with `Another Lightroom upload is being parsed; retry shortly` until process restart, including uploads from other tokens/admins.

Suggested fix:

Move `tryAcquireLrMultipartParseSlot()` until after the quota rejection branches, immediately before `request.formData()`, or wrap everything after acquisition in a `try/finally` that releases the slot on every early return. Add a route-level behavioral test that forces the quota-exceeded branch, then verifies a subsequent request can acquire the parse slot.

## Final sweep

No Critical or High security findings were confirmed in this pass.

Controls confirmed clean or unchanged:

- Admin sessions require production `SESSION_SECRET`; HMAC signatures, timing-safe comparison, DB hash lookup, expiry, and session rotation remain in place.
- Admin API routes use `withAdminAuth`; cookie path enforces same-origin and PAT path enforces token format, pre-auth rate limiting, scope checks, and no-store/nosniff.
- Mutating server actions passed the same-origin lint gate, including current `auth.ts`; the older Cycle 33 auth-lint gap appears closed at this HEAD.
- Browser upload and LR upload both apply auth, maintenance checks, filename/topic/title/description validation, private originals, GPS stripping, disk checks, and upload tracker settlement after quota claim. The LR parse-slot cleanup bug above is the exception.
- Restore path uses same-origin/admin checks, advisory locks, durable maintenance, header and chunked SQL scanning, `--one-database`, temp-file cleanup, stderr redaction, and post-restore migrations.
- Public search/similar/OG routes passed rate-limit lint; semantic and OG paths charge before protected DB/CPU work.
- SSRF posture remains pinned to the configured canonical origin for per-photo OG derivative fetches; fallback redirect URLs do not derive from request origin.
- CSV export uses `escapeCsvField` for every field and strips C0/C1, Unicode formatting chars, CR/LF, and formula prefixes.
- OG/JSON-LD text paths use shared `sanitizeForOg` and `safeJsonLd` where appropriate.
- Privacy guards keep `filename_original`, `user_filename`, GPS, admin-only color/HDR/pipeline fields, processing errors, upload attribution, and processing settings out of public selects; map GPS exposure remains limited to `publicMapSelectFields` plus the `map_visible` predicate and runtime guard.
- Previously reported Cycle 34 alias/admin-username sanitization issues are fixed at current HEAD: `deleteTopicAlias` uses `requireCleanInput`, and `createAdminUser` sanitizes username before validation.
