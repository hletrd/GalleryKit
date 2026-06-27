# Test Engineer Review — Cycle 17 (HEAD 7b5c1943)

Date: 2026-06-27
Baseline: 2112 tests / 231 test files passing before this cycle.
After: 2116 tests / 232 test files passing.

---

## Summary

**3 gaps found. 4 tests written. All gaps closed.**

| Gap | Severity | Location | Status |
|-----|----------|----------|--------|
| DBG-16-03: `updateTopic` smart-collections write-back never exercised | HIGH | `topics-actions.test.ts:285` (old mock) | CLOSED |
| DES-16-02/C16-F2: `info-bottom-sheet.tsx` `isAdmin &&` gate not pinned | MEDIUM | `photo-viewer-no-hdr-download.test.ts` (missing) | CLOSED |
| `SEMANTIC_SCAN_LIMIT` hard cap not source-contract locked | MEDIUM | `semantic-search-route.test.ts:241` (comment-only) | CLOSED |

---

## Cycle-16 Fix Assessment

### DBG-16-01 — topic_views re-pointing before rename delete
**PINNED. Non-vacuous.**

`topics-actions.test.ts:330` asserts:
```
expect(steps).toEqual(['insert-topic', 'update-images', 'update-aliases', 'update-views', 'delete-topic'])
```
Removing the `tx.update(topicViews)` call causes `'update-views'` to disappear from the steps array
and the assertion fails immediately. The ordering constraint (update-views before delete-topic,
preventing ON DELETE CASCADE from wiping analytics history) is enforced.

### DBG-16-03 — smart-collection rules re-pointed on slug rename
**WAS UNPINNED. NOW CLOSED.**

Root cause of the gap: the rename test at line 285 used `vi.fn().mockReturnValue(makeSelectChain([{slug, image_filename, map_visible}]))` — `mockReturnValue` (not `mockReturnValueOnce`), which means EVERY call to `txSelect` inside the transaction returned the same topic-shaped row. When the smart-collections scan ran (`await tx.select({id, query_json}).from(smartCollections)`), it also received `[{slug, image_filename, map_visible: true}]`. `typeof collection.query_json` was `'undefined'` ≠ `'string'`, so the guard `if (typeof collection.query_json !== 'string') continue;` fired on every iteration. The entire `for` loop body — including `remapTopicSlugInQuery` and `tx.update(smartCollections)` — was NEVER reached. Deleting the entire loop from `apps/web/src/app/actions/topics.ts` would not fail any prior test.

Note: `smart-collections.test.ts` covers `remapTopicSlugInQuery` in isolation (pure function, no DB). Those tests are non-vacuous. The gap was specifically the integration wiring: `updateTopic → tx.select(smartCollections) → tx.update(smartCollections)` on changed rows.

New test added to `topics-actions.test.ts`:
- Uses `mockReturnValueOnce` twice: first call returns the topic row; second returns `[{id: 99, query_json: '{"type":"predicate","column":"topic","operator":"eq","value":"old-topic"}'}]`.
- Captures payloads passed to `tx.update(smartCollections).set(...)` via a custom `txUpdate` mock that checks `table.id === 'smart_collections.id'`.
- Asserts `collectionUpdates.length === 1` and `JSON.parse(collectionUpdates[0].query_json).value === 'new-topic'`.
- Reverting the for-loop or removing the `tx.update(smartCollections)` call leaves `collectionUpdates` empty → assertion fails.

### CR-16-01 — upload-tracker TOCTOU claim-before-await + rollback
**PINNED. Non-vacuous.**

`images-action-toctou-claim.test.ts` uses `indexOf` ordering comparisons:
- `tracker.bytes += totalSize` index < `await ensureUploadDirectories()` index.
- `tracker.count += files.length` index < `db.select({ slug: topics.slug })` index.
- Exactly 3 occurrences of `settleUploadTrackerClaim(..., 0, 0)` for the rollback paths.

