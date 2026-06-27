# Verifier Report — Cycle 17 / HEAD 7b5c1943

**Date:** 2026-06-27
**Verifier:** Cycle-17 Verifier subagent (a85c860ee9ebaa5d2)
**Scope:** 8 cycle-16 commits (097c472b, 78a9c0c2, 41e85994, caa57769, d39e9863, bdf6fcdb, ada6817b, ad4e130d)
**Test run:** `npm test --workspace=apps/web` — 2112 passed, 4 skipped (233 test files)

---

## Per-Fix Verdict Table

| # | Commit(s) | Fix | Gate Verdict | Evidence |
|---|-----------|-----|-------------|---------|
| 1a | 097c472b | topic_views re-point before slug rename/delete | CONFIRMED | `topics-actions.test.ts`: steps array must contain `'update-views'` in order; reverting the `tx.update(topicViews)` call removes it, test fails |
| 1b | 35d7f171 | smart_collections predicate remap on slug rename | **VACUOUS GATE** | `topics-actions.test.ts` mock returns rows with no `query_json`; all rows hit `continue` and `tx.update(smartCollections)` is never asserted; reverting the loop passes all tests |
| 2 | 78a9c0c2 | upload-tracker claim-before-await TOCTOU fix | CONFIRMED | `images-action-toctou-claim.test.ts`: source-order guards `claimIdx < diskAwaitIdx` and `claimIdx < topicQueryIdx` fail on revert; rollback-count assertion (exactly 3) also gates |
| 3 | 41e85994 | isAdmin gating for bit_depth / isP3Pipeline in photo-viewer | CONFIRMED (photo-viewer); PARTIAL (info-bottom-sheet) | `photo-viewer-no-hdr-download.test.ts`: regex `/isAdmin\s*&&\s*hasExifData\(image\.bit_depth\)/` and `/isAdmin\s*&&\s*isP3Pipeline\(image\.color_pipeline_decision\)/` verified at lines 890/961; `info-bottom-sheet.tsx` line 500 has the same gate but no test scans it |
| 4 | caa57769 | `0024_drop_reactions` journal + reconcile DDL | CONFIRMED | `migrate-reconcile-coverage.test.ts`: requires `dropTableIfPresent(connection, 'image_reactions')` and `dropColumnIfPresent(connection, dbName, 'images', 'reaction_count')` in comment-stripped migrate.js source; verified at lines 638-639 |
| 5 | d39e9863 | BoundedMap immutable-increment (`.set()` not `++`) | CONFIRMED | `bounded-map-rate-limit-increment.test.ts`: positive pattern `count: entry.count + 1` required in sharing.ts, admin-users.ts, embeddings.ts; `entry.count++` and `entry.count +=` forbidden; revert fails negative assertions |
| 6 | bdf6fcdb | search-route PII guard | CONFIRMED | `search-route-privacy.test.ts`: any `images.<pii-col>` reference in semantic/route.ts or similar/[id]/route.ts fails; covers 17 PII columns including latitude, longitude, bit_depth, color_pipeline_decision |
| 7 | ada6817b | `Number.isFinite(len)` guard in og-photo-fetch | CONFIRMED | `og-photo-fallback.test.ts` line 92: regex `/Number\.isFinite\(len\)\s*&&\s*len\s*>\s*OG_PHOTO_MAX_BYTES/` fails without the guard; runtime test at line 138-150 covers oversize rejection path |
| 8a | ad4e130d | GPS Infinity + out-of-range → null | CONFIRMED | `process-image-metadata.test.ts` lines 188-225: `expect(exif.latitude).toBeNull()` for Infinity and >90/180° inputs; out-of-range guard in process-image.ts line 1461 is the unique gate for range check; Infinity is double-covered (lines 1455 + 1461) |
| 8b | ad4e130d | CSV interlinear strip (U+FFF9-FFFB) | CONFIRMED | `csv-escape.test.ts` line 35: `expect(escapeCsvField('a￹b￺c￻d')).toBe('"abcd"')` fails if `￹-￻` removed from `UNICODE_FORMAT_CHARS` in validation.ts |
| 8c | ad4e130d | COLOR_IMPACTING_KEYS exhaustiveness | CONFIRMED | `settings-hash.test.ts` line 37: `expect([...COLOR_IMPACTING_KEYS].sort()).toEqual(expected)` pins exactly the 9 documented keys; any add or remove fails |

---

## Gaps Found

### GAP-1 — VACUOUS GATE: smart_collections re-point integration (35d7f171)
**Risk: MEDIUM**

