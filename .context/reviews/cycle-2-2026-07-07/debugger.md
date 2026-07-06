# Debugger Review — Latent Bug Surface

Repo: `/Users/hletrd/flash-shared/gallery`. HEAD at review time: `642c50914834b85bed13b45ce1d8484a30d281c0`
("fix(lint): stop scanner string-stripping from crossing newlines"). Read-only review: no
source files modified. Scratch verification scripts (buffer-parsing repros) were written to
the session scratchpad only, never to the repo.

## Approach

This repo has already been through ~10 debugger review cycles (`.context/reviews/run7-cycle2/`
through `cycle-1-2026-07-06/`), most of which are documented as fixed with pinning tests. Rather
than re-litigate settled ground, this pass:

1. Read the most recent debugger cycle (`.context/reviews/cycle-1-2026-07-06/debugger.md`) and
   verified all three of its findings (DBG-01 topic-temp-file age gate, DBG-02 surrogate-pair-safe
   truncation, DBG-03 backup/restore dump-completeness) are fully fixed on current HEAD — confirmed
   via `ORPHANED_TOPIC_TEMP_MIN_AGE_MS` in `process-topic-image.ts`, `Array.from(lastErrorMsg).slice(...)`
   in `image-queue.ts:868`, and the `.tmp`-then-`rename()` + `hasMysqldumpCompletionTrailer` machinery
   in `db-actions.ts` / `db-restore.ts`. Not re-reported.
2. Diffed every commit since that cycle's HEAD (`657eb024..642c5091`, 12 commits) to find
   genuinely new code, and cross-checked which of the task's named focus files actually changed
   in that window (only `apps/web/src/lib/data.ts` did, via `4d02f695` and `3000bb05` — everything
   else in the focus list — `image-queue.ts`, `admin-backfill-runner.ts`, `upload-tracker*.ts`,
   `rate-limit.ts`, `auth-rate-limit.ts`, `view-retention.ts` — was untouched, so the prior cycle's
   "read clean" verdict still holds for those and they were not re-read end-to-end).
3. Did a full fresh read of the byte-level parsers the prior cycle's file list does **not**
   mention: `color-detection.ts`, `gain-map-detection.ts`, `gps-exif-strip.ts`, `icc-extractor.ts`,
   `icc-chromaticity.ts` — these had never been reviewed by this lane before.
4. Full fresh reads of `use-display-capability.ts` (the `useSyncExternalStore` snapshot-memoization
   contract called out in CLAUDE.md — it is the only `useSyncExternalStore` consumer in the repo),
   `scripts/migrate.js`, `scripts/build-sw.ts`, `env.ts`, `mysql-datetime.ts`.
