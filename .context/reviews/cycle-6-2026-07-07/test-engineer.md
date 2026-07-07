# test-engineer review — cycle 6

Baseline: committed HEAD `583277fb`. Prior test-engineering context read and treated as
known (not re-derived unless new evidence): `.context/plans/deferred-carry-forward.md`
(rows C4-18 component-behavior harness, C94-04 LR route-level coverage, C94-05 admin
Playwright coverage, C4-30 share-limiter e2e reset — all still open per that register),
`.context/reviews/_aggregate.md` cycle-10 items AGG-C10-07 through AGG-C10-11 (migrate-
reconcile structural coverage, CLIP real-model gating, bottom-sheet-dropdown source-only
lock, touch-target bare-link gap, nav-visual-check screenshots-without-oracle — all still
open, none fixed as of this HEAD), and my own immediately-prior lane report
`.context/reviews/cycle-5-2026-07-07/test-engineer.md` (F1-F6).

## Summary

The suite is large (345 Vitest files, 12 Playwright specs) and much of the low-hanging
coverage work from earlier cycles is done. The genuinely new material this cycle is a
**recurring shape**: several fixes landed since the cycle-5 baseline (commits `d4bccea2`,
`cae5fbd9`, `20e9048e`) for security/reliability-critical failure paths (LR PAT upload
route, DB restore child-process failure handling, photo-viewer hydration), and in every
case the new regression lock is a `readFileSync` + string/ordering assertion against the
source file rather than a test that actually drives the failure path and observes real
behavior. One of these (the LR upload route) *does* now have a genuine request/response
behavioral harness (new this cycle) — but it exercises only 2 of the route's many branches,
leaving the rest on the old source-only net despite the harness now existing to test them
cheaply. I also confirmed three of my own cycle-5 findings (F1, F2, F3) are still open and
unaddressed at current HEAD.

Findings by severity: 0 CRIT, 0 HIGH, 3 MED, 2 LOW-MED, 1 LOW/INFO (quantification only).

## Findings

### F1 — LR upload route's new real-behavior harness covers only 2 of the route's many failure branches; the rest remain source-string-only despite the harness now existing

**[SEV: MED | CONF: High | file: `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:1-279`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:63-269`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-145`]**

This cycle (`d4bccea2` +200 lines, `44ab13c4` +79 lines) added a genuine behavioral test
harness for the Lightroom PAT upload route: it constructs a real `NextRequest`, invokes the
exported `POST` handler, and asserts on the real `Response` (status, JSON body, and that
mocked collaborators were called with the right arguments). This is real progress toward
closing the long-tracked C94-04 carry-forward item ("LR route-level behavior coverage").

But the harness only covers two scenarios: (a) late HDR-policy rejection with cleanup, and
(b) the PAT-actor happy path through to a successful insert. The route (612 lines) has
several other branches that are security- or reliability-relevant and are guarded *only* by
`lr-upload-hdr-gate.test.ts`'s `readFileSync(...).toMatch()/.toContain()/.indexOf()` source
assertions, which can pass even if the actual runtime comparison is broken (wrong operator,
inverted condition, or a branch that can never be reached):

- `route.ts:94` and `route.ts:257` — two separate `isRestoreMaintenanceActive()` guards
  (503 `Restore in progress`). The behavior test's mock for `@/lib/restore-maintenance`
  always returns `false` (line 112-115 of the behavior test), so neither guard is ever
  exercised with `true`. Only pinned textually by `lr-upload-hdr-gate.test.ts:191-208`.
- `route.ts:139` — `tracker.count + 1 > UPLOAD_MAX_FILES_PER_WINDOW` (429 quota rejection).
  The behavior test never drives the tracker map to the cap before calling `POST`. Only
  pinned textually by `lr-upload-hdr-gate.test.ts:269,287`.
