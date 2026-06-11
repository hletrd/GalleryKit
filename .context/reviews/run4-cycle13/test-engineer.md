# Run-4 Cycle 13 — test-engineer angle

Full-inventory in-context pass (single-subagent constraint documented in the
aggregate). Inventory: `__tests__/topics-actions.test.ts` (full mock
infrastructure + every `it` block), the new `image-queue-quiesce.test.ts`
from cycle 12, fixture coverage of the rotation surfaces (csv-escape,
blur-data-url wiring pair, icc fixtures), and the vitest baseline.

## Baseline

`npm test --workspace=apps/web` — 183 files / 1747 tests, all passing
(cycle-12 added 1 file / 2 tests over the plan-293 record of 182/1745).

## Findings

### TEST-R4C13-01 — rename test pins call ORDER but not inserted VALUES
**Severity: gap / Confidence: HIGH — folds into COR-R4C13-01**

- `apps/web/src/__tests__/topics-actions.test.ts:246-291` ("renames topics
  by inserting the replacement row before moving child references") asserts
  `steps === ['insert-topic', 'update-images', 'update-aliases',
  'delete-topic']` and nothing else. The replacement row's column set —
  the exact thing COR-R4C13-01 regressed — is unasserted: the fake
  `txInsert` discards `.values(...)` arguments.
- This is precisely why the `map_visible` reset shipped silently when
  US-P21 added the column (2026-05-03): the suite cannot see WHAT the
  rename writes, only THAT it writes.
- Required with the fix:
  1. The fake tx SELECT must return an authoritative row carrying
     `map_visible: true` (and an `image_filename`), exercising the carry
     path.
  2. Capture `txInsert(...).values(payload)` and assert the payload
     includes `map_visible: true` and the carried `image_filename` — so
     the NEXT `topics` column addition that misses the recreate site fails
     this test instead of shipping another silent reset (the assertion
     should compare against an explicit expected object, making any new
     unthreaded column a conscious test edit).
- Note the test's `@/db` mock exports a hand-rolled `topics` shape
  (`{ slug, image_filename }`); it needs `map_visible: 'topics.map_visible'`
  added to stay representative.

## Coverage notes on rotation surfaces (adequate, no action)

- `csv-escape` — dedicated fixture tests exist (per CLAUDE.md lineage) and
  the helper is pure; mutation coverage of the pass ORDER is implicit in
  the bypass-shaped cases. Adequate.
- `blur-data-url` — producer/consumer wiring pair locked by
  `process-image-blur-wiring.test.ts` / `images-action-blur-wiring.test.ts`.
  Adequate.
- `image-queue-quiesce.test.ts` (new, c12) — re-read in full: the fake
  models the paused-queue reachability correctly, rejects instead of
  hanging, and the order assertion is exact. Good shape; no flake surface
  (no timers beyond an unref'd 60 s handle that is cleared in the quiesce
  under test... verified `populateState` clears any prior timer first).
- e2e: no e2e exercises topic rename + map flow; unit-level VALUES
  assertion is the right cost point (a full e2e would need MySQL + map
  page; the dual-layer guard in `getMapImages` already has its own tests).

## Flake sweep

- No new `setTimeout`-dependent assertions added in c12; the quiesce test
  resolves promises synchronously. No flaky patterns observed in the new
  file. CI duration unchanged (~140 s locally).
