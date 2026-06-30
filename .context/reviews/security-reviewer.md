# Cycle 35 Security Reviewer Report

Reviewed HEAD: `96160854ebadca1606e9f99b2e6f5bc4689e366c`
Scope: `/Users/hletrd/flash-shared/gallery`
Mode: read-only review of current HEAD; source, tests, plans, git history, and deploy state untouched. This file is the only permitted write for the lane.

## Guidance

Required guidance read before review:

- `AGENTS.md`
- `CLAUDE.md` security architecture, privacy, restore, upload, rate-limit, SSRF, CSV, OG, deployment, and lint-gate sections
- Security-review skill at `/Users/hletrd/.agents/skills/security-review/SKILL.md`

Prior-cycle handling:

- Reviewed the current aggregate and prior security lane context.
- Did not re-raise Cycle 33 deferred low/product-policy items because this HEAD did not add new evidence that changes severity or makes them scheduled now.
- Rechecked the Cycle 34 security finding and the related action-origin scanner regression because HEAD `96160854` explicitly changed those surfaces.

## Inventory And Coverage

Auth, sessions, origin, and credentials:

- `apps/web/src/lib/session.ts:16-36` requires a production `SESSION_SECRET` and refuses the DB fallback in production.
- `apps/web/src/lib/session.ts:82-150` signs session tokens with HMAC-SHA256, compares signatures with `timingSafeEqual`, hashes tokens before DB lookup, enforces age/expiry, and deletes expired DB sessions.
- `apps/web/src/lib/api-auth.ts:72-111` handles PAT auth first with pre-auth rate limiting, token verification, scope checks, request-scoped token context, and no-store/nosniff response hardening.
- `apps/web/src/lib/api-auth.ts:114-143` enforces same-origin before cookie-backed admin checks and adds no-store/nosniff to successful admin API responses.
- `apps/web/src/lib/request-origin.ts:45-68` derives the expected origin from trusted proxy headers only when `TRUST_PROXY=true`; `apps/web/src/lib/request-origin.ts:79-107` fails closed unless `Origin` or `Referer` matches.
- `apps/web/src/app/actions/auth.ts:97-244` checks same-origin before login rate-limit/auth work, pre-increments IP and account buckets before Argon2 verification, uses a dummy Argon2 hash for missing users, rotates sessions transactionally, and sets `httpOnly`, `secure`, `sameSite=lax` cookies.

Admin APIs, server actions, and public routes:

- Admin API inventory: `apps/web/src/app/api/admin/db/download/route.ts` and `apps/web/src/app/api/admin/lr/upload/route.ts`; both are exported through `withAdminAuth`.
- `apps/web/src/app/api/admin/db/download/route.ts:21-90` validates backup filenames, resolves and realpaths backup paths inside the backup root, opens/stat-streams the same descriptor, audits the download, and sets no-store/nosniff.
- `apps/web/src/app/[locale]/admin/db-actions.ts:92-97` and `apps/web/src/app/[locale]/admin/db-actions.ts:170-175` show representative export/dump actions returning early on `requireSameOriginAdmin()` before admin work.
- `apps/web/src/app/api/search/semantic/route.ts:107-184` requires same-origin, rejects unsupported content types/chunked or oversized bodies, and charges the public rate limiter before DB-backed semantic-mode lookup.

Upload, filesystem, restore, and SQL boundaries:

- `apps/web/src/app/api/admin/lr/upload/route.ts:101-158` rejects chunked/missing/oversized uploads and per-window quota exhaustion before acquiring the single multipart parse slot.
- `apps/web/src/app/api/admin/lr/upload/route.ts:178-185` releases the multipart parse slot in `finally` around `request.formData()`.
- `apps/web/src/lib/upload-paths.ts:49-57` creates private original-upload storage with mode `0700`.
- `apps/web/src/lib/upload-paths.ts:120-170` rejects unsafe original filenames, absolute paths, traversal, symlinks, and realpath escapes.
- `apps/web/src/app/[locale]/admin/db-actions.ts:188-230` creates backup directories/files owner-only, obtains the restore advisory lock, and runs `mysqldump` with credentials in env rather than command arguments.
- `apps/web/src/lib/sql-restore-scan.ts:61-129` blocks dangerous restore SQL classes including grants, users, database/table drops except known app backup drops, destructive DML, file IO, routines, definers, plugins, globals, prepared statements, and encoded user-variable payloads.
- `apps/web/src/lib/sql-restore-scan.ts:210-252` rejects schema-qualified writes and write targets outside the app backup table allowlist after comment/literal masking.

