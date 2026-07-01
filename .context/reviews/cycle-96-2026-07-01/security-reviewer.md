# Cycle 96 Security Review

Review target: `2f22620c3613` in `/tmp/gallery-recovery-check`.

## Inventory built first

Reviewed repo rules/context: `AGENTS.md`, `CLAUDE.md:194-222`, `CLAUDE.md:235-236`, `.context/reviews/_aggregate.md:7-21`, `.context/plans/cycle-95-2026-07-01-deferred.md:18-74`.

Reviewed all route handlers found under `apps/web/src/app/**/route.*`:

- Public/feed/upload/health/live: `feed.xml/route.ts:36`, `[topic]/feed.xml/route.ts:36`, upload routes `:7/:18-19`, health `:9`, live `:3`
- Admin APIs: DB download `apps/web/src/app/api/admin/db/download/route.ts:21`, LR upload `apps/web/src/app/api/admin/lr/upload/route.ts:84`
- Public APIs: OG `apps/web/src/app/api/og/route.tsx:63`, photo OG `apps/web/src/app/api/og/photo/[id]/route.tsx:87`, semantic search `apps/web/src/app/api/search/semantic/route.ts:107`, similar search `apps/web/src/app/api/search/similar/[id]/route.ts:68`

Reviewed exported server-action surfaces in: `auth.ts`, `admin-users.ts`, `images.ts`, `db-actions.ts`, `lr-tokens.ts`, `sharing.ts`, `tags.ts`, `topics.ts`, `settings.ts`, `seo.ts`, `collections.ts`, `public.ts`, `embeddings.ts`, `admin-backfill.ts`.

Reviewed core security libraries: session/auth, origin/CSRF, API auth/PATs, rate limits, upload/path serving, backup/restore scanner, SSRF/OG URL handling, CSP, privacy field guards, validation/sanitization, secrets hygiene.

## Validation evidence

- Admin API auth gate passed for all `/api/admin/*` routes.
- Mutating server-action origin gate passed for all scanned actions.
- Public route rate-limit gate passed for all mutating/expensive public routes.
- Secret-pattern sweep found placeholders/documented redactions only; no live tracked credential assignment.
- `npm audit --workspace=apps/web --audit-level=low --json` could not complete because DNS/network access to `registry.npmjs.org` failed.
- `git status --short --untracked-files=no` was clean after review commands.

## Confirmed security findings

No new confirmed security vulnerability was found in cycle 96.

One previously confirmed carry-forward backup/restore integrity issue remains below; it is not newly introduced by this HEAD.

### C94-09 / C77-ARCH-01 — restore maintenance does not fence already-in-flight non-upload admin mutations

- Severity: High
- Confidence: High
- Status: Confirmed carry-forward, security-adjacent integrity/availability risk
- Evidence:
  - Deferred ledger records this exact issue and exit criterion: `.context/plans/cycle-95-2026-07-01-deferred.md:55-60`.
  - Restore obtains DB/upload/backfill locks and then begins durable maintenance: `apps/web/src/app/[locale]/admin/db-actions.ts:390-452`; restore work runs after prep at `db-actions.ts:492-503`.
  - Representative non-upload admin mutations only check maintenance at entry, then later write:
    - Settings: entry check `apps/web/src/app/actions/settings.ts:41-48`, DB transaction `settings.ts:163-175`.
    - Tags: entry check `apps/web/src/app/actions/tags.ts:42-49`, transaction/update `tags.ts:83-98`.
    - Topics: entry check `apps/web/src/app/actions/topics.ts:85-92`, insert `topics.ts:148-154`, delete transaction `topics.ts:433-443`.
    - Sharing: entry check `apps/web/src/app/actions/sharing.ts:91-99`, photo share write `sharing.ts:139-156`, group share transaction `sharing.ts:258-281`.
