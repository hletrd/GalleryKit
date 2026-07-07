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

**Age-budget check (run-10 c4):** NO open High-severity carry-forward row remains
(`C94-09 / C77-ARCH-01` was scheduled + implemented in run-10 cycle-1; `C1-25(a)` is a
product-decision row whose only High attachment was a doc issue already fixed — reworded
below so it no longer reads as an open High finding, C4-34). No open row is at or past the
8-cycle High budget in a way that requires scheduling. **MED 16-cycle checkpoint (new,
C4-45; refreshed C11):** `C80-06` (~15) is the only MED row approaching/crossing
the 16-cycle re-justify window. The build-time contract is now documented in
`CLAUDE.md` (`site-config.json` imports are inlined by Next and the compose bind
mount is inert at runtime). The remaining row is only the product/operator
decision of whether runtime-editable file config is desired. Next mandatory
re-check: every cycle, in the WP that updates this file.

**Provenance note:** an UNTRACKED, stale `.context/plans/run10-cycle2/` directory
(mtime 2026-06-25, from an abandoned earlier session that also used the "run10" name)
contains a deferred register with High-severity `AGG-0x` ids. It is NOT part of the
committed lineage (README "Authoritative timeline"); its live concerns that survived into
the committed lineage are represented by the rows below (restore validation/fence classes
under C96-*/C94-*). Do not resurrect ids from that file without re-verifying against HEAD.

## Open carry-forward rows

