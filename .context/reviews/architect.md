# Architect — Cycle 5 Provenance

Review target: `4926a3e4`. The architecture inventory covered all App Router
files, libraries, components, DB/schema/migration/reconcile paths, scripts/jobs,
tests, runtime/build/deploy/PWA assets, and governing/current/deferred docs. The
sweep emphasized ownership, coupling, config lifetime, persistence, concurrency,
privacy, caches, and image delivery.

## New findings

### ARCH-C5-01 — Column layout and responsive-image policy have multiple unsynchronized owners

- Severity / confidence: **Medium / High**
- Status: **Confirmed architecture defect with live performance impact**
- Regions: layout policy in `home-client.tsx:247-271`, `timeline/page.tsx:229`, `year/[year]/page.tsx:191`, `g/[key]/page.tsx:187`; duplicated image policy in `masonry-card.tsx:21`, `timeline/page.tsx:264-274`, `year/[year]/page.tsx:223-233`, `g/[key]/page.tsx:223-233`

The same breakpoint-to-column relationship is independently encoded in Tailwind
class strings and four responsive-image literals. They already disagree: exact
main/archive breakpoints select the previous slot, and the shared-group literal
does not model `lg` or four-column `xl` correctly.

Concrete failure: a common 768px DPR-2 home viewport fetches 1536w instead of
640w; future layout changes can silently widen the drift across every copied
surface.

Suggested fix: create client-safe layout policy constants/helpers that produce or
co-locate both approved class mappings and `sizes` strings for the main/archive
and shared-grid variants. Pin the ownership with browser boundary tests.

### ARCH-C5-02 — Release state still has unreconciled Git and ledger owners

- Severity / confidence: **Low / High**
- Status: **Confirmed** for implementation and remote state; deploy SHA manual-validation
- Regions: `.context/plans/cycle-4-2026-07-18-plan.md:5,40-42,61-69`; `.context/plans/README.md:34-38`

The plan owns recovery state but is written before terminal Git/deploy operations
and is not reconciled afterward. Git proves signed remote publication through
`4926a3e4`; the plan still says implementation and push are pending.

Concrete failure: the next cycle must reconstruct the frontier from multiple
systems and can repeat release work.

Suggested fix: make terminal ledger reconciliation a required post-push step and
record deploy identity in a machine-verifiable way (or explicitly mark it
unverified instead of pending implementation).

## Revalidated carry-forward

Shared DB background admission, warn-only single-instance enforcement, SQL/file
restore generations, and failed-release rollback remain open architecture risks
with existing provenance. They are not new Cycle 5 findings.

## Final architecture sweep

All persistence mounts, build/runtime config ownership, schema/reconcile paths,
writers versus restore fences, file lifecycle, process-local coordination,
caches, color delivery, and promotion were rechecked. No further fresh break
survived.
