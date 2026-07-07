# Cycle 7 Code-Quality Review (code-reviewer)

Reviewed committed HEAD `14d31ea4` (the working tree has since advanced under the peer
session to `b4f57c6f`/`4251c9cd` while this review ran; verified those two commits touch
none of the files cited below, so all findings hold against both HEAD states).

Angle: correctness bugs, logic errors, SOLID/maintainability, error handling, edge cases,
dead code, inconsistent invariants, resource leaks, off-by-one, null/undefined handling,
async/await mistakes, incorrect Promise handling.

Scope covered: `apps/web/src/lib/{process-image.ts, color-detection.ts, image-queue.ts,
settings-hash.ts, data.ts, view-retention.ts, maintenance-scheduler.ts,
admin-backfill-runner.ts, image-url.ts, constants.ts}` (no separate `image-base-url.ts`
file exists — that logic lives in `image-url.ts`/`constants.ts`/`content-security-policy.ts`),
`apps/web/src/app/actions/*`, `apps/web/scripts/*`, plus deep extra-scrutiny reads of the
diffs for all seven freshly-landed peer commits (`14d31ea4`, `9cd8d3e8`, `d8fcb3d6`,
`57e2c5d3`, `4d37daa4`, `05fa5cd1`, `3acf638a`) and their touched files
(`request-origin.ts`, `db/index.ts`, `content-security-policy.ts`, `drizzle.config.ts`,
`run-e2e-server.mjs`, `auth.ts`, `topics.ts`).

Sanity-checked every finding below against `.context/plans/deferred-carry-forward.md`,
`.context/plans/cycle-{1..98}-*-deferred.md` (grep sweep), and the sibling
`cycle-7-2026-07-07/{security-reviewer,document-specialist,perf-reviewer,verifier}.md`
reports already in this folder — none of the four findings below overlap or duplicate an
already-known/deferred item.