The `topics-actions.test.ts` mock for `tx.select({…}).from(smartCollections)` returns `[{ slug: 'old-topic', image_filename: 'old-topic.webp', map_visible: true }]` — a row with no `query_json` property. The production code at `topics.ts` (the loop on lines ~301-318) has:

```ts
if (typeof collection.query_json !== 'string') continue;
```

Because the mock row has `query_json: undefined`, every iteration hits `continue` and `tx.update(smartCollections)` is never called. The test has no assertion that verifies the update occurred.

The `smart-collections.test.ts` (`remapTopicSlugInQuery`) IS non-vacuous for the helper function in isolation, but it does not verify that `updateTopic` in `topics.ts` actually calls it.

**Impact:** Reverting the smart_collections loop from `topics.ts` would pass the full test suite. This means the integration (that a topic slug rename actually rewrites stored smart-collection query ASTs) is untested.

**Suggested fix:** Add one test scenario to `topics-actions.test.ts` where the mock `txSelect` for `.from(smartCollections)` returns a row with a valid `query_json` string containing the old topic slug in a `eq`/`in` predicate, and assert that `tx.update(smartCollections)` is called with the remapped JSON.

### GAP-2 — PARTIAL GATE: info-bottom-sheet.tsx isAdmin gating (41e85994)
**Risk: LOW**

`photo-viewer-no-hdr-download.test.ts` (lines 36-51) scans only `apps/web/src/components/photo-viewer.tsx`. The same commit also gates `isP3Pipeline(image.color_pipeline_decision)` behind `isAdmin &&` in `apps/web/src/components/info-bottom-sheet.tsx` (line 500), but no test scans that file. The `bit_depth` isAdmin gate in `info-bottom-sheet.tsx` (line 443) is also unscanned.

**Impact:** Reverting the isAdmin gating in `info-bottom-sheet.tsx` alone would pass all tests.

**Suggested fix:** Extend the source-contract test to also scan `BOTTOM_SHEET_PATH = 'src/components/info-bottom-sheet.tsx'` with the same two regex patterns.

---

## Evidence Table

| Check | Result | Command | Output |
|-------|--------|---------|--------|
| Tests | PASS | `npm test --workspace=apps/web` | 2112 passed, 4 skipped (233 files) |
| Build | not re-run (no source change in this verification pass) | — | — |
| Type check | not re-run | — | — |
| Key fix 1a (topic_views order) | CONFIRMED | code reasoning + test read | `steps` array gate non-vacuous |
| Key fix 1b (smart_collections integration) | VACUOUS | code reasoning | mock always skips loop |
| Key fix 2 (TOCTOU) | CONFIRMED | `images-action-toctou-claim.test.ts` | source-order + rollback-count |
| Key fix 3 (isAdmin gating photo-viewer) | CONFIRMED | grep + test read | lines 890/961 match regex |
| Key fix 3 (isAdmin gating info-bottom-sheet) | PARTIAL | grep | line 500 present, no test gate |
| Key fix 4 (migrate reconcile) | CONFIRMED | `migrate-reconcile-coverage.test.ts` | lines 638-639 match required patterns |
| Key fix 5 (BoundedMap immutable) | CONFIRMED | `bounded-map-rate-limit-increment.test.ts` | positive + negative assertions |
| Key fix 6 (search PII) | CONFIRMED | `search-route-privacy.test.ts` | 17-column scan of two route files |
| Key fix 7 (Number.isFinite) | CONFIRMED | `og-photo-fallback.test.ts` | regex + runtime test |
| Key fix 8a (GPS Infinity/range) | CONFIRMED | `process-image-metadata.test.ts` | lines 188-225 |
| Key fix 8b (CSV interlinear) | CONFIRMED | `csv-escape.test.ts` line 35 | live-char assertion |
| Key fix 8c (COLOR_IMPACTING_KEYS) | CONFIRMED | `settings-hash.test.ts` line 37 | exact 9-element set |

---

## Overall Verdict

**PASS with two flagged gaps.**

All 2112 tests pass. Nine of the ten sub-fixes have non-vacuous test gates. Two gaps require action before the cycle can be considered fully covered:

1. **GAP-1 (MEDIUM):** The smart_collections re-point integration has a vacuous gate; add a test with a `query_json`-bearing mock row to `topics-actions.test.ts`.
2. **GAP-2 (LOW):** The `info-bottom-sheet.tsx` isAdmin gating is unscanned; extend the photo-viewer source-contract test to also scan that file.

These gaps do not block shipping the current fixes, but GAP-1 means a future refactor could silently drop the smart-collection predicate remap without any test failure.
