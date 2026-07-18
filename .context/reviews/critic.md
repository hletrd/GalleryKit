# Critic — Cycle 6 Provenance

Review target: `6e4c25c8`. I challenged the Cycle 5 claims against runtime behavior, test reach, Git evidence, prior reviews, and governing policy rather than accepting comments or green checks at face value.

## NEW Cycle 6 findings

### CRIT-C6-01 — “Same column caps” is true for source sizes, false for intrinsic geometry

- Severity / confidence: **Medium / High**
- Status: **Confirmed live mismatch; visual consequence manual-validation**
- Regions: `.context/plans/cycle-5-2026-07-18-plan.md:24-28,56-64`; `apps/web/src/components/home-client.tsx:231-274`; `apps/web/src/components/masonry-card.tsx:52-77`
- Failure scenario: the acceptance language implies the sparse policy is unified, yet a live two-photo 1,536 px page rendered 744×496 cards with a 196 px intrinsic stand-in. A deferred grid can change scroll extent on activation.
- Fix: make effective columns a single value used by sizing, classes, and intrinsic geometry; add a browser assertion for the computed hint.

### CRIT-C6-02 — The browser proof validates siblings, not the changed home path

- Severity / confidence: **Medium / High**
- Status: **Confirmed test gap; production source sizes currently correct**
- Regions: `apps/web/e2e/responsive-masonry.spec.ts:9-85`; `apps/web/src/__tests__/responsive-masonry.test.ts:8-42`; `apps/web/src/__tests__/masonry-card-memo.test.ts:99-177`
- Failure scenario: hard-coding five items in the home initializer breaks one-to-four-photo delivery while every new E2E and existing helper/source-presence assertion stays green.
- Fix: exercise the actual home route with deterministic sparse fixtures at responsive boundaries.

### CRIT-C6-03 — The active plan contradicts signed remote state

- Severity / confidence: **Low / High**
- Status: **Confirmed push; exact deploy SHA manual-validation**
- Regions: `.context/plans/cycle-5-2026-07-18-plan.md:5,47-49,70-78`; `.context/plans/README.md:34-40`
- Failure scenario: a resumed run repeats a push/deploy because the authoritative ledger says both are pending even though `master` and `origin/master` equal signed `6e4c25c8`; production also exposes the new runtime policy.
- Fix: terminally reconcile and archive the plan after push/deploy evidence.

## Final challenge sweep and coverage

I challenged prior full-gate claims with independent static/type/unit/audit runs, checked browser behavior at four widths plus a sparse filter, reviewed security and migration invariants, and compared every candidate with prior/deferred records. The old generic source-contract and ownership concerns were not relabeled as new; only the concrete current omissions above are Cycle 6 findings.
