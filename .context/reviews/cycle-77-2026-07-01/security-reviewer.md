# Cycle 77 Security Review

HEAD: `8aefc3659fa8b6c08bff0da62d29b9ceb40029c5`
Date: 2026-07-01
Lane: `security-reviewer`
Scope: auth/authz, admin APIs/actions, public mutating/expensive routes, SSRF/open redirects, uploads/path traversal, SQL/raw queries, restore/backup, rate limiting, secret handling, privacy leaks.

## Inventory

Required context read:

- `AGENTS.md` and `CLAUDE.md`; command evidence: `wc -l AGENTS.md CLAUDE.md` reported `49` and `688` lines.
- `.context/reviews/_aggregate.md`, `.context/plans/cycle-76-2026-07-01-plan.md`, and `.context/plans/cycle-76-2026-07-01-deferred.md`; command evidence: `wc -l` reported `13`, `65`, and `39` lines.
- Cycle 76 security-adjacent artifacts: `.context/reviews/cycle-76-2026-07-01/server-security-reviewer.md` and `.context/reviews/cycle-76-2026-07-01/_aggregate.md`.

Repository and changed-surface evidence:

- `git rev-parse HEAD` -> `8aefc3659fa8b6c08bff0da62d29b9ceb40029c5`.
- `git diff --name-only a295ae44..HEAD` showed the current-cycle source changes are limited to `.gitignore`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/admin-backfill-runner.ts`, and focused tests/context artifacts.
- `git status --short` before this artifact write showed only `?? .context/reviews/cycle-77-2026-07-01/`, which already contained peer review artifacts; no source file was modified by this lane.

Route and action inventory:

- API route inventory command: `find apps/web/src/app/api -type f -name 'route.ts*' -print | sort`.
  Covered files: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.
- Public upload/feed route inventory command: `find apps/web/src/app -type f \( -name 'route.ts' -o -name 'route.tsx' -o -name 'actions.ts' -o -name '*actions.ts' -o -name '*-actions.ts' \) | sort`.
  Additional covered route/action files include `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, and `apps/web/src/app/actions.ts`.
- Server action export inventory command: `rg -n '^export (async function|const) ' apps/web/src/app/actions apps/web/src/app/actions.ts 'apps/web/src/app/[locale]/admin/db-actions.ts'`.
  Covered admin surfaces: `admin-users.ts`, `admin-backfill.ts`, `collections.ts`, `embeddings.ts`, `images.ts`, `lr-tokens.ts`, `seo.ts`, `settings.ts`, `sharing.ts`, `tags.ts`, `topics.ts`, plus database backup/restore actions in `db-actions.ts`. Covered public/auth surfaces: `auth.ts`, `public.ts`.
