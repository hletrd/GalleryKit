# Cycle 4 Aggregate Review

Date: 2026-07-18 KST
Review HEAD: `01d39653`

## Agent coverage

Completed provenance reviews: code-reviewer, perf-reviewer,
security-reviewer, critic, verifier, test-engineer, tracer, architect,
debugger, document-specialist, designer, and the project-specific
photographer/color-HDR lane. Each lane inventoried its relevant whole-repo
surface and performed a final missed-issue sweep.

The environment provided one child-review slot. The core/performance/security/
architecture lanes ran there; the validation, test, documentation, debugger,
and browser-backed designer lanes ran in this cycle agent. The designer read
and used the full agent-browser skill set against production at 320, 393, and
1536 px, using accessibility snapshots, keyboard interaction, computed DOM
geometry/styles, theme/search states, network/debug buffers, trace, and visual
captures. Authenticated admin, unsupported RTL locales, reliable
reduced-motion emulation in this CLI build, and true cold-cache profiling
remain manual-validation limits; no finding relies on those unavailable proofs.

## New deduplicated findings

### C4-01 — Masonry Playwright coverage claims geometry without asserting geometry

- Severity / confidence: **Medium / High**
- Status: **Confirmed test/evidence defect; current production layout is not
  observed broken**
- Agreement: critic, verifier, test-engineer, debugger,
  document-specialist, designer
- Regions: `apps/web/e2e/masonry-priority.spec.ts:20-32` and the completed
  claim in `.context/plans/cycle-3-2026-07-18-plan.md:23-31`
- Failure: the test asserts that only DOM index 0 carries eager/high attributes
  and that its request occurred, but never reads a rectangle. Live 1536x900
  geometry placed the top-edge CSS-column leaders at non-contiguous indices 0,
  6, 13, 16, and later, whereas 393x852 had only index 0. A future breakpoint
  or masonry-class regression could move index 0 away from the visual top edge
  while leaving its attributes unchanged; both viewport variants would remain
  green and explicit priority could again target a below-fold card.
- Disposition: **Schedule this cycle.** Collect browser-computed card
  rectangles, derive the visual top-edge leaders, prove index 0 belongs to
  that set at both viewports and that desktop has multiple/non-contiguous
  leaders, then retain the explicit-priority and request assertions.

### C4-02 — The one-card priority fix left dead layout-policy APIs and obsolete contracts

- Severity / confidence: **Low / High**
- Status: **Confirmed maintainability defect; runtime behavior is correct**
- Agreement: code-reviewer, tracer, architect
- Regions: `apps/web/src/components/home-client.tsx:26-49,127-145,247-262,344-345`;
  `apps/web/src/components/masonry-card.tsx:23-33`
- Failure: adjacent comments still say media-qualified preloads cover desktop
  first-row cards, and the priority helpers/props still model a wider
  layout-aware policy. The helpers are now identical index-0 predicates and
  ignore `columnCount` / `hasMeasuredViewport`. A maintainer following those
  declarations can treat the removed first-N policy as missing implementation
  and recreate the CSS-column bug Cycle 3 fixed.
- Disposition: **Schedule this cycle.** Expose one universal-first-card
  predicate, remove ignored policy arguments/duplicate derivation, keep column
  count only for intrinsic-size estimation, and update comments/tests to the
  actual ownership boundary.

### C4-03 — Cycle 3 remains documented as pending and active after signed production release

- Severity / confidence: **Low / High**
- Status: **Confirmed release-provenance defect**
- Agreement: code-reviewer, critic, verifier, test-engineer, tracer,
  architect, debugger, document-specialist
- Regions: `.context/plans/cycle-3-2026-07-18-plan.md:5,45-48,56-65` and
  `.context/plans/README.md:34-38`
- Failure: `master == origin/master` at signed `01d39653`, all five Cycle 3
  commits have good signatures, and production renders the shipped tag/nav/
  one-card-priority behavior. The plan nevertheless says signed push/deploy
  are pending and remains active. Recovery work can resume from a false
  frontier or repeat terminal actions.
- Disposition: **Schedule this cycle.** Record the signed frontier and live
  proof, check terminal tasks, mark complete, archive Cycle 3, and advance the
  active index to Cycle 4.

## Revalidated carry-forward findings

These are not newly discovered and retain their authoritative severity,
confidence, reason, and exit criterion in
`.context/plans/deferred-carry-forward.md`:

- shared image-queue/backfill DB-pool oversubscription (High / High);
- warn-only single-writer enforcement with process-local coordination
  (High / High in the security/topology lane);
- failed deploy health without rollback (Medium / High);
- SQL restore/file-store generation mismatch (Medium / High);
- 10,000-row map rendering and repeated semantic vector scans
  (Medium / High);
- existing authenticated-admin, browser-matrix, zoom, model-weight, and broad
  environment validation items.

No security, correctness, or data-loss finding is newly deferred by Cycle 4.

## Baseline evidence and final sweep

The independent lane reported green API-auth, action-origin/mutation-barrier,
public-route-rate-limit, full typecheck, focused 42-test Vitest, and diff
checks. Production SSR and browser interaction confirmed the Cycle 3 runtime
fixes. The final aggregate sweep preserved the geometry-proof defect at the
highest Medium/High classification, kept the distinct dead-policy abstraction
and terminal-ledger findings at Low/High, and mapped every surviving historical
risk to the carry-forward register.

## AGENT FAILURES

A second child-review worker was attempted twice but the thread tree rejected
both starts at its concurrency limit. No perspective was dropped: the six
assigned validation/UI roles were completed locally with their own provenance
files and browser evidence. The one child worker that started returned
successfully.
