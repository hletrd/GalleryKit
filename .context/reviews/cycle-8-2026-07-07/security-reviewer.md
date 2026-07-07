# Cycle 8 Security Review

**Scope:** Committed HEAD `6256a988` (confirmed `14d31ea4`, cycle 7's baseline, is a linear
ancestor). Full-repository security sweep: OWASP Top 10, authn/authz, secrets, injection
(SQL/path/command/header), SSRF, path traversal, upload safety, session/cookie handling,
rate-limit bypass, CSP/headers, PII leakage, Trojan-Source/bidi/zero-width bypasses,
ReDoS, unsafe crypto. Depth-weighted toward the 22 commits landed since cycle 7
(`14d31ea4..6256a988`), which is where new/least-soaked code lives; every file named in the
review brief (`auth.ts`, `api-auth.ts`, `admin-tokens.ts`, `auth-rate-limit.ts`,
`rate-limit.ts`, `sanitize.ts`, `validation.ts`, `csv-escape.ts`, `og-sanitize.ts`,
`app/actions/*`, `app/api/**`, `proxy.ts`, `db-actions.ts`, `gps-exif-strip.ts`,
`serve-upload.ts`, `single-writer-guard.ts`, the LR upload route, the OG routes) was also
inventoried; files absent from the cycle-7..cycle-8 diff are UNCHANGED since cycle 7's
line-by-line clean pass and are not re-derived from scratch here (their prior clearance is
still valid because no byte of those files moved).

**Risk Level:** LOW (no new CRIT/HIGH/MED findings this cycle)

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low/Info Issues: 0 new (two previously-tracked MED "risk needing manual validation" items
  remain open and unchanged — see "Carried-forward items", not counted as new findings)

This cycle's 22 commits are dominated by one theme: consolidating the "destroy-don't-release"
pooled-advisory-lock discipline (originally landed ad hoc at the topic-route-segment lock,
commit `3acf638a`) into a single shared helper (`lib/advisory-lock-release.ts`) and applying it
uniformly across every pooled advisory-lock release site that previously duplicated the
pattern by hand. A second theme closes a real (if narrow) session-revocation gap during
restore-maintenance windows. A third fixes a genuine SQL-restore-scan evasion class. All three
are correctness/security-hardening changes, not new attack surface, and I traced each one to
its call sites rather than trusting the commit message.

## Findings

No new CRIT/HIGH/MED/LOW findings. Every changed file was traced to confirm the intended
security property actually holds at the call site (not just "diff looks plausible") — see
"Verified fresh-code hardening" below for the specific checks performed per file.

## Verified fresh-code hardening (traced call-by-call, not just diff-read)

### Advisory-lock destroy-don't-release consolidation (commit-cluster `ae197531` / C7-02)

**What changed:** `apps/web/src/lib/advisory-lock-release.ts` (new) provides
`releasePooledAdvisoryLocks()` (one-shot) and `createPooledAdvisoryLockReleaser()` (staged,
for connections holding multiple sequential locks). Every call site that used to do
`conn.query('SELECT RELEASE_LOCK(?)', ...).catch(() => {})` followed by an unconditional
`conn.release()` now routes through this helper, which `conn.destroy()`s the connection
instead of `conn.release()`ing it back to the pool whenever a `RELEASE_LOCK` round-trip
fails. Call sites updated: `app/actions/admin-users.ts:305-311` (admin-delete lock),
`app/actions/topics.ts:83-93` (topic-route-segment lock), `app/actions/embeddings.ts:203-211`
(semantic-backfill lock), `lib/image-queue.ts:663-670` and `lib/image-queue.ts:1047-1053`
(per-image processing claim), `lib/admin-backfill-runner.ts:346-354` and
`:383-390` (color-pipeline backfill lock + per-image claim),
`lib/upload-processing-contract-lock.ts:48-56` and `:59-75` (upload-processing contract
lock, both success and GET_LOCK-error paths), and the entire
`app/[locale]/admin/db-actions.ts` restore/backup flow (`dumpDatabase` at line ~351, and
`restoreDatabase` end-to-end via a staged `createPooledAdvisoryLockReleaser` at line 389).

