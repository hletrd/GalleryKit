# Cycle 5 Aggregate Review

Date: 2026-07-18 KST
Review HEAD: `4926a3e4`

## Agent coverage

Completed provenance reviews: code-reviewer, perf-reviewer,
security-reviewer, critic, verifier, test-engineer, tracer, architect,
debugger, document-specialist, and designer. The environment exposed one child
review slot, so one review worker covered all eleven named lenses and wrote one
file per role. It inventoried the maintained repository, checked the governing
documentation and historical reviews/plans, ran the configured static/unit
baseline, and performed a browser-backed designer pass against production at
320, 393, 768 (DPR 2), 769 (DPR 2), and 1536 CSS pixels.

The aggregation pass revalidated every candidate against source and Git,
deduplicated 19 role-level reports into the three cross-agent classes below,
and added one adjacent main-gallery correctness issue found while tracing the
shared responsive-size fix through the item-count-dependent column policy.

## New deduplicated findings

### C5-01 — Responsive image hints disagree with the actual column breakpoints

- Severity / confidence: **Medium / High**
- Status: **Confirmed live** on the main gallery; sibling archive/share impact
  is source-confirmed
- Agreement: code-reviewer, perf-reviewer, critic, verifier, test-engineer,
  tracer, architect, debugger, designer
- Regions: `apps/web/src/components/masonry-card.tsx:21,94-109,126-142`;
  `apps/web/src/app/[locale]/(public)/timeline/page.tsx:229,259-285`;
  `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:191,218-244`;
  `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:187,218-244`
- Failure: Tailwind activates `sm`/`md`/`xl`/`2xl` at inclusive minimum
  widths, while the image rules use inclusive `max-width` branches that keep
  the preceding wider slot at 640, 768, and 1280 px. Fresh Chromium at 768 px
  and DPR 2 rendered a 234.66 px three-column card but advertised 50vw and
  selected the 1536w AVIF; 769 px selected 640w for effectively identical
  geometry. The shared-group rule additionally omits its 1024 px three-column
  and 1280 px four-column transitions over broad ranges.
- Fix: centralize layout-specific responsive-size policy with descending
  `min-width` ranges aligned to the Tailwind breakpoints, reuse it on every
  AVIF/WebP/JPEG/fallback path, and add exact-boundary regression coverage.

### C5-02 — Main-gallery responsive sizes ignore item-count-limited columns

- Severity / confidence: **Medium / High**
- Status: **Confirmed source-level correctness defect; uncommon small-gallery
  production state needs manual validation**
- Agreement: aggregation-pass adjacent-flow finding
- Regions: `apps/web/src/components/home-client.tsx:247-271,324-329` and
  `apps/web/src/components/masonry-card.tsx:21,94-109,126-142`
- Failure: `HomeClient` deliberately limits every responsive column count to
  `itemCount`, so a gallery with one image remains one full-width column and a
  gallery with two images never exceeds two columns. `MasonryCard` nevertheless
  always advertises the five-column desktop rule. At 1536 px, a single full-
  width photo is advertised as 20vw, encouraging selection of the 640w
  derivative for a roughly 1400 px display box and producing visible softness;
  two-to-four-photo galleries have the same mismatch at smaller magnitudes.
- Fix: derive the main-gallery `sizes` value from the same item-count caps as
  its responsive column classes, pass that stable value to each card, and pin
  one/few/many-image outputs in unit tests.

### C5-03 — Masonry E2E conflates two independent scheduling attributes

- Severity / confidence: **Medium / High**
- Status: **Confirmed test-logic defect; current production attributes are
  correct**
- Agreement: code-reviewer, critic, verifier, test-engineer, debugger
- Region: `apps/web/e2e/masonry-priority.spec.ts:22-49`
- Failure: the test records a card only when `loading="eager"` **and**
  `fetchpriority="high"` are both present. A non-first card regressing to
  eager/auto or lazy/high is filtered out, leaving `priorityIndices === [0]`
  even though the browser received an unintended scheduling instruction.
- Fix: collect and assert eager and high-priority index sets independently,
  require each to equal `[0]`, and explicitly require all non-first cards to be
  lazy with auto/absent fetch priority. Preserve geometry and request proofs.

### C5-04 — Cycle 4's plan remains active and pending after signed publication

- Severity / confidence: **Low / High**
- Status: **Confirmed** for implementation, signed commits, and remote push;
  the exact deployed SHA remains manual-validation
- Agreement: critic, verifier, tracer, architect, document-specialist
- Regions: `.context/plans/cycle-4-2026-07-18-plan.md:5,18-42,61-69` and
  `.context/plans/README.md:34-38`
- Failure: every work package and gate is checked, commits `b72bb0cd`,
  `ff5d4cd6`, and `4926a3e4` have good signatures, and
  `master == origin/master == 4926a3e4`, but the authoritative plan still says
  implementation is pending and leaves commit/push/deploy unchecked. Recovery
  can repeat completed work or use the wrong frontier.
- Fix: reconcile implementation and signed-push state, distinguish observable
  live verification from unavailable exact deploy-SHA proof, archive Cycle 4,
  and advance the active-plan index.

## Revalidated carry-forward findings

The shared image-queue/backfill pool budget, warn-only single-writer topology,
failed-deploy rollback, SQL/file restore generation, large-map rendering,
semantic-vector scanning, and environment/manual browser proofs remain in
`.context/plans/deferred-carry-forward.md` with their original severity,
confidence, reason, and exit criterion. No exit criterion fired, and Cycle 5
does not reclassify or newly defer them.

## Baseline evidence and final sweep

The review worker reported green ESLint, API-auth lint,
action-origin/mutation-barrier lint, public-route-rate-limit lint, typecheck,
production dependency audit, and full Vitest (361 files passed, 2 skipped;
3,409 tests passed, 4 expected CLIP skips). Live browser checks also confirmed
the current nav disclosure/focus behavior and current one-card eager/high state.
These are review baselines; Prompt 3 must rerun every configured blocking gate
against the implementation tree.

The final aggregate sweep checked recent diffs, sibling gallery surfaces,
item-count-dependent layout, auth/rate-limit/barrier exports,
migration/journal/reconcile invariants, privacy projections, upload/delete/
restore races, caches, and deployment scripts. No further fresh finding
survived validation.

## AGENT FAILURES

A second parallel worker start was rejected by the global thread limit. The
available worker completed all eleven required perspectives and provenance
files, so no named review perspective was dropped.
