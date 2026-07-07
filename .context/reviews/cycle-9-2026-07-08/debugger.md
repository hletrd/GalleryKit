# Debugger Review — cycle 9 (2026-07-08)

**Repo:** `/Users/hletrd/flash-shared/gallery`
**HEAD at review time:** `6efd737b` ("fix(cycle18): harden review-plan-fix findings")
**Scope:** Latent bugs — null/undefined derefs, off-by-one, unhandled rejections, error
swallowing, resource leaks, boundary conditions, incorrect defaults, type coercion,
binary parser edge cases. Prior cycles (see `run9-cycle8/debugger.md`) already picked the
binary/ICC/NCLX/gain-map parsers, the Sharp pipeline, and the queue's fire-and-forget
async paths clean — this pass focused on modules NOT recently re-verified line-by-line
(`gain-map-detection.ts`, `gps-exif-strip.ts`, `db-child-watchdog.ts`,
`single-writer-guard.ts`, `blur-data-url.ts`, `migrate.js`, `icc-chromaticity.ts`,
`actions/images.ts`) and, per the "NEW angle" directive, on the code that changed in the
most recent commit itself (`6efd737b`) rather than re-litigating nine cycles of
already-hardened legacy paths.

---

## DBG9-01 — CLIP embedding backfill conflates the SQL row-fetch LIMIT with the
remaining embedding-ATTEMPT budget, causing premature "done" termination while
real candidate rows remain unscanned

