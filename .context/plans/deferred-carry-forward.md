# Consolidated carry-forward deferred register (adopted run-10 cycle-3, C3-27/CRIT3-08)

**Purpose:** make the 8-cycle age budget (`.context/plans/README.md`) mechanically
checkable. Each row indexes ONE open deferred finding; the per-cycle registers named in
the "home" column remain the authoritative detail records (severity/confidence provenance,
citations, full exit criteria). Update this table every cycle: bump ages, remove rows whose
exit criteria fired (note where they were scheduled), add the cycle's new deferrals.

**Age accounting:** counted in review cycles since the finding first entered a deferred
register, across the run-9/recovery → run-10 renumbering (run-10 cycle-1 = 2026-07-06).
Old-run items (cycle-96 register, 2026-07-01) have crossed the boundary: their age at
run-10 cycle-3 is ~6 review cycles (c96→c97→c98→[c99 review-only]→r10c1→r10c2→r10c3).

**Age-budget check (run-10 c3):** ONE High-severity carry-forward exists —
`C94-09 / C77-ARCH-01` — and it was SCHEDULED + implemented in run-10 cycle-1 (left the
register per `cycle-1-2026-07-06-deferred.md`); no open High row remains below. No open
row is at or past the 8-cycle budget. Next mandatory re-check: every cycle, in the WP that
updates this file.

**Provenance note:** an UNTRACKED, stale `.context/plans/run10-cycle2/` directory
(mtime 2026-06-25, from an abandoned earlier session that also used the "run10" name)
contains a deferred register with High-severity `AGG-0x` ids. It is NOT part of the
committed lineage (README "Authoritative timeline"); its live concerns that survived into
the committed lineage are represented by the rows below (restore validation/fence classes
under C96-*/C94-*). Do not resurrect ids from that file without re-verifying against HEAD.

## Open carry-forward rows