- `route.ts:323-335` (`statfs` disk-space precheck, `stats.bavail`). The behavior test's
  `statfsMock` always returns ample space (`bavail: 2_000_000`); no test drives it low
  enough to trigger the rejection. Only pinned textually by
  `lr-upload-hdr-gate.test.ts:230-247`.
- Content-Length / chunked-transfer-encoding validation (`route.ts:101-118`, 411 responses)
  — not exercised by the behavior test at all (both existing tests set a valid
  `content-length` header); no source-contract test covers this branch either as far as I
  could find, so it may currently have **zero** net of any kind.
- The GPS-strip fail-closed 422 path (`route.ts` — `stripGpsFromOriginal` returns false) is
  also source-only (`lr-upload-hdr-gate.test.ts:106-111`); the behavior test's
  `stripGpsFromOriginal` mock always resolves `true`.

**Failure scenario:** a future refactor of the quota check (e.g. `>=` vs `>`, or a
copy-paste that compares `tracker.bytes` instead of `tracker.count`), the restore-maintenance
guard (e.g. accidentally removing the second check at line 257 that exists specifically to
catch a restore starting mid-upload), or the disk-space arithmetic (`bavail * bsize`) would
leave every literal string the source-contract test looks for intact, so the CI gate stays
green while the real behavior silently regresses — e.g. uploads proceeding during an active
restore, or a full disk producing a confusing downstream write failure instead of the clean
507 rejection.

**Suggested fix:** the mocking infrastructure to do this cheaply already exists in the same
file. Add 4 more `it()` blocks to `lr-upload-route-behavior.test.ts`: (1) set
`isRestoreMaintenanceActiveMock` (currently hardcoded in the `vi.mock` factory — needs to
become a `vi.fn()` so it can be overridden per-test) to `true` and assert 503 without ever
reaching `saveOriginalAndGetMetadataMock`; (2) pre-seed `uploadTracker` with
`count: UPLOAD_MAX_FILES_PER_WINDOW` for the actor's key before calling `POST` and assert
429; (3) set `statfsMock` to return a small `bavail` and assert the disk-space rejection
status/body; (4) send a request with `transfer-encoding: chunked` or an omitted/zero
`content-length` header and assert 411.

### F2 — DB-restore child-process failure/cleanup path is locked only by source text, not by simulating a real spawn/timeout/stdin failure

**[SEV: MED | CONF: High | file: `apps/web/src/__tests__/db-restore.test.ts:47-76`, `apps/web/src/app/[locale]/admin/db-actions.ts:783-796`]**