**Why this matters (and is a real fix, not cosmetic):** MySQL advisory locks are
session-scoped. Returning a connection to the pool after a failed `RELEASE_LOCK` leaves the
lock held by a live, reusable session — silently wedging every future `GET_LOCK` attempt for
that name until the process restarts. For fail-fast locks (`GET_LOCK(..., 0)` — the DB-restore
lock, the upload-processing-contract lock, the color/semantic backfill locks, the per-image
processing claim, the admin-delete lock, the topic-route-segment lock) one transient release
failure previously disabled the whole feature indefinitely. This is a legitimate
availability/DoS-adjacent hardening fix: a network blip during `RELEASE_LOCK` used to be able
to durably wedge restore, backup, upload-settings changes, backfills, admin-user deletion, or
topic mutations.

**What I verified, not just read:**
- `lib/advisory-lock-release.ts:1-91` — `release()` never throws (catches internally, logs
  via `console.error`, sets a `failed` flag); `finish()` is the single terminal decision point
  (destroy iff any release failed, else release). Confirmed there is no path where both
  `destroy()` and `release()` are called on the same connection.
- `app/[locale]/admin/db-actions.ts:378-601` (`restoreDatabase`) — traced every early-return
  branch. Each branch that calls `lockReleaser.release(...)` immediately sets the
  corresponding `*LockHeld = false` flag on the same line/next line, so the outer `finally`
  block's flag-gated fallback releases (lines 589-597) cannot double-release a lock the
  earlier branch already handled. `lockReleaser.finish()` is called exactly once, at the very
  end of the outermost `finally` (line 600) — confirmed no other `conn.release()` /
  `conn.destroy()` call exists on this connection anywhere in the function.
