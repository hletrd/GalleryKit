# Cycle 7 Debugger Review — Latent Bugs & Failure Modes

**Scope:** Briefing named committed HEAD `14d31ea4`, but the actual current HEAD at review time
is `b4f57c6f` ("fix(cycle14): close review plan gaps"), one commit ahead (adds `/map` etc. to
sitemap.ts, a duplicate settings Save button, and proxy-topology-check doc clarifications). I
reviewed the true current HEAD (`b4f57c6f`) since it is what is actually committed. Focus per my
assignment: unhandled rejection paths, missing awaits, env-var parsing edge cases, parser boundary
conditions (ISOBMFF walker, ICC, sql-restore-scan chunking, csv-escape), timezone/date bugs, and
regressions from the freshest peer commits (9cd8d3e8, d8fcb3d6, 05fa5cd1, 3acf638a, 14d31ea4,
b4f57c6f). Cross-checked candidates against `.context/plans/deferred-carry-forward.md` and the
cycle-{1..6}-2026-07-07 deferred registers before reporting. Two findings were verified with a
standalone Node reproduction script in `/private/tmp/.../scratchpad/` (repo untouched).

## Summary

- Critical: 0
- High: 0
- Medium: 3 (C7-DBG1, C7-DBG2, C7-DBG3)
- Low: 2 (C7-DBG4, C7-DBG5)

All five findings are genuinely new (not present in the deferred registers) and trace directly to
the freshest commits named in the briefing, or to a pattern those commits should have but did not
generalize.

---

## C7-DBG1 — `IMAGE_BASE_URL` silently degrades to `''` with zero logging, unlike the sibling CSP path
**[SEV: MED | CONF: High | category: observability / config-parsing edge case]**

**Location:** `apps/web/src/lib/constants.ts:19` (`export const IMAGE_BASE_URL =
sanitizeImageBaseUrlSafely(process.env.IMAGE_BASE_URL);`); `apps/web/src/lib/content-security-policy.ts:40-46`
(`sanitizeImageBaseUrlSafely`) vs. `content-security-policy.ts:59-73` (`buildCspSafely`).
Introduced by 05fa5cd1 ("sanitize image base and TLS CA").

**Why it's a problem:** `sanitizeImageBaseUrlSafely` catches every failure from
`parseCspImageBaseUrl` (malformed URL, non-http(s) protocol, HTTP-in-production, or a URL carrying
credentials/query string/hash) and returns `''` — with **no `console.error`/`console.warn` call at
all**. Compare this to the sibling `buildCspSafely` in the same file (lines 59-73), which explicitly
logs once per process on the identical failure class specifically so operators aren't left guessing.
`IMAGE_BASE_URL` is the constant that drives every `imageUrl()`/`sizedImageUrl()` call across the
app (lightbox, OG cards, JSON-LD, map popups, srcSet generation) per `apps/web/src/lib/image-url.ts`.
Because it's computed once at module load, a single operator typo (e.g. a CDN URL that carries a
`?v=2` cache-buster query string, or `http://` in `NODE_ENV=production`) silently and permanently
routes every image URL for the process lifetime back to the app origin instead of the configured
CDN — with zero trace in the logs to explain why. This directly refines deferred item **C2-37res**
("Runtime IMAGE_BASE_URL has no boot-time validation... a malformed value now silently degrades CDN
images with a once-per-process log instead of 500ing") — that deferred note's premise (that a log
line exists) is only true for the CSP `img-src` header path; it is **not** true for the actual
image-URL-building constant that 05fa5cd1 introduced, which is new code since that deferral was
recorded.

**Concrete failure scenario:** operator sets `IMAGE_BASE_URL=https://cdn.example.com/assets?v=2` (a
previously-harmless value under the pre-05fa5cd1 raw `process.env.IMAGE_BASE_URL || ''` code, since
nothing validated it). After this deploy, every image on the site silently starts loading from the
app origin instead of the CDN, image-heavy pages get slower/more app-origin bandwidth, and nothing
in `docker logs` explains why.

**Reproduction (verified, /private/tmp, repo untouched):**
```
$ node repro-image-base-url.mjs
Result (what IMAGE_BASE_URL constant becomes): ""
(no console output was produced by sanitizeImageBaseUrlSafely)
```

**Suggested fix:** add a once-per-process `console.error`/`console.warn` inside
`sanitizeImageBaseUrlSafely` (or specifically at the `constants.ts` call site) mirroring the
existing `buildCspSafely` pattern, so a malformed `IMAGE_BASE_URL` is diagnosable from logs alone.