- Problem: restore maintenance blocks new entry after the marker is active, but a non-upload admin mutation that already passed its entry check can still write application tables while restore is starting/running.
- Concrete failure scenario: admin A submits a settings/tag/topic/share mutation and passes the maintenance check; admin B starts DB restore before admin A’s later transaction executes; admin A’s write lands during/after the import, producing mixed restored/current state or stale references.
- Suggested fix: introduce a shared foreground admin-write barrier used around every application-table mutating critical section, and have restore acquire the same barrier before import. Re-check durable/process maintenance after acquiring the barrier. Add tests proving a mutation that passed its entry check cannot write after restore maintenance begins.

## Likely issues

None found.

## Manual-validation risks

### Dependency advisory status was not validated live

- Severity: Unknown until audit runs
- Confidence: High that validation is incomplete
- Evidence: dependencies are declared in `apps/web/package.json:29-85` with root overrides in `package.json:7-10`; `npm audit` failed due `getaddrinfo ENOTFOUND registry.npmjs.org`.
- Problem: source review did not establish current CVE/advisory status for transitive dependencies.
- Concrete failure scenario: a newly disclosed issue in `next`, `sharp`, `mysql2`, `argon2`, or a transitive package would not be surfaced by this offline review.
- Suggested fix: rerun `npm audit --workspace=apps/web --audit-level=low` in networked CI or a trusted networked workstation and triage any advisories.

### Single-instance deployment assumption must remain true

- Severity: Medium if violated
- Confidence: High
- Evidence: project docs require single web instance/single writer and warn process-local restore/rate-limit state: `CLAUDE.md:235-236`; process-local restore flag is in `apps/web/src/lib/restore-maintenance.ts:1-31`; durable marker is synced at startup in `apps/web/src/instrumentation.ts:1-8`; OG/share fast-path buckets are in-memory in `apps/web/src/lib/rate-limit.ts:78-99`.
- Problem: several protections are intentionally process-local under the documented topology.
- Concrete failure scenario: if the service is horizontally scaled without shared state, one instance can miss another instance’s process-local rate-limit/maintenance/backfill status, weakening throttling and restore coordination.
- Suggested fix: keep production to the documented single web instance, or move these states to a shared store/barrier before scale-out.

## Surface review notes