- `lib/image-queue.ts:660-671` (`releaseImageProcessingClaim`) — confirmed callers
  (`enqueueImageProcessing`'s `finally` block, line ~1047) no longer wrap the call in an
  extra `.catch()` (the prior C1-04 defense-in-depth catch is now redundant since the helper
  itself never throws) — verified the helper's `release()` truly swallows all errors so
  removing the extra catch does not reintroduce an unhandled-rejection risk.
- `app/actions/topics.ts:70-93` — confirmed this is the SAME lock
  (`LOCK_TOPIC_ROUTE_SEGMENTS`) still guarding `createTopic`/`updateTopic`/`deleteTopic`/
  `createTopicAlias` per the existing documented invariant; the refactor only changed release
  discipline, not which operations take the lock.

**Verdict:** correct, no regression, closes a real availability gap. Not itself a new
vulnerability class — advisory-lock leakage was never remotely exploitable for privilege
escalation, only for self-inflicted denial of a maintenance feature — but worth recording
because it removes a class of "one transient blip permanently disables restore/backup"
incidents that would otherwise force a production restart.

### Restore-window session-revocation queueing (commits `c882e82d` / C7-01)

**What changed:** `apps/web/src/lib/pending-session-revocations.ts` (new). `logout()`
(`app/actions/auth.ts:279-303`) used to silently DROP the server-side session-row DELETE
whenever it ran during an active restore-maintenance/mutation-barrier window (the cookie was
still cleared client-side, so the UX looked like a normal logout, but the session token
remained verifiable server-side for up to its remaining lifetime). The fix queues the
skipped token hash in a bounded (`MAX_PENDING_REVOCATIONS = 256`, oldest-evicted) in-memory
`Set`, then flushes it (a) immediately after a restore completes
(`db-actions.ts:559-564`, deliberately AFTER the import replaces the `sessions` table, since
a pre-import delete would be undone by the import) and (b) as an hourly maintenance-scheduler
backstop (`maintenance-scheduler.ts:36-40`, itself gated on `!isRestoreMaintenanceActive()` so
it cannot race a live import).

**What I verified:**
- `app/actions/auth.ts:279-303` — confirmed `enqueuePendingSessionRevocation` is called ONLY
  on the branch where the DB delete was skipped (`revoked` stays `false`), not on the success
  path (no double-tracking / no accidental re-queue of an already-deleted session).
- `lib/pending-session-revocations.ts:50-65` (`flushPendingSessionRevocations`) — entries are
  removed from the `pending` set ONLY after the `db.delete(...)` promise resolves
  successfully; a thrown/rejected delete leaves every hash queued for the next call (verified
  against the hourly-sweep backstop, so a single DB blip does not permanently lose a
  revocation).
- Confirmed the two flush call sites (`db-actions.ts:564`, `maintenance-scheduler.ts:41`) are
  the only two `flushPendingSessionRevocations` call sites in non-test source — no orphaned
  third path that could race the restore import.
- Residual risk is explicitly documented in the module's own header comment and is accepted:
  the queue is process-local, so a process crash between "cookie cleared, DB delete skipped"
  and "flush" loses the pending revocation, at which point the exposure is identical to an
  already-compromised token bounded only by session TTL — same class of risk the codebase
  already accepts elsewhere for other process-local state (see "Carried-forward items"
  below). Not a new gap; this change is strictly a narrowing of an existing gap (previously
  the drop was permanent, not just crash-window-scoped).

**Verdict:** correct, real fix, no new exposure. Session hygiene during restore windows is
measurably better after this change, not worse.

### SQL-restore-scan chunk-boundary evasion fix (commit `9f416f01` / C7-12)

**What changed:** `apps/web/src/lib/sql-restore-scan.ts:279-317`
(`appendSqlScanChunk`)'s rolling raw-byte "bridge" suffix (the mechanism that catches a
dangerous keyword like `DROP TABLE` split exactly across a 1 MB chunk read boundary) used to
be computed as `chunk.length > SQL_SCAN_RAW_BRIDGE_BYTES ? chunk.slice(-N) : chunk` —
i.e., derived from ONLY the current chunk. A legal short `fd.read()` (fewer bytes than
requested — POSIX-permitted, not exploit-exotic) could return a chunk shorter than the
bridge window, and that chunk's own tiny suffix would silently discard the accumulated prior
suffix. A dangerous keyword split across **three** short reads (e.g. `"DR"` |
`"OP TAB"` | `"LE images;"`) could then evade the bridge scan entirely, because the middle
chunk's own-length suffix lost the leading `"DR"` before it ever got a chance to rejoin with
the next chunk.

**What I verified:**
- `lib/sql-restore-scan.ts:308-316` — the fix concatenates `previousRawSuffix + chunk` BEFORE
  slicing to the last `SQL_SCAN_RAW_BRIDGE_BYTES`, so the rolling suffix now covers the
  cumulative stream regardless of individual chunk sizes.
- `app/[locale]/admin/db-actions.ts:684-719` — traced the call site: `scanRawSuffix` is
  declared once outside the read loop (line 693), threaded through every iteration
  (`nextRawSuffix` assigned back to `scanRawSuffix` at line 715), and never reset mid-loop.
  This is the actual attack surface (a malicious/corrupted restore-dump upload attempting to
  sneak a `DROP TABLE`/`GRANT`/etc. past the pre-import scan via crafted chunk-boundary
  splitting) and the fix closes it correctly at the real call site, not just in the unit
  under test.
- Confirmed via `git diff` that `SQL_SCAN_RAW_BRIDGE_BYTES`-window behavior for the
  already-covered same-boundary case (exactly one short read) is unchanged; only the
  multi-short-read chain is newly covered.

**Verdict:** genuine security-relevant bug fix for the restore-upload dangerous-SQL denylist
(a defense-in-depth layer; `sql-restore-scan.ts` also enforces a destructive-SQL denylist and
a schema/write-target allowlist independently, so this was one layer of several, not the only
gate). No regression; this closes a real, if narrow and admin-authenticated-only, evasion
window.

