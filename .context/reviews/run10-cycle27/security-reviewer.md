# Run 10 Cycle 27 Security Review

Reviewer: security-reviewer  
Date: 2026-07-08  
HEAD: `cff8d59f0301df8f64e030adc0fb2d65e825903a`

## Scope

Read:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/plans/cycle-26-2026-07-08-plan.md`
- `.context/plans/cycle-26-2026-07-08-deferred.md`
- `.context/reviews/cycle-26-2026-07-08/_aggregate.md`

Reviewed current code at HEAD for:

- Auth/authz and admin API/action protection
- Same-origin guards and admin mutation barriers
- Public/admin rate limiting
- Upload handling, path traversal, symlink containment, and filename safety
- Database backup, download, restore, SQL restore scanning, and maintenance-mode safety
- SSRF and CSP controls
- Secret handling and child-process environment hygiene
- SQL safety and raw SQL usage
- Production deploy and ops safety

## Verification Evidence

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm audit --workspace=apps/web --audit-level=moderate` passed with `found 0 vulnerabilities`.

## Findings

No confirmed current security findings.

## Reviewed Surfaces

Auth/authz and origin controls:

- `apps/web/src/lib/request-origin.ts:118` to `apps/web/src/lib/request-origin.ts:145` fail closed for admin same-origin checks unless an explicit missing-source exemption is requested.
- `apps/web/src/lib/api-auth.ts:66` to `apps/web/src/lib/api-auth.ts:151` enforces either scoped PAT auth for allowed external API clients or same-origin cookie admin auth, with no-store and nosniff headers.
- `apps/web/src/app/actions/auth.ts:79` to `apps/web/src/app/actions/auth.ts:255` checks restore maintenance, trusted same origin, rate limits, Argon2 verification, session fixation prevention, and secure cookie settings.
- The admin API/auth and action-origin lint gates passed, covering the current admin route/action export surface.

Rate limiting:

- `apps/web/src/lib/rate-limit.ts` uses proxy headers only under `TRUST_PROXY=true`, selects client IPs from the trusted hop boundary, and provides bounded in-memory plus DB-backed limiters.
- The public route rate-limit lint gate passed for current public App Router handlers.

Uploads and path containment:

- `apps/web/src/lib/serve-upload.ts:162` to `apps/web/src/lib/serve-upload.ts:238` validates upload directory names, filename shape, extension/content type, rejects symlinks with `lstat`, resolves real paths, and checks containment before streaming.
- `apps/web/src/lib/upload-paths.ts:68` to `apps/web/src/lib/upload-paths.ts:170` keeps originals under a private root, validates basenames, rejects symlinks, and verifies realpath containment for original lookup/deletion.
- `apps/web/src/app/api/admin/lr/upload/route.ts:84` to `apps/web/src/app/api/admin/lr/upload/route.ts:320` requires authenticated admin or scoped PAT access, rejects chunked/missing-length uploads, caps request and file size, validates user filenames and topic slugs, and uses upload quota/processing locks.
- `apps/web/src/app/actions/images.ts:145` to `apps/web/src/app/actions/images.ts:360` applies same-origin admin gating, mutation barriers, quota pre-claims, filename validation, topic/tag validation, and upload-processing contract locking.

Backup, restore, and DB operations:

- `apps/web/src/app/[locale]/admin/db-actions.ts:421` to `apps/web/src/app/[locale]/admin/db-actions.ts:748` protects dump/restore actions with restore maintenance checks, same-origin admin checks, advisory locks, minimal child-process environments, sanitized stderr, watchdogs, and atomic backup file creation.
- `apps/web/src/app/[locale]/admin/db-actions.ts:752` to `apps/web/src/app/[locale]/admin/db-actions.ts:990` validates restore files, enforces size/header/trailer checks, runs the SQL danger scanner, uses `mysql --one-database`, and cleans temporary files.
- `apps/web/src/lib/db-restore.ts` and `apps/web/src/lib/sql-restore-scan.ts` reject dangerous SQL constructs such as privilege changes, database/table drops outside the allowlist, global/server changes, file import/export, definer routines, and prepared execution.
- `apps/web/src/app/api/admin/db/download/route.ts:21` to `apps/web/src/app/api/admin/db/download/route.ts:109` validates backup filenames, resolves and realpaths the backup root/file, checks containment, opens by validated path, verifies the file descriptor is a regular file, and streams with no-store/nosniff.

SSRF and CSP:

- `apps/web/src/app/api/og/photo/[id]/route.tsx:87` to `apps/web/src/app/api/og/photo/[id]/route.tsx:207` pins internal photo fetches to configured `BASE_URL`/site URL and does not derive fetch origins from request headers.
- `apps/web/src/lib/og-photo-fetch.ts` applies same-origin URL construction, a timeout, and pre/post-buffer size caps for OG photo fetches.
- `apps/web/src/lib/seo-og-url.ts` validates stored OG URLs as relative or same-origin HTTP(S) URLs.
- `apps/web/src/lib/content-security-policy.ts:139` to `apps/web/src/lib/content-security-policy.ts:199`, `apps/web/proxy.ts`, and `apps/web/next.config.ts:55` to `apps/web/next.config.ts:109` provide production CSP, frame, referrer, permissions, HSTS, API sandbox, and nosniff headers.

Secret handling and ops safety:

- `apps/web/src/lib/session.ts` requires a sufficiently long `SESSION_SECRET` and refuses production startup without it.
- `apps/web/src/lib/sanitize.ts` redacts DB credentials and common password-like output from child-process stderr.
- `apps/web/deploy.sh` validates deploy env presence and file permissions, avoids hardcoded deployment credentials, and prunes Docker resources only after the updated service is running.

SQL safety:

- Current app query construction uses Drizzle parameterization for user-controlled values in reviewed admin/public paths.
- `apps/web/src/lib/smart-collections.ts` allowlists smart-collection columns/operators and bounds JSON/query shape before compiling expressions.
- Reviewed `sql.raw` usage is limited to fixed SQL fragments or static separators, not user-controlled raw SQL.

## Not Refiled

- `AGG-C26-06` / `AGG-C25-04` remains a known deferred broad background-DB-capacity concern. It was not refiled as a Cycle 27 security finding because it is already tracked as a deferred architecture/performance item and no narrower current exploit path was confirmed in this pass.
- Cycle 26 deferred behavior-level test gaps for sidecar backfill fail-closed handling, restore temporary-file cleanup, and UI hardening were not refiled as security defects. They remain test-strength gaps, not confirmed current vulnerabilities from this review.

## Residual Risk

This was a static code review plus focused security lint/audit validation. I did not run the full build, full Vitest suite, Playwright suite, production deploy, or production-host configuration inspection because the requested work was a specialist review artifact with no source or plan modifications.