| ID | Sev/Conf | Home register | First deferred | Age @ r10c4 | Exit criterion (short) |
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
| C1-31 | LOW/Med | cycle-1-2026-07-06 | r10c1 | 3 | mysql2 version bump OR DB-backed test infra |
| C1-32 (broad) | LOW-MED/High | cycle-1-2026-07-06 | r10c1 | 3 | Incremental drainage policy (per-cycle, ongoing) |
| C1-33 (measurement) | LOW/Med | cycle-1-2026-07-06 | r10c1 | 3 | RSS trace on deploy host during 200 MB upload |
| C1-13 (fail-loud half) | LOW/Med | cycle-1-2026-07-06 | r10c1 | 3 | TRUST_PROXY ops incident OR boot-probe design decision |
| C1-25(a) | product-decision (doc half already FIXED) | cycle-1-2026-07-06 | r10c1 | 3 | Product decision: ship Collections admin UI (not an open High finding — C4-34 reword) |
| C1-11 (operator) | MED/Med | cycle-1-2026-07-06 | r10c1 | 3 | Operator confirms production edge topology (chains C3-12op) |
| C1-36(b) | MED/High | cycle-1-2026-07-06 | r10c1 | 3 | i18n key-reference scanner (AST-level test infra) |
| C2-07 | MED/High | cycle-2-2026-07-07 | r10c2 | 2 | Chains on C2-31 tokenizer OR a DB-reaching public page.tsx without edge limiter |
| C2-12 | MED/High | cycle-2-2026-07-07 | r10c2 | 2 | ~1000 geotagged map photos OR measured multi-second /map mount |
| C2-14b | MED/High | cycle-2-2026-07-07 | r10c2 | 2 | Semantic search enabled in prod + measured scan latency (MUST copy vectors — PERF3-04 rider, run-10 c3) |
| C2-15 | MED/High | cycle-2-2026-07-07 | r10c2 | 2 | Measured view-record latency OR DB-backed test infra |
| C2-16 | MED/Med | cycle-2-2026-07-07 | r10c2 | 2 | Measured home latency OR next schema cycle folds the index |
| C2-20 | MED/High | cycle-2-2026-07-07 | r10c2 | 2 | C1-33 RSS trace OR OOM incident during GPS-stripped uploads |
| C2-21 | MED/High | cycle-2-2026-07-07 | r10c2 | 2 | Next migration-authoring cycle folds the `(processed, updated_at, id)` index |
| C2-24b | MED/High | cycle-2-2026-07-07 | r10c2 | 2 | Operator needs runtime site-config edits despite documented build-time import semantics OR config-precedence product decision |
| C2-27 | MED/High | cycle-2-2026-07-07 | r10c2 | 2 | Product decision: wire or delete the storage abstraction |
| C2-28 | MED-LOW/Med-High | cycle-2-2026-07-07 | r10c2 | 2 | Admin perceived-lag report OR next admin-table cycle (now folds C4-24) |
| C2-30 | LOW/High | cycle-2-2026-07-07 | r10c2 | 2 | Real spurious restore-abort OR next barrier-touching cycle |
| C2-31 (remainder) | LOW/High | cycle-2-2026-07-07 | r10c2 | 2 | Next scanner ossification instance → lint-gate tokenizer (first concrete rework landed r10c3 WP12) |
| C2-35 | LOW/Med | cycle-2-2026-07-07 | r10c2 | 2 | Never-clean backfill banner report OR next backfill cycle |
| C2-38 | LOW/High | cycle-2-2026-07-07 | r10c2 | 2 | Next.js first-class style-nonce OR an HTML-injection sink |
| C2-46 | LOW-MED/Med | cycle-2-2026-07-07 | r10c2 | 2 | Measured wasted re-encode volume OR NFS unlink hazard |
| C2-50 | LOW/High | cycle-2-2026-07-07 | r10c2 | 2 | Storage quarantine lifted (chains C2-27) |
| C2-53 | LOW/High | cycle-2-2026-07-07 | r10c2 | 2 | AT-user report OR next a11y label batch |
| C2-54 | LOW/High | cycle-2-2026-07-07 | r10c2 | 2 | Product decision on untitled-photo H1 template |
| C2-55 | LOW/High-Med | cycle-2-2026-07-07 | r10c2 | 2 | Per-item measurement triggers (perf long-tail class) |
| C2-37res | LOW/Med | cycle-3-2026-07-07 | r10c3 | 1 | Runtime IMAGE_BASE_URL boot-validation decision (root-cause residual) |
| C3-17 | LOW-MED/High | cycle-3-2026-07-07 | r10c3 | 1 | Measured payload concern OR namespace-inventory guard test lands |
| C3-28 | LOW/High | cycle-3-2026-07-07 | r10c3 | 1 | CSP memoization conflicts with pinned per-call fail-degrade semantics; re-open on measured middleware CPU OR a CSP-builder redesign |
| C3-30 | LOW/High | cycle-3-2026-07-07 | r10c3 | 1 | Observed tag-mutation deadlock in logs |
| C3-31 | LOW/High (accepted) | cycle-3-2026-07-07 | r10c3 | 1 | Very-large-dump restore slowdown measurement |
| C3-35 (redesign) | LOW/Med | cycle-3-2026-07-07 | r10c3 | 1 | Migration-machinery incident OR dedicated maintenance window (C4-01 added a DML guard but did NOT retire the non-monotonic-journal machinery) |
| C3-36 | LOW/Med | cycle-3-2026-07-07 | r10c3 | 1 | Opportunistic data.ts concern peeling (C1-32 policy) |
| C3-08op | MED/Med-High | cycle-3-2026-07-07 | r10c3 | 1 | Operator applies + verifies nginx zones per runbook (now also covers `zone=nextimage`, C4-13) |
| C3-12op | MED-HIGH contingent | cycle-3-2026-07-07 | r10c3 | 1 | Chains on C1-11 topology confirmation |
| C4-10 | MED/Med | cycle-4-2026-07-07 | r10c4 | 0 | Concurrent-upload UX report OR parallel-external-client product decision (reader/writer lock split) |
| C4-11 | MED/Med | cycle-4-2026-07-07 | r10c4 | 0 | C1-33 RSS trace lands OR RSS/OOM incident during LR uploads (retention-window fix) |
| C4-13 | MED/Med | cycle-4-2026-07-07 | r10c4 | 0 | Sequenced behind C3-08op: after operator applies nginx zones, add the read-only >burst 429 probe |
| C4-16 | LOW-MED/High | cycle-4-2026-07-07 | r10c4 | 0 | Next image-queue-touching cycle folds the {durable\|transient} state partition + single reset helper, OR a 5th lifecycle-reset bug lands. NOTE (c8b): the ARCH8-02 near-miss (embeddingScanModelVersion missed by the restore-quiesce reset, healed at HEAD) is evidence FOR this partition |
| C4-18 | LOW-MED/High | cycle-4-2026-07-07 | r10c4 | 0 | Next component-behavior-only source-pin must evaluate a minimal RTL/jsdom harness (adopt or record why not) |
| C4-22 | LOW/Med-High | cycle-4-2026-07-07 | r10c4 | 0 | Hairpin-DNS/self-origin OG incident OR measured cold-OG latency (fs-read transport + containment) |
| C4-24 | LOW/Med-High | cycle-4-2026-07-07 | r10c4 | 0 | Admin bulk-upload perceived-lag report OR next admin-surface perf cycle (fold with C2-28) |
| C4-25 (code) | LOW/Med | cycle-4-2026-07-07 | r10c4 | 0 | `IMAGE_BASE_URL` actually configured in production → decide the SW cross-origin caching story (doc half shipped this cycle) |
| C4-09d | MED/High | cycle-4-2026-07-07 | r10c4 | 0 | Real permanently-un-embeddable backlog ≥ SEMANTIC_SCAN_LIMIT in prod (durable cursor + per-row failure marking) |
| SEC4-03 | LOW/Med | cycle-4-2026-07-07 | r10c4 | 0 | Storage-backend multi-writer/non-local (C2-27) OR threat model adds hostile-local-writer (O_NOFOLLOW/fd-realpath re-check) |
| C4-46 | INFO/Low | cycle-4-2026-07-07 | r10c4 | 0 | Operator/agent FIND-failure incident on an existing runbook entry OR CLAUDE.md crosses ~1000 lines |
| C6-05 | MED/High | cycle-6-2026-07-07 | r10c6 | 0 | Measured admin bulk-apply latency OR DB-backed test infra (bulkUpdateImages CASE-UPDATE rewrite) |
| C6-04c | MED/High | cycle-6-2026-07-07 | r10c6 | 0 | Peer image-queue work lands + measured pool starvation, OR next image-queue cycle (shared pool-budget semaphore; doc half shipped c6 WP7) |
| C6-06c | MED/Med | cycle-6-2026-07-07 | r10c6 | 0 | DB-TLS import-throw incident OR system-CA opt-in product/ops decision (doc-wording half shipped c6 WP7) |
| C6-12 | MED/High | cycle-6-2026-07-07 | r10c6 | 0 | Next restore-path cycle OR a reusable child_process spawn-mock harness (db-restore failure behavioral test) |
| C6-17 | LOW/Med | cycle-6-2026-07-07 | r10c6 | 0 | A real over-strict `lint:action-origin` failure (check-action-origin clear-not-restore) |
| C6-18 | LOW/Med | cycle-6-2026-07-07 | r10c6 | 0 | Peer image-queue lands + new id-reuse trigger, OR next image-queue cycle (`processing_error` processed=false guard) |
| C6-19 | LOW-MED/Med | cycle-6-2026-07-07 | r10c6 | 0 | AT/keyboard-user report OR next a11y batch (truncated-metadata title-only reveal; folds with C96-13) |
| C6-20 | LOW/Low-Med | cycle-6-2026-07-07 | r10c6 | 0 | Collections authoring UI ships (chains C1-25(a)) → smart-collection compiled-cost ceiling |
| C6-21 | LOW-MED/Med | cycle-6-2026-07-07 | r10c6 | 0 | Many-small-file / high-DB-latency perceived upload lag, OR next upload-flow perf cycle (client batching; sequential constraint is C4-10) |
| C6-22 | LOW/Med | cycle-6-2026-07-07 | r10c6 | 0 | Observed brute-force at restart-near-window-boundary, OR rate-limit algorithm unification |
| C6-23 | LOW/Med | cycle-6-2026-07-07 | r10c6 | 0 | Observed concurrent-migrate ER_DUP_KEYNAME/half-reconcile, OR migration-machinery hardening cycle |
| C6-24 | LOW/High | cycle-6-2026-07-07 | r10c6 | 0 | Real duplicated-cache staleness bug, OR a config-cache refactor adopting one documented rule |
| C6-25 | LOW-MED/High | cycle-6-2026-07-07 | r10c6 | 0 | Peer cycle-10 closes AGG-C10-19/20, else fold next docs cycle (`.omc/wiki` CLIP "LIVE" drift) |
| C6-27 | LOW/Med | cycle-6-2026-07-07 | r10c6 | 0 | Next bulk-edit cycle OR a maintainer trips on the `titlePrefix` exact-set naming |
| C6-28 | MED/High | cycle-6-2026-07-07 | r10c6 | 0 | On-this-day made client-driven, OR a `TZ` operator-config note ships, OR a wrong-day report |
| C7b-06code | MED/High | cycle-7b-2026-07-07 | r10c7(loop-B) | 0 | `IMAGE_BASE_URL` configured in production (decide the boot-validation story once with C4-25/C2-37res), OR an operator restart-without-rebuild thumbnail incident (boot-time remotePatterns-vs-runtime probe; doc half shipped c7b WP14) |
| C8b-01 / ARCH8-01 | MED/High | cycle-8b-2026-07-07 | r10c8(loop-B) | 0 | Next upload-flow-touching cycle extracts shared `ingestUploadedImage(...)` orchestration (LR route vs browser action; drift class burned twice, both healed), OR a third settings/validation drift lands |
| C8b-02 / TEST8-03b | HIGH/High (test-design) | cycle-8b-2026-07-07 | r10c8(loop-B) | 0 | Behavioral concurrency harness for `uploadImages()` (C94-04/C4-18 test-infra class); the strictly-stronger no-await window pin shipped c8b WP7 — underlying code verified correct by the c8 verifier lane |
| C8b-03 / PERF8-SW-01 | LOW/High | cycle-8b-2026-07-07 | r10c8(loop-B) | 0 | Next SW-template-touching cycle amortizes the HTML offline-cache O(N) eviction reads, OR measured SW main-thread cost |
| C8b-04 / PERF8-BF-01 | LOW/High | cycle-8b-2026-07-07 | r10c8(loop-B) | 0 | Next schema/migration-authoring cycle folds a `(pipeline_version, id)` index for backfill candidate scans (rides the next journal entry, same treatment as C2-21) |

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
