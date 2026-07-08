# Consolidated carry-forward deferred register (adopted run-10 cycle-3, C3-27/CRIT3-08)

**Purpose:** make the 8-cycle age budget (`.context/plans/README.md`) mechanically
checkable. Each row indexes ONE open deferred finding; the per-cycle registers named in
the "home" column remain the authoritative detail records (severity/confidence provenance,
citations, full exit criteria). Update this table every cycle: bump ages, remove rows whose
exit criteria fired (note where they were scheduled), add the cycle's new deferrals.

**Age accounting:** counted in review cycles since the finding first entered a deferred
register, across the run-9/recovery → run-10 renumbering (run-10 cycle-1 = 2026-07-06).
Old-run items (cycle-96 register, 2026-07-01) crossed the boundary: their age at run-10
cycle-4 is ~7 review cycles (c96→c97→c98→[c99 review-only]→r10c1→r10c2→r10c3→r10c4).
**Pre-run-10 ages are APPROXIMATE (C4-33 note):** the recovery run's cycles 85-99 were
fast/irregular, so ages for items first deferred before c96 use a compressed scale of
~4 age-units per 8 review-cycles (matching the author's original c96≈7 / c88≈11 anchors).
The RELATIVE ordering is load-bearing (an item first deferred at c80 MUST read older than
one first deferred at c88); the absolute magnitude is a fuzzy estimate, not an exact count.

**Age-budget check (run-10 c25):** direct contained findings `AGG-C25-01`,
`AGG-C25-02`, `AGG-C25-21`, and `AGG-C25-23` are scheduled in
`cycle-25-2026-07-08-plan.md`. Newly deferred High-severity Cycle 25 rows
(`AGG-C25-03`, `AGG-C25-04`, `AGG-C25-05`, and conditional operator row
`AGG-C25-27`) are broad architecture/performance/operator items with explicit
exit criteria in `cycle-25-2026-07-08-deferred.md`, prior carry-forward lineage,
and no contained one-cycle fix. `AGG-C25-06` has correctness implications but is
deferred only under the documented warn-only single-writer guard rule in
`CLAUDE.md`; changing that behavior requires operator/product approval.

**Previous check (run-10 c24):** direct test/provenance/comment findings
`AGG-C24-04`, `AGG-C24-05`, `AGG-C24-06`, and `AGG-C24-07` are scheduled in
`cycle-24-2026-07-08-plan.md`. Newly deferred High-severity Cycle 24 rows
(`AGG-C24-01`, `AGG-C24-02`, `AGG-C24-03`, `AGG-C24-10`) are broad
architecture/performance/topology items with explicit exit criteria in
`cycle-24-2026-07-08-deferred.md`, prior committed carry-forward lineage, and no
contained one-cycle fix. `AGG-C24-10` has correctness implications but is deferred only
under the documented warn-only single-writer guard rule in `CLAUDE.md`; changing that
behavior requires operator/product approval.

**Previous check (run-10 c23):** direct auth/session, restore, scanner, evidence, and
small accessibility findings `AGG-C23-01`, `AGG-C23-02`, `AGG-C23-03`, `AGG-C23-07`,
`AGG-C23-08`, `AGG-C23-09`, `AGG-C23-10`, `AGG-C23-23`, and `AGG-C23-24` were scheduled
in `cycle-23-2026-07-08-plan.md`. Newly deferred High-severity Cycle 23 rows
(`AGG-C23-04`, `AGG-C23-05`, `AGG-C23-06`) are broad architecture/performance/availability
items with explicit exit criteria in `cycle-23-2026-07-08-deferred.md`, prior committed
carry-forward lineage, and no contained one-cycle fix. Security/operator rows rely on the
documented host-nginx, proxy, single-instance, DB-only backup, and permanently deferred
2FA/WebAuthn boundaries in `CLAUDE.md`.

**Previous check (run-10 c22):** direct correctness/privacy/data-retention findings
`AGG-C22-01`, `AGG-C22-02`, `AGG-C22-03`, and provenance finding `AGG-C22-04`
are scheduled in `cycle-22-2026-07-08-plan.md`; `AGG-C22-10` and targeted
`AGG-C22-09` behavior coverage are also scheduled. Newly deferred High-severity
Cycle 22 rows (`AGG-C22-05`, `AGG-C22-06`, `AGG-C22-07`, residual `AGG-C22-09`)
are broad architecture/performance/test-infrastructure items with explicit exit
criteria in `cycle-22-2026-07-08-deferred.md`, not contained unpatched
authz/security/data-loss bugs. Security/operator rows rely on the documented
single-web-instance topology, DB-only backup boundary, permanently deferred
2FA/WebAuthn posture, and nginx-edge/operator boundaries in `CLAUDE.md`.
Cycle 21 rows are now one cycle old; Cycle 20 rows are two cycles old; none crosses
the 8-cycle High budget or 16-cycle Medium checkpoint.

**Previous check (run-10 c21):** direct correctness/data-loss and gate findings
`AGG-C21-01`, `AGG-C21-02`, `AGG-C21-06`, `AGG-C21-15`, `AGG-C21-25`, and
`AGG-C21-30` were scheduled in `cycle-21-2026-07-08-plan.md`; bounded docs/i18n/a11y
and ledger findings were also scheduled. Newly deferred High-severity Cycle 21 rows
(`AGG-C21-03`, `AGG-C21-04`, `AGG-C21-05`, `AGG-C21-07`, `AGG-C21-08`, `AGG-C21-09`)
are broad architecture/performance/test-infrastructure items with explicit exit criteria
in `cycle-21-2026-07-08-deferred.md`, not contained unpatched authz/security/data-loss
bugs. Security/operator rows rely on the documented single-web-instance topology,
DB-only backup boundary, and nginx-edge boundary in `CLAUDE.md`. Cycle 20 rows are now
one cycle old; Cycle 19 rows are two cycles old; none crosses the 8-cycle High budget
or 16-cycle Medium checkpoint.

**Previous check (run-10 c20):** direct high-confidence correctness/security gate
findings `AGG-C20-01` and `AGG-C20-02` were scheduled and fixed in `d8e604ef`; the
revocable-photo offline-cache privacy issue `AGG-C20-03` was also fixed. Newly deferred
High-severity Cycle 20 rows (`AGG-C20-04`, `AGG-C20-05`, `AGG-C20-06`, `AGG-C20-28`,
`AGG-C20-29`) are broad architecture/performance/test-infrastructure items with explicit
exit criteria in `cycle-20-2026-07-08-deferred.md`, not contained unpatched data-loss or
authz defects.

**Previous check (run-10 c19):** no newly deferred Cycle 19 High-severity row is a
direct unpatched correctness/security/data-loss bug; direct correctness items
`AGG-C19-01` and `AGG-C19-02` were scheduled in `cycle-19-2026-07-08-plan.md`.
The newly deferred High rows were broad architecture/performance/test-design items
with explicit exit criteria in `cycle-19-2026-07-08-deferred.md`. Security/availability
deferrals relied on the single-web-instance and nginx-edge operator boundaries
documented in `CLAUDE.md`.

**Previous check (run-10 c18):** no newly deferred Cycle 18 High-severity row is a
correctness/security/data-loss issue; the two High rows are performance/architecture
items with explicit exit criteria in `cycle-18-2026-07-08-deferred.md`.
Older High-severity carry-forward rows with correctness implications were already
scheduled in earlier run-10 cycles (`C77-ARCH-01`, `C94-11`). **MED 16-cycle
checkpoint:** legacy MED rows at or beyond the soft checkpoint remain product,
operator, or performance decisions with exit criteria preserved in their home
registers; Cycle 18 adds the current deferred register to the lineage below so the
next cycle does not need to infer age from prose.

**Provenance note:** an UNTRACKED, stale `.context/plans/run10-cycle2/` directory
(mtime 2026-06-25, from an abandoned earlier session that also used the "run10" name)
contains a deferred register with High-severity `AGG-0x` ids. It is NOT part of the
committed lineage (README "Authoritative timeline"); its live concerns that survived into
the committed lineage are represented by the rows below (restore validation/fence classes
under C96-*/C94-*). Do not resurrect ids from that file without re-verifying against HEAD.

## Open carry-forward rows

| ID | Sev/Conf | Home register | First deferred | Age @ r10c24 | Exit criterion (short) |
|----|---------|---------------|----------------|-------------|------------------------|
| C96-04 | MED/High | cycle-96-2026-07-01 | c96 | ~7 | Feed maintenance/caching policy decision for restore windows |
| C96-07 | MED/High | cycle-96-2026-07-01 | c96 | ~7 | nginx template parameterizes the demo domain (operator template pass) |
| C96-08 | LOW-MED/Med | cycle-96-2026-07-01 | c96 | ~7 | i18n SEO-copy product decision |
| C96-09 | MED/High | cycle-96-2026-07-01 | c96 | ~7 | Field-level SEO form errors (admin form-UX pass) |
| C96-10 | MED/High | cycle-96-2026-07-01 | c96 | ~7 | Field-level topic dialog errors (same pass) |
| C96-11 | MED/High | cycle-96-2026-07-01 | c96 | ~7 | Restore file-size rejection keeps selection + inline error (same pass) |
| C96-12 | MED/Med | cycle-96-2026-07-01 | c96 | ~7 | Mobile admin toolbar overflow report or mobile-admin cycle |
| C96-13 | LOW/High | cycle-96-2026-07-01 | c96 | ~7 | Color metadata `<dl>` semantics polish pass |
| C96-14 | MED/Med-High | cycle-96-2026-07-01 | c96 | ~7 | Zoomed-pan vs swipe-nav gesture conflict fix (with C94-06) |
| C96-15 | MED/High | cycle-96-2026-07-01 | c96 | ~7 | CLIP sidecar/runbook example refresh on next CLIP-touching cycle |
| C96-16 | LOW-MED/Med | cycle-96-2026-07-01 | c96 | ~7 | CLIP manifest comment refresh (same trigger) |
| C96-17 | MED/Med | cycle-96-2026-07-01 | c96 | ~7 | Color backfill runbook predicate refresh on next backfill-touching cycle |
| C94-04/C93-05 | MED/High | cycle-96-2026-07-01 | ≤c93 | ~9+ | Route-level LR upload behavior coverage (test-infra investment) |
| C94-05/C93-06 | MED/High | cycle-96-2026-07-01 | ≤c93 | ~9+ | Admin Playwright coverage for first-class pages |
| C94-06/C93-09 | MED/High | cycle-96-2026-07-01 | ≤c93 | ~9+ | Keyboard-pannable zoom (a11y cycle) |
| C94-07/C93-10 | MED/High | cycle-96-2026-07-01 | ≤c93 | ~9+ | Mobile admin nav redesign (product decision) |
| C94-08/C93-11 | MED/High | cycle-96-2026-07-01 | ≤c93 | ~9+ | Mobile-first admin image management (product decision) |
| C94-10/C88-03 | MED/High | cycle-96-2026-07-01 | c88 | ~11 | Multi-model-version embedding schema migration (next schema cycle) |
| C80-06 | MED/Med | cycle-96-2026-07-01 (via c80) | c80 | ~15 | Product/operator decision: add runtime-editable file config despite the documented build-time `site-config.json` contract, or close as not needed |
| C76-04, C76-05, C75-08 | LOW..MED | cycle-96-2026-07-01 (via c76/c75) | c75/76 | ~13 | See home register (behavior-test hardening / validation UX) |
| C1-31 | LOW/Med | cycle-1-2026-07-06 | r10c1 | 6 | mysql2 version bump OR DB-backed test infra |
| C1-32 (broad) | LOW-MED/High | cycle-1-2026-07-06 | r10c1 | 6 | Incremental drainage policy (per-cycle, ongoing) |
| C1-33 (measurement) | LOW/Med | cycle-1-2026-07-06 | r10c1 | 6 | RSS trace on deploy host during 200 MB upload |
| C1-13 (fail-loud half) | LOW/Med | cycle-1-2026-07-06 | r10c1 | 6 | TRUST_PROXY ops incident OR boot-probe design decision |
| C1-25(a) | product-decision (doc half already FIXED) | cycle-1-2026-07-06 | r10c1 | 6 | Product decision: ship Collections admin UI (not an open High finding — C4-34 reword) |
| C1-11 (operator) | MED/Med | cycle-1-2026-07-06 | r10c1 | 6 | Operator confirms production edge topology (chains C3-12op) |
| C1-36(b) | MED/High | cycle-1-2026-07-06 | r10c1 | 6 | i18n key-reference scanner (AST-level test infra) |
| C2-07 | MED/High | cycle-2-2026-07-07 | r10c2 | 5 | Chains on C2-31 tokenizer OR a DB-reaching public page.tsx without edge limiter |
| C2-12 | MED/High | cycle-2-2026-07-07 | r10c2 | 5 | ~1000 geotagged map photos OR measured multi-second /map mount |
| C2-14b | MED/High | cycle-2-2026-07-07 | r10c2 | 5 | Semantic search enabled in prod + measured scan latency (MUST copy vectors — PERF3-04 rider, run-10 c3) |
| C2-15 | MED/High | cycle-2-2026-07-07 | r10c2 | 5 | Measured view-record latency OR DB-backed test infra |
| C2-16 | MED/Med | cycle-2-2026-07-07 | r10c2 | 5 | Measured home latency OR next schema cycle folds the index |
| C2-20 | MED/High | cycle-2-2026-07-07 | r10c2 | 5 | C1-33 RSS trace OR OOM incident during GPS-stripped uploads |
| C2-21 | MED/High | cycle-2-2026-07-07 | r10c2 | 5 | Next migration-authoring cycle folds the `(processed, updated_at, id)` index |
| C2-24b | MED/High | cycle-2-2026-07-07 | r10c2 | 5 | Operator needs runtime site-config edits despite documented build-time import semantics OR config-precedence product decision |
| C2-27 | MED/High | cycle-2-2026-07-07 | r10c2 | 5 | Product decision: wire or delete the storage abstraction |
| C2-28 | MED-LOW/Med-High | cycle-2-2026-07-07 | r10c2 | 5 | Admin perceived-lag report OR next admin-table cycle (now folds C4-24) |
| C2-30 | LOW/High | cycle-2-2026-07-07 | r10c2 | 5 | Real spurious restore-abort OR next barrier-touching cycle |
| C2-31 (remainder) | LOW/High | cycle-2-2026-07-07 | r10c2 | 5 | Next scanner ossification instance → lint-gate tokenizer (first concrete rework landed r10c3 WP12) |
| C2-35 | LOW/Med | cycle-2-2026-07-07 | r10c2 | 5 | Never-clean backfill banner report OR next backfill cycle |
| C2-38 | LOW/High | cycle-2-2026-07-07 | r10c2 | 5 | Next.js first-class style-nonce OR an HTML-injection sink |
| C2-46 | LOW-MED/Med | cycle-2-2026-07-07 | r10c2 | 5 | Measured wasted re-encode volume OR NFS unlink hazard |
| C2-50 | LOW/High | cycle-2-2026-07-07 | r10c2 | 5 | Storage quarantine lifted (chains C2-27) |
| C2-53 | LOW/High | cycle-2-2026-07-07 | r10c2 | 5 | AT-user report OR next a11y label batch |
| C2-54 | LOW/High | cycle-2-2026-07-07 | r10c2 | 5 | Product decision on untitled-photo H1 template |
| C2-55 | LOW/High-Med | cycle-2-2026-07-07 | r10c2 | 5 | Per-item measurement triggers (perf long-tail class) |
| C2-37res | LOW/Med | cycle-3-2026-07-07 | r10c3 | 4 | Runtime IMAGE_BASE_URL boot-validation decision (root-cause residual) |
| C3-17 | LOW-MED/High | cycle-3-2026-07-07 | r10c3 | 4 | Measured payload concern OR namespace-inventory guard test lands |
| C3-28 | LOW/High | cycle-3-2026-07-07 | r10c3 | 4 | CSP memoization conflicts with pinned per-call fail-degrade semantics; re-open on measured middleware CPU OR a CSP-builder redesign |
| C3-30 | LOW/High | cycle-3-2026-07-07 | r10c3 | 4 | Observed tag-mutation deadlock in logs |
| C3-31 | LOW/High (accepted) | cycle-3-2026-07-07 | r10c3 | 4 | Very-large-dump restore slowdown measurement |
| C3-35 (redesign) | LOW/Med | cycle-3-2026-07-07 | r10c3 | 4 | Migration-machinery incident OR dedicated maintenance window (C4-01 added a DML guard but did NOT retire the non-monotonic-journal machinery) |
| C3-36 | LOW/Med | cycle-3-2026-07-07 | r10c3 | 4 | Opportunistic data.ts concern peeling (C1-32 policy) |
| C3-08op | MED/Med-High | cycle-3-2026-07-07 | r10c3 | 4 | Operator applies + verifies nginx zones per runbook (now also covers `zone=nextimage`, C4-13) |
| C3-12op | MED-HIGH contingent | cycle-3-2026-07-07 | r10c3 | 4 | Chains on C1-11 topology confirmation |
| C4-10 | MED/Med | cycle-4-2026-07-07 | r10c4 | 3 | Concurrent-upload UX report OR parallel-external-client product decision (reader/writer lock split) |
| C4-11 | MED/Med | cycle-4-2026-07-07 | r10c4 | 3 | C1-33 RSS trace lands OR RSS/OOM incident during LR uploads (retention-window fix) |
| C4-13 | MED/Med | cycle-4-2026-07-07 | r10c4 | 3 | Sequenced behind C3-08op: after operator applies nginx zones, add the read-only >burst 429 probe |
| C4-16 | LOW-MED/High | cycle-4-2026-07-07 | r10c4 | 3 | Next image-queue-touching cycle folds the {durable\|transient} state partition + single reset helper, OR a 5th lifecycle-reset bug lands. NOTE (c8b): the ARCH8-02 near-miss (embeddingScanModelVersion missed by the restore-quiesce reset, healed at HEAD) is evidence FOR this partition |
| C4-18 | LOW-MED/High | cycle-4-2026-07-07 | r10c4 | 3 | Next component-behavior-only source-pin must evaluate a minimal RTL/jsdom harness (adopt or record why not) |
| C4-22 | LOW/Med-High | cycle-4-2026-07-07 | r10c4 | 3 | Hairpin-DNS/self-origin OG incident OR measured cold-OG latency (fs-read transport + containment) |
| C4-24 | LOW/Med-High | cycle-4-2026-07-07 | r10c4 | 3 | Admin bulk-upload perceived-lag report OR next admin-surface perf cycle (fold with C2-28) |
| C4-25 (code) | LOW/Med | cycle-4-2026-07-07 | r10c4 | 3 | `IMAGE_BASE_URL` actually configured in production → decide the SW cross-origin caching story (doc half shipped this cycle) |
| C4-09d | MED/High | cycle-4-2026-07-07 | r10c4 | 3 | Real permanently-un-embeddable backlog ≥ SEMANTIC_SCAN_LIMIT in prod (durable cursor + per-row failure marking) |
| SEC4-03 | LOW/Med | cycle-4-2026-07-07 | r10c4 | 3 | Storage-backend multi-writer/non-local (C2-27) OR threat model adds hostile-local-writer (O_NOFOLLOW/fd-realpath re-check) |
| C4-46 | INFO/Low | cycle-4-2026-07-07 | r10c4 | 3 | Operator/agent FIND-failure incident on an existing runbook entry OR CLAUDE.md crosses ~1000 lines |
| C6-05 | MED/High | cycle-6-2026-07-07 | r10c6 | 2 | Measured admin bulk-apply latency OR DB-backed test infra (bulkUpdateImages CASE-UPDATE rewrite) |
| C6-04c | MED/High | cycle-6-2026-07-07 | r10c6 | 2 | Peer image-queue work lands + measured pool starvation, OR next image-queue cycle (shared pool-budget semaphore; doc half shipped c6 WP7) |
| C6-06c | MED/Med | cycle-6-2026-07-07 | r10c6 | 2 | DB-TLS import-throw incident OR system-CA opt-in product/ops decision (doc-wording half shipped c6 WP7) |
| C6-12 | MED/High | cycle-6-2026-07-07 | r10c6 | 2 | Next restore-path cycle OR a reusable child_process spawn-mock harness (db-restore failure behavioral test) |
| C6-17 | LOW/Med | cycle-6-2026-07-07 | r10c6 | 2 | A real over-strict `lint:action-origin` failure (check-action-origin clear-not-restore) |
| C6-18 | LOW/Med | cycle-6-2026-07-07 | r10c6 | 2 | Peer image-queue lands + new id-reuse trigger, OR next image-queue cycle (`processing_error` processed=false guard) |
| C6-19 | LOW-MED/Med | cycle-6-2026-07-07 | r10c6 | 2 | AT/keyboard-user report OR next a11y batch (truncated-metadata title-only reveal; folds with C96-13) |
| C6-20 | LOW/Low-Med | cycle-6-2026-07-07 | r10c6 | 2 | Collections authoring UI ships (chains C1-25(a)) → smart-collection compiled-cost ceiling |
| C6-21 | LOW-MED/Med | cycle-6-2026-07-07 | r10c6 | 2 | Many-small-file / high-DB-latency perceived upload lag, OR next upload-flow perf cycle (client batching; sequential constraint is C4-10) |
| C6-22 | LOW/Med | cycle-6-2026-07-07 | r10c6 | 2 | Observed brute-force at restart-near-window-boundary, OR rate-limit algorithm unification |
| C6-23 | LOW/Med | cycle-6-2026-07-07 | r10c6 | 2 | Observed concurrent-migrate ER_DUP_KEYNAME/half-reconcile, OR migration-machinery hardening cycle |
| C6-24 | LOW/High | cycle-6-2026-07-07 | r10c6 | 2 | Real duplicated-cache staleness bug, OR a config-cache refactor adopting one documented rule |
| C6-25 | LOW-MED/High | cycle-6-2026-07-07 | r10c6 | 2 | Peer cycle-10 closes AGG-C10-19/20, else fold next docs cycle (`.omc/wiki` CLIP "LIVE" drift) |
| C6-27 | LOW/Med | cycle-6-2026-07-07 | r10c6 | 2 | Next bulk-edit cycle OR a maintainer trips on the `titlePrefix` exact-set naming |
| C6-28 | MED/High | cycle-6-2026-07-07 | r10c6 | 2 | On-this-day made client-driven, OR a `TZ` operator-config note ships, OR a wrong-day report |
| C7b-06code | MED/High | cycle-7b-2026-07-07 | r10c7(loop-B) | 3 | `IMAGE_BASE_URL` configured in production (decide the boot-validation story once with C4-25/C2-37res), OR an operator restart-without-rebuild thumbnail incident (boot-time remotePatterns-vs-runtime probe; doc half shipped c7b WP14) |
| C17-register | mixed, includes High performance/operator rows | cycle-17-2026-07-08 | r10c17 | 3 | Superseded by `cycle-18-2026-07-08-deferred.md` where still open; see the Cycle 17 register for original severity/confidence and citations |
| C18-03 | HIGH/High | cycle-18-2026-07-08 | r10c18 | 5 | Streaming upload/restore ingestion OR production RSS breach |
| C18-04 | HIGH/High | cycle-18-2026-07-08 | r10c18 | 5 | Semantic traffic/gallery size exceeds limits OR vector indexing/caching scheduled |
| C18-05 | MED/High | cycle-18-2026-07-08 | r10c18 | 5 | Map GPS rows approach thousands OR clustering prioritized |
| C18-07 | MED/High | cycle-18-2026-07-08 | r10c18 | 5 | Credentialed admin browser-flow coverage cycle |
| C18-08 | MED/High | cycle-18-2026-07-08 | r10c18 | 5 | WebKit/mobile/Firefox matrix scheduled OR browser-specific regression |
| C18-09 | LOW-MED/High | cycle-18-2026-07-08 | r10c18 | 5 | Admin e2e skip reporting/setup changes |
| C18-16 | MED/High | cycle-18-2026-07-08 | r10c18 | 5 | Responsive admin card/workbench mode scheduled |
| C18-17 | LOW-MED/High | cycle-18-2026-07-08 | r10c18 | 5 | Admin nav redesign or sensitive-operation IA separation |
| C18-18 | LOW/High | cycle-18-2026-07-08 | r10c18 | 5 | Live semantic/proxy/deploy claim requires host evidence |
| C18-21 | LOW-MED/Medium | cycle-18-2026-07-08 | r10c18 | 5 | Credentialed protected-admin responsive validation pass |
| C18-22 | LOW/Medium | cycle-18-2026-07-08 | r10c18 | 5 | Any RTL locale addition |
| C19-03r | HIGH/High | cycle-19-2026-07-08 | r10c19 | 5 | Streaming upload/restore ingestion OR production RSS breach |
| C19-04 | HIGH/High | cycle-19-2026-07-08 | r10c19 | 5 | Shared DB background budget scheduled OR measured queue/backfill pool starvation |
| C19-05 | HIGH/High | cycle-19-2026-07-08 | r10c19 | 5 | Semantic traffic/gallery size exceeds scan limits OR vector indexing/caching scheduled |
| C19-06r | MED/High | cycle-19-2026-07-08 | r10c19 | 5 | Map clustering/viewport pagination scheduled OR map trace proves thousands-marker jank |
| C19-07 | HIGH/High | cycle-19-2026-07-08 | r10c19 | 5 | Next migration/schema cycle OR DB-backed reconcile convergence gate |
| C19-08 | MED/High | cycle-19-2026-07-08 | r10c19 | 5 | Next high-risk source-contract-only finding OR behavior-test hardening cycle |
| C19-09 | MED/High | cycle-19-2026-07-08 | r10c19 | 5 | Browser-specific regression OR Playwright mobile/WebKit/Firefox matrix scheduled |
| C19-10 | MED/High | cycle-19-2026-07-08 | r10c19 | 5 | Admin-flow regression OR admin E2E expansion cycle |
| C19-11 | MED/High-Med | cycle-19-2026-07-08 | r10c19 | 5 | Operator applies/verifies nginx zones OR app-layer public page limiter project |
| C19-12 | LOW/High | cycle-19-2026-07-08 | r10c19 | 5 | Style nonce/hash path lands OR CSP hardening cycle |
| C19-13..34 | mixed, up to High | cycle-19-2026-07-08 | r10c19 | 5 | See `cycle-19-2026-07-08-deferred.md` for preserved citations, reasons, and exit criteria |
| C20-04 | HIGH/High | cycle-20-2026-07-08 | r10c20 | 4 | Shared upload ingest service before next upload parity drift |
| C20-05 | HIGH/High | cycle-20-2026-07-08 | r10c20 | 4 | Streaming upload/restore ingress OR production RSS/OOM incident |
| C20-06 | HIGH/High | cycle-20-2026-07-08 | r10c20 | 4 | Shared DB/CPU background budget OR measured queue/backfill starvation |
| C20-07 | MED/High | cycle-20-2026-07-08 | r10c20 | 4 | Full-text/search-index project OR measured keyword latency |
| C20-08 | MED/Medium | cycle-20-2026-07-08 | r10c20 | 4 | Collections UI ships OR public smart-collection latency/materialization project |
| C20-09 | MED/High | cycle-20-2026-07-08 | r10c20 | 4 | Semantic traffic reaches scan limits OR vector index/cache project |
| C20-10 | MED/High | cycle-20-2026-07-08 | r10c20 | 4 | Map GPS rows approach thousands OR clustering/viewport project |
| C20-11 | LOW-MED/High | cycle-20-2026-07-08 | r10c20 | 4 | Map a11y polish batch OR AT/keyboard marker-name report |
| C20-12 | MED/Medium | cycle-20-2026-07-08 | r10c20 | 4 | Next schema/index migration OR listing filesort/temp-table evidence |
| C20-13 | MED/High | cycle-20-2026-07-08 | r10c20 | 4 | Scale-out attempt, singleton contention, or shared-state topology project |
| C20-14 | MED/High-Med | cycle-20-2026-07-08 | r10c20 | 4 | Host nginx verified/applied OR app-layer public page limiter project |
| C20-15 | MED/Medium | cycle-20-2026-07-08 | r10c20 | 4 | Shared-group cache/refactor OR counter drift report |
| C20-16 | MED/Med-High | cycle-20-2026-07-08 | r10c20 | 4 | Topic schema migration OR new slug-bearing store/rename bug |
| C20-17 | MED/High | cycle-20-2026-07-08 | r10c20 | 4 | Next image-queue cycle OR permanent-failure cap incident |
| C20-18 | MED/Med-High | cycle-20-2026-07-08 | r10c20 | 4 | Upload quota leak OR upload-flow refactor |
| C20-19 | LOW/High | cycle-20-2026-07-08 | r10c20 | 4 | Step-up auth/roles product decision |
| C20-20 | LOW/High | cycle-20-2026-07-08 | r10c20 | 4 | Style nonce/hash support OR CSP hardening cycle |
| C20-21 | LOW/High | cycle-20-2026-07-08 | r10c20 | 4 | Secret scanner flags review logs OR log retention policy update |
| C20-24 | MED/High | cycle-20-2026-07-08 | r10c20 | 4 | Lint/config cleanup OR warning false-green incident |
| C20-25 | MED/High | cycle-20-2026-07-08 | r10c20 | 4 | Button primitive touch-target change OR a11y audit cycle |
| C20-26 | MED/High | cycle-20-2026-07-08 | r10c20 | 4 | Next i18n/message edit OR placeholder bug |
| C20-27 | MED/High | cycle-20-2026-07-08 | r10c20 | 4 | Next source-contract false confidence OR behavior-test hardening cycle |
| C20-28 | HIGH/High | cycle-20-2026-07-08 | r10c20 | 4 | Next migration/schema cycle OR DB-backed reconcile convergence gate |
| C20-29 | HIGH/Medium | cycle-20-2026-07-08 | r10c20 | 4 | Next backup/restore cycle OR child-process harness lands |
| C20-30 | MED/High | cycle-20-2026-07-08 | r10c20 | 4 | Browser/admin/PWA/CLIP matrix project OR regression in those surfaces |
| C20-31 | MED/High | cycle-20-2026-07-08 | r10c20 | 4 | Next tag-filter/UI cycle OR mobile closed-filter report |
| C20-32 | LOW/Medium | cycle-20-2026-07-08 | r10c20 | 4 | Measured tag-filter hydration cost OR tag-filter redesign |
| C20-33 | MED/High | cycle-20-2026-07-08 | r10c20 | 4 | Mobile admin priority/wrong-row report OR admin redesign cycle |
| C20-34 | LOW-MED/Medium | cycle-20-2026-07-08 | r10c20 | 4 | Photo-page IA redesign OR missed controls report |
| C20-35 | LOW-MED/Medium | cycle-20-2026-07-08 | r10c20 | 4 | Template/package distribution OR wrong canonical URL incident |
| C20-36 | MED/High-Low | cycle-20-2026-07-08 | r10c20 | 4 | CLIP/search/nginx live preflight or capacity project |
| C20-37 | LOW/High | cycle-20-2026-07-08 | r10c20 | 4 | README/product positioning pass |
| C21-03 | HIGH/High | cycle-21-2026-07-08 | r10c21 | 3 | Before upload-time privacy/metadata/processing fields are added, or next confirmed browser/PAT drift |
| C21-04 | HIGH/High-Medium | cycle-21-2026-07-08 | r10c21 | 3 | Production RSS/OOM incident during upload/restore, or approved streaming-ingress project |
| C21-05 | HIGH/High | cycle-21-2026-07-08 | r10c21 | 3 | Measured pool starvation during queue/backfill/search, or shared background-budget project approved |
| C21-07 | HIGH/High | cycle-21-2026-07-08 | r10c21 | 3 | Next high-risk source-contract-only finding, or behavior/integration test-hardening cycle |
| C21-08 | HIGH/High | cycle-21-2026-07-08 | r10c21 | 3 | Next migration/schema cycle with DB test infra, or reconcile/schema drift incident |
| C21-09 | HIGH/Medium | cycle-21-2026-07-08 | r10c21 | 3 | Next backup/restore cycle, child-process regression, or reusable spawn/fixture harness lands |
| C21-10..14 | mixed, up to MED | cycle-21-2026-07-08 | r10c21 | 3 | Public discovery/search/map/vector performance exit criteria in Cycle 21 deferred register |
| C21-16 | MED/Medium | cycle-21-2026-07-08 | r10c21 | 3 | Counter drift bug report, shared-group cache refactor, or analytics consistency cycle |
| C21-19..24 | mixed, up to MED | cycle-21-2026-07-08 | r10c21 | 3 | Operator/topology/security-model exit criteria in Cycle 21 deferred register |
| C21-26..29 | mixed, up to MED | cycle-21-2026-07-08 | r10c21 | 3 | Client/browser/e2e hardening exit criteria in Cycle 21 deferred register |
| C21-37..40 | mixed, up to MED | cycle-21-2026-07-08 | r10c21 | 3 | Admin UX, presentation, and template-distribution exit criteria in Cycle 21 deferred register |
| C22-05 | HIGH/High | cycle-22-2026-07-08 | r10c22 | 2 | Before upload-time privacy/metadata/processing fields are added, or next confirmed browser/PAT drift |
| C22-06 | HIGH/High source shape, Medium live impact | cycle-22-2026-07-08 | r10c22 | 2 | Production RSS/OOM incident during upload/restore, or approved streaming-ingress project |
| C22-07 | HIGH/High | cycle-22-2026-07-08 | r10c22 | 2 | Measured pool starvation during queue/backfill/search, or shared background-budget project approved |
| C22-08 | MED/Medium | cycle-22-2026-07-08 | r10c22 | 2 | Counter drift bug report, shared-group cache refactor, or analytics consistency cycle |
| C22-09 residual | HIGH/High | cycle-22-2026-07-08 | r10c22 | 2 | Next high-risk source-contract-only finding, or behavior/integration test-hardening cycle |
| C22-11 | MED/High | cycle-22-2026-07-08 | r10c22 | 2 | Browser-specific regression, PWA/SW incident, visual regression budget, or test-matrix project approved |
| C22-12..15 | mixed, up to MED | cycle-22-2026-07-08 | r10c22 | 2 | Public map/search/on-this-day/vector performance exit criteria in Cycle 22 deferred register |
| C22-16..20 | mixed, up to MED | cycle-22-2026-07-08 | r10c22 | 2 | Operator/topology/backup/security-model exit criteria in Cycle 22 deferred register |
| C22-21 | LOW/Medium | cycle-22-2026-07-08 | r10c22 | 2 | Next background writer/queue is added, or restore-drain omission escapes review |
| C22-22..25 | mixed, up to MED | cycle-22-2026-07-08 | r10c22 | 2 | Admin UX, mobile presentation, and template-distribution exit criteria in Cycle 22 deferred register |
| C23-04 | HIGH/High source shape, Medium live RSS impact | cycle-23-2026-07-08 | r10c23 | 1 | Production RSS/OOM incident during upload/restore, on-host RSS trace proving breach, or approved streaming-ingress project |
| C23-05 | HIGH/High | cycle-23-2026-07-08 | r10c23 | 1 | Before upload-time privacy/metadata/processing fields are added, or next confirmed browser/PAT drift |
| C23-06 | HIGH/High | cycle-23-2026-07-08 | r10c23 | 1 | Measured pool starvation during queue/backfill/search, or shared background-budget project approved |
| C23-11..15 | mixed, up to MED | cycle-23-2026-07-08 | r10c23 | 1 | Operator/topology/backup/security-model exit criteria in Cycle 23 deferred register |
| C23-16..17 | MED/High | cycle-23-2026-07-08 | r10c23 | 1 | Public keyword/semantic search scale exit criteria in Cycle 23 deferred register |
| C23-18..19 | MED/High | cycle-23-2026-07-08 | r10c23 | 1 | Test-infra/browser-matrix hardening exit criteria in Cycle 23 deferred register |
| C23-20..22 | mixed, up to MED | cycle-23-2026-07-08 | r10c23 | 1 | Public map/on-this-day/SW performance exit criteria in Cycle 23 deferred register |
| C23-25..26 | mixed, up to MED | cycle-23-2026-07-08 | r10c23 | 1 | Admin responsive/IA and mobile presentation exit criteria in Cycle 23 deferred register |
| C24-01 | HIGH/High | cycle-24-2026-07-08 | r10c24 | 0 | Production RSS/OOM incident during upload/restore, on-host RSS trace proving breach, or approved streaming-ingress project |
| C24-02 | HIGH/High source design, Medium threshold | cycle-24-2026-07-08 | r10c24 | 0 | Measured pool starvation during queue/backfill/search, or shared background-budget project approved |
| C24-03 | HIGH/High | cycle-24-2026-07-08 | r10c24 | 0 | Before upload-time privacy/metadata/processing fields are added, or next confirmed browser/PAT drift |
| C24-08..09 | mixed, up to MED | cycle-24-2026-07-08 | r10c24 | 0 | Data-layer/storage-boundary architecture exit criteria in Cycle 24 deferred register |
| C24-10 | HIGH/High | cycle-24-2026-07-08 | r10c24 | 0 | Scale-out attempted, singleton contention incident, or fail-closed/shared-state topology project approved |
| C24-11..12 | MED/mixed | cycle-24-2026-07-08 | r10c24 | 0 | Smart-collection lifecycle and large-client-component architecture exit criteria in Cycle 24 deferred register |
| C24-13..18 | mixed, up to MED | cycle-24-2026-07-08 | r10c24 | 0 | Public search/map/vector/SW/CSV performance exit criteria in Cycle 24 deferred register |
| C24-19..23 | mixed, up to MED | cycle-24-2026-07-08 | r10c24 | 0 | Source-contract, browser matrix, CLIP preflight, coverage, and admin E2E evidence exit criteria in Cycle 24 deferred register |
| C24-24..30 | mixed, up to MED | cycle-24-2026-07-08 | r10c24 | 0 | Admin responsive/IA/form-validation/zoom/mobile-masonry/site-config product-UX exit criteria in Cycle 24 deferred register |
| C24-31..35 | mixed, up to MED | cycle-24-2026-07-08 | r10c24 | 0 | Operator nginx/proxy/secrets/backup/build-runtime/restore-recovery validation exit criteria in Cycle 24 deferred register |
| C25-03 | HIGH/High | cycle-25-2026-07-08 | r10c25 | 0 | Production RSS/OOM incident during upload/restore, on-host RSS trace proving breach, or approved streaming-ingress project |
| C25-04 | HIGH/High source shape, Medium-High impact | cycle-25-2026-07-08 | r10c25 | 0 | Measured pool starvation during queue/backfill/search, or shared background-budget project approved |
| C25-05 | HIGH/High | cycle-25-2026-07-08 | r10c25 | 0 | Before adding upload-time privacy/metadata/processing fields, or next confirmed browser/PAT drift |
| C25-06 | MED-HIGH/High | cycle-25-2026-07-08 | r10c25 | 0 | Scale-out attempted, singleton contention incident, or fail-closed/shared-state topology project approved |
| C25-07..14 | mixed, up to MED | cycle-25-2026-07-08 | r10c25 | 0 | Storage-boundary, semantic/map/search/query/export/SW/action-boundary exit criteria in Cycle 25 deferred register |
| C25-15..20 | mixed, up to MED | cycle-25-2026-07-08 | r10c25 | 0 | Migration parity, browser-flow, browser-matrix, visual-regression, CLIP preflight, and coverage-ratchet exit criteria in Cycle 25 deferred register |
| C25-22 | MED/High | cycle-25-2026-07-08 | r10c25 | 0 | Before distributing GalleryKit as a template/package, or if copied installs publish wrong canonical URLs |
| C25-24..30 | mixed, up to MED/HIGH-conditional | cycle-25-2026-07-08 | r10c25 | 0 | Restore scanner, secrets, backups, nginx/proxy, build-runtime config, restore recovery, and analytics-boundary exit criteria in Cycle 25 deferred register |
| C8b-01 / ARCH8-01 | MED/High | cycle-8b-2026-07-07 | r10c8(loop-B) | 3 | Next upload-flow-touching cycle extracts shared `ingestUploadedImage(...)` orchestration (LR route vs browser action; drift class burned twice, both healed), OR a third settings/validation drift lands |
| C8b-02 / TEST8-03b | HIGH/High (test-design) | cycle-8b-2026-07-07 | r10c8(loop-B) | 3 | Behavioral concurrency harness for `uploadImages()` (C94-04/C4-18 test-infra class); the strictly-stronger no-await window pin shipped c8b WP7 — underlying code verified correct by the c8 verifier lane |
| C8b-03 / PERF8-SW-01 | LOW/High | cycle-8b-2026-07-07 | r10c8(loop-B) | 3 | Next SW-template-touching cycle amortizes the HTML offline-cache O(N) eviction reads, OR measured SW main-thread cost |
| C8b-04 / PERF8-BF-01 | LOW/High | cycle-8b-2026-07-07 | r10c8(loop-B) | 3 | Next schema/migration-authoring cycle folds a `(pipeline_version, id)` index for backfill candidate scans (rides the next journal entry, same treatment as C2-21) |

Cycle-8 (loop-B) age-budget check: four new rows (C8b-01..04; the HIGH row C8b-02 is a
test-design gap — the underlying upload-quota code is verified correct, and its stronger
static pin shipped in c8b WP7). No open High-severity CODE finding crosses the 8-cycle
budget: all loop-B cycle-1 rows reaching age 8 this cycle (C1-11/13/25a/31/32/33/36b) are
MED-or-lower, so the README's High rule triggers no mandatory scheduling. MED 16-cycle
checkpoint: `C80-06` (~16) re-justified — the build-time `site-config.json` contract is
documented (CLAUDE.md ARCH-03); the row remains ONLY the product/operator decision on
runtime-editable file config, and its exit criterion has not fired (no operator request).
Housekeeping: `C4-17` REMOVED from the open table — implemented in run-10 cycle 5
(`maintenance-scheduler.ts` owned by `instrumentation.ts`), verified by the c8 architect
lane (AGG8b-38). Fold notes: PERF-F1 → C6-04c; TEST8-05 residual → C6-12 (the
watchdog-primitive tests do NOT close C6-12); TEST8-06 → C4-18.

Cycle-7 (loop-B) age-budget check: one new row (C7b-06code, MED, age 0). No open High-severity
carry-forward crosses the 8-cycle budget (C7-02/HIGH was SCHEDULED, not deferred, in
`cycle-7b-2026-07-07-plan.md` WP1), and no MED row newly crosses the 16-cycle checkpoint.

Cycle-6 age-budget check (this loop): all 15 new rows are age 0 and MED-or-lower — no open
High-severity carry-forward crosses the 8-cycle budget, and none crosses the 16-cycle MED
checkpoint. Ages of pre-c6 rows above are unchanged here (the two concurrent loops share this
register; each per-cycle `cycle-N-*-deferred.md` remains the authoritative detail record).

## Rows that left a register recently (for lineage continuity)

- `C4-17` (maintenance-scheduler extraction): IMPLEMENTED in run-10 cycle 5 — removed from
  the open table at c8b (loop-B) after the cycle-8 architect lane verified
  `instrumentation.ts` wires `maintenance-scheduler.ts` directly (the row was doc-lag, not
  open code work).
- `C77-ARCH-01` (High): scheduled run-10 c1 (WP3) after 8+ cycles — the age budget's first application.
- `C94-11`: re-opened + scheduled run-10 c1 (WP6) on two-lane agreement.
- `C2-31` concrete instance: scheduled + landed run-10 c3 (WP12, nginx-test block parser); remainder row above.
- `C3-25`: same WP12 (api-csp-header count-pin relaxation) — closed, no row.
- `C3-32` (JSON-LD dev-warning): exit criterion FIRED and CLOSED run-10 c4 — DES4-P3 reproduced against a production build (zero console output; the React 19 warning is dev-only). Removed from this register.
- `C4-26` (SW eviction recency read): folded into WP5/run-10 c4 — `evictExpiredCachedImage` now reads LRU meta through `withMetaMutation` in both `apps/web/public/sw.template.js` and `apps/web/src/lib/sw-cache.ts`.
- `C3-01 / C3-02 / C3-04 / C3-16` residuals: their sibling failure classes were scheduled + shipped run-10 c4 (WP1 DML-baseline guard, WP2 guard self-heal, WP3 config write-invalidation) — see the cycle-4 plan's forward-honesty ledger.