- Auth/session: production refuses DB fallback for `SESSION_SECRET` (`apps/web/src/lib/session.ts:16-36`); tokens are HMAC-signed and DB-stored as SHA-256 hashes (`session.ts:82-89`, `session.ts:136-150`); HMAC comparison uses `timingSafeEqual` (`session.ts:107-119`). Login enforces same-origin before rate-limit/IP work and pre-increments before Argon2 (`apps/web/src/app/actions/auth.ts:98-160`); missing-user timing uses a dummy Argon2 hash (`auth.ts:180-188`); session fixation is mitigated by transactionally inserting the new session and deleting old sessions (`auth.ts:214-230`). Password changes rotate sessions (`auth.ts:389-419`). Argon2id parameters are explicit (`apps/web/src/lib/password-hashing.ts:10-15`).
- Authz/API tokens: admin API wrapper enforces PAT scope or same-origin cookie auth (`apps/web/src/lib/api-auth.ts:58-144`). PATs are generated from 32 random bytes, hashed, format-validated, scoped, and expiry-checked (`apps/web/src/lib/admin-tokens.ts:52-107`, `admin-tokens.ts:141-175`, `admin-tokens.ts:208-252`). LR upload requires `lr:upload` scope (`apps/web/src/app/api/admin/lr/upload/route.ts:84-91`).
- CSRF/origin: trusted origin reconstruction only trusts forwarded host/proto when `TRUST_PROXY=true` (`apps/web/src/lib/request-origin.ts:45-68`) and fails closed without matching `Origin`/`Referer` (`request-origin.ts:79-107`). Mutating actions use `requireSameOriginAdmin()` (`apps/web/src/lib/action-guards.ts:37-44`); guard lint passed.
- Rate limits: client IP handling rejects spoofed proxy headers unless enabled (`apps/web/src/lib/rate-limit.ts:166-196`); login/search/PAT/OG/share/semantic limits are bounded (`rate-limit.ts:66-124`, `rate-limit.ts:245-388`); DB-backed buckets use parameterized Drizzle upserts/decrements (`rate-limit.ts:410-511`).
- Upload/file path: LR upload rejects chunked/missing/oversized bodies before parsing (`apps/web/src/app/api/admin/lr/upload/route.ts:94-128`) and re-checks restore after slow file work (`route.ts:430-441`). Browser upload and image mutations enforce maintenance/origin/admin checks (`apps/web/src/app/actions/images.ts:128-140`, `images.ts:648-743`, `images.ts:746-903`). Upload paths use private originals, safe filenames, realpath containment, and symlink rejection (`apps/web/src/lib/upload-paths.ts:49-88`, `upload-paths.ts:120-170`); public derivative serving validates path/extension and realpath containment (`apps/web/src/lib/serve-upload.ts:127-190`). Sharp input limits and UUID filenames are enforced in `apps/web/src/lib/process-image.ts:887-947`.
- Backup/restore: DB backup/download uses admin auth, strict filename validation, realpath containment, no-store/nosniff headers (`apps/web/src/app/api/admin/db/download/route.ts:21-90`). Dump/restore avoid CLI password flags, require TLS CA for non-local MySQL, write mode `0600`, and sanitize stderr (`apps/web/src/app/[locale]/admin/db-actions.ts:177-230`, `db-actions.ts:651-716`; `apps/web/src/lib/mysql-cli-ssl.ts:1-24`). Restore scans chunks for dangerous SQL and disallowed write targets (`apps/web/src/lib/sql-restore-scan.ts:61-129`, `sql-restore-scan.ts:210-252`).
- SSRF/open redirect: per-photo OG fetch is pinned to canonical `BASE_URL`, not request origin (`apps/web/src/app/api/og/photo/[id]/route.tsx:176-201`); fallback redirects require same canonical origin (`route.tsx:329-374`). OG image URL validation rejects third-party origins and backslash/scheme-relative bypasses (`apps/web/src/lib/seo-og-url.ts:3-43`). `IMAGE_BASE_URL` parsing rejects non-http(s), production plaintext, credentials, query, and hash (`apps/web/src/lib/content-security-policy.ts:1-25`).
- Secrets: env examples use placeholders and rotation warnings (`apps/web/.env.local.example:21-33`); tracked secret hygiene test rejects non-placeholder credential assignments (`apps/web/src/__tests__/tracked-secrets.test.ts:7-58`).
- Privacy/PII: public selects omit GPS/original filename/user filename/internal processing fields (`apps/web/src/lib/data.ts:368-408`); map GPS exposure is isolated behind `topics.map_visible=true` and runtime assertion (`data.ts:1709-1745`); compile-time/test guards cover public, map, timeline, and search enrichment fields (`data.ts:459-489`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`, `apps/web/src/__tests__/privacy-fields.test.ts:47-132`).
- Injection/input: admin strings reject control/bidi/invisible characters (`apps/web/src/lib/validation.ts:46-135`, `apps/web/src/lib/sanitize.ts:19-67`, `sanitize.ts:161-190`); LIKE searches escape `%`, `_`, and escape chars with parameterized Drizzle SQL (`apps/web/src/lib/sql-like.ts:5-10`, `apps/web/src/lib/data.ts:1594-1612`).

## Final missed-issue sweep and coverage statement

Coverage included every route handler and every exported server action in the app tree, plus the cross-file auth/authz/session/CSRF/origin/rate-limit/upload/path/backup-restore/SSRF/secrets/privacy/API-token libraries and relevant tests. Additional sweeps covered `fetch(`/`new URL(` call sites, tracked secret patterns, route/action inventories, and security guard scripts. No new confirmed or likely security issue was identified beyond the existing carry-forward restore write-fencing risk.