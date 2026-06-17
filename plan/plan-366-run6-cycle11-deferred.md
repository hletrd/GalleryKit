# Plan 366 — Run-6 Cycle-11 Deferred Register

**Created:** 2026-06-17
**HEAD at planning:** `a7de3ebd`
**Source:** `.context/reviews/_aggregate.md` (cycle-11 fan-out, 11/11 agents) + per-agent reviews.
**Status:** DEFERRED REGISTER. Per the review-plan-fix deferred-fix rules, this lists every cycle-11 finding NOT scheduled in `plan-365-run6-cycle11-fixes.md`, with file+line, **original** severity/confidence (NOT downgraded to justify deferral), a concrete deferral reason, and the exit criterion that re-opens it. Existing review findings only — no new refactors/features introduced.

**Deferral integrity / repo-policy basis.** The single deferred item is a UI touch-target deviation on a full-width text-entry field, carried forward unchanged from cycle-10 (DEF-C10-01). It is NOT a security, correctness, or data-loss finding (none of which are deferrable). The repo's own touch-target enforcement (`touch-target-audit.test.ts`) deliberately excludes `<Input>` from scope, so deferring an `<Input>` height observation is consistent with the established repo convention.

No security, correctness, or data-loss finding has been deferred this cycle (none surfaced).

---

## DEF-C11-01 [LOW — designer originally rated MEDIUM/conf-M] — Search dialog `<Input>` is 32 px tall (`h-8`), below the documented 44 px touch-target floor

**Carried forward unchanged from:** plan-364 DEF-C10-01.

**Where:** `apps/web/src/components/search.tsx:374` — `className="border-0 p-0 h-8 shadow-none focus-visible:ring-2 ..."` on the search combobox `<Input>` (inside a `flex items-center gap-2 p-4 border-b` row).

**Original severity/confidence (preserved, not downgraded):** designer rated **MEDIUM / conf-M**. Aggregator real-world severity: **LOW**.

**Why deferred (concrete reason):**
1. Single-line full-width text-entry field (~470 px wide). The tappable target is enormous horizontally; only the vertical extent is 32 px. WCAG 2.5.5 (AAA, 44 px) and 2.5.8 (AA, 24 px — already cleared) target discrete tap targets; a full-width text input behaves differently (tap anywhere in the field; on mobile the keyboard opens on focus).
2. Existed since commit `1312d29b`; survived 10 review cycles including dedicated photographer-rN UI passes and the blocking `touch-target-audit.test.ts`, which deliberately scans `Button`/`button`/`Badge asChild`/`select` but NOT `<Input>` (text fields are intentionally out of scope) — a known, accepted boundary of the repo's policy.
3. The orchestrator's strong anti-manufacturing directive: a one-line `h-8`→`h-11` change with negligible UX benefit on an already-large target, or audit-fixture churn to bring `<Input>` into scope, would be marginal. Honest convergence is the desired signal.

**Repo-rule basis for deferral:** Not a security/correctness/data-loss finding (those are non-deferrable). It is a UI-polish deviation on a surface the repo's own enforced policy explicitly excludes from scope.

**Exit criterion (re-open + fix `h-8`→`h-11` AND extend `touch-target-audit.test.ts` FORBIDDEN patterns to cover `<Input>` sub-44 explicit heights):** IF ANY of —
- (a) the search field is reworked into a multi-control composite where the input is no longer full-width; OR
- (b) a real mobile-usability report cites the search field's height; OR
- (c) the repo decides to bring `<Input>` under the touch-target-audit scope (at which point this becomes a hard, blocking test failure that MUST be fixed in the same change).

**File+line for tracking:** `apps/web/src/components/search.tsx:374`.

---

## Rejected this cycle (recorded for traceability — NOT deferred, NOT scheduled)

### REJ-C11-01 — `aria-controls` referencing a conditionally-unmounted disclosure region (carried from REJ-C10-01)
**Where:** `apps/web/src/components/similar-photos.tsx:116`, `apps/web/src/components/color-details-section.tsx:290`.
**Disposition: REJECTED — not a defect.** MDN's `aria-controls` documentation states verbatim that `aria-controls` "only needs to be set when the popup is visible, but it is valid and easier to program to reference an element that is not visible." Referencing a not-currently-present controlled element is explicitly valid and recommended; NOT a WCAG 4.1.2 failure. The cycle-8 wiring (AGG-C8-11) uses exactly this MDN-endorsed pattern. The cycle-11 designer's authoritative verdict is ZERO new findings; a stale appended cycle-10 fragment re-stating this was removed from `designer.md` during aggregation. No change. (Full rationale in `.context/reviews/_aggregate.md` § REJ-C11-01 and the cycle-10 plan-364 register.)

---

## Pre-existing deferred items still open (carried forward — see their own registers)

- **DEF-C8-1 / DEF-C8-2 / DEF-C8-3** (plan-361, run-6 cycle-8 deferred register): the three architecture-dependent CLIP items (main-thread inference / worker-pool design, load-time integrity verification, reload-storm hardening). Each requires an architect-led concurrency-architecture design pass and remains correctly deferred with its own re-open criteria. NOT re-opened this cycle — the cycle-11 architect confirmed the CLIP config double-gate is fail-closed end-to-end and the advisory-lock pairing has no leak; the live feature operates within their documented bounded mitigations. Status unchanged; see plan-361 for the authoritative register.

---

## Coverage assertion

Every cycle-11 finding is now accounted for:
- AGG-C11-01 (LOW, test-only) → scheduled + implemented in plan-365 TASK-1.
- DEF-C11-01 (LOW; designer MEDIUM) → deferred here with file+line, preserved severity, reason, exit criterion.
- REJ-C11-01 → rejected here + in the aggregate with authoritative-source rationale.
- Optional non-findings (architect comment reword; doc-fidelity) → not scheduled, do not block convergence.

No security, correctness, or data-loss finding has been deferred.
