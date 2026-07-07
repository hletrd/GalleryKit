# Verifier — Cycle 8 (2026-07-07)

Scope: evidence-based check of documented/commented/tested behavioral claims vs. actual
implementation, at HEAD `6256a988` (plus uncommitted-at-review-time restore-scan/search
commits `f09c97ee`, `9f416f01`, `f3cafa9c`, `584417f5`). Read-only — no source files modified;
this file is the only write.

Method: for each assigned claim, read the exact code the claim describes, cross-referenced
against `node_modules/drizzle-orm` internals where the claim makes assertions about a
third-party library, and against the pinning tests to check they assert the claimed behavior
(not a weaker proxy). Ran the directly relevant test files read-only
(`sql-restore-scan`, `migrate-pending-migrations`, `settings-hash`, `data-tag-names-sql`,
`advisory-lock-release-contract` — 5 files / 77 tests, all pass) to confirm current green
state before reasoning about gaps the tests don't cover.

I checked `.context/plans/deferred-carry-forward.md` first; none of the findings below
duplicate an open carry-forward row.

---

## Findings

### VER8-01 — migrate.js comment misstates the non-monotonic journal example date (LOW / High confidence)

**Claim (code comment):** `apps/web/scripts/migrate.js:769-770` (inside
`baselineAllJournalMigrations`'s JSDoc):

> "The journal in this repo has non-monotonic `when` timestamps (idx 6 lands in 2026-04 while
> idx 7-17 land in 2025-05)."

**Actual code:** `apps/web/drizzle/meta/_journal.json`, entry idx 6
(`0006_admin_tokens`) has `"when": 1778304060000`, which converts to
**2026-05-09 05:21:00 UTC**, not 2026-04. (idx 5, `0005_topics_map_visible`, is the one that
lands in April: `1778304000000` → 2026-05-09 05:20:00 UTC as well, actually — both idx 5 and 6
land in *May* 2026; there is no journal entry in April 2026 at all. The nearest April-adjacent
entry is idx 1, `0001_sync_current_schema`, at `1776114026325` → 2026-04-13.)

**Verification:**
```
idx 5  0005_topics_map_visible        1778304000000  -> 2026-05-09 05:20:00 UTC
idx 6  0006_admin_tokens              1778304060000  -> 2026-05-09 05:21:00 UTC
idx 7  0007_image_reactions           1746144000000  -> 2025-05-02 00:00:00 UTC
```
The comment's substantive point (the journal is genuinely non-monotonic, idx 6 → idx 7 drops
from 2026 to 2025) is correct and I independently confirmed it holds for the full 30-entry
journal. Only the specific "2026-04" month figure is wrong — it should read "2026-05" (or
just "2026").

**Why it matters:** this comment is the one place in the codebase that explains, with a
concrete example, why `migrate.js`'s baseline/pending-vs-drift machinery exists at all. A
future maintainer debugging a stuck migration who checks the comment's claimed dates against
the actual journal (as I just did) will find a month-off discrepancy and may doubt the rest of
the (otherwise accurate) explanation.

**Fix:** change `2026-04` to `2026-05` (or drop the specific month and just say "2026") in the
comment at `migrate.js:769`.

**Severity:** LOW (comment-only, no behavioral impact — `journalSqlContainsDml`,
`baselineAllJournalMigrations`, and `prepareLegacyDatabaseIfNeeded` all correctly use the raw
`entry.when` values, not the prose example). **Confidence:** High (verified by direct
timestamp conversion of the committed journal file).

---

### VER8-02 — DB-restore SQL scanner's chunk loop can silently SKIP file bytes on a short read, undermining the just-shipped chunk-boundary fixes (MEDIUM-HIGH / Medium confidence)

**Claim:** commits `f09c97ee` ("close SQL scanner intra-keyword chunk-boundary evasion") and
`9f416f01` ("accumulate the raw scan suffix across short reads") both fix — and the new tests
in `apps/web/src/__tests__/sql-restore-scan.test.ts` (lines 291-349) both assert — that the
dangerous-SQL restore scanner correctly detects a keyword split across chunk boundaries,
including across **three separate short reads** (`"DR" | "OP TAB" | "LE images;"`). The commit
message for `9f416f01` explicitly frames this as closing an evasion caused by "a
legally-possible short `fd.read()`". The security-reviewer's cycle-8 review (`security-reviewer.md`
§"SQL-restore-scan chunk-boundary evasion fix") independently confirmed the `appendSqlScanChunk`
fix and its call-site threading (`scanRawSuffix` in `db-actions.ts`) are correct, and reports
"this closes a real, if narrow and admin-authenticated-only, evasion window" — i.e., the class
of bug is treated as closed.

