# Document Specialist — Cycle 2 review-plan-fix loop (2026-04-25)

## Lens

Did docs and code agree post-plan-301? Are doc claims still accurate?

## Findings

### DS2L-INFO-01 — `humanizeTagLabel` JSDoc claims a single source of truth that doesn't yet hold

- **File:** `apps/web/src/lib/photo-title.ts:17-27`
- **Severity / Confidence:** INFO / High
- **Why:** JSDoc reads: "The single source of truth for the transform lives here so visible UI, alt text, and structured-data emitters cannot drift from each other." Two render paths (photo-viewer info sidebar, info bottom sheet) emit raw `tag.name`, so the documented invariant is false in the current state.
- **Resolution:** Either (a) fix the two surfaces (preferred, see CR2L-LOW-02) and the doc becomes truthful, or (b) weaken the doc claim to "intended single source of truth; some legacy chip rendering still bypasses". (a) is preferred.

### DS2L-INFO-02 — `buildHreflangAlternates` JSDoc claims forward-compat extends to every consumer

- **File:** `apps/web/src/lib/locale-path.ts:76-87`
- **Severity / Confidence:** INFO / High
- **Why:** JSDoc reads: "Iterates the `LOCALES` constant so adding a new locale automatically extends the alternate-language map at every consumer (no inline `{ en: ..., ko: ... }` literals to keep in sync)." The root layout still has the inline literal. The claim is aspirational but not yet true.
- **Resolution:** Same as DS2L-INFO-01 — fix the layout consumer (see CR2L-LOW-01) and the doc becomes truthful.

### DS2L-INFO-03 — Plan-301 status is correctly marked DONE for its declared DOD

- **File:** `.context/plans/plan-301-cycle1-loop-fresh-fixes.md`
- **Severity / Confidence:** INFO / High
- The plan called out four caller surfaces; plan-301 hit those four. The two/one missed consumers (photo-viewer/layout) were not in plan-301's caller inventory; the new cycle-2 plan should treat them as fresh in-scope items, not as "plan-301 incomplete".
- **Resolution:** Plan-301's DONE marker is honest given its declared scope. Cycle-2 plan-303 (or whatever number is next) addresses the residual consumers.

## Doc-code-fact alignment

- CLAUDE.md sections accurately describe the current state of the repo (no stale claims).
- AGENTS.md guidance was followed (gitmoji semantic commits, push after each task).
- The deferred-cycle1 plan-302 correctly flagged the items it deferred.

No CLAUDE.md / AGENTS.md / context drift surfaced this cycle.
