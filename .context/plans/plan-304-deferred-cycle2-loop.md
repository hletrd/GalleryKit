# Plan 304 — Deferred items from cycle 2 loop review (2026-04-25)

## Status: deferred-only

## Source

`_aggregate-cycle2-loop.md` — items not covered by plan-303. All LOW severity. None are security/correctness/data-loss; deferral is allowed by repo rules. Each item records original severity, confidence, file citation, deferral reason, and re-open criterion.

## Deferred items

### AGG2L-LOW-03 — Group-page masonry density (4 columns at 2xl)

- **Severity / Confidence:** LOW / Medium
- **File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:170`
- **Reviewers:** code-reviewer (CR2L-INFO-01), designer (DSGN2L-INFO-01)
- **Deferral reason:** Designer call. Two valid stances:
  - Keep at 4 (curated share-group thumbnails benefit from breathing room).
  - Mirror home/topic at 5 (keep masonry density consistent across all gallery surfaces).
  No correctness or accessibility issue either way; current 4-column behavior was unchanged this cycle.
- **Re-open criterion:** Designer ratifies a unified masonry density rule, OR a user-reported visual issue surfaces specifically on the share-group page at 2xl widths.

## Plan-302 carryforward (re-confirmed)

The 12 LOW items deferred to `plan-302` remain deferred. Each retains its original re-open criterion. Cycle 2 reviewers did not surface new evidence to upgrade severity on any of them. Specifically:
- AGG1L-LOW-03 (skeleton-shimmer dark mode + animation never stops) — designer evidence still pending.
- AGG1L-LOW-05 (focus-style ring vs outline) — designer commitment still pending.
- AGG1L-LOW-06 (login double-cuing) — AT verification still pending.
- AGG1L-LOW-07 / 08 (toolbar / search button height) — designer call still pending.
- AGG1L-LOW-09 (landscape mobile photo container) — partially debunked, no user reports.
- AGG1L-LOW-10 (--muted-foreground regression) — visual screenshot review still pending.
- AGG1L-LOW-11 (admin OG locale dead silently) — UX/docs polish.
- AGG1L-LOW-13 (e2e password toggle) — Playwright suite addition not warranted yet.
- AGG1L-LOW-14 (browser save-password prompt) — UX polish.
- AGG1L-LOW-15 (F-* policy doc) — docs.
- AGG1L-LOW-16 (touch-target gaps in non-cycle-1 surfaces) — admin-UX review not yet scheduled.

No re-open criterion was met for any plan-302 item this cycle.

## Convergence note

Per orchestrator guidance: this is the "deferred-only" companion to plan-303. Plan-303 implements the only two highest-cross-reviewer-agreement items. Plan-304 captures the single residual LOW finding plus the plan-302 carryforward summary. None of the deferrals violate repo rules — none are security, correctness, or data-loss findings.
