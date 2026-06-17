# Plan 364 — Run-6 Cycle-10 Deferred Register

**Created:** 2026-06-17
**HEAD at planning:** `0502ae86`
**Source:** `.context/reviews/_aggregate.md` (cycle-10 fan-out, 11/11 agents) + per-agent reviews.
**Status:** DEFERRED REGISTER. Per the review-plan-fix deferred-fix rules, this register lists every cycle-10 finding NOT scheduled in `plan-363-run6-cycle10-fixes.md`, with file+line, **original** severity/confidence (NOT downgraded to justify deferral), a concrete deferral reason, and the exit criterion that re-opens it. This register is ONLY for existing review findings — no new refactors/features introduced.

**Deferral integrity / repo-policy basis.** The single deferred item is a UI touch-target deviation on a full-width text-entry field. It is NOT a security, correctness, or data-loss finding (none of which are deferrable). The repo's own touch-target policy enforcement (`touch-target-audit.test.ts`) deliberately excludes `<Input>` from scope, so deferring an `<Input>` height observation is consistent with the established repo convention.

---

## DEF-C10-01 [LOW — designer originally rated MEDIUM/conf-M] — Search dialog `<Input>` is 32 px tall (`h-8`), below the documented 44 px touch-target floor

**Where:** `apps/web/src/components/search.tsx:374` — `className="border-0 p-0 h-8 shadow-none focus-visible:ring-2 ..."` on the search combobox `<Input>` (inside a `flex items-center gap-2 p-4 border-b` row at line 339).

**Finding (designer FIND-D2):** the search input renders 32 px tall, under the repo's stated 44 px WCAG 2.5.5 (AAA) touch-target floor.

**Original severity/confidence (preserved, not downgraded):** designer rated **MEDIUM / conf-M**. Aggregator real-world severity assessment: **LOW**.

**Why deferred (concrete reason):**
1. The control is a **single-line text-entry field spanning the full dialog width (~470 px)**. The tappable target is enormous horizontally; only the vertical extent is 32 px. WCAG 2.5.5 (AAA, 44 px) and 2.5.8 (AA, 24 px — already cleared by 32 px) concern discrete tap targets; a full-width text input behaves differently — the user taps anywhere in the wide field, and on mobile the keyboard opens on focus.
2. This `h-8` has existed since commit `1312d29b` and **survived 9 review cycles**, including dedicated photographer-rN UI passes and the blocking `touch-target-audit.test.ts`. The audit deliberately scans `Button` / `button` / `Badge asChild` / native `select` but **NOT `<Input>`** — text-entry fields are intentionally out of the audit's scope, so this is a known, accepted boundary of the repo's touch-target policy, not an oversight.
3. The orchestrator's cycle-10 anti-manufacturing directive: a one-line `h-8`→`h-11` change with negligible UX benefit on an already-large target, or extending the audit fixture to scan `<Input>` (test churn), would be marginal work. Honest convergence is the desired signal.

**Repo-rule basis for deferral:** Not a security / correctness / data-loss finding (those are non-deferrable). It is a UI-polish deviation on a surface the repo's own enforced policy explicitly excludes from scope. Deferring is consistent with the established `touch-target-audit.test.ts` scope decision.

**Exit criterion (re-open + fix):** re-open and apply `h-8`→`h-11` (and extend `touch-target-audit.test.ts` FORBIDDEN patterns to cover `<Input>` sub-44 explicit heights) IF ANY of:
- (a) the search field is reworked into a multi-control composite where the input is no longer full-width (loses the large-horizontal-target mitigation); OR
- (b) a real mobile-usability report cites the search field's height; OR
- (c) the repo decides to bring `<Input>` under the touch-target-audit scope (at which point this becomes a hard, blocking test failure that MUST be fixed in the same change).

**File+line for tracking:** `apps/web/src/components/search.tsx:374`.

---

## Rejected this cycle (recorded for traceability — NOT deferred, NOT scheduled)

### REJ-C10-01 — designer FIND-D1 (claimed HIGH): `aria-controls` referencing a conditionally-unmounted disclosure region
**Where:** `apps/web/src/components/similar-photos.tsx:116`, `apps/web/src/components/color-details-section.tsx:290`.
**Disposition: REJECTED — not a defect.** MDN's `aria-controls` documentation states verbatim that `aria-controls` "only needs to be set when the popup is visible, but it is valid and easier to program to reference an element that is not visible." Referencing a not-currently-present controlled element is explicitly valid and recommended; it is NOT a WCAG 4.1.2 failure. The cycle-8 wiring (AGG-C8-11) uses exactly the MDN-endorsed pattern (consistent `aria-controls` + conditional render + correct `aria-expanded`). No change. (Full rationale in `.context/reviews/_aggregate.md` § REJ-C10-01.)

---

## Pre-existing deferred items still open (carried forward — see their own registers)

- **DEF-C8-1 / DEF-C8-2 / DEF-C8-3** (plan-361, run-6 cycle-8 deferred register): the three architecture-dependent CLIP items (main-thread inference / worker-pool design, load-time integrity verification, reload-storm hardening). Each requires an architect-led concurrency-architecture design pass and remains correctly deferred with its own re-open criteria. NOT re-opened this cycle — the cycle-10 fan-out confirmed they are not exploitable security or data-loss defects at HEAD, and the live feature operates within their documented bounded mitigations. Their status is unchanged; see plan-361 for the authoritative register.

---

## Coverage assertion

Every cycle-10 finding is now accounted for:
- AGG-C10-01 (HIGH) → scheduled in plan-363 TASK-1.
- AGG-C10-02 (MEDIUM) → scheduled in plan-363 TASK-2.
- DEF-C10-01 (LOW; designer MEDIUM) → deferred here with file+line, preserved severity, reason, exit criterion.
- REJ-C10-01 → rejected here + in the aggregate with authoritative-source rationale.
- DOC-N1/N2/N3 → non-findings (doc fidelity), optional in plan-363; do not block convergence.

No security, correctness, or data-loss finding has been deferred.
