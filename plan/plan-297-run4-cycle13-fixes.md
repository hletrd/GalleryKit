# Plan 297 — Run-4 Cycle 13 fixes

**Source review:** `.context/reviews/run4-cycle13/_aggregate.md`
**Scope:** the single scheduled finding COR-R4C13-01 (MED/High, CONFIRMED,
6/6 cross-angle agreement), which also closes COR-R4C13-02 (LOW),
TEST-R4C13-01 (gap), and DES-R4C13-A (MED, resolved-by-backend-fix).

Correctness findings are non-deferrable per the loop rules — scheduled here.

## Task 1 — carry `map_visible` (and authoritative `image_filename`) through the topic rename recreate

**Finding:** `updateTopic`'s rename path
(`apps/web/src/app/actions/topics.ts:236-259`) re-creates the topic row
with only `{label, slug, order, image_filename}`. `topics.map_visible`
(`db/schema.ts:11`, `NOT NULL DEFAULT false`, US-P21) resets to `false` on
every slug rename — the topic's photos silently drop off the public `/map`
and the admin Switch shows OFF with no feedback. Additionally,
`image_filename` is carried from a SELECT taken before the route lock
(`topics.ts:213`), a small two-admin TOCTOU.

**Change (apps/web/src/app/actions/topics.ts):**
1. Widen the in-transaction existence SELECT (currently
   `{ slug: topics.slug }` at lines 239-242) to also fetch
   `image_filename` and `map_visible` — this row becomes the authoritative
   pre-rename state, read under the route lock AND inside the transaction.
2. Compute `nextImageFilename = imageFilename ?? transactionTopic.image_filename ?? null`
   (replacing the pre-lock `previousImageFilename` carry at line 237 —
   the outer SELECT remains only for the post-success previous-image
   cleanup compare at line 282, which stays as-is).
3. Add `map_visible: transactionTopic.map_visible` to the replacement
   insert (lines 248-253).
4. Comment the carry contract: the recreate-row idiom requires every
   non-form `topics` column to be threaded through; the rename test pins
   the VALUES.

**Tests (apps/web/src/__tests__/topics-actions.test.ts):**
- Extend the `@/db` mock's `topics` export with
  `map_visible: 'topics.map_visible'` (and keep shape parity).
- Update the existing rename test ("renames topics by inserting the
  replacement row before moving child references"): the fake tx SELECT
  returns `[{ slug: 'old-topic', image_filename: 'old-topic.webp',
  map_visible: true }]`; capture the `txInsert(...).values(payload)`
  payload and assert it equals the full expected object
  `{ label, slug, order, image_filename: 'old-topic.webp',
  map_visible: true }` — an exact-object assertion so any future
  unthreaded column addition is a conscious test edit, not a silent
  reset.
- Add a second rename case where a NEW image was uploaded
  (`processTopicImageMock` resolves) asserting the payload carries the
  NEW filename while `map_visible` still carries `true` from the
  authoritative row.
- Prove the value assertion fails against the pre-fix source (run once
  with the fix reverted locally) before committing.

**Acceptance:**
- Rename of an opted-in topic preserves `map_visible = true` (unit-proven).
- Payload assertion red on pre-fix source, green post-fix.
- All 8 gates green (eslint, typecheck, vitest, api-auth, action-origin,
  public-route-rate-limit, build, e2e).

**Non-goals:** no FK `ON UPDATE CASCADE` restructuring (rejected in the
perf/architect angle); no UI warning (DES-R4C13-A resolves via this fix);
no audit-event addition for the carried value (no transition occurs once
carried).

## Gate work (QUALITY-GATE FIX REQUIREMENT)

Run all 8 configured gates repo-wide after the fix; fix any error-level
issue uncovered. Baseline pre-change: vitest 183/1747 green.

## Deploy

- [ ] DEPLOY_MODE=per-cycle: after gates green and pushes done, run
      `npm run deploy` once; record result below.

## Progress

- [x] Task 1 implemented (`apps/web/src/app/actions/topics.ts` — tx SELECT
      widened to `{slug, image_filename, map_visible}`; payload carries
      both; `nextImageFilename` now sourced from the in-transaction row,
      closing COR-R4C13-02; carry-contract comment added)
- [x] Tests extended (exact-payload assertion on the rename insert +
      new-image rename case asserting new filename wins while map_visible
      carries; `map_visible` added to the `@/db` mock topics shape)
- [x] Red-proof: with the topics.ts fix stashed, BOTH payload assertions
      failed (`map_visible: true` missing from the inserted object);
      restored fix → 13/13 green
- [x] All 8 gates green: eslint ✅, typecheck ✅, vitest 183 files /
      1748 tests ✅, api-auth ✅, action-origin ✅,
      public-route-rate-limit ✅, build ✅, e2e 20 passed (6.0m) ✅
- [x] Committed `414a8e18` fix(topics) + SW refresh `c813f0a1`
      (`SW_VERSION = 414a8e18-p7`), both GPG-signed, conventional +
      gitmoji
- [ ] Pushed + deploy record appended