### Same-origin canonical-origin fallback (commit `ceb7c8a5` / C7-05, C7-13)

**What changed:** `apps/web/src/lib/request-origin.ts:48-70` (`getConfiguredBaseOrigin`) now
falls back to `siteConfig.url` (the checked-in, build-time-inlined `site-config.json`) when
`BASE_URL` is unset, but ONLY in `NODE_ENV === 'production'`. This affects the anchor used
for same-origin CSRF checks in `getExpectedOrigin`.

**What I verified:** `siteConfig.url` is a build-time-inlined JSON literal
(`import siteConfig from '@/site-config.json'`), not attacker-influenced request data, so this
fallback cannot be used to spoof an "expected origin" — it only widens the set of deployments
that get a hardcoded (rather than header-derived) origin anchor, which is a strictly safer
default than falling through to header-derived origin inference when `BASE_URL` is
unset. Dev/test is explicitly excluded from the fallback (comment at
`request-origin.ts:56-64` — the checked-in file often carries the production URL while dev
runs on localhost, where header-derived resolution is correct and e2e sets `BASE_URL`
explicitly). No new spoofing surface introduced.

## Areas re-verified with fresh commands (not merely re-read from prior cycle notes)

- `npm run lint:api-auth --workspace=apps/web` — **PASS.** Both `api/admin/*` routes
  (`db/download`, `lr/upload`) wrap `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web` — **PASS.** Every mutating export across
  `app/actions/*.ts` (collections, embeddings, images, lr-tokens, public, seo, settings,
  sharing, tags, topics) either enforces `requireSameOriginAdmin()`/same-origin or carries a
  reviewed `@action-origin-exempt` comment; public rate-limited mutations
  (`recordPhotoView`/`recordTopicView`/`recordSharedGroupView`) pass under the
  public-rate-limited-action branch.
- `npm run lint:public-route-rate-limit --workspace=apps/web` — **PASS.** All public
  mutating/expensive routes (feed.xml, uploads/[...path] ×2, health, live, og ×2,
  search/semantic, search/similar/[id]) either call a rate-limit pre-increment helper or
  carry a reasoned `@public-no-rate-limit-required` exemption.
- `npm audit --audit-level=moderate` — **0 vulnerabilities.**
- Secret-pattern grep (`api[_-]?key|secret|password|token` assigned to a literal ≥12 chars)
  across `apps/web/src` — 0 hits outside env-var reads/schema field names/already-reviewed
  token-hash code.
- `git ls-files | grep -i '\.env'` — only `.env.deploy.example` and
  `apps/web/.env.local.example` tracked; no live secret files committed.
- Full-repo grep for `dangerouslySetInnerHTML` (8 hits, all six public page routes) — every
  site pipes through `safeJsonLd()` (confirmed by grepping each file's import + call site
  individually, not just counting hits): `(public)/page.tsx:219,228`,
  `(public)/timeline/page.tsx:147`, `(public)/year/[year]/page.tsx:141`,
  `(public)/c/[slug]/page.tsx:148`, `(public)/[topic]/page.tsx:225`,
  `(public)/p/[id]/page.tsx:276,283`. No raw-HTML sink found.
- Full-repo grep for `eval(`, `new Function(`, `exec(`/`execSync(` with `shell: true`, and
  `Access-Control-Allow-Origin` — zero hits in `apps/web/src` outside test files.
- Cross-checked the `images` table's full column list (`db/schema.ts`) against
  `adminSelectFields` in `data.ts:255-327` — every schema column is either explicitly
  selected (and, if sensitive, explicitly omitted from `publicSelectFields` at
  `data.ts:374-403` AND present in the `PrivacySensitiveKeys` union at `data.ts:472`) or
  deliberately excluded from `adminSelectFields` altogether (`share_key` — lookup-only key,
  never SELECTed into any result row; `blur_data_url` — excluded by design, fetched only in
  individual image queries). No orphaned column that would silently default to public
  through the destructure-omit pattern. This is the same guard shape CLAUDE.md documents; no
  drift found.
