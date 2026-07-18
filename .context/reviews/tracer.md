# Tracer — Cycle 5 Provenance

Review target: `4926a3e4`. The inventory and causal sweep followed
request→guard→mutation→DB, upload→queue→derivatives, delete→durable cleanup,
restore→locks/barrier/import, migration→journal/postcondition, SSR→picture
sources→CSS columns→candidate request, navigation→focus/collapse, and
commit→remote→plan→deploy evidence across the full maintained tree.

## New findings

### TRC-C5-01 — Layout and image-selection traces fork at their breakpoint boundary

- Severity / confidence: **Medium / High**
- Status: **Confirmed live** for the home flow; sibling traces are likely/source-confirmed
- Trace/regions: column classes in `home-client.tsx:247-271`, `timeline/page.tsx:229`, `year/[year]/page.tsx:191`, and `g/[key]/page.tsx:187` → independent size declarations in `masonry-card.tsx:21`, `timeline/page.tsx:264-274`, `year/[year]/page.tsx:223-233`, and `g/[key]/page.tsx:223-233` → browser currentSrc
- Failure: at 768px/DPR2 the layout trace enters three columns while the image trace remains in the prior 50vw branch, fetching 1536w for a 234.66px card. The shared-group trace has broader 1024–1200 and 1280+ divergence.
- Fix: give layout and responsive-image selection one shared breakpoint policy per grid variant, then trace it with browser boundary tests.

### TRC-C5-02 — Cycle 4's implementation trace reaches the remote but stops before its ledger

- Severity / confidence: **Low / High**
- Status: **Confirmed** through signed remote publication; deployment SHA is manual-validation
- Trace/regions: checked work/gates at `.context/plans/cycle-4-2026-07-18-plan.md:18-39,63-67` → signed commits `b72bb0cd`, `ff5d4cd6`, `4926a3e4` → `master == origin/master` → stale status/tasks at plan lines `5,40-42,68-69` and active index `.context/plans/README.md:34-38`
- Failure: recovery follows a frontier behind actual implementation and remote state.
- Fix: reconcile the ledger after terminal operations and record deploy evidence independently.

## Final trace sweep

Writer guards, processing/deletion races, restore sidecars and locks, schema
application, config→encoder→cache flow, proxy→limiter flow, SW mutations, and
deploy/prune ordering were rechecked. No further new causal break survived.
