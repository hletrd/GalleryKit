# Cycle 7 Test-Engineer Review (HEAD 14d31ea4)

Scope: test-coverage gaps, flaky tests, source-pin tests where a behavioral test would be
stronger, missing edge-case coverage, and cheap new-test opportunities. Focus modules per
assignment: image-queue, process-image, sql-restore-scan, settings-hash, data.ts privacy
guards, view-retention, gps-exif-strip, admin-backfill-runner, image-url/image-base-url —
plus the freshly-landed peer commits (14d31ea4, 9cd8d3e8, d8fcb3d6, 57e2c5d3, 4d37daa4,
05fa5cd1, 3acf638a).

## Method

- Inventoried `apps/web/src/__tests__/` (349 test files discovered by vitest; 347 passed / 2
  intentionally skipped — the env-gated CLIP preflight suites, documented in CLAUDE.md as
  "permanently skipped in CI"). Full run: `npm test --workspace=apps/web` → **3198 passed, 4
  skipped, 0 failed** (fresh run, this session).
- Grepped every exported function in the 9 assigned critical modules against the test corpus
  to find zero/low-reference exports, then read the actual test bodies (not just filenames)
  to classify each as behavioral (imports + exercises real code) vs. source-pin
  (`readFileSync` + `toContain`/`indexOf` string/ordering assertions on raw source text).
- Read the diff of each of the 7 listed peer commits (`git show <sha>`) to see exactly what
  shipped and what test coverage landed with it.
- Checked `.context/plans/deferred-carry-forward.md` and `cycle-6-2026-07-07-deferred.md` to
  avoid re-litigating already-known test-infra gaps (LR route-level coverage, admin Playwright
  coverage, DB-backed test infra, db-restore child-process spawn-mock harness — all already
  tracked as DEF-C94-04/05, DEF-C6-12, etc.). None of the findings below duplicate those.

## Findings

### C7-TE1 — `armDbChildProcessWatchdog` control-flow fix shipped with zero behavioral coverage
`[SEV: HIGH | CONF: High | test-coverage / source-pin-only]`

- File: `apps/web/src/app/[locale]/admin/db-actions.ts:60-88` (function is NOT exported).
- Commit `9cd8d3e8` reordered this watchdog's timeout handler: `onTimeout(err)` moved from
  *before* `child.stdin/stdout/stderr.destroy(err)` + `child.kill('SIGTERM')` to *after* them,
  and the returned cleanup closure's `markSettled()` call was changed from unconditional to
  `if (!fired) markSettled()`. This is real, security/reliability-relevant control flow: it
  governs whether a DB-restore/backup/migration child process actually gets destroyed/killed
  before the timeout callback fires, and whether a late-arriving `exit`/`close` event after a
  watchdog fire can spuriously clear `forceKill`'s SIGKILL grace timer.
- The ONLY coverage that shipped alongside this fix is in
  `apps/web/src/__tests__/cycle-20-source-contracts.test.ts:8-17` (also touched in the *same*
  commit) — a purely textual test:
  ```js
  const watchdog = src.slice(src.indexOf('function armDbChildProcessWatchdog'), src.indexOf('export async function exportImagesCsv'));
  expect(watchdog.indexOf("child.kill('SIGTERM')")).toBeLessThan(watchdog.indexOf('onTimeout(err)'));
  expect(watchdog.indexOf("child.kill('SIGKILL')")).toBeLessThan(watchdog.indexOf('onTimeout(err)'));
  expect(watchdog).toContain('if (!fired) markSettled()');
  expect(watchdog).not.toMatch(/\n\s*markSettled\(\);\n\s*child\.off/);
  ```
  This locks *word order in the source text*, not runtime behavior. It would pass even if, say,
  `forceKill` never actually fired SIGKILL, or if `onTimeout` were never invoked at all, or if a
  refactor split this across two functions in a way that preserved token order but broke the
  semantics.
- No other test in the repo references `armDbChildProcessWatchdog` by name (confirmed via
  `grep -rl armDbChildProcessWatchdog src/__tests__` → only `cycle-19`/`cycle-20`
  source-contract files).