- Confirmed no new API route files were added since cycle 7 (`git diff --diff-filter=A` on
  `apps/web/src/app/api` between `14d31ea4` and `6256a988` — zero results); the 6 routes
  (`api/admin/db/download`, `api/admin/lr/upload`, `api/health`, `api/live`,
  `api/search/semantic`, `api/search/similar/[id]`) are unchanged from cycle 7's line-by-line
  clearance.
- Diffed `.gitignore` between cycle 7 and cycle 8 baselines — only plan/review markdown
  negation-pattern additions (`!.context/plans/cycle-5/6/7b-*.md`); no security-relevant
  change (no new tracked-secret exemption, no removed ignore rule for a sensitive path).
- Diffed `apps/web/nginx/`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `.github/`,
  and `apps/web/drizzle/` between cycle 7 and cycle 8 baselines — zero changes except one
  dead-script removal (`scripts/restore-maintenance-recovery.ts`, commit `510eea49`),
  confirmed to be an unreferenced duplicate of the shipped
  `restore-maintenance-recovery.mjs` (verified via `git show 510eea49 --stat` plus
  confirming the `.mjs` twin is what `package.json`'s `restore:maintenance` script and the
  Dockerfile actually reference); a new parity-pinning test
  (`restore-maintenance-recovery-mjs.test.ts`) was added in the same commit. Not a
  regression — this was dead code, not a live safety mechanism.

## Files named in the review brief that did NOT change since cycle 7 (prior clean pass stands)

`auth-rate-limit.ts`, `rate-limit.ts`, `sanitize.ts`, `validation.ts`, `csv-escape.ts`,
`og-sanitize.ts`, `gps-exif-strip.ts`, `serve-upload.ts`, `single-writer-guard.ts`,
`api-auth.ts`, `admin-tokens.ts`, `proxy.ts`, the LR upload route
(`api/admin/lr/upload/route.ts`), and both OG routes (`api/og/route.tsx`,
`api/og/photo/[id]/route.tsx`) are byte-identical to the versions cycle 7 reviewed
line-by-line (confirmed via `git diff --stat 14d31ea4..6256a988` showing none of these paths
in the changed-file list). Cycle 7 found these clean (constant-time comparisons, scope
enforcement, path-containment/symlink-rejection, SSRF-pinned OG fetches, TRUST_PROXY-gated IP
attribution, etc.) with zero findings; that clearance is reused rather than re-derived from
scratch, per the instruction to avoid re-litigating unchanged, already-reviewed surface.

## Carried-forward items (not new findings; unchanged since prior cycles)

Two MED "risk needing manual validation" items from the rolling `.context/reviews/
security-reviewer.md` aggregate remain open and are unaffected by this cycle's commits
(neither `single-writer-guard.ts` nor `rate-limit.ts` changed in `14d31ea4..6256a988`):

- **Multi-instance operation is warn-only while several controls are process-local**
  (rate-limit buckets for OG/share/semantic, upload-quota tracking, shared-group view-count
  buffering). Already tracked via the deferred-carry-forward register (`C1-11`/`C3-12op`,
  "operator confirms production edge topology") and documented in CLAUDE.md's "Runtime
  topology" section as a single-writer/single-instance deployment assumption. Interestingly,
  this cycle's `pending-session-revocations.ts` queue is a NEW instance of the same
  process-local-state pattern (explicitly self-documented as such in its own header comment,
  with the same "process crash between skip and flush" risk class already accepted
  elsewhere) — consistent with the existing risk, not a new one.