`d4bccea2` added `db-restore.test.ts:56-76` ("keeps maintenance active and cleans temp state
on mysql child failure paths"), which slices `DB_ACTIONS_SRC` (a `readFileSync` of the whole
`db-actions.ts` file) around the `failRestore` function body and asserts it *textually
contains* `clearRestoreWatchdog();`, `readStream.destroy();`, `restore.stdin.destroy();`,
`restore.kill();`, `cleanupTempFile();`, and `keepMaintenance: true`, then asserts each of
the 4 call-sites (timeout, read-error, stdin-error, spawn-error) textually calls
`failRestore(...)`. This is the restore-path equivalent of the LR upload route pattern in
F1: it proves the literal code fragments exist and are wired to the right call sites in
*source order*, but never actually triggers a mysql child-process `error`/`close`/timeout
event and observes that `restore.kill()` is genuinely invoked, that the temp file is
genuinely unlinked, or that a subsequent restore attempt genuinely sees
`keepMaintenance: true` propagate through to the caller. The rest of `db-restore.test.ts`
(the `hasPlausibleSqlDumpHeader`, `isIgnorableRestoreStdinError`, `isMysqldumpArtifactHeader`,
`hasMysqldumpCompletionTrailer` describe blocks) *are* real behavioral unit tests of pure
exported helpers — this gap is specific to the orchestration function itself
(`restoreDatabase`'s child-process wiring), which is understandably harder to unit test
because it spawns a real `mysql` child process and touches the DB advisory-lock connection.

**Failure scenario:** a future edit to `failRestore` (e.g., reordering so
`cleanupTempFile()` runs before `restore.kill()`, or a bug where `readStream.destroy()` is
called but not awaited/handled and throws inside the callback, swallowing the rest of the
cleanup) would leave every literal string the test looks for intact — the test greps for
presence, not order-of-execution-at-runtime or actual side effects — so CI stays green while
a real restore failure could leak the temp SQL dump file on disk or leave the DB
child-process orphaned.

**Suggested fix:** add a `child_process.spawn` mock (this repo's other tests already mock
`fs/promises` and similar Node builtins the same way, e.g.
`lr-upload-route-behavior.test.ts:41-44`) that returns a fake `ChildProcess`-like object
with `stdin`, `kill`, and event emission. Drive it to emit a `'error'` (spawn failure) and
separately a timeout via the watchdog, then assert on the *mock's* `kill`/`stdin.destroy`
call counts and that the temp file cleanup mock was actually invoked — not on the source
text of the handler that's supposed to do it.

### F3 — Two more source-string tests landed this cycle for the same client-hydration/interaction class my own cycle-5 review already flagged as undertested, and the underlying tautological e2e assertion (my cycle-5 F2) is still unfixed

**[SEV: LOW-MED | CONF: High | file: `apps/web/src/__tests__/photo-viewer-auto-lightbox-source.test.ts:1-22` (new file, `cae5fbd9`), `apps/web/src/__tests__/image-zoom-source-contracts.test.ts:18-22` (extended, `cae5fbd9`), `apps/web/e2e/hydration-photo-page.spec.ts:44-49`]**

`cae5fbd9` fixed a real hydration bug (photo-viewer's `showLightbox` initial state read
`sessionStorage` inside the `useState` lazy initializer, causing an SSR/client mismatch) by
moving the read into a post-mount effect, and separately fixed a click-to-zoom regression
(the container's own `role="button"` was matching its own `target.closest('[role="button"]')`
guard, silently eating clicks). Both fixes are good and each got a new/extended test — but
both tests are pure `readFileSync` + `.toContain()`/`.indexOf()` ordering checks against the
component source, not a rendered-DOM or interaction test. This is the same C4-18 gap
(no jsdom/RTL harness in this repo — `apps/web/package.json` still lists only `vitest`, no
`@testing-library/*` or `jsdom`/`happy-dom`) producing fresh, concrete instances rather than
new evidence of a novel class of gap; flagging because these two files did not exist at the
time of the cycle-10 or cycle-5 test-engineer passes and are exactly the kind of "next
component-behavior-only source-pin" the carry-forward register (`C4-18`) asks to be
evaluated against.

Separately and more concretely: my own cycle-5 review (F2) flagged
`apps/web/e2e/hydration-photo-page.spec.ts:47-49` as tautological — the assertion
`getByRole('button', { name: /pinned/i }).or(getByRole('button', { name: /info/i })).first()`
accepts either of the toolbar's only two possible button labels, so it can never fail
regardless of whether the pin-state restoration effect actually runs. I re-checked at current
HEAD: the file is untouched since before the cycle-5 baseline (`git log` shows its last two
commits are `4afacfa8`/`9a61d454`, both older than `d9bcbf4c`), so this remains open. Given
`cae5fbd9` specifically touched the exact code this test exercises (the sessionStorage
restore effect) and did not fix the test, a regression that inverts or drops the new
`autoLightboxRestoredRef` mount effect (e.g., the effect never firing, or firing before
`sessionStorage` is available) would still show a passing e2e suite: the hydration-error-count
assertion above it only detects the *mismatch* class of bug, not "restoration silently stopped
happening" specifically.

**Suggested fix:** (unchanged from cycle-5) replace the `.or()` with a single assertion on
`getByRole('button', { name: /pinned/i })`, since the spec's fixed 1440×900 viewport with no
seeded `sessionStorage` deterministically produces the pinned state once restored. For the
two new source-contract tests, no immediate action is required beyond tracking them under the
existing C4-18 carry-forward — they are reasonable given the harness gap, just worth counting.

## Previously-known items re-confirmed still open (no new finding, citing for completeness)

- **Cycle-5 F1** (image-zoom touchmove/passive-listener regression, `image-zoom.tsx:262-319`):
  still zero coverage. `grep -rn "passive: false" apps/web/src/__tests__/*.ts` returns nothing.
- **Cycle-5 F3** (`updateGallerySettings` → `invalidateDetachedGalleryConfigCache()` wiring):
  still untested. `grep -rln "updateGallerySettings" apps/web/src/__tests__/*.ts` still only
  matches `settings-backfill-required-action.test.ts` and
  `settings-semantic-mode-action.test.ts`, neither of which touches this call site.
- **C94-05** (admin Playwright coverage): `apps/web/e2e/admin.spec.ts` is still 166 lines / 7
  `test()` blocks (login-redirect, login/nav, wrong-password, GPS toggle, topic create/delete,
  upload workflow). Tags, Tokens (LR PAT admin UI), Smart Collections, DB backup/restore, and
  semantic-search settings admin surfaces remain e2e-untested.
- **AGG-C10-07/08/09/10/11** (migrate-reconcile structural parity, CLIP real-model CI gating,
  bottom-sheet-dropdown source-only lock, touch-target bare-link gap, nav-visual-check
  screenshots without an oracle): all confirmed still open at this HEAD (the only commits
  since cycle-10's review are `583277fb`, a scheduling/plan doc commit with no source changes).

## Lower-confidence / secondary observation

### F4 — Privacy-field aliasing guards check source text/regex rather than the imported runtime objects that are already available in the same file

**[SEV: LOW | CONF: Medium | file: `apps/web/src/__tests__/privacy-fields.test.ts:9-24, 179-235`]**

`44ab13c4` and `09a0dcd3` added tests that check `publicSelectFields`/`searchFields`/
`timelineSelectFields`/`searchEnrichmentSelectFields` never alias a public key name to a
sensitive `images.<col>` reference. Both new tests do this by `readFileSync`-ing
`data.ts`/`data-timeline.ts`/`search-enrichment-fields.ts` and regex-matching
`` `\\b[A-Za-z0-9_]+\\s*:\\s*images\\.${key}\\b` `` against a source slice, even though the file
already imports the real runtime objects (`searchEnrichmentSelectFields` is imported at the
top and was already used by an earlier, pre-existing test in the same file for a by-name
check). Checking source text for `images.<col>` is a defensible choice for the *value* side
of the check (Drizzle's column proxy objects aren't trivially introspectable back to a bare
column name without relying on internal API surface), so I'm not confident a purely-runtime
replacement is strictly better without checking whether Drizzle's `MySqlColumn` exposes a
stable public `.name`/`.field` accessor — flagging this as a residual gap rather than a clear
defect. The concrete risk: the regex assumes the sensitive table is always referenced via the
literal identifier `images` (e.g. `images.latitude`); a differently-aliased import
(`import { images as img } from '@/db/schema'`) or a spread from an intermediate object would
not match `images\.${key}` and would silently pass the guard while still leaking the column.
Given every other file in this codebase imports the table as `images` consistently, likelihood
is low, but since this guard backs a documented, security-relevant invariant (no GPS/PII in
public/search-enrichment fields), it's worth a comment noting the alias assumption, or (if
Drizzle's column object does expose a stable `.name`) switching to a runtime column-identity
check that isn't defeated by import naming.

## Quantification (supporting evidence for the existing C4-18 carry-forward item)

53 of 345 Vitest files under `apps/web/src/__tests__/` use the
`readFileSync(resolve(__dirname, ...))` source-pinning idiom (roughly 1 in 6-7 test files).
This is a known, already-tracked architectural gap (`C4-18`: no jsdom/RTL harness exists in
this repo), not a new finding — reporting the count because two fresh instances landed this
cycle (F3) with no exit-criteria movement on the underlying gap.

## Files examined (inventory)

Built the full inventory via `find apps/web/src/__tests__ -name '*.ts'` (345 files) and
`find apps/web/e2e -type f` (12 files, including 2 fixture images and a `helpers.ts`). Read
prior-context registers in full: `.context/plans/deferred-carry-forward.md`,
`.context/reviews/_aggregate.md`, `.context/reviews/cycle-5-2026-07-07/test-engineer.md`,
`.context/reviews/cycle10-2026-07-07/test-engineer.md`. Diffed and read in full every
non-doc-only commit between the cycle-5 baseline (`d9bcbf4c`) and current HEAD
(`583277fb`): `00c8b282`, `d4bccea2`, `a602fc0f`, `f2a8c530`, `cae5fbd9`, `eca55414`,
`44ab13c4`, `20e9048e`, `09a0dcd3`, plus the doc-only cycle-10 review/schedule commits
(`2c610340`..`583277fb`) to confirm no additional source or test changes were hidden in
them.

Read in full: `apps/web/src/__tests__/lr-upload-route-behavior.test.ts`,
`apps/web/src/__tests__/lr-upload-hdr-gate.test.ts` (relevant sections),
`apps/web/src/__tests__/db-restore.test.ts`, `apps/web/src/__tests__/image-list-cursor.test.ts`,
`apps/web/src/__tests__/migrate-pending-migrations.test.ts` (new test),
`apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/__tests__/background-db-writes.test.ts`,
`apps/web/e2e/hydration-photo-page.spec.ts`, `apps/web/e2e/admin.spec.ts`,
`apps/web/src/app/api/admin/lr/upload/route.ts`,
`apps/web/src/app/[locale]/admin/db-actions.ts` (restore section),
`apps/web/src/components/photo-viewer.tsx` and `image-zoom.tsx` (diffed sections),
`apps/web/src/lib/background-db-writes.ts`, `apps/web/scripts/migrate.js` (new preflight
function). Spot-checked for the "commonly missed" sweep below:
`apps/web/src/__tests__/color-pipeline-decision.test.ts`, `color-detection.test.ts`,
`gain-map-detection.test.ts`, `icc-chromaticity.test.ts` (all real behavioral tests, no
readFileSync, no findings), `apps/web/src/__tests__/rate-limit.test.ts` and
`auth-rate-limit.test.ts` (real behavioral tests covering IP normalization, bucket math,
proxy-hop trust, account/IP rollback — no findings).

## Final sweep (commonly-missed) notes

- No `.only`/`test.only`/`describe.only` anywhere in `apps/web/src/__tests__` or
  `apps/web/e2e` (re-confirmed at current HEAD).
- All `.skip` usages remain conditional and documented: the two CLIP real-model suites
  (env-gated, by design — AGG-C10-08/TE-01, already tracked) and admin/origin-guard e2e
  local opt-outs (`CI !== 'true'` / `E2E_ADMIN_ENABLED` / missing baseURL guards).
- Color pipeline and rate-limiting — two of the six named critical-path areas in this
  cycle's assignment — both have solid, real behavioral test coverage with no new findings;
  the gaps this cycle cluster specifically around **failure/edge-branch coverage of
  multi-step server-side orchestration functions** (LR upload route, DB restore) rather
  than pure-function logic, which this repo already tests well.
- Peer-dirty files (`schema.ts`, `image-queue.ts`, `data.ts`, `maintenance-scheduler.ts`,
  `public.ts`, etc.) were read only to understand already-committed history
  (`git show <commit>:<path>`) for context on F1/F2's supporting analysis; no findings in
  this report depend on their current uncommitted working-tree state, and none of the test
  files this report proposes changes to are on the peer-dirty list.