- Why this matters concretely: a future edit that, say, moves `forceKill.unref?.()` before the
  `forceKill = setTimeout(...)` assignment (a real bug — you'd unref `undefined`), or that
  breaks the grace-period SIGKILL path, would sail through the entire test suite because
  nothing actually *runs* the watchdog with a fake timer and a fake child process.
- **Fix (cheap, no DB, no fs)**: this function only touches an object shaped like
  `ChildProcessWithoutNullStreams` (methods: `.once`, `.off`, `.kill`, and `.stdin/.stdout/.stderr.destroy`)
  plus `setTimeout`/`clearTimeout`. It has no I/O of its own. Following the exact precedent
  already used in this file for `escapeCsvField` ("moved to `@/lib/csv-escape` so it can be
  unit-tested without the `'use server'` async-only constraint"), export
  `armDbChildProcessWatchdog` (or extract it to a small non-`'use server'` helper module) and add
  a direct behavioral test using `vi.useFakeTimers()` + a minimal `EventEmitter`-based fake child:
  ```js
  import { EventEmitter } from 'node:events';
  function fakeChild() {
    const emitter = new EventEmitter() as ChildProcessWithoutNullStreams & EventEmitter;
    emitter.stdin = { destroy: vi.fn() } as never;
    emitter.stdout = { destroy: vi.fn() } as never;
    emitter.stderr = { destroy: vi.fn() } as never;
    emitter.kill = vi.fn();
    return emitter;
  }

  it('destroys streams and SIGTERMs before invoking onTimeout, then SIGKILLs after the grace window if unsettled', () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const onTimeout = vi.fn();
    armDbChildProcessWatchdog(child, 'test', onTimeout);

    vi.advanceTimersByTime(DB_CHILD_PROCESS_TIMEOUT_MS);
    expect(child.stdin.destroy).toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');

    vi.advanceTimersByTime(DB_CHILD_PROCESS_KILL_GRACE_MS);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('does not SIGKILL if the child settles (exit) within the grace window', () => {
    vi.useFakeTimers();
    const child = fakeChild();
    armDbChildProcessWatchdog(child, 'test', vi.fn());
    vi.advanceTimersByTime(DB_CHILD_PROCESS_TIMEOUT_MS);
    child.emit('exit');
    vi.advanceTimersByTime(DB_CHILD_PROCESS_KILL_GRACE_MS);
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
  });

  it('cleanup() after a normal (non-timeout) exit clears the timer and does not call markSettled twice', () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const cleanup = armDbChildProcessWatchdog(child, 'test', vi.fn());
    child.emit('exit');
    cleanup();
    vi.advanceTimersByTime(DB_CHILD_PROCESS_TIMEOUT_MS + DB_CHILD_PROCESS_KILL_GRACE_MS);
    expect(child.kill).not.toHaveBeenCalled(); // watchdog never fired
  });
  ```
  This is pure/deterministic (fake timers, no real process, no DB) and would have actually
  exercised the exact ordering bug this commit fixed, plus the `if (!fired) markSettled()`
  regression it introduced protection against.
- Confidence: High (confirmed via `git show 9cd8d3e8`, `grep -rl` across `__tests__/`, and
  reading the current `db-actions.ts` source). Needs-manual-validation only on the exact export
  mechanism the team prefers (inline `export function` vs. extraction to a new lib file).

### C7-TE2 — `logout()` restore-maintenance fence has no behavioral test for its two new branches
`[SEV: MED | CONF: High | test-coverage / source-pin-only]`

- File: `apps/web/src/app/actions/auth.ts:268-295`. Commit `3acf638a` wrapped the session
  verify+delete in `logout()` with `getRestoreMaintenanceMessage()` + `acquireAdminMutationSlot()`
  gates, per the commit's own stated intent: *"restore windows must block DB mutations while
  still allowing the session cookie to be cleared locally."*
- The only test added for this in the same commit is
  `apps/web/src/__tests__/auth-mutation-barrier-source.test.ts:30-47` — an `indexOf`-based
  ordering check on raw source text (same-origin index < maintenance index < slot index <
  verify index < delete index < cookie-delete index). It cannot detect whether the *branches*
  actually behave correctly (e.g., whether `cookieStore.delete` still runs when
  `maintenanceError` is truthy, or whether `db.delete(sessions)` is incorrectly still invoked).
- `apps/web/src/__tests__/auth-actions-behavior.test.ts` is the file that DOES exercise
  `logout()` behaviorally (imports the real function, mocks `getRestoreMaintenanceMessage`,
  `verifySessionTokenMock`, `dbDeleteMock`, `cookieDeleteMock`, `redirectMock` — everything
  needed is already wired up in `beforeEach`) — but it contains exactly **one** logout test
  (`logout rejects hostile origins before session verification or deletion`, line 231). There is
  no test for:
  1. The normal success path (trusted origin + valid session → `verifySessionTokenMock` called,
     `dbDeleteMock`/`dbDeleteWhereMock` called, `cookieDeleteMock` called, redirect thrown).
  2. The restore-maintenance-active path: `getRestoreMaintenanceMessageMock.mockReturnValue('restore in progress')`
     → `verifySessionTokenMock` must NOT be called, `dbDeleteMock` must NOT be called, but
     `cookieDeleteMock` MUST still be called and the redirect must still happen (this is the
     exact invariant the commit message promises and the kind of "silently over-blocked logout"
     regression a future edit could introduce without any test noticing).
- **Fix (cheap, all mocks already exist in the file)** — add to `auth-actions-behavior.test.ts`:
  ```js
  it('logout verifies and deletes the session, then clears the cookie, for a normal trusted request', async () => {
    await expect(logout(form({ locale: 'en' }))).rejects.toThrow('NEXT_REDIRECT:/en/admin');
    expect(verifySessionTokenMock).toHaveBeenCalledWith('session-token');
    expect(dbDeleteMock).toHaveBeenCalled();
    expect(cookieDeleteMock).toHaveBeenCalled();
  });

  it('logout skips session verification/deletion but still clears the cookie during restore maintenance', async () => {
    getRestoreMaintenanceMessageMock.mockReturnValue('restore in progress');
    await expect(logout(form({ locale: 'en' }))).rejects.toThrow('NEXT_REDIRECT:/en/admin');
    expect(verifySessionTokenMock).not.toHaveBeenCalled();
    expect(dbDeleteMock).not.toHaveBeenCalled();
    expect(cookieDeleteMock).toHaveBeenCalled();
  });
  ```
  (The mutation-slot-not-acquired branch is a third, lower-priority case — it needs an explicit
  `vi.mock('@/lib/admin-mutation-barrier', ...)`, which is a slightly bigger lift since that
  module isn't mocked in this file today; the two tests above are the cheap wins and cover the
  behavior the commit message explicitly promises.)
- Confidence: High. Needs-manual-validation: confirm `cookieGetMock.mockReturnValue({ value: 'session-token' })` in the existing `beforeEach` (it is, per line 185) so the success-path test needs no extra setup.

### C7-TE3 — `drizzle.config.ts` TLS-CA requirement is source-pin only; identical siblings already prove the cheap behavioral pattern
`[SEV: MED | CONF: High | test-coverage / source-pin-only]`

- File: `apps/web/drizzle.config.ts:10-17` (new in commit `05fa5cd1`). Non-local `DB_HOST` +
  `DB_SSL !== 'false'` now *throws* `'DB_SSL_CA is required for non-local DB connections unless DB_SSL=false'`
  when `DB_SSL_CA` is unset, and otherwise resolves `{ ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true }`
  into `dbCredentials.ssl`.
- The only test that shipped with it, `apps/web/src/__tests__/drizzle-tls-source.test.ts`, is
  100% source-pin: `expect(config).toContain('readFileSync')`, `.toContain("ca: readFileSync(caPath, 'utf8')")`, etc.
  It never actually imports/evaluates `drizzle.config.ts`, so it cannot catch e.g. a typo that
  reads the wrong env var, an inverted `isLocalhost` condition, or the throw firing on the wrong
  branch.
- This is a **directly cheap fix** because the exact same requirement already has full
  behavioral coverage for its two siblings:
  - `apps/web/src/__tests__/mysql-runtime-ssl.test.ts` (runtime pool path, `db/index.ts`) —
    creates a temp CA file with `mkdtempSync`/`writeFileSync`, calls
    `getMysqlConnectionOptions({ host, sslCa })`, and asserts `options.ssl` / the thrown error.
  - `apps/web/src/__tests__/mysql-cli-ssl.test.ts` (CLI script path) — same pattern.
  - I verified `drizzle-kit`'s `defineConfig` is a plain identity function (`node -e "console.log(require('drizzle-kit').defineConfig({a:1}))"` → `{ a: 1 }`), so dynamically importing `drizzle.config.ts` after setting env vars and writing a temp CA file will yield the real resolved `dbCredentials` object with no drizzle-kit CLI side effects.
- **Fix**, mirroring `mysql-runtime-ssl.test.ts`'s existing pattern exactly:
  ```js
  import { mkdtempSync, writeFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import path from 'node:path';

  async function loadConfig() {
    vi.resetModules();
    const mod = await import('../../drizzle.config');
    return mod.default as { dbCredentials: { ssl?: { ca: string; rejectUnauthorized: boolean } } };
  }

  it('throws when DB_SSL_CA is missing for a non-local DB_HOST', async () => {
    process.env.DB_HOST = 'db.example.test';
    delete process.env.DB_SSL_CA;
    delete process.env.DB_SSL;
    await expect(loadConfig()).rejects.toThrow(/DB_SSL_CA is required/);
  });

  it('loads the configured CA for a non-local DB_HOST', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'drizzle-ca-'));
    const caPath = path.join(dir, 'ca.pem');
    writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n');
    process.env.DB_HOST = 'db.example.test';
    process.env.DB_SSL_CA = caPath;
    const config = await loadConfig();
    expect(config.dbCredentials.ssl).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n',
      rejectUnauthorized: true,
    });
  });

  it('has no ssl block for localhost or DB_SSL=false', async () => {
    process.env.DB_HOST = '127.0.0.1';
    expect((await loadConfig()).dbCredentials.ssl).toBeUndefined();
  });
  ```
  (Needs `beforeEach`/`afterEach` env snapshot/restore like the sibling files already do.)
- Confidence: High — feasibility spot-checked (`defineConfig` identity confirmed above); the
  identical pattern already exists twice in this repo for the same env-var contract.

### C7-TE4 — `getColorSettingsHash` never tested for the documented `image_sizes` order-independence invariant
`[SEV: LOW | CONF: High | missing edge case]`

- File: `apps/web/src/lib/settings-hash.ts:96` — `image_sizes: (config) => [...config.imageSizes].sort((a, b) => a - b).join(',')`.
  CLAUDE.md documents this explicitly: *"`image_sizes` is sorted ascending before hashing so that
  `[640,1536]` and `[1536,640]` produce the same hash — the admin UI stores the array in display
  order, but the encoder normalizes before hashing to prevent spurious invalidation (AGG-R7C3-02)."*
- `apps/web/src/__tests__/settings-hash.test.ts` is otherwise exhaustive — every other
  `COLOR_IMPACTING_KEYS` member has an explicit "differs when X changes" test, plus the C6-02
  loop that flips every key through `getColorSettingsHash(config)` — but no test ever passes an
  *unsorted* `imageSizes` array through `getColorSettingsHash` to confirm the order-independence
  claim. This is exactly the kind of documented invariant that a later refactor (e.g. someone
  "simplifying" `buildHashFromConfig` by removing the `.sort()`) could silently break, causing
  spurious 304→200 ETag churn across the fleet after every settings-array reorder — the
  regression the sort exists to prevent.
- **Fix** (2-3 lines, drop into the existing `describe('color settings hash (P4-E2)')` block):
  ```js
  it('AGG-R7C3-02: is order-independent for imageSizes (display-order array hashes same as sorted)', async () => {
    const base = { /* ...same GalleryConfig fixture already used above... */ };
    const ascending = await getColorSettingsHash({ ...base, imageSizes: [640, 1536, 2048] });
    const displayOrder = await getColorSettingsHash({ ...base, imageSizes: [1536, 640, 2048] });
    expect(displayOrder).toBe(ascending);
  });
  ```
- Confidence: High.

### C7-TE5 — `purgeOldViewEvents`'s `MAX_BATCHES_PER_TABLE` safety cap is untested
`[SEV: MED | CONF: High | missing edge case (safety invariant)]`

- File: `apps/web/src/lib/view-retention.ts:37,77` — `MAX_BATCHES_PER_TABLE = 200` bounds the
  per-table chunked-DELETE loop specifically so "an unexpectedly huge backlog can't spin the
  hourly job indefinitely."
- `apps/web/src/__tests__/view-retention.test.ts` is otherwise very thorough (negative/NaN/
  scientific-notation env parsing, chunked-DELETE-until-drained behavior) but every scenario
  uses at most 2 iterations per table (`5000` then `10`). Nothing exercises the case where every
  batch keeps returning `affectedRows: VIEW_PURGE_BATCH` (5000) forever — i.e., whether the loop
  actually stops at 200 iterations per table (600 total across 3 tables) instead of looping
  unboundedly (which, on a real unbounded backlog, is exactly the DoS-adjacent scenario this
  constant exists to prevent).
- **Fix**, using the exact same `limitMock.mockImplementation` pattern already in the file's last test:
  ```js
  it('stops at MAX_BATCHES_PER_TABLE iterations per table when the backlog never drains below the cap (safety ceiling)', async () => {
    limitMock.mockImplementation(async () => ({ affectedRows: 5000 })); // never drains
    const total = await purgeOldViewEvents();
    // 3 tables x 200 batches x 5000 rows, and the DELETE call count is bounded too.
    expect(limitMock).toHaveBeenCalledTimes(200 * 3);
    expect(total).toBe(200 * 5000 * 3);
  });
  ```
- Confidence: High. This is a pure logic/mock test, no DB needed (mirrors the file's existing
  mock harness exactly).

### C7-TE6 (LOW priority, optional) — `sql-restore-scan` case-insensitive identifier matching is unverified by test
`[SEV: LOW | CONF: Med | missing edge case]`

- File: `apps/web/src/lib/sql-restore-scan.ts:227-233` (`normalizeSqlIdentifier` lowercases
  before comparing against `APP_BACKUP_TABLE_SET`). Code inspection shows this is already
  correct, but no test in `sql-restore-scan.test.ts` exercises a mixed-/upper-case unquoted
  table name (e.g. `CREATE TABLE Images (id INT);` or `INSERT INTO IMAGES VALUES (1);`) to lock
  it against a future regression (e.g. someone changing the allowlist `Set` to case-sensitive
  or removing the `.toLowerCase()`).
- **Fix**: one line dropped into the existing "allows restore writes to known app tables in the
  current schema" test's statement array: `'INSERT INTO Images VALUES (1);'`,
  `'CREATE TABLE IMAGES (id INT);'` → expect `containsDangerousSql(...) === false`.
- Confidence: Medium (real gap, but low severity/likelihood since mysqldump output is always
  lower/backtick-quoted in practice, so this mainly guards a hypothetical hand-authored restore
  file).

## Not re-reporting (already known/deferred)

- `db-restore.test.ts`'s source-pin coverage of the restore/dump control flow
  (`DEF-C6-12`, cycle-6 deferred register) — acknowledged there as requiring a
  `child_process.spawn` mock harness, explicitly deferred as a test-infra investment. C7-TE1
  above is a narrower, cheaper slice of the same class of gap (a pure helper function that does
  NOT need a spawn mock, only a fake `ChildProcessWithoutNullStreams`-shaped EventEmitter), so I
  am reporting it as new/actionable rather than folding it into the deferred item.
- LR upload route-level behavior coverage and admin Playwright coverage
  (`C94-04`/`C93-05`, `C94-05`/`C93-06`) — already tracked, no new evidence found this cycle.
- Admin bulk-apply latency / DB-backed test infra (`C6-05`) — already tracked, no new evidence.
- The general prevalence of `readFileSync`-based "source contract" tests across ~45% of the test
  suite (158/354 files) is a deliberate, longstanding architecture choice for this codebase
  (many are legitimate architecture-invariant fixture scans — e.g. `check-api-auth.test.ts`,
  `touch-target-audit.test.ts` — not weak tests), and the project has no `jsdom`/Testing-Library
  setup (`vitest.config.ts` runs Node-only), so React-component behavioral testing is a
  structural investment, not a cheap fix. I did not blanket-flag this; C7-TE1/TE2/TE3 above are
  the specific instances where (a) the underlying logic is pure/dependency-light, (b) a
  behavioral test is cheap, and (c) an near-identical sibling test in this exact repo already
  proves the pattern is practical.

## Flaky-test check

- Full suite run fresh this session: `npm test --workspace=apps/web` → **347 files passed, 2
  skipped (349); 3198 tests passed, 4 skipped, 0 failed**, ~11.7s. The 4 skipped tests are the
  documented env-gated CLIP preflight suites (`clip-semantic-integration.test.ts`,
  `clip-offline-load.test.ts`), not flakiness.
- Searched for common flakiness sources: no `it.skip`/`describe.only`/`.todo` markers found; no
  real (`await new Promise(r => setTimeout(...))`) timing waits found — timing-sensitive tests
  consistently use `vi.useFakeTimers()` + `vi.advanceTimersByTime`/`vi.setSystemTime`. No
  evidence of flakiness in this pass; not flagging any specific test as flaky.

## Final sweep for commonly-missed issues

Confirmed read/checked (not just filename-grepped) for the 9 assigned critical modules:
`image-queue.ts` (+ its 13 test files: bootstrap, cleanup, concurrency-cap, delete-race,
embed-wiring, gc-timer-reinit, permanent-failure(-cleanup), processing-retry-backoff, quiesce,
r10c1-contracts, settings-wiring) — well covered, only the pool-budget formula tests were
inspected in depth (solid); `process-image.ts` (+ ~15 test files covering blur-wiring,
color-roundtrip, dimensions, exif-strip, icc-options-lockin, max-input-pixels-env, metadata,
orientation, p3-icc, post-encode-verification, raw-rejection, variant-scan, webp-lossless-detect)
— strong, real Sharp-backed behavioral tests throughout, no gaps found beyond what's listed
above; `sql-restore-scan.ts` — exceptionally thorough (322-line test file, byte-boundary/token-
split adversarial cases already covered) aside from C7-TE6; `settings-hash.ts` — thorough aside
from C7-TE4; `data.ts` privacy guards (`privacy-fields.test.ts`) — excellent design, real
imports + guarded source-extraction with an anti-vacuous-pass sentinel
(`assertSelectBlockCaptured`), no gap found; `view-retention.ts` — thorough aside from C7-TE5;
`gps-exif-strip.ts` (+ `strip-gps-from-original.test.ts`, `gps-exif-strip-isobmff.test.ts`) —
the best-tested module in this set, real Sharp/exif-reader round-trips, byte-identical pixel
assertions, adversarial split-token/trailer cases; `admin-backfill-runner.ts` — thorough
(`resolveBackfillConcurrency` fully covered; `getAdminBackfillCandidateCount`'s real DB query
body is untestable without DB infra, consistent with the already-known DB-test-infra
limitation, not a new gap); `image-url.ts`/image-base-url (`image-url.test.ts`,
`csp-malformed-image-base-url.test.ts`) — excellent, real behavioral coverage including the
credential-stripping and malformed-URL fallback paths, aside from the sibling gap in C7-TE3.

Also read the full diff of all 7 listed freshly-landed peer commits (`14d31ea4`, `9cd8d3e8`,
`d8fcb3d6`, `57e2c5d3`, `4d37daa4`, `05fa5cd1`, `3acf638a`) rather than relying on `--stat`
alone; `d8fcb3d6` (host-preference origin fix) has genuinely strong behavioral test coverage
added in the same commit (real `hasTrustedSameOrigin()` calls with header fixtures, not source-
pin) — flagged as a positive contrast to C7-TE1/TE2/TE3, not a gap.

Noted but not reported on (per shared-worktree rules — peer-dirty, in-flight, note only):
`apps/web/src/__tests__/cycle12-ops-contracts.test.ts` and `scripts/check-proxy-topology.mjs`
are uncommitted working-tree edits (peer's in-flight work) that add wording clarifying the
proxy-topology probe cannot prove real client-IP/X-Forwarded-For overwrite behavior at the edge
— a documentation-honesty improvement to an already-known-limited operational script, not a
test-suite change; no action taken.

No blocking issues found; all 6 findings above are additive test-coverage improvements, not bug
reports (aside from the fact that C7-TE1/TE2 cover code paths that changed control flow this
cycle with only textual test coverage backing them).
