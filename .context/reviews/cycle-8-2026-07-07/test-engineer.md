# Test-Engineer Review — Cycle 8 (2026-07-07)

Scope: test-coverage gaps, flaky tests, weak assertions, TDD opportunities across
`apps/web/src/__tests__/**` (Vitest) and `apps/web/e2e/**` (Playwright), against HEAD
`6256a988` (read-only; the test suite was run once, unmodified, to observe health).

## Test-suite health snapshot

```
Test Files  352 passed | 2 skipped (354)
     Tests  3235 passed | 4 skipped (3239)
  Duration  10.89s (transform 7.64s, import 45.52s, tests 14.24s)
```

All 3235 executed tests pass; nothing flaky or slow observed in this run. The 2 skipped
files (`clip-semantic-integration.test.ts`, `clip-offline-load.test.ts`) are the
documented, intentional `describe.skip` gates that require real CLIP model weights
(`CLIP_MODELS_ROOT`/`RUN` env) — expected in CI, not a hidden gap; CLAUDE.md already
documents the manual pre-flight (`npm run test:clip:preflight`) as the real gate before
production activation. The e2e admin/origin-guard specs (`e2e/admin.spec.ts`,
`e2e/origin-guard.spec.ts`) similarly `test.skip()` without `CI=true` + seeded admin
credentials — documented, matches the still-open C94-05 deferred row (no premature
closure to report).

I did not find any `it.only`/`describe.only` left in the tree, and no real-timer
`setTimeout`/`sleep`-based waits in `src/__tests__/**` — every async-timing test I sampled
uses `vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync()` or polls the module's own
completion signal via `vi.waitFor()`. One test
(`admin-backfill-runner-detection-failure.test.ts`) explicitly documents having *fixed* a
prior flake (a fixed 10×`setImmediate` drain racing real `sharp()` I/O) by switching to
`vi.waitFor()` polling on `readAdminBackfillState().running` — good practice, worth using
as the house style for any new drain-based async test.

## Overall answer to "are source-contract tests brittle or meaningful?"