- **Severity:** Medium
- **Confidence:** High
- **Files:**
  - `apps/web/src/app/actions/embeddings.ts:142-168,211` (new in `6efd737b`, this cycle's own fix)
  - `apps/web/scripts/backfill-clip-embeddings.ts:159-189,244` (identical pre-existing pattern; the sidecar's doc comment was edited in `6efd737b` but this specific defect was not)

### The bug

Both the newly-rewritten in-app action and the sidecar script use the same keyset-pagination
loop:

```ts
const remainingEmbeddingBudget = Math.max(SEMANTIC_SCAN_LIMIT - attemptedEmbeddings, 0);
if (remainingEmbeddingBudget === 0) break;

const pending = await db.select(...)
    .where(and(eq(images.processed, true), gt(images.id, cursor), notExists(...)))
    .orderBy(asc(images.id))
    .limit(Math.min(BACKFILL_BATCH_SIZE, remainingEmbeddingBudget));   // <-- conflation

if (pending.length === 0) break;
cursor = pending[pending.length - 1].id;

// ... process chunk, incrementing `attemptedEmbeddings` ONLY for rows that
// actually reach embedImageReal/embedImageStub (rows with a missing/unresolvable
// filenameOriginal increment `skipped`/`failed` instead and do NOT touch
// attemptedEmbeddings) ...

if (pending.length < BACKFILL_BATCH_SIZE) break;   // <-- "reached end of table" heuristic
```

`remainingEmbeddingBudget` is a count of remaining embedding **attempts**, but it is fed
directly into the SQL `LIMIT`, which controls the number of **rows scanned**. Those are
different quantities precisely because this cycle's own fix made "missing-original" rows
free (they advance the cursor without consuming the attempt budget) — the two counters
diverge by design.

The loop's only way to detect "no more candidate rows exist" is `pending.length <
BACKFILL_BATCH_SIZE` (100 for the action, 50 for the sidecar's `BATCH_SIZE`). That
heuristic is only valid when the requested `LIMIT` equals the true page size. Once
`remainingEmbeddingBudget` drops below `BACKFILL_BATCH_SIZE`/`BATCH_SIZE` — which is
guaranteed to happen at least once in any run that gets close to exhausting
`SEMANTIC_SCAN_LIMIT` — the query's `LIMIT` is silently shrunk to the small remaining
budget number. If the next `remainingEmbeddingBudget`-sized window of candidate rows
(ordered by ascending id, past the cursor) happens to be dominated by skip-eligible rows
(NULL `filename_original`, or an original file that no longer resolves on disk — exactly
the case this cycle's fix was written to make "free"), `attemptedEmbeddings` does not
advance, `pending.length` equals the artificially-small limit (which is `<
BACKFILL_BATCH_SIZE`), and the loop's tail check fires and **breaks**, even though the
table may contain thousands of additional un-embedded, embeddable rows beyond the
cursor that were never even fetched.

### Concrete trigger

1. Semantic search is in `production` mode; `SEMANTIC_SCAN_LIMIT` is left at its default
   2000; `BACKFILL_BATCH_SIZE`/`BATCH_SIZE` is 100/50.
2. A gallery has well over 2000 processed images lacking a production-model embedding.
   Across the first several ~100-row pages, ~1950 are successfully embedded, so
   `attemptedEmbeddings` climbs to 1950 and `remainingEmbeddingBudget` drops to 50.
3. The next query is issued with `LIMIT 50` (not 100). Suppose the next 50 candidate rows
   by ascending id — e.g. a batch of images whose originals were later moved/deleted by an
   admin, or rows with a NULL `filename_original` from a legacy import — are ALL
   skip-eligible. None of them touch `attemptedEmbeddings`.
4. `pending.length === 50 < BACKFILL_BATCH_SIZE (100)` → the loop breaks.
5. The run ends having only scanned a fraction of the true candidate set. Crucially, the
   sidecar's own explicit "reached SEMANTIC_SCAN_LIMIT" log line (`logScanLimitReached()`,
   `backfill-clip-embeddings.ts:239-242`) does **not** fire in this path, because
   `attemptedEmbeddings` (1950) never actually reached `SEMANTIC_SCAN_LIMIT` (2000) — so
   the run reports quiet, successful completion.

This directly contradicts the operator-facing completion contract that this exact commit
documents (script header, `backfill-clip-embeddings.ts:45-49`, and
`CLAUDE.md` "For galleries larger than that limit, repeat the same sidecar command until
it finishes without that message and reports no remaining rows to process"): an operator
sees the run finish without the scan-limit message and reasonably concludes the backfill
is complete, while real, embeddable photos past the cursor were never scanned. A repeat
invocation does not help either — a fresh call resets `cursor = 0` and
`attemptedEmbeddings = 0`, so it will retrace the same already-embedded 1950 rows (now a
no-op via `notExists`), hit the same skip-heavy window, and terminate at the same point
again, never advancing past it.

(Note: no misconfiguration is required to hit this — it is reachable with every default.
It is also reachable trivially on the very first page if an operator sets a small custom
`SEMANTIC_SCAN_LIMIT` env override below `BACKFILL_BATCH_SIZE`/`BATCH_SIZE`, since
`SEMANTIC_SCAN_LIMIT` is a plain `envPositiveInt` env override in
`apps/web/src/lib/clip-embeddings.ts:48` with no enforced minimum relative to the batch
size.)

### Why the existing regression test doesn't catch it

The cycle-18 test added for this rewrite
(`apps/web/src/__tests__/embeddings-action-behavior.test.ts`, "continues past skipped
production rows to later valid rows in the same run") only exercises a single page of 2
rows (one skip, one valid) with `SEMANTIC_SCAN_LIMIT` far from exhausted, so
`remainingEmbeddingBudget` never drops below `BACKFILL_BATCH_SIZE` in that test and the
`.limit(Math.min(...))` clause never actually shrinks. The scenario that trips the bug —
budget near exhaustion, i.e. `remainingEmbeddingBudget < BACKFILL_BATCH_SIZE` — is
untested in both the action and the sidecar's own contract test
(`cycle-17-source-contracts.test.ts`, which only asserts substring presence of the source
code, not runtime behavior of the interaction between the two variables).

### Suggested fix

Decouple the two concerns: always request a full `BACKFILL_BATCH_SIZE`/`BATCH_SIZE` page
for **scanning** (so "fewer rows returned than requested" reliably means "reached the end
of the table"), and enforce the **attempt** budget only at the point where a real
embedding attempt would be made (skip/break out of the per-row work once
`attemptedEmbeddings >= SEMANTIC_SCAN_LIMIT`, independent of how many rows were fetched
into the current page). For example:

```ts
.limit(BACKFILL_BATCH_SIZE)   // always a full page; do not shrink by remaining budget
```

and inside the chunk loop, check `attemptedEmbeddings >= SEMANTIC_SCAN_LIMIT` before
calling `embedImageReal`/`embedImageStub`, stopping further attempts within the page
(and then let the top-of-loop `remainingEmbeddingBudget === 0` check end the run on the
next iteration). This bounds the same total number of attempts (with at most
`BACKFILL_CONCURRENCY - 1` extra in-flight attempts in the worst case, a much smaller and
already-tolerated variance) while restoring the row-count-based "end of table" heuristic
as a valid signal. Add a regression test that sets `attemptedEmbeddings` near
`SEMANTIC_SCAN_LIMIT` (or mocks a small `SEMANTIC_SCAN_LIMIT`) with a batch of
all-skip-eligible rows followed by more valid rows past the cursor, and asserts the run
does NOT terminate before scanning the later valid rows.

---

## Other modules checked — no new defects found

- **`apps/web/src/lib/gain-map-detection.ts`** (full read): ISOBMFF walker bounds-checks
  every box header against its true enclosing `end` (not just overall buffer length,
  DBG-01/run-10c2 fix already in place), depth-capped at 5, scan-capped at 1 MB,
  `parseInfe`/`parseIinf`/`parseIref` all guard every multi-byte read against `dataEnd`/
  `boxEnd` before reading. No new out-of-bounds or infinite-loop paths found.
- **`apps/web/src/lib/gps-exif-strip.ts`** (full read): TIFF IFD walker, JPEG APP1/XMP
  segment walker (including the ExtendedXMP chunk reconstruction), ISOBMFF Exif/XMP
  item walker via iinf/iloc, and the WebP RIFF walker all fail closed (`return null`) on
  any bounds violation, zero-progress guard, or oversized declared size. Traced the
  JPEG header-segment walker's generic-length branch (any marker other than
  RST/TEM/SOS/EOI is treated as length-prefixed) for a case where a non-standard
  in-stream `0xFFD8` byte pair could misalign the segment walk and skip over a real
  GPS-bearing APP1 segment — in every case checked, a misaligned `pos` lands off a
  `0xFF` boundary on the next iteration and forces `return null` (fail-closed re-encode
  fallback), so this does not manifest as a silent GPS leak in practice; not filing it
  as a defect.
- **`apps/web/src/lib/db-child-watchdog.ts`** (full read): the settle-listener /
  force-kill / cleanup-no-op-after-fire contract is internally consistent; the one
  theoretical race (child exit and the 30-minute timeout firing in the same tick) is a
  practically unreachable timing coincidence given mysqldump/migrate durations and
  degrades to a harmless mislabeled log message, not a functional defect.
- **`apps/web/src/lib/single-writer-guard.ts`** (full read): the lapse/reprobe/reacquire
  state machine (`stopping` latch, `contentionEmittedSinceLapse`, unref'd timers)
  correctly prevents both a stopped guard from taking ownership and a keepalive lapse
  from permanently disarming the guard. No leaked timers or double-registration found.
- **`apps/web/src/lib/blur-data-url.ts`** (full read): the bounded rejection-log LRU,
  redacted warn preview, and MAX_BLUR_DATA_URL_LENGTH gate are consistent; no bypass
  found.
- **`apps/web/src/lib/icc-chromaticity.ts`** (full read): tag-table walk bounds every
  read against `icc.length` and `MAX_TAG_TABLE_BYTES` before use; `chad`/XYZ tag parsing
  validates signature and size before reading; `invert3x3` rejects near-singular
  matrices. No new defect found.
- **`apps/web/scripts/migrate.js`** (full read): the DML-baseline guard, cursor-based
  pending-vs-drift split, and mixed-batch handling are internally consistent with the
  documented contract; traced `journalSqlContainsDml`'s comment-stripping heuristic for a
  false-negative (a DML statement's leading `INSERT`/`UPDATE`/etc. keyword line can never
  itself start with `--`, so the per-line comment filter cannot hide it) — no gap found.
- **`apps/web/src/app/actions/images.ts` `retryFailedImage`** (full read): claim
  predicate, snapshot ordering (clear failure columns only after the strict config
  snapshot succeeds), `affectedRows`-gated updates, and the re-enqueue-failure rollback
  path (restoring `processing_error`/`failed_at` and re-adding to
  `permanentlyFailedIds`/`lastErrors` only when the restore UPDATE actually matched a
  row) are all consistent. No defect found.
- **`apps/web/src/lib/api-auth.ts` / `apps/web/src/app/api/admin/lr/upload/route.ts`**
  (this cycle's `markAdminAuthTokenUsed` refactor, full diff read): confirmed via grep
  that `lr/upload/route.ts` is the ONLY route currently using `allowTokenScope`, so
  moving the `markTokenUsed` side effect out of `withAdminAuth` and into an explicit
  per-route call does not silently stop usage-tracking on any other token-scoped route
  (none exist yet). The `WeakSet`-based double-mark guard and its `finally`-block
  cleanup are correct.
- **`apps/web/src/lib/image-queue.ts`** retry/permanent-failure bookkeeping
  (`retryCounts`, `claimRetryCounts`, `lastErrors`, `permanentlyFailedIds`): re-verified
  the FIFO eviction (`pruneRetryMaps`, `MAX_RETRY_MAP_SIZE`/`MAX_PERMANENTLY_FAILED_IDS`)
  runs unconditionally in the job's `finally` block on every exit path (success, retry,
  claim-retry, permanent failure), so none of these four maps/sets can grow unbounded.
  No new defect found here (consistent with prior cycles' findings).

---

## DISPOSITION: 1 DEFECT (DBG9-01, Medium/High), 0 additional new findings
