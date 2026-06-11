# Run-4 Cycle 13 — code-reviewer / debugger / tracer angle

Full-inventory in-context pass (single-subagent constraint, same as
run4-c1..c12). Inventory this angle: independent line-level regression review
of the cycle-12 fix commit (`ef1ea136` quiesce reorder + its 176-line
behavioral test); rotation to the least-run-4-covered surfaces by a
mention-count coverage map built over run4-c1..c12 review texts —
`app/actions/topics.ts` (full, 524 lines), `lib/process-topic-image.ts`
(full), `lib/tag-records.ts` + `lib/tag-slugs.ts` (full), `lib/csv-escape.ts`
(full), `lib/blur-data-url.ts` (full), `lib/image-url.ts` /
`lib/download-filename.ts` / `lib/backup-filename.ts` / `lib/mysql-cli-ssl.ts`
/ `lib/error-shell.ts` / `lib/action-result.ts` / `lib/feature-flags.ts`
(full), `lib/icc-extractor.ts` (full bounds audit); `db/schema.ts` topics
region; `topic-manager.tsx` rename/map regions; pattern sweep for sibling
transactional insert+delete recreate patterns across all of `src/`.

## Regression review of cycle-12 commit `ef1ea136` — SOUND

- `quiesceImageProcessingQueueForRestore` now runs `pause(); clear(); await
  onIdle();` with state clears after the await. Verified against the p-queue
  9.1.2 semantics established last cycle: `clear()` empties `size`, so `idle`
  fires when the at-most-one in-flight job settles — no hang path remains.
- The injected-fake test models paused-queue semantics faithfully (`onIdle`
  rejects unless `clear()` ran) and pins the exact `pause → clear → onIdle`
  order; a regression fails fast instead of hanging the suite.
- New-job interleaving between `clear()` and `onIdle()` is correctly argued
  impossible (maintenance gate + paused queue); comment matches code.
- No drift with the sibling `drainProcessingQueueForShutdown` order.
No follow-on work.

## Findings

### COR-R4C13-01 — topic slug rename silently resets `map_visible` to false
**Severity: MEDIUM (admin-setting data loss, fail-safe direction) /
Confidence: HIGH — CONFIRMED from code + schema**

- `apps/web/src/app/actions/topics.ts:248-253` — the rename path implements
  "PK rename" by inserting a replacement row and deleting the old one inside
  a transaction. The replacement insert carries ONLY
  `{ label, slug, order, image_filename }`.
- `apps/web/src/db/schema.ts:11` — `topics.map_visible` is
  `boolean NOT NULL DEFAULT false` (US-P21, per-topic opt-in for the public
  /map GPS view).
- Consequence: renaming a topic whose `map_visible = true` re-creates the row
  with the column's DEFAULT — `false`. The topic's photos silently vanish
  from the public `/map` view (`getMapImages` in `lib/data.ts:1533-1550`
  INNER JOINs `topics.map_visible = true` and runtime-asserts it).
- Concrete failure scenario: admin opts topic `travel` into the map
  (`setTopicMapVisible`, Switch in `topic-manager.tsx:244`), later edits the
  topic and changes the slug to `trips` (same screen, Pencil → edit dialog →
  `updateTopic` at `topic-manager.tsx:101`). The rename succeeds; the Map
  switch now shows OFF; the map loses the topic's photos. No error, no
  warning, nothing in the audit log says the opt-in changed.
- Causal trace (tracer): the recreate pattern landed 2026-04-22
  (`2f2e8436`); `map_visible` landed 2026-05-03 (`52cb48f1`, US-P21) and did
  not update the recreate site. Classic column-addition blind spot — the
  recreate-row idiom requires every future `topics` column to be threaded
  through, and nothing enforced that.
- Direction note: the reset fails SAFE for privacy (a renamed topic becomes
  MORE private, never less) — this is an availability/correctness loss of an
  admin opt-in, not a GPS leak.
- Fix: make the transaction's existence-check SELECT fetch the authoritative
  row (`image_filename`, `map_visible`) and thread both into the replacement
  insert (`map_visible: transactionTopic.map_visible`,
  `image_filename: imageFilename ?? transactionTopic.image_filename ?? null`).
  Extend the rename test to assert the inserted VALUES, not just call order.

### COR-R4C13-02 — rename carries `image_filename` from a pre-lock SELECT (TOCTOU) — folds into COR-R4C13-01
**Severity: LOW / Confidence: HIGH**

- `apps/web/src/app/actions/topics.ts:213,217,237` — `previousImageFilename`
  is read OUTSIDE `withTopicRouteMutationLock` and outside the transaction,
  then written into the replacement row (`nextImageFilename`). A concurrent
  `updateTopic` that changes the topic image between the outer SELECT and
  the transaction gets its new image filename clobbered by the stale value
  (file orphaned on disk, never referenced).
- Two-admin sub-second window; no data loss beyond an orphaned derivative.
  The COR-R4C13-01 fix moves the authoritative read inside the transaction,
  closing this for free. The outer SELECT stays for the post-success
  previous-image cleanup compare (`topics.ts:282`), which is correct as-is.

### Clean-pass notes (no findings)

- `process-topic-image.ts` — extension allowlist, UUID output name, 0600
  temp file, failure unlinks both temp+output, singleton mkdir, orphan
  cleanup at bootstrap. `deleteTopicImage` guards with `isValidFilename`
  (validation.ts:123-130 — rejects `..`, `/`, `\`, requires
  `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`). Sound.
- `tag-records.ts` — `INSERT IGNORE` + re-select pattern; collision shape
  explicit. `tag-slugs.ts` — bounded (256 chars / 20 tags), dedup-stable.
  Sound.
- `csv-escape.ts` — order of passes (C0/C1 strip → format-char strip →
  CRLF collapse → `^\s*[=+\-@]` quote → quote-wrap) verified against the
  documented bypass lineage. Sound.
- `blur-data-url.ts` — prefix allowlist + 4 KB cap + throttled redacted
  warn. Sound.
- `icc-extractor.ts:49-121` — every offset read re-checked: tagCount capped
  100, per-tag `tagOffset + 12 > iccLen` break, desc path checks
  `dataOffset + 12`, `dataSize >= 12`, `dataOffset + dataSize <= iccLen`,
  string len min(declared, dataSize-12, 1024); mluc path caps records 100,
  `recordSize >= 12`, record header and text bounds both checked against
  `iccLen` AND `dataOffset + dataSize`; all arithmetic in doubles (no
  UInt32 overflow), whole body try/catch. Sound.
- `image-url.ts`, `download-filename.ts`, `backup-filename.ts`,
  `mysql-cli-ssl.ts`, `error-shell.ts`, `action-result.ts`,
  `feature-flags.ts` — trivial/clean.

## Pattern sweeps

- Transactional insert+delete recreate of the same table: `topics.ts`
  rename is the ONLY instance in `src/` (sweep over `tx.insert` ∩
  `tx.delete` sites: tags attach/detach, images delete, sharing
  create/delete, settings/seo upsert, sessions rotate — none recreate a row
  whose other columns must survive). No sibling instances of COR-R4C13-01.
- `parseInt` radix: `topics.ts:96,198` use radix 10 + NaN guard + clamp. OK.
- Unbounded loops over attacker-controlled counts in the newly-read parsers:
  none (all capped).