Mixed, and the split is informative. The STRONG source-contract tests in this repo do one
of two things: (a) introspect real runtime state (e.g.
`sql-restore-scan.test.ts`'s `APP_BACKUP_TABLES is a superset of every table in the
Drizzle schema` walks the actual Drizzle schema exports via `getTableName`, so a new table
added to `schema.ts` without an allowlist update fails for real), or (b) drive the real
function/module with fake inputs and assert on real outputs (e.g. `db-child-watchdog.test.ts`,
`advisory-lock-release.test.ts`, `admin-backfill-runner-detection-failure.test.ts`,
`migrate-pending-migrations.test.ts`). These are hard to regress past.

The WEAK ones (flagged below as TEST8-01/02/03/04) instead `readFileSync` the source file
and assert `toContain(...)` / `indexOf(...)` ordering on literal snippets copied from the
current implementation. These pin *today's exact wording*, not the underlying behavioral
contract — a change that preserves the literal strings while breaking the control-flow
relationship between them (or a semantically-equivalent rewrite that changes the strings
while keeping the behavior correct) is invisible to them in one direction and a false
alarm in the other. Several of these guard genuinely security/privacy/concurrency-critical
invariants (GPS fail-closed, upload-quota TOCTOU, restore-window session revocation,
tag-name search parity after a real past production bug) where a behavioral test would
catch classes of regression the current text-pin cannot.

---

## Findings

### TEST8-01 — Restore-window logout revocation queue has zero behavioral test (only source-grep)
**Severity: HIGH | Confidence: High**

`logout()` in `apps/web/src/app/actions/auth.ts:269-307` has three exit branches that
matter: (1) normal path — DB session delete runs, `revoked = true`; (2) restore-maintenance
window active (`getRestoreMaintenanceMessage()` truthy) — DB delete is skipped entirely;
(3) `acquireAdminMutationSlot()` fails to acquire — DB delete is also skipped. In both (2)
and (3), `enqueuePendingSessionRevocation(hashSessionToken(token))` must fire so the token
doesn't stay verifiable for its remaining session lifetime (this is the documented C7-01
fix — a real prior bug: logout "looked like" a full logout while silently leaving the
session row live).

The ONLY test covering this wiring is
`src/__tests__/pending-session-revocations.test.ts`'s
`describe('C7-01 wiring source contracts')` (lines 88-113), which does:
```ts
expect(source).toContain("enqueuePendingSessionRevocation(hashSessionToken(token))");
expect(source).toContain('let revoked = false;');
expect(source).toContain('if (!revoked) {');
```
These are three independent `toContain` calls against the whole file text — they do not
verify relative order, nesting, or that the enqueue call is actually gated by `!revoked`
(vs. sitting unconditionally elsewhere in the file). `auth-actions-behavior.test.ts` only
tests the hostile-origin-rejection path for `logout()` (line 231); no test ever calls
`logout()` with a valid token while mocking `getRestoreMaintenanceMessage()` to return a
message (or `acquireAdminMutationSlot()` to report `acquired: false`) and asserts that (a)
`db.delete(sessions)` is NOT invoked, (b) `enqueuePendingSessionRevocation` IS invoked with
the correct `hashSessionToken(token)`, and (c) the cookie is still cleared / redirect still
fires.

**Regression this would miss:** moving the `enqueuePendingSessionRevocation` call outside
the `if (!revoked)` block (so it always fires, harmlessly re-queuing an already-revoked
token) or, worse, a future refactor that changes the guard variable name while leaving
`let revoked = false;` as dead code elsewhere — both pass today's test.

**Test to add:** a behavioral case in `auth-actions-behavior.test.ts` (the harness already
mocks `@/lib/restore-maintenance` and can mock `@/lib/admin-mutation-barrier`) that calls
`logout()` with a valid session cookie under each of the two skip conditions and asserts
the three outcomes above via the existing `db.delete` mock and a spy on
`enqueuePendingSessionRevocation`.

---

### TEST8-02 — `searchImages` tag_names full-tag-set parity is pinned by source-slice, not by running the query
**Severity: HIGH | Confidence: High**

`apps/web/src/lib/data.ts:1682-1701` fixed a REAL production bug (C7-09): filtering tag
matches via an `INNER JOIN` before `GROUP_CONCAT` caused `tag_names` in search results to
contain only the matching tag instead of the photo's full tag set, which fed into alt-text
and result labels. The fix moved the filter into an `EXISTS` subquery
(`tagMatchExists`) so the aggregation `LEFT JOIN`s stay unfiltered.

The regression test for this,
`data-tag-names-sql.test.ts`'s `searchImages keeps tag matching separate from tag_names
aggregation` (lines 234-248), is a pure source-text slice: it extracts the function body
as a string, cuts out the substring between two `db.select(...)` calls, and asserts
`toContain`/`not.toContain` on JOIN-type keywords (`leftJoin`/`innerJoin`) and variable
names. No test anywhere executes `searchImages()` (with a mocked/fixture `db`) against a
photo carrying 2+ tags and a search term matching only one of them, then asserts the
returned `tag_names` string contains BOTH tags.

**Regression this would miss:** any bug that keeps the textual shape (still says
`.leftJoin(imageTags` / uses `tagMatchExists` in the `where`) but is semantically wrong —
e.g., an off-by-one in which `tagConditions` gets attached to the wrong query, or a future
change to `tagMatchExists`'s `WHERE` clause that accidentally re-introduces filtering via a
different mechanism (e.g. a `HAVING` clause) not covered by the specific keyword checks. It
also gives no protection against a regression in the alias-search branch's analogous
`tag_names: sql\`NULL\`` placeholder being wired to the wrong result set.

**Test to add:** a data-layer test (this file already has "Drizzle compiled SQL" tests at
the bottom that build a real Drizzle query and call `.toSQL()` without needing a live MySQL
connection — see `Drizzle compiled SQL for the lite query shape emits GROUP_CONCAT + LEFT
JOIN + GROUP BY`, line 294) that mocks `db.select().from().leftJoin()...` to return a
multi-tag fixture row and asserts the `tag_names` field in the RESULT actually contains
every tag, not just the searched one. If a real query-execution mock is too heavy, at
minimum assert the compiled SQL's `WHERE` clause references `tagMatchExists`'s `EXISTS(...)`
subquery and NOT a join-level filter on `tags.name`, using the same `.toSQL()` technique
already proven working in this file — that would be strictly stronger than string-slicing
the TypeScript source.

---

### TEST8-03 — Upload-quota TOCTOU claim-before-await ordering is proven only by string position, never by a concurrency scenario
**Severity: HIGH | Confidence: High**

CLAUDE.md documents this explicitly under "Race Condition Protections": *"Upload quota
TOCTOU: per-window upload count/byte limits are checked SYNCHRONOUSLY then the claim is
made before the first `await` ... so two concurrent same-key uploads cannot both pass
before either claims."* This is exactly the kind of invariant a regression could silently
break (someone adds an `await` for a new pre-check, e.g. an audit-log call or a new
settings read, between the limit check and the claim).

The only test, `images-action-toctou-claim.test.ts`, is 100% `indexOf`/`search` position
comparisons on the raw text of `apps/web/src/app/actions/images.ts`:
```ts
const claimIdx = SRC.indexOf('tracker.bytes += totalSize');
const diskAwaitIdx = SRC.indexOf('await ensureUploadDirectories()');
expect(claimIdx).toBeLessThan(diskAwaitIdx);
```
This only checks the claim's position relative to two SPECIFIC named awaits. It provides
no protection if a future change inserts a NEW `await` anywhere between the synchronous
limit checks and the claim lines (the actual vulnerability window) as long as it isn't
literally `await ensureUploadDirectories()` or the topic-exists `db.select` — the two
awaits this test happens to know about. There is no test that actually simulates two
overlapping `uploadImages()` invocations against a shared tracker key (e.g. by making the
disk-check or topic-exists mock return a controllable pending Promise so both "requests"
interleave at that yield point) and asserts the tracker's cumulative claimed
count/bytes never exceeds the configured window limit.

**Test to add:** a behavioral concurrency test — mock `ensureUploadDirectories` (or
whichever pre-check is easiest to control) to return a `Promise` that only resolves after
both of two concurrent `uploadImages()` calls have reached that point, then assert the
combined tracker state reflects both claims (i.e., no double-pass), and that a third
call issued after the window is already fully claimed is correctly rejected. This is the
actual property CR-16-01/CR-17-1 exist to protect and is currently unverified by
execution.

---

### TEST8-04 — GPS-strip fail-closed on-disk cleanup call is not asserted (only adjacent lines are)
**Severity: MEDIUM | Confidence: Medium**

`apps/web/src/app/actions/images.ts:410-423` — when `stripGpsFromOriginal()` returns
`false` (mandatory strip failed), the code must delete the just-saved original
(`await deleteOriginalUploadFile(savedOriginalFilename)`) before continuing, or a
GPS-bearing original persists on disk despite the upload being reported as failed/rejected
— defeating the documented VER-01 "fail closed" contract in CLAUDE.md.

`images-action-gps-toggle-wiring.test.ts`'s last test (`rejects the upload if mandatory GPS
stripping cannot be guaranteed`, lines 69-76) checks five things in the same source file —
`gpsStripFailureCount++`, `t('gpsStripFailed')`, `failedFiles.push(file.name)`, `continue;`,
and the `if (!gpsStripped)` guard — but never asserts
`deleteOriginalUploadFile(savedOriginalFilename)` appears inside that block. The parallel
LR-upload test (`lr-upload-hdr-gate.test.ts`, lines 91-108) has the identical gap for the
same logic in `api/admin/lr/upload/route.ts`. This module's own doc comment
acknowledges the source-contract tier was a deliberate choice over a full behavioral mock
(reasonable — mocking the whole server action is heavy), which is why this is MEDIUM not
HIGH: it's a narrower, cheap addition to an already-accepted test design, not a missing
test class.

**Test to add:** one more `toContain('await deleteOriginalUploadFile(savedOriginalFilename)')`
assertion (scoped to the same guard-block window the existing test already slices) in both
`images-action-gps-toggle-wiring.test.ts` and `lr-upload-hdr-gate.test.ts`. Cheap, and closes
the one meaningful omission in an otherwise-reasonable source-pin design.

---

### TEST8-05 — SQL-restore-scan's real chunked-file streaming loop, and the three watchdog `onTimeout` failure handlers in db-actions.ts, remain source-pinned only (C6-12 exit criterion still not fired)
**Severity: MEDIUM | Confidence: High**

Two related gaps in the same file (`apps/web/src/app/[locale]/admin/db-actions.ts`):

1. **Restore-scan streaming loop** (`db-actions.ts:684-723`): the pure functions
   `appendSqlScanChunk` / `containsDangerousSql` in `lib/sql-restore-scan.ts` are
   excellently unit-tested (including the C6-01/C7-12 rolling-raw-tail-across-three-short-reads
   scenarios). But the loop that actually threads `scanTail`/`scanRawSuffix` across
   real `fs.open()`/`read()` iterations, handles short reads via `bytesRead`, and flips
   `dangerousSqlDetected` is not referenced anywhere in `db-restore.test.ts` (confirmed —
   zero hits for `appendSqlScanChunk`, `scanRawSuffix`, or `disallowedSql` in that file). A
   wiring regression here (e.g. forgetting `scanRawSuffix = nextRawSuffix;`, or an
   off-by-one in the `for (let off = 0; off < fileSize; off += CHUNK_SIZE)` loop) would
   silently defeat the well-tested pure-function guarantees and isn't caught by anything.

2. **Watchdog `onTimeout` wiring at the 3 real call sites** (backup dump, restore import,
   post-restore migration — `db-actions.ts:204,771,882`): `db-child-watchdog.test.ts`
   thoroughly behavior-tests the extracted `armDbChildProcessWatchdog` PRIMITIVE (fake
   timers, double-settle, late-cleanup ordering — genuinely strong). But the actual
   `failRestore`/equivalent callback bodies passed as `onTimeout` at each call site are
   still pinned only by `db-restore.test.ts`'s `keeps maintenance active and cleans temp
   state on mysql child failure paths` test, which is a source-text slice
   (`DB_ACTIONS_SRC.slice(...)` + `toContain`), not an actual simulated child-process
   timeout driving the real `restoreDatabase()`/backup action end-to-end.

This is the still-open deferred item **C6-12** (`cycle-6-2026-07-07`, "Next restore-path
cycle OR a reusable child_process spawn-mock harness — db-restore failure behavioral
test"). The C7-15 watchdog extraction (this cycle's peer work, per the module's own doc
comment) made the ISOLATED primitive testable and IS well tested now, but that alone does
not fire C6-12's exit criterion — the exit criterion is specifically a reusable spawn-mock
harness enabling behavioral coverage of the db-actions.ts wiring, which still does not
exist. Worth flagging explicitly so this cycle's register update doesn't mistake "the
watchdog primitive is now behaviorally tested" for "C6-12 is closed."

**Test to add:** (a) a `db-restore.test.ts` case that writes a real multi-MB temp file
with a dangerous keyword split across a `CHUNK_SIZE` boundary and drives the actual file
I/O loop (no mocking of `fs`) to confirm end-to-end detection; (b) the spawn-mock harness
C6-12 already calls for, reused across backup/restore/migrate to drive each real
`onTimeout` callback and assert its side effects (`keepMaintenance: true`, temp-file
cleanup, stream/kill calls) actually execute, not just that the source contains the right
literal calls.

---

### TEST8-06 — SW template/reference-implementation parity is proven by regex-on-source, never by executing the template
**Severity: LOW | Confidence: Medium**

`lib/sw-cache.ts` (the documented reference implementation) is genuinely behavior-tested
(545 lines of real function calls in `sw-cache.test.ts` — LRU eviction, phantom-entry
accounting, recency reorder, etc.). But `public/sw.template.js` — the file that ACTUALLY
ships to browsers — is only checked via `sw-template-contract.test.ts`, which is regex/
`toContain` matching against the raw template text (e.g. "recordAndEvict pays the tracked
total down UNCONDITIONALLY" is asserted by grepping for a code shape, not by loading the
template into a simulated `self`/`caches` environment and calling its functions). This is a
reasonable, previously-considered architecture tradeoff (CLAUDE.md notes the split
explicitly), not an oversight, hence LOW severity — but it means a template edit that
changes runtime behavior while incidentally preserving every pinned substring (or a subtle
divergence between the template and `sw-cache.ts` that a regex isn't specific enough to
catch) would not be caught until an operator or e2e test observes broken offline/image
caching in a real browser.

**Suggestion (not urgent):** if a future cycle touches the SW template, consider a minimal
harness that `eval`s (or dynamically requires) `sw.template.js` inside a stubbed
`self`/`caches`/`fetch` object — similar in spirit to the RTL/jsdom harness already
deferred for components (C4-18) — so at least the LRU/eviction paths run for real once.
Until then, this stays an accepted gap, not a regression risk needing urgent action.

---

### TEST8-07 — `createPooledAdvisoryLockReleaser`'s staged multi-lock PARTIAL-failure path is untested
**Severity: LOW | Confidence: Medium**

`lib/advisory-lock-release.ts`'s staged releaser (used by the DB-restore path, which
chains up to three advisory locks on one connection) never early-returns on `failed` inside
`release()` — every subsequent `release()` call is still attempted even after an earlier
one failed, by design (best-effort: release everything you can, then destroy the
connection once at the end). `advisory-lock-release.test.ts` covers: all-succeed staged
case, and a single one-shot failure case (`releasePooledAdvisoryLocks` with ONE lock) — but
no test drives the STAGED releaser through a sequence where lock A's release fails and
lock B's release is still attempted afterward, confirming (a) `release('lock-b', ...)` is
still called (not skipped), (b) `releaseFailed` stays `true` after the second, successful
call, and (c) `finish()` still destroys (not releases) the connection.

**Test to add:** in the `'supports staged multi-lock release'` describe block, add a case
where `conn.query` rejects on the first `RELEASE_LOCK` call and resolves on the second,
then assert `conn.query` was called twice (lock B was still attempted), `releaseFailed ===
true`, and `conn.destroy()` (not `conn.release()`) was called once.

---

## Areas checked and found solid (no finding filed)

To avoid re-litigating strong coverage, noting explicitly what I verified is NOT a gap,
since these were named in the review brief:

- **Advisory-lock destroy-on-failed-release** (single-lock case): well covered —
  `advisory-lock-release.test.ts` + the source-contract scanner
  (`advisory-lock-release-contract.test.ts`) that forbids any NEW raw `RELEASE_LOCK(?)` call
  site outside a small, justified allowlist. Only the staged multi-lock partial-failure
  case is missing (TEST8-07 above).
- **`db-child-watchdog` extraction** (C7-15): genuinely thorough behavioral coverage with
  fake timers — timeout firing, SIGKILL escalation, settle-during-grace, cleanup-before/
  after-timeout ordering, double-settle. One of the better-designed test files in the repo.
- **`single-writer-guard` re-acquire loop** (C4-06): thoroughly covered, including the
  post-lapse re-acquire success/contention paths, repeated-lapse re-warning, stop-during-
  reprobe-window, and unref'd-timer assertions.
- **`migrate.js` mixed-drift + DML-baseline guard**: `migrate-pending-migrations.test.ts`
  has dedicated cases for the mixed batch (drift below cursor + pending above), the
  above-cursor refusal guard, the DML-detector on real migration files (including the
  allowlisted `0001_sync_current_schema` exception), and the `runMigrations` post-condition
  throw. No new gap found here this cycle.
- **`admin-backfill-runner` detection-failure no-version-bump**: genuinely strong — a real
  behavioral test that invokes `triggerAdminBackfill()`, mocks DB calls at the
  `db.execute`/SQL-text level, and asserts the emitted `UPDATE` statement's SQL text omits
  `pipeline_version`. Uses `vi.waitFor()` polling instead of timing assumptions (see health
  snapshot above re: a fixed prior flake in this exact file).
- **GPS-strip byte-level correctness** (JPEG/WebP/TIFF/AVIF scrubbing, XMP overflow-chunk
  splits, post-EOI trailers): extensively and specifically tested in
  `strip-gps-from-original.test.ts` / `gps-exif-strip-isobmff.test.ts`. Only the upload-path
  wiring's fail-closed cleanup call is under-asserted (TEST8-04).

---

## Summary

**Findings by severity:** 3 HIGH (TEST8-01, TEST8-02, TEST8-03), 2 MEDIUM (TEST8-04,
TEST8-05), 2 LOW (TEST8-06, TEST8-07). All 7 findings are about test *design* (source-text
pinning standing in for behavioral verification on security/privacy/concurrency-critical
paths), not about currently-failing or flaky tests — the suite is green (3235/3235
executed tests passing) with no flakiness observed in this run.