Tooling note: `lsp_diagnostics` (typescript-language-server) is not installed in this
environment; substituted the project's own blocking type gate, `npm run typecheck
--workspace=apps/web` (from `apps/web/`), which passed with exit 0 (both `typecheck:app`
and `typecheck:scripts`, including `next typegen`) — no type errors on the full tree,
which includes every file cited below.

## By Severity

- CRITICAL: 0
- HIGH: 1
- MEDIUM: 2
- LOW: 2
- INFO: 0

## Issues

### C7-CQ1 — Advisory-lock connection returned to the pool even when RELEASE_LOCK itself fails, in the DB backup/restore/backfill lock paths
[SEV: HIGH | CONF: High | resource-leak / inconsistent-invariant]

File: `apps/web/src/app/[locale]/admin/db-actions.ts` — `dumpDatabase()` finally block at
lines 388-395, and `restoreDatabase()` at lines 405-648 (RELEASE_LOCK call sites at
390, 449, 462, 481, 485, 519, 524, 530, 606, 611, 617, 633, 638, 643, with the connection
released at 394 and 647).

Issue: every `RELEASE_LOCK(...)` call in this file is wrapped in
`.catch((err) => console.debug(...))` — the failure is swallowed and never tracked — and
the *same dedicated connection* (`const conn = await connection.getConnection()`, line 418)
is then unconditionally returned to the pool via `conn.release()` regardless of whether any
of the `RELEASE_LOCK` calls actually succeeded. This file's own comment states the safety
model explicitly: "GET_LOCK is released automatically on connection close (crash-safe)"
(line 403) — i.e. the code *knows* that only closing the connection guarantees the advisory
lock is freed; returning it to the pool does not. `LOCK_DB_RESTORE`,
`LOCK_COLOR_PIPELINE_BACKFILL`, and `LOCK_SEMANTIC_EMBEDDING_BACKFILL` are all MySQL
server-scoped advisory locks (documented in CLAUDE.md's "Advisory-lock scope note"), so a
lock that silently survives on a live pooled connection blocks every future acquire attempt
server-wide until that specific connection is closed.

This is the exact bug class the sibling commit in THIS SAME REVIEW BATCH,
`3acf638a` ("harden mutation lock cleanup"), just fixed for
`withTopicRouteMutationLock()` in `apps/web/src/app/actions/topics.ts` — that commit's own
rationale explicitly rejected "release the connection after a failed unlock" because "the
advisory lock state is unknown and returning it to the pool can leak lock ownership," and
switched to `conn.destroy()` on RELEASE_LOCK failure. `db-actions.ts` guards a strictly more
critical lock (the entire backup/restore and color/semantic backfill admin surface) with the
identical unsafe pattern, and was not touched by that fix — a textbook "fixed one sibling,
missed the next" gap (the codebase's own comments elsewhere use exactly that phrase for this
recurring failure mode).

Concrete failure scenario: a transient MySQL hiccup (brief network blip, server-side query
kill, packet loss) occurs at the moment `RELEASE_LOCK(gallerykit_db_restore)` is sent, right
after a backup or restore completes successfully. The query rejects, is logged at
`console.debug` (invisible unless debug logging is enabled), and `conn.release()` still runs.
The connection — still possibly holding the lock at the MySQL session level — goes back into
the live pool (`enableKeepAlive: true`, so it can persist indefinitely) and can be reused by
any ordinary query. Every subsequent restore attempt now fails `GET_LOCK(..., 0)` and the
admin UI shows a generic "restore already in progress" style error with no signal that this
is a leaked lock rather than a real concurrent restore. There is no operator-facing tool to
inspect/clear a leaked MySQL advisory lock (the documented `restore-maintenance-recovery`
flow only clears the file-based durable marker, a separate mechanism) — recovery requires
restarting the app process to force all pooled connections closed.

Fix: mirror the `withTopicRouteMutationLock` fix exactly. Track a `releasedCleanly` flag
across all `RELEASE_LOCK` attempts on this connection (there can be up to three per call —
restore, color-backfill, semantic-backfill — sharing the one dedicated `conn`); if any
`RELEASE_LOCK` call throws, call `conn.destroy()` instead of `conn.release()` at the end of
the function. Apply the same change to `dumpDatabase()`'s single-lock finally block.

Confidence: High — confirmed by direct read of every `RELEASE_LOCK`/`conn.release()` call
site in the file; the unsafe pattern is 100% consistent throughout, and the fix pattern to
mirror already exists (and was reviewed) elsewhere in this exact commit batch.
Needs-manual-validation: none — this is a straightforward code-reading confirmation, not a
runtime-dependent hypothesis.

### C7-CQ2 — `logout()` skips server-side session revocation during a restore-maintenance window; only the cookie is cleared
[SEV: MEDIUM | CONF: High | logic/security edge case]

File: `apps/web/src/app/actions/auth.ts:279-294` (introduced/changed by peer commit
`3acf638a`).

Issue:
```
if (token) {
    const maintenanceError = getRestoreMaintenanceMessage('restore in progress');
    if (!maintenanceError) {
        using mutationSlot = acquireAdminMutationSlot();
        if (mutationSlot.acquired) {
            const session = await verifySessionToken(token);
            if (session) { logAuditEvent(...).catch(console.debug); }
            await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token))).catch(() => {});
        }
    }
}
cookieStore.delete({ name: COOKIE_NAME, path: '/' });
redirect(localizePath(locale, '/admin'));
```
Prior to `3acf638a`, `logout()` always attempted `db.delete(sessions)...` for the presented
token. Now, whenever `isRestoreMaintenanceActive()` is true (restore in progress) — or, more
narrowly, whenever `acquireAdminMutationSlot()` returns `acquired: false` (which per
`admin-mutation-barrier.ts` only happens while `state.exclusiveActive` is set, i.e. exactly
during that same restore window) — the whole block is skipped: no audit log, and critically,
**no `DELETE FROM sessions`**. The cookie is still cleared and the browser is still
redirected, so the user *believes* they are logged out.

This matters because `verifySessionToken()` (`apps/web/src/lib/session.ts:94-151`) is
stateful: after the HMAC/timing-safe signature check, it does
`db.query.sessions.findFirst({ where: eq(sessions.id, tokenHash) })` and only rejects the
token if that DB row is absent or expired. The DB row — not the cookie — is what a "logout"
is supposed to invalidate. During a restore-maintenance window, the raw session token value
(if an attacker or a second browser/device already captured it, e.g. via device access,
un-encrypted network capture, or a browser-extension/log leak — the `httpOnly` cookie
attribute blocks JS-based XSS reads but not these other vectors) remains valid for
admin-authenticated requests server-side for up to 24 hours (the token's own max age),
completely independent of the user having just clicked "Logout." This is exactly the
scenario a manual "someone may have my session, log me out now" logout is meant to close,
and it silently no-ops during the one window (an active DB restore) where an admin is most
likely to be paying close attention to the system's state.

Fix: `logout()`'s session *deletion* doesn't need the admin-mutation-barrier's "whole body
must complete before the restore imports" guarantee the way a multi-statement CREATE/UPDATE
does — it's a single idempotent `DELETE ... WHERE id = ?` against a table that is not
being restructured mid-restore in a way that a delete would corrupt (unlike, say, a topic
rename). Consider deleting the session unconditionally (matching pre-`3acf638a` behavior)
while still gating only the *audit log write* (or nothing) behind the maintenance check, or
at minimum, if the mutation slot is unavailable, still perform the single-row session
delete outside the barrier (it's a delete of a row the restore doesn't reference), and log
an explicit warning so the gap is at least observable in production logs rather than
silent.

Confidence: High that this is the code's actual behavior (read directly, confirmed
`verifySessionToken`'s DB-authoritative check, confirmed `acquireAdminMutationSlot`'s
`acquired: false` only occurs during `exclusiveActive`, i.e. restore). Medium on real-world
exploitability given the narrow, operator-initiated, short-lived window this requires — but
the failure mode (a security control silently no-ops with no error surfaced) is real
regardless of the window's rarity. Not previously reported by the sibling
`security-reviewer.md`/`document-specialist.md` reports in this same cycle folder (checked;
they note the mutation-barrier ordering is doc-consistent but don't examine the DB-deletion
skip itself).

### C7-CQ3 — `restore-maintenance-recovery.ts` is dead code, duplicating (and risking silent drift from) the shipped `.mjs` recovery CLI and the canonical `restore-maintenance-durable.ts` logic
[SEV: MEDIUM | CONF: High | dead-code / DRY-drift-risk]

Files:
- `apps/web/scripts/restore-maintenance-recovery.ts` (52 lines) — imports and correctly
  delegates to `restore-maintenance-durable.ts`'s real functions, but is **never invoked by
  anything**: not `package.json`'s `restore:maintenance` script (which runs
  `restore-maintenance-recovery.mjs` instead), not the Dockerfile, not any test. Confirmed
  via `grep -rn "restore-maintenance-recovery"` across the whole repo — only the `.mjs`
  sibling and its own tests reference it.
- `apps/web/scripts/restore-maintenance-recovery.mjs` (96 lines) — the file actually wired
  up in `package.json` (`"restore:maintenance": "node scripts/restore-maintenance-recovery.mjs"`)
  and cited by CLAUDE.md's incident-recovery runbook. It hand-reimplements the exact marker
  path resolution, existence check, and clear logic that already lives in
  `apps/web/src/lib/restore-maintenance-durable.ts:16-30` (`getRestoreMaintenanceMarkerLocation`)
  — presumably because a plain `node scripts/*.mjs` invocation can't import TypeScript
  without a build/tsx step, mirroring the same "no tsx in the production runtime container"
  constraint documented elsewhere in CLAUDE.md for the backfill sidecars.

Issue: the `.mjs` and the `.ts` copies currently match byte-for-byte in logic (same
env-var precedence, same fail-closed-on-non-ENOENT-stat-error behavior, same marker
filename), but nothing enforces that they stay in sync, and the `.ts` file that "documents"
the canonical intent is not the one actually shipped/run. The only existing regression test,
`cycle-72-source-contracts.test.ts`, pins the `.mjs`'s content via a handful of `expect(source
).toContain(...)` substring checks (env var names, one ternary literal) — it does not import
both implementations and assert behavioral equivalence across inputs. A future change to
`restore-maintenance-durable.ts`'s path/filename/fail-open-vs-closed logic (the file every
other consumer — `assertNoDurableRestoreMaintenanceForScript`, the restore flow itself —
actually uses) is very likely to be made there and NOT mirrored into the standalone `.mjs`,
since the `.ts` sibling (which a maintainer might reasonably edit first, assuming it's live)
is dead. The operational risk lands exactly on the incident-recovery path CLAUDE.md's own
"Real incident (2026-06-17)" section describes needing to work reliably under pressure: the
documented recovery command (`npm run restore:maintenance -- status` / `-- clear
--confirm-clear-restore-maintenance`) could silently target a stale/wrong marker path during
a real production restore-maintenance lockout.

Fix: delete the dead `restore-maintenance-recovery.ts` (or, if it must be kept as a
documentation-of-intent artifact, add an explicit top-of-file comment stating it is UNUSED
and pointing at the `.mjs` as the single source of truth) — and either (a) generate the
`.mjs`'s path-resolution block from `restore-maintenance-durable.ts` at build time, or (b)
add a fixture test that runs both implementations' path-resolution logic against the same
matrix of env-var combinations and asserts identical output, so a future divergence fails
CI instead of failing silently in production.

Confidence: High — confirmed dead via exhaustive repo-wide grep (only self-references and
the wired `.mjs`'s own test reference it); confirmed the `.mjs`/`.ts`/`durable.ts` logic is
presently identical via direct line-by-line comparison. The DRY-drift risk is a forward-looking
maintainability concern (not a currently-manifesting bug), rated MEDIUM because the blast
radius (a mis-targeted incident-recovery command with no error) matches an area CLAUDE.md
itself flags as previously having caused real operational pain.

Related, smaller-scale instance of the same "same logic, hand-copied across files" pattern
(not separately filed, noise-reduction): the exact "is this DB host local" +
"DB_SSL_CA required for non-local TLS" check is now independently duplicated in three
places — `apps/web/src/db/index.ts`, `apps/web/drizzle.config.ts`, and
`apps/web/scripts/mysql-connection-options.js` — all three currently agree, but nothing
enforces that beyond manual review (the `05fa5cd1` commit added the drizzle-config copy
using the same handwritten predicate rather than importing a shared helper).

### C7-CQ4 — Dead/unreachable branches in `searchImages()`'s tag/alias fan-out
[SEV: LOW | CONF: High | dead-code]

File: `apps/web/src/lib/data.ts:1660-1713`.

Issue: the function returns early at line 1660-1662 whenever
`results.length >= effectiveLimit` (and `results.length` can never exceed `effectiveLimit`
because the main query is itself `.limit(effectiveLimit)`-bounded, so this is really an
equality check). Consequently, by the time execution reaches line 1679
(`const remainingLimit = effectiveLimit - results.length;`), `results.length` is always
strictly less than `effectiveLimit`, so `remainingLimit` is always `>= 1`. Since
`aliasRemainingLimit` (line 1691) is simply assigned `= remainingLimit` with no further
transformation, it is also always `>= 1`. That makes both:
```
const [tagResults, aliasResults] = remainingLimit <= 0
    ? [[], []] as [SearchResult[], SearchResult[]]      // line 1693-1694 — unreachable
    : await Promise.all([...
        aliasRemainingLimit <= 0 ? [] : db.select(...)  // line 1705 — unreachable
    ...]);
```
unreachable dead code. It doesn't cause incorrect output (the `Promise.all` branch always
runs, which is in fact always correct given the guard above), but it's confusing:
a future maintainer editing this function may reasonably assume `remainingLimit` can be
`<= 0` here and preserve/extend dead logic, or — worse — may assume the early-return guard
at 1660 is *not* exhaustive and waste time looking for a path that reaches the dead branch.
The separate `aliasRemainingLimit` variable (identical to `remainingLimit` in every case)
compounds the confusion; it reads as if it were meant to diverge from `remainingLimit` (per
the adjacent `C3-PR-01` comment discussing the two queries' limits), but never does.

Fix: remove the two dead ternaries and the redundant `aliasRemainingLimit` alias; the
`Promise.all([...])` call can run unconditionally once execution reaches line 1679, and both
`.limit(...)` calls can reference `remainingLimit` directly. If the intent was ever for the
alias query's limit to differ from the tag query's limit (per the `C3-PR-01` comment's
framing), that logic was never actually implemented — worth a one-line comment clarifying
they are, in fact, meant to be identical today.

Confidence: High — confirmed via full control-flow trace of the function; the early-return
guard at line 1660 makes both dead branches provably unreachable, not just unlikely.

## Minor observations (not filed as standalone findings — noise-reduction per briefing)

- `apps/web/src/app/actions/topics.ts:511-512` — the comment "removed the redundant `if
  (deletedRows > 0)` guard which was always true after the `deletedRows === 0` early return
  on line 346" cites a stale line number (the actual early return is at line 500 in the
  current file); a documentation/code line-reference drift, zero functional impact.
- `apps/web/src/app/actions/topics.ts:371-382` (the no-rename branch of `updateTopic`) —
  issues two sequential `SELECT`s against the exact same row
  (`topics.slug = cleanCurrentSlug`) — one (`existingTopic`, `slug` only) purely to check
  existence, immediately followed by a second (`topicBeforeUpdate`, `image_filename`) that
  also re-confirms existence. These could be combined into one query (the codebase already
  does this consolidation elsewhere, e.g. `topicRouteSegmentExists`'s `C3L-CR-02` UNION
  comment). Purely a redundant-round-trip / DRY nit, not a correctness bug; flagging for the
  perf-reviewer's lane rather than filing here.

## Final sweep for commonly-missed issues

Confirmed read/checked (not just grepped) for correctness issues, with no NEW findings
beyond the four above:

- `apps/web/src/lib/{image-queue.ts, admin-backfill-runner.ts, process-image.ts,
  color-detection.ts}` — full deep-dive delegated to a forked sub-review (same model,
  inherited context) covering retry/backoff off-by-ones, concurrency-clamp arithmetic
  (independently re-verified `resolveImageQueueConcurrency`/`IMAGE_QUEUE_RESERVED_LIVE_CONNECTIONS`
  myself: `reserved = max(3, ceil(10/2)) = 5`, `cap = max(1, floor((10-5)/2)) = 2`, matching
  CLAUDE.md's documented "effective cap 2 at pool 10" exactly, including the small-pool
  edge case `poolLimit<=2` which still clamps to a safe minimum of 1, never negative/NaN),
  Promise handling, resource cleanup, the NCLX ISOBMFF box-walker's bounds/depth safety, and
  dead code. Result: no new substantive findings — this code carries per-line citations to
  the specific prior review cycle that hardened it, and the lineage holds.
- `apps/web/src/lib/{settings-hash.ts, view-retention.ts, maintenance-scheduler.ts}` — read
  in full personally. All three are correct: the settings-hash single-authoritative-mapper
  refactor (`C6-02`) is sound; view-retention's chunked-delete retention sweep has no
  off-by-one and fails safe on non-finite/negative env input; the maintenance scheduler's
  restore-drain timeout/abort wiring (verified against its caller in `db-actions.ts:558-575`)
  correctly aborts the restore rather than importing over an in-flight sweep.
- `apps/web/src/lib/data.ts` — read the cursor-pagination helpers
  (`normalizeImageListCursor`, `buildCursorCondition`), the prev/next adjacency query
  builder (`getImageWithSelectFields`), `getImagesLitePage`, `getSharedGroup`,
  `getImageByShareKey`, and `searchImages` in full. Only the one dead-code finding above;
  everything else (including the deliberate rows/totalCount race documented at `C2-36`) is
  correct as designed.
- `apps/web/src/app/actions/{auth.ts, topics.ts}` — read in full personally (the two files
  touched by the freshly-landed `3acf638a`). One HIGH-adjacent finding above (C7-CQ2) plus
  the two minor observations. The `withTopicRouteMutationLock` connection-destroy-on-failure
  fix itself is correct and was the template for the C7-CQ1 gap found in its sibling file.
- `apps/web/src/app/actions/{images.ts, tags.ts, admin-users.ts, public.ts, sharing.ts,
  seo.ts, collections.ts, embeddings.ts, lr-tokens.ts, settings.ts, admin-backfill.ts}` —
  delegated to a second forked sub-review for full-file reads; `admin-backfill.ts` also
  spot-checked personally (clean — correctly delegates DB-mutation fencing to
  `admin-backfill-runner.ts`'s own advisory lock, doesn't need the foreground mutation-slot
  guard since the actual writes happen in the background runner).
- `apps/web/src/lib/{request-origin.ts, constants.ts, image-url.ts,
  content-security-policy.ts}`, `apps/web/src/db/index.ts`, `apps/web/drizzle.config.ts` —
  read in full personally (all touched by peer commits `d8fcb3d6`/`57e2c5d3`/`05fa5cd1`/
  `9cd8d3e8`). The `db/index.ts` connection-init-timeout fix (`connection.destroy()` instead
  of `.release()`) is correct and doesn't leave a dangling `.release()` call on the now-thrown
  path. The `IMAGE_BASE_URL` sanitize-and-silently-empty-on-error pattern is consistent
  between server (`constants.ts`, stamped verbatim into `data-image-base`) and client
  (`image-url.ts` re-sanitizing the already-clean value, a harmless idempotent no-op), and
  matches the pre-existing `buildCspSafely` degrade-not-500 design philosophy — not a new
  gap. `request-origin.ts`'s `BASE_URL`-preferred-origin logic traced end-to-end; no logic
  bug (this is more the security reviewer's lane and their report already covers it in depth
  with no disagreement from this read).
- `apps/web/scripts/{run-e2e-server.mjs, restore-maintenance-recovery.mjs,
  restore-maintenance-recovery.ts, mysql-connection-options.js, ensure-site-config.mjs,
  admin-backfill.ts (action, not script — see above)}` — read in full personally. One
  MEDIUM finding above (C7-CQ3); the rest are clean.
- Did not deep-read `apps/web/scripts/{check-action-origin.ts, check-api-auth.ts,
  check-public-route-rate-limit.ts}` line-by-line (1463/208/998 lines of lint-gate meta-
  tooling with their own dedicated fixture test suites per CLAUDE.md, and none were touched
  by the seven freshly-landed commits) — flagging as the one explicit coverage gap in this
  pass rather than silently omitting it.
- `npm run typecheck --workspace=apps/web` passed clean (substituting for the unavailable
  `lsp_diagnostics` MCP tool, whose backing `typescript-language-server` binary is not
  installed in this environment) — no type errors anywhere in the tree, including every file
  cited above.

## Recommendation

**REQUEST CHANGES** — one HIGH-confidence HIGH-severity finding (C7-CQ1) plus a
HIGH-confidence MEDIUM-severity finding (C7-CQ2) that should be fixed before this batch is
considered fully hardened; the two LOW/MEDIUM dead-code/duplication items (C7-CQ3, C7-CQ4)
are good opportunistic cleanup but not release-blocking on their own.