**Confidence:** High — confirmed by direct code read plus a standalone reproduction of the exact
function.

---

## C7-DBG2 — `logout()` skips session invalidation during a restore/mutation-barrier window but still clears the cookie and redirects with no error, leaving a stale session valid for up to 24h
**[SEV: MED | CONF: High | category: logic bug / session-lifecycle edge case]**

**Location:** `apps/web/src/app/actions/auth.ts:279-294` (current `logout()`); introduced by
3acf638a ("harden mutation lock cleanup"). Session TTL is 24h (`auth.ts:212`,`auth.ts:244`,
`auth.ts:429` — `24 * 60 * 60`).

```ts
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

**Why it's a problem:** before this commit, `logout()` unconditionally deleted the DB `sessions` row
(best-effort). Now, if a restore maintenance window is active (`getRestoreMaintenanceMessage`
truthy — this can persist across process restarts per the durable marker documented in CLAUDE.md
if a restore is stuck) **or** the process-local admin-mutation barrier fails to grant a slot
(`mutationSlot.acquired === false`, i.e. a restore is actively draining in-flight mutations), the
`sessions` row deletion is **skipped entirely — not deferred, not retried** — while the cookie is
unconditionally cleared and the user is redirected to the login page exactly as if logout succeeded.
Every OTHER mutating admin action in this codebase fails LOUD in this situation (returns
`t('restoreInProgress')` to the caller). `logout()` is the one action that fails silently and still
reports success to the user via the normal redirect. The DB session row (a fully valid, 24h-TTL
session) remains live and replayable by anyone holding that cookie value until its natural
expiry — there is no later reconciliation step once the restore window ends.

**Concrete failure scenario:** an admin on a shared/public machine clicks "Log out" while a DB
restore is in progress (or during the (rare, but documented) window where a stuck durable restore
marker has not yet been cleared). The browser cookie is removed and the user is taken to the login
screen, believing they are logged out. Their session token — if it leaked via browser history,
another device, a proxy log, or was captured earlier — remains a fully authenticated admin session
for up to 24 hours, with no way for the user to know their "logout" didn't actually invalidate it
server-side.

**Suggested fix:** when the DB-side session deletion is skipped due to restore/mutation-barrier
contention, either (a) retry/queue the deletion once the barrier clears (e.g. record the token hash
for post-restore cleanup), or (b) at minimum, don't silently report success — keep the cookie and
surface an explicit "try again in a moment" message the way other mutating admin actions already do,
so the user isn't misled into believing the session was invalidated.

**Confidence:** High — deterministic control-flow read; the added
`auth-mutation-barrier-source.test.ts` test only asserts source-line *ordering* (a string-position
contract), not the actual runtime cookie/session-row outcome, so this scenario is untested.

**Similar issues:** none of the sibling `password-form.tsx`/`updatePassword` mutation-barrier usages
have this "cookie clears regardless of DB outcome" asymmetry — `updatePassword` returns an error to
the caller instead of silently succeeding, per the same file's other barrier usage at
`auth.ts` (`updatePassword`).

---

## C7-DBG3 — the "destroy connection on RELEASE_LOCK failure" fix (3acf638a) was applied to exactly one of ~8 identical call sites
**[SEV: MED-HIGH | CONF: High (code-confirmed); needs-manual-validation for live-MySQL trigger | category: incomplete fix / connection-pool poisoning]**

**Location (fixed):** `apps/web/src/app/actions/topics.ts:69-100` (`withTopicRouteMutationLock`) —
correctly tracks `releaseCleanly` and calls `conn.destroy()` instead of `conn.release()` when
`RELEASE_LOCK` throws.

**Location (NOT fixed — same pattern, same risk):**
- `apps/web/src/app/actions/admin-users.ts:303-308` (`finally { ...RELEASE_LOCK.catch(()=>{}); conn.release(); }`)
- `apps/web/src/lib/upload-processing-contract-lock.ts:45-54` and `:60-68` (both the `release()`
  closure and the outer error-catch path release unconditionally after a swallowed/thrown
  `RELEASE_LOCK` failure)
- `apps/web/src/lib/image-queue.ts:659-666` (`releaseImageProcessingClaim`: `finally { lockConnection.release(); }`
  — releases even though the preceding `RELEASE_LOCK` query isn't even wrapped in a `.catch`, so a
  thrown error still hits `finally` before propagating)
- `apps/web/src/app/actions/embeddings.ts:203-207`
- `apps/web/src/app/[locale]/admin/db-actions.ts:390-394, 449-451, 462-464, 481-487, 519-531, 606-619, 633-644`
  (every `RELEASE_LOCK` call site in this file swallows the error via `.catch((err) =>
  console.debug(...))` and then unconditionally calls `conn.release()` in the surrounding
  `finally`/cleanup block)
- `apps/web/src/lib/single-writer-guard.ts:192, 250, 320` (same swallow-then-continue shape, though
  this one doesn't pool-release a `PoolConnection` the same way, lower risk)

**Why it's a problem:** the commit's own message states the rationale precisely: "the advisory lock
state is unknown [after a failed RELEASE_LOCK] and returning it to the pool can leak lock
ownership." MySQL advisory locks (`GET_LOCK`/`RELEASE_LOCK`) are **session-scoped and (per this
repo's own CLAUDE.md) server-scoped across the whole MySQL server**. If `RELEASE_LOCK` fails/errors
(network blip mid-round-trip, connection already going away, etc.) and the app can't be sure the
lock was actually released server-side, returning that same physical connection to the pool means a
FUTURE, unrelated caller from the pool inherits a session that may still be holding, e.g.,
`gallerykit_upload_processing_contract`, `gallerykit_color_pipeline_backfill`,
`gallerykit_semantic_embedding_backfill`, `gallerykit_db_restore`, `gallerykit_admin_delete`, or a
per-image processing claim — silently and indefinitely blocking every subsequent `GET_LOCK` attempt
on that name (from ANY connection) until the poisoned pooled connection happens to be recycled or
the app restarts. This is exactly the class of hard-to-diagnose production incident ("backfill/
restore/upload-lock suddenly always reports in-progress") the fix was meant to close — it just
wasn't generalized past the one call site the commit happened to touch.

**Suggested fix:** extract the `releaseCleanly`-then-`destroy()` pattern from
`withTopicRouteMutationLock` into a small shared helper (e.g. `releasePooledLockConnection(conn,
releaseQuery)`) and apply it at the other ~7-8 call sites listed above, matching the "same pattern
elsewhere" principle this codebase's own CLAUDE.md repeatedly documents as its most common defect
class (touch-target audit, WI-14 encoder note, etc. all call out "fix one sibling, miss the next").

**Confidence:** High that the code pattern is present at every cited location (confirmed by direct
read of each file); the live-MySQL fault-injection needed to prove pool poisoning end-to-end was not
run in this review (would require standing up MySQL and forcing a `RELEASE_LOCK` failure mid-flight)
— flagging as needs-manual-validation for the runtime trigger, but the code-level gap itself is not
speculative.

---

## C7-DBG4 — new duplicate "Save" button on the Settings page has no `ref`, so the a11y focus-restore hook moves focus to the WRONG button
**[SEV: LOW | CONF: High | category: a11y regression / stale-ref edge case]**

**Location:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:76-77`
(`const saveButtonRef = useRef<HTMLButtonElement>(null); useRestoreFocusAfterPending(saveButtonRef,
isPending);`), `:327` (existing top button: `<Button ref={saveButtonRef} onClick={handleSave}
disabled={isPending} ...>`), `:859` (**new** bottom button added by `b4f57c6f`: `<Button
type="button" onClick={handleSave} disabled={isPending} className="min-h-11 gap-2">` — no `ref`
prop). Hook definition: `apps/web/src/lib/use-restore-focus-after-pending.ts:19-37`.