Moving any claim after its `await` fails the `toBeLessThan` assertion. Removing a rollback call fails the count check.

### DES-16-02 / C16-F2 — `isAdmin` gate in photo-viewer.tsx
**PINNED. Non-vacuous.**

`photo-viewer-no-hdr-download.test.ts:41,49` asserts:
- `/isAdmin\s*&&\s*hasExifData\(image\.bit_depth\)/` present in photo-viewer.tsx.
- `/isAdmin\s*&&\s*isP3Pipeline\(image\.color_pipeline_decision\)/` present in photo-viewer.tsx.
- `/\{\s*hasExifData\(image\.bit_depth\)\s*&&/` NOT present (no ungated form).

### DES-16-02 / C16-F2 — `isAdmin` gate in info-bottom-sheet.tsx
**WAS UNPINNED. NOW CLOSED.**

The same C16-F2 commit added `{isAdmin && isP3Pipeline(image.color_pipeline_decision)}` to BOTH `photo-viewer.tsx` (pinned) AND `info-bottom-sheet.tsx:500`. Only the photo-viewer site was covered. Removing `isAdmin &&` from `info-bottom-sheet.tsx:500` would expose `color_pipeline_decision` (an admin-only `_PrivacySensitiveKeys` field) to public mobile users without failing any prior test.

The existing `is-p3-pipeline.test.ts` only checks that `isP3Pipeline(` exists and is imported — it does NOT assert the `isAdmin &&` prefix in info-bottom-sheet.tsx.

New test added to `photo-viewer-no-hdr-download.test.ts` in a new describe block:
- Asserts `/isAdmin\s*&&\s*isP3Pipeline\(image\.color_pipeline_decision\)/` in info-bottom-sheet.tsx.
- Negative: no ungated `{isP3Pipeline(image.color_pipeline_decision) &&` form.

### TE-16-01 — BoundedMap immutable increment
**PINNED. Non-vacuous.**

`bounded-map-rate-limit-increment.test.ts` scans `sharing.ts`, `admin-users.ts`, `embeddings.ts`:
- Each matches `count:\s*entry\.count\s*\+\s*1` (immutable update).
- Each must NOT match `entry\.count\+\+` or `entry\.count\+=`.

Reverting any file to `entry.count++` fails both positive and negative assertions.

### TE-16-03 — GPS Infinity/range guard (ad4e130d)
**PINNED. Non-vacuous.**

`process-image-metadata.test.ts` behavioral assertions:
- `Infinity` GPS rationals → asserts returned coordinates are `null`.
- Out-of-range lat > 90 / lon > 180 → asserts `null`.
- Valid GPS → asserts non-null.

Removing any guard produces a null/non-null mismatch, not a silent pass.

### TE-16-04 — COLOR_IMPACTING_KEYS set (ad4e130d)
**PINNED. Non-vacuous.**

`settings-hash.test.ts` asserts `[...COLOR_IMPACTING_KEYS].sort()` deep-equals the exact 9-element sorted array. Adding or removing any key fails the exact-match assertion.

### TE-16-05 — CSV interlinear strip (ad4e130d)
**PINNED. Non-vacuous.**

`csv-escape.test.ts` asserts `escapeCsvField('a￺ b￻ c￼ d') === '"abcd"'`. Behavioral assertion on the exact output string.

### C16-F1 — migration 0024 reconcile tripwire
**PINNED.**

`migrate-reconcile-coverage.test.ts` includes DROP tripwire for migration 0024 (`image_reactions` / `reaction_count`), parallel to the existing 0023 tripwire.

### DBG-16-02 — OG photo finite Content-Length guard
**PINNED.**

`og-photo-fallback.test.ts` source-contract asserts `/Number\.isFinite\(len\)\s*&&\s*len\s*>\s*OG_PHOTO_MAX_BYTES/`. Removing the `Number.isFinite` guard changes the comparison semantics silently.

---

