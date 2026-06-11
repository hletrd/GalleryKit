# Run-4 Cycle 13 — document-specialist angle

Full-inventory in-context pass (single-subagent constraint documented in the
aggregate). Inventory: CLAUDE.md claims touching the rotation surfaces
(race-condition section, key-tables section, upload-flow sections), AGENTS.md
git rules, in-code contract comments on the rotation surfaces, and the
cycle-12 fix commit message vs. shipped code.

## Findings

### DOC-R4C13-01 — CLAUDE.md "Topic slug rename" claim remains TRUE but incomplete
**Severity: INFO / Confidence: HIGH**

- CLAUDE.md Race Condition Protections: "Topic slug rename: Transaction
  wraps reference updates before PK rename" — accurate as far as it goes
  (verified against `topics.ts:236-259`: insert → images update → aliases
  update → delete, all in one tx, under the route lock).
- What it does not say (and what bit us): the "rename" is a recreate, so
  non-form columns must be explicitly carried. After the COR-R4C13-01 fix
  the carry becomes real; no CLAUDE.md edit is REQUIRED (the claim never
  asserted column preservation), but the fix commit body should state the
  carry contract for future archaeology. Recorded for provenance; no doc
  change scheduled.

### DOC-R4C13-02 — CLAUDE.md key-tables list omits `map_visible` / US-P21 entirely
**Severity: INFO / Confidence: HIGH — observation, no mismatch**

- The "Database Schema (Key Tables)" section lists `topics - Photo
  albums/categories` without columns; the public-/map opt-in feature
  (US-P21) appears nowhere in CLAUDE.md (the Privacy section covers GPS
  exclusion from public API responses, which `getMapImages` deliberately
  pierces for opted-in topics behind its dual-layer guard).
- Not a code/doc CONTRADICTION (the schema section is name-level only),
  so per the no-new-work rule this is recorded as an observation rather
  than scheduled doc churn. Exit criterion: next CLAUDE.md edit touching
  the Privacy or schema sections should mention the per-topic map opt-in
  in passing.

## Verified accurate this cycle

- Cycle-12 commit `ef1ea136` message vs. code: the described
  `pause → clear → onIdle` order, the state-clears-after-await rationale,
  and the bootstrap re-discovery contract all match the shipped diff.
- `process-topic-image.ts` header comments (orphan cleanup contract,
  ARCH-R4C2-06 size-cap single-sourcing) match call sites
  (`image-queue.ts` bootstrap calls `cleanOrphanedTopicTempFiles`).
- `csv-escape.ts` long-form comment lineage (C7R/C8R IDs) matches the
  implemented pass order exactly.
- `blur-data-url.ts` comments match the producer/consumer wiring and the
  fixture tests named in CLAUDE.md.
- `icc-extractor.ts` header (v2 `desc` ASCII / v4 `mluc` UTF-16BE,
  locale-matched, P4-E1) matches implementation.
- CLAUDE.md test-surface claim (`npm test --workspace=apps/web`) matches
  the green 183/1747 baseline.