| ID | Sev/Conf | Home register | First deferred | Age @ r10c3 | Exit criterion (short) |
|----|---------|---------------|----------------|-------------|------------------------|
| C96-04 | MED/High | cycle-96-2026-07-01 | c96 | ~6 | Feed maintenance/caching policy decision for restore windows |
| C96-07 | MED/High | cycle-96-2026-07-01 | c96 | ~6 | nginx template parameterizes the demo domain (operator template pass) |
| C96-08 | LOW-MED/Med | cycle-96-2026-07-01 | c96 | ~6 | i18n SEO-copy product decision |
| C96-09 | MED/High | cycle-96-2026-07-01 | c96 | ~6 | Field-level SEO form errors (admin form-UX pass) |
| C96-10 | MED/High | cycle-96-2026-07-01 | c96 | ~6 | Field-level topic dialog errors (same pass) |
| C96-11 | MED/High | cycle-96-2026-07-01 | c96 | ~6 | Restore file-size rejection keeps selection + inline error (same pass) |
| C96-12 | MED/Med | cycle-96-2026-07-01 | c96 | ~6 | Mobile admin toolbar overflow report or mobile-admin cycle |
| C96-13 | LOW/High | cycle-96-2026-07-01 | c96 | ~6 | Color metadata `<dl>` semantics polish pass |
| C96-14 | MED/Med-High | cycle-96-2026-07-01 | c96 | ~6 | Zoomed-pan vs swipe-nav gesture conflict fix (with C94-06) |
| C96-15 | MED/High | cycle-96-2026-07-01 | c96 | ~6 | CLIP sidecar/runbook example refresh on next CLIP-touching cycle |
| C96-16 | LOW-MED/Med | cycle-96-2026-07-01 | c96 | ~6 | CLIP manifest comment refresh (same trigger) |
| C96-17 | MED/Med | cycle-96-2026-07-01 | c96 | ~6 | Color backfill runbook predicate refresh on next backfill-touching cycle |
| C94-04/C93-05 | MED/High | cycle-96-2026-07-01 | ≤c93 | ~8+ | Route-level LR upload behavior coverage (test-infra investment) |
| C94-05/C93-06 | MED/High | cycle-96-2026-07-01 | ≤c93 | ~8+ | Admin Playwright coverage for first-class pages |
| C94-06/C93-09 | MED/High | cycle-96-2026-07-01 | ≤c93 | ~8+ | Keyboard-pannable zoom (a11y cycle) |
| C94-07/C93-10 | MED/High | cycle-96-2026-07-01 | ≤c93 | ~8+ | Mobile admin nav redesign (product decision) |
| C94-08/C93-11 | MED/High | cycle-96-2026-07-01 | ≤c93 | ~8+ | Mobile-first admin image management (product decision) |
| C94-10/C88-03 | MED/High | cycle-96-2026-07-01 | c88 | ~10 | Multi-model-version embedding schema migration (next schema cycle) |
| C80-06 | MED/Med | cycle-96-2026-07-01 (via c80) | c80 | ~10 | site-config runtime/build contract decision (same as C2-24b below) |
| C76-04, C76-05, C75-08 | LOW..MED | cycle-96-2026-07-01 (via c76/c75) | c75/76 | ~12 | See home register (behavior-test hardening / validation UX) |
| C1-31 | LOW/Med | cycle-1-2026-07-06 | r10c1 | 2 | mysql2 version bump OR DB-backed test infra |
| C1-32 (broad) | LOW-MED/High | cycle-1-2026-07-06 | r10c1 | 2 | Incremental drainage policy (per-cycle, ongoing) |
| C1-33 (measurement) | LOW/Med | cycle-1-2026-07-06 | r10c1 | 2 | RSS trace on deploy host during 200 MB upload |
| C1-13 (fail-loud half) | LOW/Med | cycle-1-2026-07-06 | r10c1 | 2 | TRUST_PROXY ops incident OR boot-probe design decision |
| C1-25(a) | HIGH-attached-to-doc (fixed)/product | cycle-1-2026-07-06 | r10c1 | 2 | Product decision: ship Collections admin UI |
| C1-11 (operator) | MED/Med | cycle-1-2026-07-06 | r10c1 | 2 | Operator confirms production edge topology (chains C3-12op) |
| C1-36(b) | MED/High | cycle-1-2026-07-06 | r10c1 | 2 | i18n key-reference scanner (AST-level test infra) |
| C2-07 | MED/High | cycle-2-2026-07-07 | r10c2 | 1 | Chains on C2-31 tokenizer OR a DB-reaching public page.tsx without edge limiter |
| C2-12 | MED/High | cycle-2-2026-07-07 | r10c2 | 1 | ~1000 geotagged map photos OR measured multi-second /map mount |
| C2-14b | MED/High | cycle-2-2026-07-07 | r10c2 | 1 | Semantic search enabled in prod + measured scan latency (MUST copy vectors — PERF3-04 rider, run-10 c3) |
| C2-15 | MED/High | cycle-2-2026-07-07 | r10c2 | 1 | Measured view-record latency OR DB-backed test infra |
| C2-16 | MED/Med | cycle-2-2026-07-07 | r10c2 | 1 | Measured home latency OR next schema cycle folds the index |
| C2-20 | MED/High | cycle-2-2026-07-07 | r10c2 | 1 | C1-33 RSS trace OR OOM incident during GPS-stripped uploads |
| C2-21 | MED/High | cycle-2-2026-07-07 | r10c2 | 1 | Next migration-authoring cycle folds the `(processed, updated_at, id)` index |
| C2-24b | MED/High | cycle-2-2026-07-07 | r10c2 | 1 | Operator needs runtime site-config edits OR config-precedence product decision |
| C2-27 | MED/High | cycle-2-2026-07-07 | r10c2 | 1 | Product decision: wire or delete the storage abstraction |
| C2-28 | MED-LOW/Med-High | cycle-2-2026-07-07 | r10c2 | 1 | Admin perceived-lag report OR next admin-table cycle |
| C2-30 | LOW/High | cycle-2-2026-07-07 | r10c2 | 1 | Real spurious restore-abort OR next barrier-touching cycle |
| C2-31 (remainder) | LOW/High | cycle-2-2026-07-07 | r10c2 | 1 | Next scanner ossification instance → lint-gate tokenizer (first concrete rework landed r10c3 WP12) |
| C2-35 | LOW/Med | cycle-2-2026-07-07 | r10c2 | 1 | Never-clean backfill banner report OR next backfill cycle |
| C2-38 | LOW/High | cycle-2-2026-07-07 | r10c2 | 1 | Next.js first-class style-nonce OR an HTML-injection sink |
| C2-46 | LOW-MED/Med | cycle-2-2026-07-07 | r10c2 | 1 | Measured wasted re-encode volume OR NFS unlink hazard |
| C2-50 | LOW/High | cycle-2-2026-07-07 | r10c2 | 1 | Storage quarantine lifted (chains C2-27) |
| C2-53 | LOW/High | cycle-2-2026-07-07 | r10c2 | 1 | AT-user report OR next a11y label batch |
| C2-54 | LOW/High | cycle-2-2026-07-07 | r10c2 | 1 | Product decision on untitled-photo H1 template |
| C2-55 | LOW/High-Med | cycle-2-2026-07-07 | r10c2 | 1 | Per-item measurement triggers (perf long-tail class) |
| C2-37res | LOW/Med | cycle-3-2026-07-07 | r10c3 | 0 | Runtime IMAGE_BASE_URL boot-validation decision (root-cause residual) |
| C3-17 | LOW-MED/High | cycle-3-2026-07-07 | r10c3 | 0 | Measured payload concern OR namespace-inventory guard test lands |
| C3-28 | LOW/High | cycle-3-2026-07-07 | r10c3 | 0 | CSP memoization conflicts with pinned per-call fail-degrade semantics; re-open on measured middleware CPU OR a CSP-builder redesign |
| C3-30 | LOW/High | cycle-3-2026-07-07 | r10c3 | 0 | Observed tag-mutation deadlock in logs |
| C3-31 | LOW/High (accepted) | cycle-3-2026-07-07 | r10c3 | 0 | Very-large-dump restore slowdown measurement |
| C3-32 | LOW/Med | cycle-3-2026-07-07 | r10c3 | 0 | Reproduce JSON-LD console warning against a production build |
| C3-35 (redesign) | LOW/Med | cycle-3-2026-07-07 | r10c3 | 0 | Migration-machinery incident OR dedicated maintenance window |
| C3-36 | LOW/Med | cycle-3-2026-07-07 | r10c3 | 0 | Opportunistic data.ts concern peeling (C1-32 policy) |
| C3-08op | MED/Med-High | cycle-3-2026-07-07 | r10c3 | 0 | Operator applies + verifies nginx zones per runbook |
| C3-12op | MED-HIGH contingent | cycle-3-2026-07-07 | r10c3 | 0 | Chains on C1-11 topology confirmation |

## Rows that left a register recently (for lineage continuity)

- `C77-ARCH-01` (High): scheduled run-10 c1 (WP3) after 8+ cycles — the age budget's first application.
- `C94-11`: re-opened + scheduled run-10 c1 (WP6) on two-lane agreement.
- `C2-31` concrete instance: scheduled + landed run-10 c3 (WP12, nginx-test block parser); remainder row above.
- `C3-25`: same WP12 (api-csp-header count-pin relaxation) — closed, no row.