## Additional Surfaces Swept

### SEMANTIC_SCAN_LIMIT hard cap — WAS UNPINNED. NOW CLOSED.

`semantic-search-route.test.ts:241` had a comment describing the DB scan limit but NO assertion on the limit value. Mocking the DB call without checking the `.limit(SEMANTIC_SCAN_LIMIT)` argument meant that removing the call from the route allowed an unbounded vector scan but all tests still passed.

New file `semantic-scan-limit-source.test.ts`:
- Asserts `SEMANTIC_SCAN_LIMIT` is imported from `@/lib/clip-embeddings` (not inlined as a magic number).
- Asserts `.limit(\s*SEMANTIC_SCAN_LIMIT\s*)` is present in the route source.

### migrate.js reconcile + baseline
**Well covered.** `migrate-reconcile-coverage.test.ts` (237 lines) covers schema mirrors, index mirrors, and DROP tripwires. No gap.

### Color pipeline decision matrix
**Well covered.** `color-pipeline-decision.test.ts` + `process-image-color-roundtrip.test.ts` exercise all 6 source ICC families with real Sharp invocations. `force_srgb_derivatives` path covered. Non-vacuous.

### remapTopicSlugInQuery (smart-collections pure function)
**Well covered in isolation.** `smart-collections.test.ts` covers eq/in/nested and/or rewrite, non-matching slug, non-topic predicates, contains (not rewritten). Integration wiring was the gap; closed above.

### Rate-limit BoundedMap eviction
`bounded-map.test.ts` covers oldest-entry eviction when `maxSize` is exceeded. `auth-rate-limit.test.ts` covers per-IP/per-account functional behavior. `bounded-map-rate-limit-increment.test.ts` locks the immutable increment pattern. Non-vacuous.

### View-retention GC
`view-retention.test.ts` covers chunked DELETE logic, negative-days guard, and non-finite guard. Non-vacuous.

### CSV escape
`csv-escape.test.ts` covers formula injection, C0/C1 strip, bidi override strip, zero-width strip, and interlinear anchors (TE-16-05). Non-vacuous.

### blur-data-url
`blur-data-url.test.ts` covers `isSafeBlurDataUrl` (MIME whitelist, base64 check, length cap). `process-image-blur-wiring.test.ts` and `images-action-blur-wiring.test.ts` lock the pipeline. Non-vacuous.

### useDisplayCapability / display gamut detection
No behavior tests — requires a browser environment. The hook is tested via import-presence checks only. The conservative `'srgb'` fallback is the safe path; P3 badges are the only affected surface. Risk: LOW.

---

## Tests Written This Cycle

| File | Tests Added | Pins |
|------|-------------|------|
| `src/__tests__/topics-actions.test.ts` | 1 | DBG-16-03: smart-collection write-back integration wiring |
| `src/__tests__/photo-viewer-no-hdr-download.test.ts` | 1 | DES-16-02/C16-F2: info-bottom-sheet `isAdmin &&` gate |
| `src/__tests__/semantic-scan-limit-source.test.ts` (new file) | 2 | SEMANTIC_SCAN_LIMIT import + `.limit(...)` call site |

---

## Verification

```
npm test --workspace=apps/web -- --run
Test Files  232 passed | 2 skipped (234)
     Tests  2116 passed | 4 skipped (2120)
  Duration  ~18.6s
```

Baseline before this cycle: 2112 tests / 231 files. Net: +4 tests / +1 file.

---

## Unpinned Cycle-16 Fixes

**None remain unpinned.** Every fix in the cycle-16 priority list is now either:
- Already pinned by existing tests (DBG-16-01, CR-16-01, DES-16-02/photo-viewer, TE-16-01 through TE-16-05, C16-F1, DBG-16-02), or
- Pinned by tests added this cycle (DBG-16-03, DES-16-02/info-bottom-sheet).

The separately identified SEMANTIC_SCAN_LIMIT gap is also now pinned.
