# Tracer — Cycle 7 Provenance

Review target: `ec7fc46f`; review only.

## Inventory and causal traces

I inventoried the full maintained source/test/runtime surface and traced request admission, DB/file lifecycles, queue/restore interactions, responsive rendering, cache/PWA behavior, and release promotion across file boundaries. Fresh lint/security-lint/typecheck/audit/full-unit gates passed.

### TRC-C7-01 — Sparse width trace crosses coordinate systems above 1,536 px

- Severity / confidence: **Medium / High**
- Classification: **Confirmed causal mismatch; visible shift manual-validation**
- Regions: `home-client.tsx:21-79,231-249` -> `app/[locale]/(public)/layout.tsx:17-19` -> `masonry-card.tsx:58-77` -> `globals.css:231-235`; coverage at `e2e/responsive-masonry.spec.ts:11-49`
- Trace: viewport 2,560 -> width bucket 2,544 -> raw breakpoint count 5 -> two items cap effective count to 2 -> estimator computes 1,264 px -> public Tailwind container caps at 1,536 and `px-4` leaves 1,504 px -> real two-column card is about 744 px -> `MasonryCard` converts both widths through the same aspect ratio -> `contain-intrinsic-size` is about 1.70x real height -> `content-visibility:auto` uses the oversized stand-in when skipped.
- Concrete failure: a deferred sparse card collapses its virtual height when activated, altering scroll/layout geometry. The 1,536 px E2E observes the one point where the two coordinate systems nearly match and therefore passes.
- Suggested fix: feed observed grid content width, not viewport width, into the shared effective-column calculation; add an above-cap browser case.

Cycle 6's optional `ResizeObserver` suggestion was not implemented or tracked as a confirmed finding. The item-capped divisor now makes the above-cap branch a concrete current regression rather than a duplicate of the fixed five-column under-reservation.

### TRC-C7-02 — Cycle 6 terminal state stops before its published HEAD

- Severity / confidence: **Low / High**
- Classification: **Confirmed signed-push mismatch; deploy SHA manual-validation**
- Regions: `.context/plans/cycle-6-2026-07-18-plan.md:3-5,43-45,65-73`; `.context/plans/README.md:34-41`; commits `fcbce386`, `03a96a3d`, `ec7fc46f`
- Trace: implementation/test/docs commits are all GPG-good -> `master == origin/master == ec7fc46f` -> plan still says signed release pending and leaves push/deploy unchecked -> index keeps Cycle 6 active.
- Concrete failure: recovery can repeat publication/deploy work or start from an obsolete frontier.
- Suggested fix: reconcile signatures and remote equality, record only observable deploy evidence, archive Cycle 6, and advance the index.

## Final missed-issue sweep

I traced the competing explanations for the wide mismatch (breakpoint drift, source `sizes`, bad aspect ratio, stale deployment, and bucket rounding); none explains the deterministic container/viewport divergence. I also re-traced auth/rate-limit admission, upload-delete-restore ordering, background jobs, migration promotion, cache invalidation, and release state. No third new trace survived.