**Why it's a problem:** `useRestoreFocusAfterPending` exists specifically to fix a real WCAG 2.4.3
regression: when a submit button's `disabled` flips to `true` mid-transition, the browser forcibly
blurs it to `<body>`, and the hook restores focus to the referenced element once `isPending` returns
to `false` — but *only* if focus is still on `<body>` (so it never steals focus a user has since
moved). The cycle-14 commit `b4f57c6f` added a second, bottom-of-page "Save" button (so users don't
have to scroll back to the top) reusing the same `handleSave`/`isPending` state, but did not attach
`ref={saveButtonRef}` to it. Only one `saveButtonRef` exists, pointed at the TOP button.

**Concrete failure scenario:** a keyboard or screen-reader user scrolls to the bottom of the (long)
settings page, tabs to and activates the new bottom Save button. `handleSave()` triggers
`startTransition`, `isPending` becomes `true`, both buttons become `disabled`, and the browser blurs
the bottom button to `<body>` (matching the hook's own documented trigger condition: `active ===
document.body`). When the transition resolves, `useRestoreFocusAfterPending` calls
`saveButtonRef.current.focus()` — which is the TOP button, not the one the user actually clicked.
Focus (and the visual focus ring) jumps to the top of a long page the user never scrolled to
manually, which is disorienting for exactly the population this hook was written to protect, and it
reintroduces a variant of the very bug (C1-08/DES-02) the hook exists to prevent.

**Test-coverage note:** the new `apps/web/src/__tests__/settings-save-affordance-source.test.ts`
(added in the same commit) only asserts `onClick={handleSave}` appears twice and that the wrapping
`<div className="flex justify-end border-t pt-4">` markup exists — it does not check for a `ref`
attribute, so this regression ships with a green test suite.

**Suggested fix:** either attach a second `ref` (e.g. `bottomSaveButtonRef`) and extend
`useRestoreFocusAfterPending` (or add a second hook call) to restore focus to whichever save button
was actually most recently active, or simplest: track "last-activated save button" in a single ref
that `handleSave` updates on click before calling `startTransition`.

**Confidence:** High — confirmed via direct JSX/ref read; not a runtime repro since it's a
straightforward static wiring gap (only one `ref=` attribute exists across the two buttons).

---

## C7-DBG5 — sql-restore-scan's chunk-boundary "raw bridge" only has a 1-chunk lookback; a legally-possible short `fd.read()` can make a `DROP TABLE`-class keyword evade detection across 3 reads
**[SEV: LOW (tempered — admin-only, defense-in-depth layer; requires an actual OS-level short read, not purely attacker-controlled) | CONF: High for the code-level gap (reproduced), Low-Med for real-world triggerability | category: parser boundary condition]**

**Location:** `apps/web/src/lib/sql-restore-scan.ts:279-308` (`appendSqlScanChunk`, specifically the
`nextRawSuffix` computation) consumed by `apps/web/src/app/[locale]/admin/db-actions.ts:731-763`
(the manual `for (let off = 0; off < fileSize; off += CHUNK_SIZE)` loop with `CHUNK_SIZE = 1MB`,
reading via `scanFd.read(chunkBuf, 0, readSize, off)`). This code is not part of the 5 freshest
peer commits, but is one of the explicitly-named files in my assignment and is genuinely
uncovered by the existing test suite for the scenario below.

**Why it's a problem:** `nextRawSuffix` is computed as `chunk.length > SQL_SCAN_RAW_BRIDGE_BYTES (128)
? chunk.slice(-128) : chunk` — i.e., it only ever remembers the tail of the **immediately preceding**
chunk. If any read returns fewer than 128 bytes (the code's own comment at `db-actions.ts:744-748`
explicitly acknowledges this: *"Short reads are rare but legal"* for `filehandle.read()` at a fixed
offset — genuinely part of Node's documented contract, more plausible under NFS/network-backed
storage, which this deployment's own CLAUDE.md flags as a real topology (NAS/ZFS/NFS)), then a
dangerous keyword split so that its *first* fragment lands in the chunk **two calls back** is
permanently lost from both the raw-bridge window (only 1-chunk lookback) and the compacted-tail
window (the compacted join inserts a literal `\n` between chunks, which — once collapsed to a single
space by `compactSqlScanTail` — permanently splits the keyword into two separate "words" that never
re-merge). No single scan pass ever sees the fully-reconstructed keyword.

**Reproduction (verified, /private/tmp, repo untouched — functions copied verbatim from
`sql-restore-scan.ts`, only `DANGEROUS_SQL_PATTERNS` trimmed to the one pattern under test):**
```
chunk A = '...DR'   (ends mid-token)
chunk B = 'OP'      (2-byte short read — simulates the acknowledged-legal short-read case)
chunk C = ' TABLE images;'

After chunk A: containsDangerousSql = false
After chunk B (short 2-byte read): containsDangerousSql = false
  -> nextRawSuffix carried into chunk C is only: "OP" (lost the "DR" from chunk A)
After chunk C: containsDangerousSql = false     <-- full text is "...DROP TABLE images;", never detected
```

**Why severity is tempered rather than MED/HIGH:** the live caller (`db-actions.ts:741-748`) reads
fixed 1 MB chunks at explicit offsets, so **every non-final chunk is normally exactly 1 MB** (≫ 128
bytes) — an attacker cannot force a sub-128-byte *middle* chunk purely by choosing the dump file's
bytes/size; it requires an actual short read from the underlying `fd.read()` syscall path (signal
interruption, certain network-filesystem behavior under load), which is not something the uploader
(an authenticated admin) can reliably trigger on demand on typical local disks. It is nonetheless a
real gap in the stated design invariant ("128 comfortably spans the longest contiguous dangerous
keyword phrase" — this assumes the *only* place a short read/small chunk can occur is the final
chunk of the file, which the code does not actually enforce or assert).

**Suggested fix:** either (a) assert/require every non-final `fd.read()` call actually returns
`readSize` bytes and retry-read on a short return instead of silently proceeding into
`appendSqlScanChunk` with a small `chunk`, or (b) make `nextRawSuffix` accumulate across multiple
short reads (append instead of replace when the incoming chunk is small) so the lookback window
degrades gracefully instead of collapsing to just the latest tiny chunk.

**Confidence:** High that the code-level gap exists (reproduced deterministically); explicitly
Low-Medium on real-world attacker-triggerability given the fixed 1 MB caller chunking — reporting
per the "no speculation without evidence" rule with the caveat stated plainly rather than oversold.

---

## Final sweep for commonly-missed issues

Checked and found **no new issues** in (confirming coverage, not silence-by-omission):
- `apps/web/src/lib/color-detection.ts` `parseCicpFromHeif` ISOBMFF walker (bounds correctly by
  `limit = Math.min(end, offset + MAX_SCAN_BYTES, buffer.length)` at every recursion level; the
  `9ce5cf96` container-end-bound fix is sound and the recursive `walk(contentOffset, boxEnd, depth+1)`
  correctly threads the tightened bound down).
- `apps/web/src/lib/icc-extractor.ts` / `icc-chromaticity.ts` — no new commits in this cycle; spot
  checked the `mluc` dataSize<16 guard (`cf7f4330`) and it correctly precedes the record-header read.
- `apps/web/src/lib/csv-escape.ts` — unchanged this cycle; not re-audited beyond confirming no diff.
- Timezone/date logic (`on-this-day`, year-in-review, `capture_date` handling) — grepped for
  recent changes; none touched in the commits under review this cycle, so not re-litigated here
  (no new evidence to add beyond prior cycles' coverage).
- `apps/web/src/db/index.ts` pool-connection-timeout fix in 9cd8d3e8 (`connection.destroy()` instead
  of `connection.release()` on init-query timeout) — verified sound; addresses a real
  connection-reuse hazard (a stale in-flight init query on a connection returned to the pool) and
  is a clean, minimal, correctly-scoped fix with no observed edge case.
- `db-actions.ts`'s `armDbChildProcessWatchdog` reorder (9cd8d3e8: `onTimeout()` now called AFTER
  `child.kill('SIGTERM')` + arming `forceKill`, and the returned cleanup only calls the internal
  `markSettled()` when `!fired`) — traced all three call sites (mysqldump backup, mysql restore,
  post-restore migrate); in every case the outer `settled` flag is set by the `onTimeout` callback
  itself before any other handler could call the returned cleanup function, so the `if (!fired)`
  guard is currently inert/defensive rather than exercised — no regression found, and the change
  correctly prevents a future call site from accidentally disarming the SIGKILL grace timer.
- `apps/web/src/lib/request-origin.ts` Host-vs-X-Forwarded-Host preference change (d8fcb3d6) —
  read in full; this is squarely security-reviewer's lane and their `C7-SEC1` already covers the
  practical no-op-under-shipped-nginx nuance, so not duplicated here.
- `apps/web/drizzle.config.ts` DB_SSL_CA requirement (05fa5cd1) — confirmed this brings
  drizzle-kit's TLS handling into parity with the pre-existing runtime requirement already enforced
  in `scripts/mysql-connection-options.js` (same required-CA invariant, not a new/inconsistent
  policy) — no bug.
- `apps/web/scripts/run-e2e-server.mjs` / CSP `GA_CONNECT_SOURCES` additions in 9cd8d3e8 — routine,
  no edge case found.
- Did **not** touch or propose edits to any peer-owned flat `.context/reviews/*.md` file, anything
  under `plan/`, or `deferred-carry-forward.md`; the currently-dirty peer files
  (`.context/reviews/{_aggregate,code-reviewer,critic,designer,perf-reviewer,security-reviewer,verifier}.md`,
  `apps/web/src/__tests__/cycle12-ops-contracts.test.ts`, `scripts/check-proxy-topology.mjs`) were
  left untouched per the shared-worktree rules; their committed (HEAD) versions were read where
  relevant to my analysis (e.g. `check-proxy-topology.mjs`, reviewed via `git show b4f57c6f`) but not
  their in-flight dirty content.
