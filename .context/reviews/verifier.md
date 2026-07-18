# Verifier — Cycle 5 Provenance

Review target: `4926a3e4`. Inventory covered all tracked source, tests,
migrations, scripts, build/deploy configuration, governing docs, and current
review/plan ledgers. Assertions were checked against gates, Git state, and live
browser behavior rather than accepted from comments or checkboxes.

## New findings

### VER-C5-01 — Browser evidence disproves responsive candidate alignment at 768 px

- Severity / confidence: **Medium / High**
- Status: **Confirmed**
- Regions: `apps/web/src/components/masonry-card.tsx:21,94-109`; duplicated archive/share declarations at `timeline/page.tsx:259-275`, `year/[year]/page.tsx:218-235`, and `g/[key]/page.tsx:218-235`
- Evidence/failure: fresh production Chromium at 768×852, DPR 2 reported three columns, a 234.66px card, the 50vw source-size branch, and currentSrc `_1536.avif`. A separate fresh 769px session reported the same geometry and `_640.avif`. This is an actual excess-candidate selection, not a theoretical media-query concern.
- Fix: match `sizes` to the min-width column breakpoints and verify each boundary at DPR 2.

### VER-C5-02 — Priority proof conflates two independent attributes

- Severity / confidence: **Medium / High**
- Status: **Confirmed test-proof defect; live attributes currently correct**
- Region: `apps/web/e2e/masonry-priority.spec.ts:22-49`
- Evidence/failure: the predicate requires eager AND high before recording an index. Either attribute can affect scheduling independently, so a one-attribute regression is invisible. Live production currently reports index 0 eager/high and every other card lazy/auto; the defect is in what the test can prove.
- Fix: derive and assert separate eager and high sets.

### VER-C5-03 — Plan status is contradicted by repository state

- Severity / confidence: **Low / High**
- Status: **Confirmed** for implementation/push; exact deploy commit needs manual confirmation
- Regions: `.context/plans/cycle-4-2026-07-18-plan.md:5,40-42,63-69`; `.context/plans/README.md:34-38`
- Evidence/failure: all implementation/gate boxes are checked, commits `b72bb0cd`, `ff5d4cd6`, and `4926a3e4` have good GPG signatures, and local/remote refs are identical, while the ledger still says implementation and signed push are pending.
- Fix: reconcile the terminal ledger and archive it with separately verified deploy evidence.

## Final sweep

The configured gates passed, including 3,409 Vitest tests. No new mismatch was
found in auth, privacy projection, color/HDR, migration application, or persistence
contracts. Known environment-only proofs remain carry-forward.