**Actual code:** the caller loop, `apps/web/src/app/[locale]/admin/db-actions.ts:694-716`:
```js
for (let off = 0; off < fileSize; off += CHUNK_SIZE) {
    const readSize = Math.min(CHUNK_SIZE, fileSize - off);
    const chunkBuf = Buffer.alloc(readSize);
    const { bytesRead } = await scanFd.read(chunkBuf, 0, readSize, off);
    if (bytesRead === 0) break;
    const chunk = chunkBuf.subarray(0, bytesRead).toString('utf8');
    const { combined, nextTail, nextRawSuffix } = appendSqlScanChunk(scanTail, chunk, SQL_SCAN_TAIL_BYTES, scanRawSuffix);
    ...
    scanTail = nextTail;
    scanRawSuffix = nextRawSuffix;
}
```
The loop advances the file position by the FIXED `CHUNK_SIZE` every iteration
(`off += CHUNK_SIZE`), regardless of how many bytes `scanFd.read()` actually returned. If a
read away from EOF returns fewer bytes than requested (`bytesRead < readSize`, with
`readSize === CHUNK_SIZE` since we're not at EOF) — precisely the "legally-possible short
`fd.read()`" scenario the two commits' own comments and tests explicitly anticipate — the next
iteration starts at `off + CHUNK_SIZE`, **not** `off + bytesRead`. The `CHUNK_SIZE - bytesRead`
bytes between those two positions are never read by any iteration: they are not merely
mis-tokenized across a chunk boundary (which is what the recent fixes address), they are
**never scanned at all**. A dangerous statement (`DROP TABLE`, `GRANT`, `CREATE USER`, …)
landing entirely inside such a gap would pass `containsDangerousSql` undetected regardless of
the chunk-boundary bridging logic, because the bytes are absent from `combined` on every call.

I confirmed this is not merely theoretical bookkeeping: `git show f09c97ee` shows the loop's
`for (let off = 0; off < fileSize; off += CHUNK_SIZE)` line is untouched by either restore-scan
fix — only the `appendSqlScanChunk` call's arguments changed. No test in
`sql-restore-scan.test.ts` or elsewhere exercises the real `runRestore` file-read loop; every
test (including the new three-short-read cases at lines 329-349) calls `appendSqlScanChunk`
directly with hand-fed, gapless, contiguous chunk sequences — i.e., the tests assume the
caller always supplies every byte of the stream, which is exactly the assumption the real loop
violates on a short read.

**Concrete divergent case:** suppose `scanFd.read()` at `off=0` requests 1 MiB but returns only
900 KiB (bytesRead=921600) due to a short read (plausible on NFS-backed `data/backups/` or
under I/O pressure — this app's own CLAUDE.md documents NFS-adjacent hazards elsewhere, e.g.
deferred item C2-46 "NFS unlink hazard"). The next iteration starts at `off=1048576` (1 MiB),
skipping bytes `921600..1048575` (the last ~124 KiB of the first requested window) entirely.
Any dangerous statement contained in that skipped span is never scanned, and the restore
proceeds to `mysql --one-database` with it intact — a strictly worse outcome than the
addressed "keyword split across the boundary" case, since here the bytes are dropped, not just
detokenized.

**Suggested fix:** advance the loop by actual bytes consumed, e.g. track a running read
cursor `pos += bytesRead` (looping additional reads at the same logical `off` until either
`CHUNK_SIZE` bytes are collected or EOF), instead of assuming a read call always returns the
full requested length. Add a regression test that mocks a short-`fd.read()` at the file-loop
level (not just at the `appendSqlScanChunk` unit level) to lock the fix.

**Severity:** MEDIUM-HIGH as a security-control gap (it defeats the very defense-in-depth
layer these two recent commits hardened, for the exact threat class the commits' own comments
describe as realistic) but bounded in practice: the restore endpoint requires an authenticated
admin session already, `containsDangerousSql` is one of several independent restore guards
(schema/write-target allowlist also runs), and triggering a short read away from EOF on a local
filesystem is uncommon (though the developers' own comments treat it as a real, not
exotic, possibility, and it becomes materially more likely on network-backed storage).
**Confidence:** Medium — the code defect itself is High confidence (directly read and traced),
but real-world exploitability depends on an environment-specific short read that an attacker
cannot reliably force on most local filesystems.

---

### VER8-03 — SW LRU "never record a 0-size entry" invariant is enforced by `touchMeta` but not by `recordAndEvict` (LOW / Medium confidence)

**Claim:** CLAUDE.md, "Service Worker / PWA" section: "an entry is NEVER recorded with size 0
— a 0-size entry would let the total accounting under-count and the 50 MB cap drift."

**Actual code:** two functions write LRU meta entries in both
`apps/web/src/lib/sw-cache.ts` (unit-tested reference) and `apps/web/public/sw.template.js`
(shipped copy):

- `touchMeta` (`sw-cache.ts:218-249`) DOES guard this: `if (!size) { return; }` — the write is
  skipped entirely when the resolved size is falsy (including 0).
- `recordAndEvict` (`sw-cache.ts:100-160`, called from the network-revalidate path in
  `sw.template.js:332-334` as `await recordAndEvict(request.url, size)` where
  `size = await responseSize(networkResponse)`) has **no equivalent guard** —
  it unconditionally does `entries.set(url, { url, size: newSize, timestamp: Date.now() })`
  regardless of whether `newSize` is 0. `responseSize()`
  (`sw.template.js:226-235`) returns `0` whenever the response's `Content-Length` header is
  `"0"` or the cloned body blob has zero bytes, so a 0-byte network response (e.g. a
  zero-byte/corrupted derivative on disk, or a transient empty body) would be recorded with
  `size: 0` via `recordAndEvict`, contradicting the stated invariant.

**Why it matters:** the CLAUDE.md text states the invariant unconditionally ("an entry is
NEVER recorded with size 0"), which reads as a property of the whole LRU meta module, but it
is actually a property of only one of the two entry-writing functions. A 0-size entry recorded
via `recordAndEvict` is exactly the failure mode the doc warns about: it occupies a live Cache
Storage entry that is invisible to the `total` byte accounting (contributing 0 to the sum),
letting the real on-disk cache grow unboundedly past `MAX_IMAGE_CACHE_BYTES` while the tracked
`total` never reflects it — the same class of drift the C4-02 fix (unconditional `total -=
entry.size` during eviction) was written to prevent for a different code path.

**Fix (doc or code):** either (a) add the same `if (!newSize) return;`-style guard to
`recordAndEvict` for parity with `touchMeta`, or (b) narrow the CLAUDE.md claim to specify it
describes `touchMeta`'s behavior specifically, not a whole-module invariant.

**Severity:** LOW — requires a genuinely 0-byte image derivative response, which should not
occur for real photos (Sharp-encoded derivatives are never empty), so this is a defensive gap
rather than an observed live bug. **Confidence:** Medium (the code asymmetry is directly
verified; likelihood of a 0-byte derivative response in production is low).

---

## Claims verified accurate (no finding — listed for lineage / to avoid re-litigating)

- **migrate.js DML-baseline guard + pending-vs-drift split** (`prepareLegacyDatabaseIfNeeded`,
  `baselineAllJournalMigrations`, lines 858-947, 784-841): traced against
  `node_modules/drizzle-orm@0.45.2`'s actual MySQL migrator
  (`mysql-core/dialect.cjs:52-70`, `migrator.cjs:36-62`) — confirmed drizzle really does decide
  application via a single `order by created_at desc limit 1` row compared against each
  migration's `folderMillis` (functionally `MAX(created_at)`), with **no per-entry hash check**,
  exactly as the code comment claims. The pending-vs-drift split (leave above-cursor entries
  unbaselined so `drizzle.migrate()` genuinely executes them), the mixed-batch split (baseline
  only at/below-cursor drift, never the pending tail), and the DML-bearing-entry refusal
  (`LEGACY_DML_MIRRORED_BY_RECONCILE` allowlist, only `0001_sync_current_schema`) all match
  the described behavior and are exercised by real, specific tests in
  `__tests__/migrate-pending-migrations.test.ts` (18 tests covering the pending-tail case, the
  mixed-batch case, the null-cursor legacy-bootstrap case, the above-cursor throw guard, and
  the DML-detector itself) — these are not weak proxies, they assert on the actual reconcile/
  baseline call sequence via an injected mock connection.
- **`COLOR_IMPACTING_KEYS` count of 9** (`settings-hash.ts` docstring vs.
  `gallery-config-shared.ts` `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS`): confirmed exactly 9
  entries (5 color + 3 quality + 1 size), matching both the docstring and CLAUDE.md.
- **Single-writer guard keepalive/re-acquire/reprobe behavior** (`single-writer-guard.ts`):
  every mechanism described in CLAUDE.md's "Single-writer boot guard" paragraph — the 60s
  unref'd keepalive, the ~25s single re-probe before a persistent-holder loud error, the
  post-lapse unref'd 60s re-acquire loop, quiet re-arm on success vs. loud error on contention,
  and the `stopping` latch preventing post-shutdown ownership — matches the code exactly.
- **Advisory-lock destroy-on-failed-release "everywhere"** (`advisory-lock-release.ts`):
  confirmed via a raw-string grep for the literal `RELEASE_LOCK(?)` call-site pattern that only
  the allowlisted files (`advisory-lock-release.ts`, `single-writer-guard.ts` [dedicated
  non-pool connection, correctly exempt], and the two sidecar `--rm` scripts [correctly exempt,
  process exits immediately]) contain a raw call; every other file that mentions RELEASE_LOCK
  only does so in a comment. `advisory-lock-release-contract.test.ts` mechanically enforces
  this with the same allowlist and passes.
- **Restore mutation barrier drain** (`admin-mutation-barrier.ts`): `using`-based
  `Symbol.dispose` release, exclusive-side blocking of new acquisitions, drain-with-timeout via
  a waiter list, and re-check-after-registration (race-safe) all match the CLAUDE.md
  description. All 40+ call sites across `app/actions/*.ts` use the documented
  `using mutationSlot = acquireAdminMutationSlot();` pattern.
- **`_PrivacySensitiveKeys` guard and `publicSelectFields` derivation** (`data.ts:250-476`):
  `publicSelectFields` is genuinely derived from `adminSelectFields` via destructuring-omission
  (not a hand-maintained parallel object), the `PrivacySensitiveKeys` union lists exactly the
  20 fields CLAUDE.md and the in-file comment describe, and the compile-time `Extract<...>`
  guards would fail `tsc` if a sensitive key leaked into `publicSelectFields`,
  `publicMapSelectFields`, or `searchFields`.
- **`tagNamesAgg` / GROUP_CONCAT contract, including the just-landed `searchImages` fix**
  (commits `f3cafa9c`/`584417f5`): confirmed the new `tagMatchExists` EXISTS-subquery shape in
  `data.ts:1682-1729` — the tag-search branch now uses unfiltered `.leftJoin(imageTags)` /
  `.leftJoin(tags)` (matching every other `tagNamesAgg` consumer) with match filtering isolated
  in the EXISTS subquery, correctly fixing the prior INNER-JOIN-plus-WHERE bug that silently
  truncated `tag_names` to only the matching tag on the search surface. The C7-23 "provably
  unreachable" claim about the removed `remainingLimit <= 0` ternaries is correct: the
  short-circuit `if (results.length >= effectiveLimit) return results;` at line 1660
  guarantees `remainingLimit > 0` at the point the ternaries used to guard. The new test
  `'searchImages keeps tag matching separate from tag_names aggregation'`
  (`data-tag-names-sql.test.ts:234-248`) asserts on the correct code region (verified the slice
  boundaries) and checks for `.leftJoin` presence / `.innerJoin` absence exactly where the bug
  was — a real, non-weak regression pin.
- **Upload quota TOCTOU** (`app/actions/images.ts:196-320`): confirmed the claim precisely —
  all synchronous count/byte/topic-format checks happen before the claim
  (`tracker.bytes += totalSize; tracker.count += files.length;`), no `await` sits between the
  checks and the claim, and every subsequent awaited early-return (disk-space check, DB-error
  throw, topic-not-found) calls `settleClaim(0, 0)` to roll back — including the DB-throw path,
  which rolls back before re-throwing.
- **OG SSRF pinning** (`api/og/photo/[id]/route.tsx:188-196`, `lib/constants.ts:21-26`):
  confirmed `BASE_URL` really is `process.env.BASE_URL || siteConfig.url` (never
  `new URL(req.url).origin`), the per-photo route fails closed (returns the fallback response)
  when that URL doesn't parse rather than falling back to the request-derived origin, and the
  topic/home OG route (`api/og/route.tsx`) contains no internal `fetch()` call at all, matching
  the claim that only the per-photo route performs the internal derivative fetch.

## Not independently re-verified (covered by parallel lanes this cycle)

Skimmed `security-reviewer.md` and `document-specialist.md` to avoid duplicate work; their
independent confirmations of the `9f416f01` fix (token-rejoin correctness),
`COLOR_IMPACTING_KEYS`, single-writer-guard timings, and advisory-lock constants agree with my
own from-scratch verification above (cross-checked, not merely trusted).

---

**Summary:** 3 findings — 0 CRIT, 0 HIGH, 1 MEDIUM (leaning MEDIUM-HIGH), 2 LOW. No CRIT/HIGH
doc-vs-code mismatches found among the assigned high-value claims; the migrate.js DML-baseline
logic, settings-hash key count, single-writer-guard, advisory-lock release discipline, admin
mutation barrier, privacy-field guard, tag_names contract, upload-quota TOCTOU, and OG SSRF
pinning all check out against the actual implementation and (where applicable) are backed by
tests that assert the claimed behavior rather than a weaker proxy.