5. Programmatic i18n placeholder-parity check (en.json vs ko.json ICU placeholder names, not just
   key parity, which is already unit-tested) — no real mismatch (the "one/other" plural literal
   text in English false-positived on a naive placeholder regex; Korean's fixed non-plural
   `{count}` form is the project's documented, intentional convention).
6. Empirically verified (via crafted-buffer Node scripts in the scratchpad — not committed) the one
   parsing finding below, rather than relying on static reading alone.

## Findings

### DBG-01 — ISOBMFF box walkers in `color-detection.ts` and `gain-map-detection.ts` validate a child box's declared size only against the total buffer length, not against its parent container's true end — unlike the sibling walker in `gps-exif-strip.ts`, which already fixed this exact class of bug

- Severity: **Medium** (for the `color-detection.ts` instance — it feeds the `is_hdr` upload-accept/reject
  gate; **Low** for the `gain-map-detection.ts` instance — purely an admin-only cosmetic label).
- Confidence: **High** — reproduced empirically, not just read.
- Classification: Boundary/containment defect in an ISOBMFF box parser — the exact bug class this
  module's own docstring promises to reject ("Bounded: max box depth 5, max scan 1 MB, rejects
  malformed boxes"), and the exact class already found and fixed in a sibling module in this same
  codebase.
- Files:
  - `apps/web/src/lib/gain-map-detection.ts:63-81` (`readBoxHeader`) — bounds check at line 79 is
    `if (size < headerSize || pos + size > buffer.length) return null;` — only against the whole
    buffer. `readBoxHeader` takes no `end`/container-boundary parameter at all. Called from
    `parseIinf` (`:150-175`, loop bound `pos + 8 <= boxEnd` at `:165` only bounds the *next* box's
    *start*, not the *current* box's *size*), `parseIref` (`:185-216`, same pattern at `:191`), and
    the top-level `walk` (`:218-240`, `limit` computed at `:221` but never passed into
    `readBoxHeader`).
  - `apps/web/src/lib/color-detection.ts:230-296` (`parseCicpFromHeif`) — the inline equivalent
    check at `:256` is `if (size < headerSize || pos + size > buffer.length) break;` — again only
    against `buffer.length`, not against the `limit`/`end` the enclosing `walk` call computed at
    `:238`.
  - Contrast: `apps/web/src/lib/gps-exif-strip.ts:395-415` (`walkChildren`, used by
    `stripGpsFromIsobmffBuffer`) does this correctly — `if (size < headerSize || pos + size > end)
    { walkAborted = true; return; }` at `:411` bounds the child against the true parent `end`, and
    the surrounding R19C19/R20C20 comments (`:385-393`, `:461-469`) show the author was specifically
    aware of, and fixed, "a box that runs past its parent" as a distinct anomaly class. That fix was
    never back-ported to the two sibling walkers, which are structurally near-identical (same
    "Bounded... rejects malformed boxes" doctrine, same author, called back-to-back at the very same
    upload-time call site — `detectColorSignals` in `color-detection.ts:337-354` calls
    `parseCicpFromHeif` and `parseGainMapFromHeif` on the same 1 MB header buffer for every
    HEIF/AVIF upload). This is the project's own recurring "fix one sibling, miss the next" pattern
    (explicitly named in CLAUDE.md's touch-target-audit section) recurring here in the color/HDR
    parsers.
- Why this matters: a box whose declared `size` field claims to extend past the true end of its
  enclosing container (but still lands within the overall buffer, because there is more file data
  after that container) is accepted as valid instead of rejected as malformed. The child's `dataEnd`
  is then computed from the (too-large) declared size, so string-scanning / field-reading inside
  that child (e.g. `infe`'s null-terminated `item_uri`, or a `colr` box's 11-byte CICP triplet read)
  can read bytes that actually belong to a **sibling** box that follows the true container boundary,
  not bytes that are part of the child's own logical payload.
  - Empirical proof (`readBoxHeader` reimplemented verbatim from `gain-map-detection.ts`, run under
    plain `node`): an `iinf` box that declares itself 24 bytes (true end = offset 24) containing one
    child `infe` box (starting at offset 16) that declares `size = 40` (would end at offset 56) is
    **accepted** by `readBoxHeader` as long as the overall buffer is ≥ 56 bytes — even though the
    `infe` box's own true container (`iinf`) ends at offset 24. `parseIinf` would then call
    `parseInfe(dataStart, pos + header.size)` with a `dataEnd` of 56, letting the item-name/item-uri
    scan read 32 bytes of whatever comes after the real `iinf` box (in the test, literal sibling text)
    as if it were still inside this `infe` entry.
  - For `color-detection.ts`, the same shape lets a `walk()` recursion into `meta` → `iprp`/`ipco`
    accept a child box whose declared size overflows the true parent boundary, letting a subsequent
    `colr`/`nclx` box be "found" and its fixed 11-byte CICP triplet read from bytes that belong to
    unrelated container structure rather than genuine CICP data.
- Failure scenario: a deliberately malformed (but not obviously truncated/rejected) HEIF/AVIF upload
  with an oversized child-box `size` field could cause `detectColorSignals` to derive an incorrect
  `transferFunction`/`colorPrimaries`/`matrixCoefficients` triplet from unrelated bytes. Since
  `isHdr = transferFunction === 'pq' || transferFunction === 'hlg'` directly gates the upload-reject
  path (`apps/web/src/app/actions/images.ts:382` — `if (data.colorSignals?.isHdr &&
  !uploadConfig.allowHdrIngest)`), a crafted file could cause either (a) a legitimate SDR upload to
  be misclassified as HDR and rejected, or (b) an actual HDR source to be misclassified as SDR and
  silently accepted as if it were a normal SDR upload (not a memory-safety or injection issue — no
  OOB read outside the buffer occurs, since `readBoxHeader`'s own `buffer.length` bound is still
  respected — but a real correctness/policy gap for adversarially-crafted input). For the
  `gain-map-detection.ts` case, the only consequence is an incorrect `has_gain_map` admin-only audit
  label — cosmetic.
- Fix: give `readBoxHeader` in `gain-map-detection.ts` (and the equivalent inline check in
  `color-detection.ts`'s `parseCicpFromHeif`) an `end` parameter (the enclosing container's true
  boundary, exactly as `gps-exif-strip.ts:411` already does), and reject (`return null` /
  `break`/abort) when `pos + size > end` rather than only `pos + size > buffer.length`. This is a
  narrow, mechanical, already-proven-out fix — port the exact pattern from
  `gps-exif-strip.ts:395-415`.

### DBG-02 — Splitting the paginated page-rows query from the total-count query (recent perf commit `3000bb05`) drops the atomicity the single windowed query used to guarantee, opening a narrow window where the displayed photo count can diverge from the actually-returned photo set

- Severity: **Low** (requires a concurrent write landing in a sub-millisecond-to-millisecond window
  between two `Promise.all`-parallel queries; every affected page has `revalidate = 0`, so the
  inconsistency self-corrects on the very next request).
- Confidence: **High** that the mechanism is real (shown directly by the diff); frequency of visible
  user impact in practice is low.
- Classification: Newly-introduced regression risk (not present before the perf commit) — a
  consistency/atomicity gap between two independently-executed reads that a single query previously
  guaranteed by construction.
- Files: `apps/web/src/lib/data.ts:914-919` (`getImagesLitePage`) and `:1510-1522`
  (`getImagesForSmartCollection`); introduced by commit `3000bb05` ("perf(data): replace first-page
  window count with lean parallel count"), which is *after* the most recent prior debugger cycle's
  reviewed HEAD, so this is genuinely unreviewed code.
- Why: before this commit, both functions computed `total_count` via `COUNT(*) OVER()` **inside the
  same query** that also produced the page's visible rows — one query execution, one consistent
  snapshot, so the displayed total and the displayed rows could never disagree about the state of
  the table. The commit replaces this with:
  ```ts
  const [rows, totalCount] = await Promise.all([
      query.limit(normalizedPageSize + 1).offset(offset),
      getImageCount(topic, tagSlugs, { includeUnprocessed }),
  ]);
  ```
  (`data.ts:914-918`, and the structurally identical `Promise.all([pageQuery, countQuery])` for the
  smart-collection variant at `:1510-1518`). These are now **two separate query executions** issued
  concurrently on two different pool connections. The commit message states the change has
  "identical semantics" and is "strictly lower cost" — the predicate-equivalence claim is correct
  (verified: `getImageCount`'s `buildTagFilterCondition`/topic/processed conditions are the same
  self-contained `IN(subquery)` shape as `getImagesLitePage`'s own `buildImageConditions`, so there is
  no *structural* over/under-count from a join fan-out) — but the atomicity claim is not: if a
  concurrent write (an upload finishes processing, an image is deleted, a tag is added/removed)
  commits in between the two queries' execution, `rows` and `totalCount` can reflect two different
  moments in the table's history.
- Failure scenario: on the home page, a topic page, or a smart-collection page's first-page render
  (all `revalidate = 0`, so this runs on every request), a photo finishes background processing (flips
  `processed = false → true`) or is deleted at the exact moment between the two parallel queries
  resolving. The visible masonry grid (from `rows`) and the header count text (`t('home.metaTitle',
  { count: totalCount })` in `apps/web/src/components/home-client.tsx:291`, fed by `totalCount` from
  `data.ts:914`/`:1510` via `apps/web/src/app/[locale]/(public)/page.tsx:177`,
  `[topic]/page.tsx:187`, and `c/[slug]/page.tsx:111`) can disagree by one for that single render —
  e.g. the page says "143 photos" while only 142 are actually rendered, or vice versa. Self-corrects
  on the next request since nothing is cached.
- Fix: either accept this as a documented, deliberate trade-off (given the severity is genuinely low
  and the performance win is real — the prior `COUNT(*) OVER()` forced full materialization of the
  grouped result before `LIMIT`), or restore atomicity cheaply by running both queries inside a
  single `START TRANSACTION ... WITH CONSISTENT SNAPSHOT`-style read, or by re-deriving `totalCount`
  from a `SELECT ... FOR SHARE`-free repeatable-read transaction wrapping both statements. Given the
  low real-world severity, a documentation-only fix (a one-line comment on both call sites noting the
  small window and that it self-corrects) is a reasonable proportionate response if the team decides
  not to spend transaction overhead on it.

## Areas examined and found clean (no new finding)

- `apps/web/src/lib/image-queue.ts` (full re-read post the `642c5091` diff touching it — the diff
  itself only moved a function declaration below the import block and reworded two comments; no
  behavior change) — bootstrap claim/retry/permanent-failure state machine, `pruneRetryMaps` FIFO
  eviction, `quiesceImageProcessingQueueForRestore`'s pause→clear→onIdle ordering, and the embedding
  bootstrap in-flight dedupe are all internally consistent.
- `apps/web/src/lib/admin-backfill-runner.ts` (full read, not previously read end-to-end by this
  lane) — the connection-budget concurrency arithmetic (`resolveBackfillConcurrency`), the
  per-image processing-claim lock ordering, and the deleted-mid-reencode cleanup (both the
  encode-throw path and the affectedRows=0-plus-existence-probe path) are all correct and
  consistent with the sibling sidecar script's documented contract.
- `apps/web/scripts/migrate.js` (full read) — the per-entry journal baselining, `reconcileLegacySchema`
  idempotent CREATE/ALTER/DROP guards, and the post-condition assertion in `runMigrations` are sound;
  `migrateLegacyOriginalUploads`'s same-bytes-before-unlink check and EXDEV cross-device fallback are
  correct.
- `apps/web/src/lib/gps-exif-strip.ts` (full read) — the most rigorously bounds-checked module in the
  codebase; it is in fact the module that demonstrates the *correct* pattern DBG-01 is missing
  elsewhere.
- `apps/web/src/lib/icc-extractor.ts`, `apps/web/src/lib/icc-chromaticity.ts` (full read) — tag-table
  walks are bounded (`MAX_TAG_COUNT`, `MAX_TAG_TABLE_BYTES`), `mluc`/`desc` record offsets are checked
  against both the buffer end and the tag's own declared `dataSize`, and unsigned offset/size values
  from `readUInt32BE` cannot overflow `Number.MAX_SAFE_INTEGER` when summed, so no integer-overflow
  bypass of the bounds checks is possible.
- `apps/web/src/lib/use-display-capability.ts` (full read) — the only `useSyncExternalStore` consumer
  in the repo; the by-value snapshot cache correctly prevents the React #185 infinite-loop hazard the
  file's own comment warns about, and the module-level cache is safe because it is client-only
  per-tab state, not cross-request server state.
- `apps/web/src/lib/env.ts`, `apps/web/src/lib/mysql-datetime.ts`, `apps/web/scripts/build-sw.ts` —
  small, correct, no coercion or off-by-one issues found.
- i18n placeholder parity (`messages/en.json` vs `messages/ko.json`) — programmatically diffed ICU
  placeholder names per key; the only "mismatches" found were a naive-regex false positive on
  English plural-branch literal text (e.g. `one {1 file...}`), not real placeholder drift. The
  Korean fixed-form (no `plural` block) convention is intentional and documented in CLAUDE.md.
- Unhandled-rejection sweep (`grep` for bare `.then(` without a paired `.catch(`) — every hit
  resolved to either a properly-chained `.catch()` on a following line (e.g.
  `data.ts:126` inside the view-count flush) or an inert client-side callback (clipboard copy,
  dynamic `import()`), consistent with the prior cycle's identical sweep.

## Caveats

- DBG-01 was verified with a synthetic reimplementation of the exact bounds-check logic
  (copy-pasted from the real source) run under plain `node` against a hand-crafted buffer — not by
  driving the actual TypeScript module through its real import graph (which would require the
  project's build/test tooling), and not by constructing a full, otherwise-valid HEIF/AVIF file. The
  underlying arithmetic and control flow are copied verbatim from the real functions, so confidence
  in the mechanism is high, but this was not reproduced as an end-to-end upload through the running
  application.
- DBG-02's race window was not reproduced against a live MySQL instance under concurrent load; it is
  derived from reading the `Promise.all` control flow and confirming (via `getImageCount`/
  `buildImageConditions`/`buildTagFilterCondition`) that the predicates are structurally equivalent,
  so the only remaining gap is the atomicity one described.
- This lane did not run the test suite, lint, typecheck, or build (read-only latent-bug hunting per
  the task brief); no source files were modified.