Privacy, SSRF, secrets, and deploy:

- `apps/web/src/lib/data.ts:251-327` identifies the full admin image field set and marks private/source/internal fields.
- `apps/web/src/lib/data.ts:368-488` derives public selects by omitting sensitive fields and locks public and map-visible selects with compile-time privacy guards.
- `apps/web/src/lib/search-enrichment-fields.ts:29-47` centralizes public search enrichment fields and blocks `PrivacySensitiveKeys` at type-check time.
- `apps/web/src/lib/og-photo-fetch.ts:64-94` builds per-photo OG fetch URLs from the configured canonical origin, enforces timeout and byte caps, and treats failures as fallback misses.
- `scripts/deploy-remote.sh:22-86` loads deploy target/credentials from `.env.deploy` or the private fallback env file, refuses group/world-readable env files, and does not hardcode deploy hosts or key paths.
- `apps/web/deploy.sh:30-83` uses the env file for compose, waits for health before cleanup, and documents that Docker pruning runs after the live container/image are in use and cannot touch bind-mounted gallery data.

## Lightweight Validation

Commands run during this lane:

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- Focused security/privacy Vitest bundle covering admin tokens, auth headers/actions/rate limits, backup download, SQL restore scan, privacy/map/search guards, tracked secrets, and OG rate-limit/fallback behavior: passed.
- `npm audit --workspace=apps/web --audit-level=low --json`: passed with `0` vulnerabilities.
- Secret-pattern sweep over code/config/docs/tests: no new live checked-in secret found; matches were placeholders, tests, docs, or known historical/deferred references.

Not run:

- Full `npm run lint`, `npm run typecheck`, `npm run build`, full `npm test`, and Playwright E2E were outside this read-only security-review lane.

## Findings

No new reportable security findings were confirmed at reviewed HEAD.

Severity: n/a
Confidence: High for the no-new-finding conclusion on the reviewed surfaces above.
Failure scenario: n/a
Fix: n/a

## Current-HEAD Fix Verification

Cycle 34 `SEC-C34-01` is fixed at this HEAD:

- `apps/web/src/app/api/admin/lr/upload/route.ts:139-150` now returns quota-related `429` responses before acquiring the multipart parse slot.
- `apps/web/src/app/api/admin/lr/upload/route.ts:152-158` acquires the slot only after quota checks pass.
- `apps/web/src/app/api/admin/lr/upload/route.ts:178-185` releases the acquired slot in `finally` after multipart parsing.

The related action-origin scanner regression is also fixed:

- `apps/web/scripts/check-action-origin.ts:501-512` only recognizes a trusted origin early-exit when the expression is a prefix negation of an approved `hasTrustedSameOrigin(...)` import.
- `apps/web/src/__tests__/check-action-origin.test.ts:546-559` asserts that an inverted same-origin early exit fails the lint gate.

## Final Sweep

No Critical, High, Medium, or Low security issue was promoted from this pass.

Controls confirmed clean at HEAD:

- Admin auth remains split between same-origin cookie sessions and scoped PATs for integration clients.
- Mutating server actions and admin APIs are covered by static origin/auth lint gates.
- Public expensive/mutating routes are covered by public route rate-limit lint or explicit exemptions.
- Browser and Lightroom upload paths preserve private originals, safe filenames, quota tracking, GPS stripping, restore-maintenance checks, and filesystem containment.
- Backup export/download/restore preserve same-origin/admin checks, advisory locks, owner-only backup files, dangerous-SQL scanning, stderr redaction, and bounded subprocess execution.
- Public selects and search enrichment continue to exclude original filenames, GPS except map-visible topics, upload attribution, processing internals, and admin-only color/HDR/pipeline fields.
- Deploy helpers remain config-driven through env files and do not expose hardcoded production credentials or host paths.