- **Reverse-proxy IP attribution / same-origin reconstruction depends on live edge
  configuration matching `TRUST_PROXY`/`TRUSTED_PROXY_HOPS`.** Unchanged this cycle; this
  cycle's `request-origin.ts` fallback to `siteConfig.url` (see above) is if anything a
  strict improvement to this risk (fewer deployments fall through to header-derived origin
  inference), not a regression.

Neither is re-scored or re-numbered here; they remain the deferred register's responsibility
to track and age out.

## Final sweep for commonly-missed issues

- Confirmed no new environment variable was introduced this cycle that would need a
  corresponding `TRUST_PROXY`/secrets/permissions review (grepped `process.env\.[A-Z_]+` diff
  hunks in the changed files — none found; all new code reads existing env vars or none).
  Note: `content-security-policy.ts` gained a one-time-per-process `console.error` diagnostic
  on `IMAGE_BASE_URL` sanitizer rejection (`hasLoggedImageBaseSanitizeFailure` guard,
  `content-security-policy.ts:52-64`) — confirmed the logged `error` object is the parse
  exception (not raw request/user input) and the guard is `typeof window === 'undefined'`
  server-only, so this cannot become a client-console PII leak.
- Confirmed no new file writes/reads a path built from unsanitized user input (all touched
  filesystem code this cycle — `db-actions.ts`, `advisory-lock-release.ts`,
  `db-child-watchdog.ts` — operates on process-internal fd/child-process handles, not
  user-supplied paths).
- Confirmed no new child-process spawn was added; `db-child-watchdog.ts` only manages timeout/
  kill lifecycle for the SAME `mysqldump`/`mysql`/migrate children already spawned via
  argument-array `spawn()` in `db-actions.ts` (unchanged spawn call sites — the watchdog was
  extracted, not the spawn itself).
- Confirmed the `search.tsx` and `similar-photos.tsx` 44px-touch-target / result-label a11y
  changes this cycle render only React-escaped text (JSX children / `alt`/`title`/`aria-label`
  string props), not `dangerouslySetInnerHTML` — no new XSS sink despite `label` originating
  from admin-controlled `image.title`/tag data.
- Re-confirmed `searchImages()`'s new `EXISTS` subquery in `data.ts:1682-1699` (tag-match
  full-tag-set fix, commit `f3cafa9c`) uses Drizzle's parameterized `containsLike()` helper
  identically to the code it replaced — no raw string interpolation introduced by moving the
  condition into a correlated subquery.
- No CI/deploy files, secrets, commits, pushes, deploys, container operations, or destructive
  git operations were performed. This review is strictly read-only; the one write is this
  report file at the assigned path.
- Working-tree note: `git status` shows uncommitted modifications to
  `.context/plans/README.md`, `.context/plans/cycle-84-2026-07-01-plan.md`,
  `.context/reviews/_aggregate.md`, `.gitignore`, `apps/web/src/__tests__/
  failed-image-retry.test.ts`, and `apps/web/src/__tests__/
  image-queue-permanent-failure.test.ts`. These are peer-session-owned working-tree changes
  outside committed HEAD; per the shared-worktree constraint this review evaluates only
  `git show HEAD:<path>` state and does not assess the concurrent session's in-flight edits.

## Security Checklist
- [x] No hardcoded secrets (fresh grep this cycle + tracked-file check)
- [x] All inputs validated (spot-checked the fresh commits' call sites, not just diff text)
- [x] Injection prevention verified (SQL parameterization incl. the new EXISTS subquery, no
      shell exec, no unsafe HTML sinks, restore-scan chunk-boundary evasion fixed)
- [x] Authentication/authorization verified (three lint gates re-run and pass; session
      revocation gap during restore windows closed, not introduced)
- [x] Dependencies audited (npm audit: 0 vulnerabilities)
- [x] Advisory-lock lifecycle correctness re-verified end-to-end for the restore/backup/
      backfill/upload-contract/topic/admin-delete/image-processing-claim paths (no
      double-release, no leaked destroy, terminal decision made exactly once per connection)