- SQL inventory command: `rg -n -e 'execute\(sql`' -e '\.query\(' -e 'sql`' -e 'sql\.raw' -e 'raw\(' apps/web/src apps/web/scripts --glob '!**/__tests__/**'`.
  Result summary: no non-test `sql.raw` hit; request-path SQL is Drizzle template-bound or mysql2 placeholder-bound. Direct `.query(...)` usage is limited to advisory locks, admin-user transactional checks, and script/migration contexts reviewed below.

Security source surfaces inspected:

- Auth/session/origin: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/password-hashing.ts`.
- Admin API/authz: `apps/web/src/lib/api-auth.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, admin server actions under `apps/web/src/app/actions/*.ts`, and `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Public routes/actions and rate limits: `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/actions/public.ts`, public share pages under `apps/web/src/app/[locale]/(public)/{s,g}/[key]/page.tsx`, and `apps/web/src/lib/rate-limit.ts`.
- Uploads/path traversal: `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, and `apps/web/src/app/actions/images.ts`.
- Restore/backup and secret handling: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/backup-filename.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/src/lib/sanitize.ts`, and tracked-secret tests.
- Privacy/select fields: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, map/search/privacy tests.
- Current HEAD change focus: `apps/web/src/app/api/og/photo/[id]/route.tsx` now includes derivative-impact settings/pipeline inputs in the OG ETag path; `apps/web/src/lib/admin-backfill-runner.ts` and `apps/web/scripts/backfill-color-pipeline.ts` now check row existence before classifying zero-row updates as deleted rows.

## Findings

No confirmed security findings were identified in this lane.

I did not find a reproducible auth/authz bypass, unprotected admin API/action, public mutating/expensive route missing the required rate-limit pre-increment pattern, SSRF/open-redirect path, upload/path traversal issue, raw SQL injection issue, restore/backup privilege break, secret leak, or privacy-field leak in the reviewed current HEAD.

## Gate/Invariant Coverage

Auth and same-origin invariants:

- `apps/web/src/lib/api-auth.ts:72` through `apps/web/src/lib/api-auth.ts:142` protects admin APIs with either scoped PAT validation or cookie auth plus `hasTrustedSameOrigin(...)`. Successful admin API responses add `no-store` and `nosniff`.
- `apps/web/src/app/actions/auth.ts:99` and `apps/web/src/app/actions/auth.ts:290` enforce same-origin provenance before login and password-update mutation. Login and password update apply pre-increment rate limits before expensive password verification/hash work.
- `apps/web/src/lib/session.ts:26` through `apps/web/src/lib/session.ts:150` requires a production session secret, uses HMAC-SHA256 tokens, timing-safe comparison, DB hash lookup, expiry checks, and 24-hour max age.
- `apps/web/src/lib/request-origin.ts:17` through `apps/web/src/lib/request-origin.ts:109` fails closed without trusted `Origin`/`Referer`, and only trusts proxy headers when `TRUST_PROXY=true`.

Admin API/action coverage:

- `npm run lint:api-auth --workspace=apps/web` passed. Evidence: both admin API route files were reported OK.
- `npm run lint:action-origin --workspace=apps/web` passed. Evidence: mutating admin actions were reported as enforcing same-origin provenance, and approved public/read-only exemptions were skipped or separately checked.
- `apps/web/src/app/api/admin/db/download/route.ts:21` wraps `GET` in `withAdminAuth(...)`, validates the backup filename, resolves and realpaths inside the backup root, rejects non-files, and streams from the opened file handle.
- `apps/web/src/app/api/admin/lr/upload/route.ts:84` and `apps/web/src/app/api/admin/lr/upload/route.ts:593` restrict Lightroom uploads to admin auth or `lr:upload` PAT scope, require content length, cap body/file sizes, serialize multipart uploads, sanitize user filename/topic metadata, take the upload contract lock, and re-check restore maintenance before and after disk work.

Public route and rate-limit coverage:

- `npm run lint:public-route-rate-limit --workspace=apps/web` passed. Evidence: public OG/search routes were reported as rate-limited; cheap health/live/feed and upload serving routes carried explicit exemptions.
- `apps/web/src/app/api/search/semantic/route.ts:107` through `apps/web/src/app/api/search/semantic/route.ts:184` enforces same-origin, restore maintenance, content-type, no chunked bodies, required/capped content length, and rate-limit pre-increment before expensive semantic work.
- `apps/web/src/app/api/search/similar/[id]/route.ts:72` through `apps/web/src/app/api/search/similar/[id]/route.ts:126` enforces same-origin, maintenance, id validation, rate-limit pre-increment, and production semantic mode gating before similarity scans.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:100` through `apps/web/src/app/api/og/photo/[id]/route.tsx:159` rate-limits OG generation before DB/image work, rolls back invalid IDs before the DB, charges missing-image probes, and uses current ETag/304 handling.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:176` through `apps/web/src/app/api/og/photo/[id]/route.tsx:196` pins internal image fetches to `new URL(BASE_URL).origin` and fails closed on invalid configuration, avoiding request-origin SSRF influence.

Upload, path traversal, and media privacy coverage:

- `apps/web/src/lib/serve-upload.ts:15` through `apps/web/src/lib/serve-upload.ts:202` allowlists public upload directories/extensions, validates safe path segments, rejects symlinks, realpath-checks root containment, verifies file type, and never serves SVG.
- `apps/web/src/lib/upload-paths.ts:120` through `apps/web/src/lib/upload-paths.ts:193` validates private original basenames, rejects symlinks and root escapes, creates private original storage with restrictive mode, and fails production startup if legacy public originals remain.
- `apps/web/src/lib/process-image.ts:388` through `apps/web/src/lib/process-image.ts:478` and `apps/web/src/lib/process-image.ts:860` through `apps/web/src/lib/process-image.ts:1045` reject RAW input, generate UUID storage names, cap image pixels, store originals with restrictive permissions, validate metadata, strip GPS where configured, and clean up failed originals.

SQL, restore/backup, and secret coverage:

- SQL inventory found no request-path `sql.raw`; reviewed request-path SQL is parameterized through Drizzle templates or mysql2 placeholders.
- `apps/web/src/lib/smart-collections.ts:1` through `apps/web/src/lib/smart-collections.ts:320` uses allowlisted columns/operators, bounded JSON/depth/node counts, and parameter binding for smart collection queries.
- `apps/web/src/app/[locale]/admin/db-actions.ts:1` through `apps/web/src/app/[locale]/admin/db-actions.ts:821` keeps backup/restore admin-only, uses advisory locks, restore maintenance, upload/backfill quiescence, strict backup filenames, random temp paths, plausible dump checks, SQL dangerous-statement scanning, `MYSQL_PWD` instead of CLI passwords, stderr redaction, and `mysql --one-database`.
- `apps/web/src/lib/mysql-cli-ssl.ts:1` through `apps/web/src/lib/mysql-cli-ssl.ts:24` requires configured CA verification for non-local DB CLI connections unless explicitly disabled.
- `apps/web/src/lib/sanitize.ts:95` through `apps/web/src/lib/sanitize.ts:142` redacts DB password/host/user/database values and common password patterns from process output.
- `npm audit --omit=dev --workspace=apps/web --audit-level=high` passed with `found 0 vulnerabilities`.

Privacy coverage:

- `apps/web/src/lib/data.ts` public select fields omit GPS, original/user filenames, original format/size, admin-only HDR/color pipeline internals, uploader, processing errors, and related sensitive keys. The `_PrivacySensitiveKeys` compile guard remains present.
- `apps/web/src/lib/search-enrichment-fields.ts` exposes only public enrichment fields and carries the type-level sensitive-key guard.
- Public map latitude/longitude exposure remains scoped to `topics.map_visible` runtime assertions.

Focused validation:

- `npm test --workspace=apps/web -- --run ...` from the repo root passed: 34 test files, 283 tests.
- The focused set covered session verification, auth rate-limit ordering/rollback, password hashing policy, admin users, backup download, restore maintenance/upload locks, upload serving, raw upload rejection and cleanup, privacy field guards, semantic/search/OG rate limits, CSP/nginx checks, tracked secrets, stderr sanitization, backup filename/download contracts, SQL restore scanning, and MySQL CLI SSL behavior.
- A first focused test invocation was issued from `apps/web` with `--workspace=apps/web` and failed before test execution with `No workspaces found`; the same target set was rerun from the repository root and passed.
- `npm run typecheck --workspace=apps/web` passed, including app and script typechecks.

## Historical Items Not Re-raised

- C76-01 was not re-raised. Current code in `apps/web/src/lib/admin-backfill-runner.ts:462` through `apps/web/src/lib/admin-backfill-runner.ts:485` and `apps/web/scripts/backfill-color-pipeline.ts:439` through `apps/web/scripts/backfill-color-pipeline.ts:510` checks row existence before treating zero affected rows as deletion. Focused backfill tests passed.
- C76-02 was not re-raised. Current code in `apps/web/src/app/api/og/photo/[id]/route.tsx:56` through `apps/web/src/app/api/og/photo/[id]/route.tsx:80` includes color settings hash and pipeline version in the OG photo ETag input, and `apps/web/src/app/api/og/photo/[id]/route.tsx:139` through `apps/web/src/app/api/og/photo/[id]/route.tsx:159` applies that ETag to conditional responses. Focused OG tests passed.
- C76-03 was process/ledger cleanup and is not a current security finding.
- C76-04 and C76-05 remain deferred coverage/process items per `.context/plans/cycle-76-2026-07-01-deferred.md`; no new evidence in this lane changes their security severity.
- C75-08 and the other aggregate carry-forward items remain historical/deferred items. I did not re-raise them because this lane found no new exploitability evidence, schedule change, or severity increase.

## Final Sweep

Confirmed finding count: 0.

Validation completed in this lane:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm audit --omit=dev --workspace=apps/web --audit-level=high` passed with zero high-or-higher production advisories.
- Focused security/privacy/restore/upload/rate-limit test set passed: 34 files, 283 tests.
- `npm run typecheck --workspace=apps/web` passed.

Residual risks and not-run checks:

- Full `npm run lint --workspace=apps/web`, full `npm test --workspace=apps/web`, `npm run build --workspace=apps/web`, and `npm run test:e2e --workspace=apps/web` were not run by this lane.
- This was source and targeted-test review only. I did not inspect production host configuration, production database contents, deployed environment variables, proxy topology, or live rate-limit behavior.
- Restore SQL scanning remains a heuristic defense around an admin-only operation; current tests cover dangerous-statement classes, but it is not a formal SQL parser proof.
- Some public rate-limit fast paths are in-memory and assume the documented single web instance topology.
- Admins are full-power by design; there is no role separation between admin users.
- Backups are plaintext at rest inside the operator boundary by design.

No source files were modified by this lane. The only intended file write is this review artifact.
