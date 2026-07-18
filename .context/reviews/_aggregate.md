# Cycle 7 Aggregate Review

Date: 2026-07-18 KST
Review HEAD: `ec7fc46f`

## Agent coverage

Completed and preserved provenance reviews: code-reviewer, perf-reviewer,
security-reviewer, critic, verifier, test-engineer, tracer, architect,
debugger, document-specialist, and designer. The global thread limit exposed
one child review slot. Six technical lenses ran in the first worker; the
initial product-worker launch was rejected by that limit, then the required
retry independently validated the five locally produced product/UX reports.
The aggregate applied the retry's material ultrawide and cold-fallback wording
corrections consistently across those files.

The review inventory covered all maintained TypeScript/JavaScript application
and script files, 31 migration SQL files plus journal/reconcile, 370 unit-test
files, 14 Playwright files, public/admin route and action boundaries,
PWA/build/deploy assets, governing documentation, current plans, and the
consolidated deferred register. The Cycle 6 diff was an entry point, not a
scope boundary. Designer coverage used the required agent-browser skill
family and live DOM/accessibility/computed-style evidence at 320, 393, 1,536,
and 2,560 CSS pixels.

## New deduplicated findings

### C7-01 — Intrinsic masonry geometry uses viewport width instead of its capped container

- Severity / confidence: **Medium / High**
- Status: **Confirmed live fallback-geometry mismatch**
- Agreement: code-reviewer, perf-reviewer, critic, verifier, tracer,
  architect, debugger, document-specialist, designer
- Regions: `apps/web/src/components/home-client.tsx:21-79,231-249`;
  `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`;
  `apps/web/tailwind.config.ts:21-22`;
  `apps/web/src/components/masonry-card.tsx:23-25,52-76`;
  `apps/web/src/app/[locale]/globals.css:231-235`
- Failure: Cycle 6 corrected the item-count divisor but retained a 48
  px-quantized `window.innerWidth` numerator. The gallery is inside `px-4` and
  Tailwind's 1,536 px-capped `.container`. At 320 px, live production rendered
  a 288x192 landscape card with `contain-intrinsic-size:auto 224px` (16.7%
  high). At 2,560 px, a live two-photo filter rendered a 1,504 px grid and two
  744x496 cards while the 2,544 px viewport bucket emitted `auto 843px` (70%
  high). These lengths are the cold fallback for `content-visibility:auto`;
  browsers may retain actual dimensions after rendering, but first-time
  skipped geometry is materially oversized and contracts when activated.
- Fix: measure the actual masonry content width, bucket that observed width if
  rerender throttling remains necessary, and derive the item-capped card width
  from that single layout-domain value. Avoid duplicating Tailwind's cap or
  padding in an unexplained arithmetic clamp.

### C7-02 — Responsive tests execute intrinsic geometry only at the accidental equality point

- Severity / confidence: **Medium / High**
- Status: **Confirmed test-design gap with live counterexamples**
- Agreement: code-reviewer, perf-reviewer, critic, verifier, test-engineer,
  tracer, architect, debugger, designer
- Regions: `apps/web/e2e/responsive-masonry.spec.ts:11-49`;
  `apps/web/src/__tests__/responsive-masonry.test.ts:9-53`;
  `apps/web/src/components/home-client.tsx:21-79,231-249`
- Failure: the only main-gallery geometry E2E runs at exactly 1,536 px, where
  viewport and container nearly coincide, and permits ±15% error. Unit tests
  cover column/source helpers but no measured-width/card-width boundary.
  Consequently both the current 320 px 16.7% error and 2,560 px 70% error pass
  every focused Cycle 6 test.
- Fix: add seeded main-gallery browser cases at 320 px and above the container
  cap (2,560 px), comparing computed intrinsic height with the real card box.
  Retain the existing sparse 1,536 px case because it protects item-count and
  source-selection invariants. Add focused helper coverage for invalid/empty
  measured widths if width arithmetic is extracted.

### C7-03 — Cycle 6 remains active and “signed release pending” after publication

- Severity / confidence: **Low / High**
- Status: **Confirmed signed push and live policy; exact deployed SHA remains manual-validation**
- Agreement: code-reviewer, critic, verifier, tracer, architect, debugger,
  document-specialist
- Regions: `.context/plans/cycle-6-2026-07-18-plan.md:3-5,43-45,65-73`;
  `.context/plans/README.md:34-40`; commits `fcbce386`, `03a96a3d`,
  `ec7fc46f`
- Failure: all three commits have good GPG signatures and
  `master == origin/master == ec7fc46f`; production exposes the Cycle 6
  responsive policy. The authoritative plan nevertheless leaves signed push
  and deploy unchecked and remains active, so recovery can repeat terminal
  work or select the wrong frontier.
- Fix: reconcile observable signed-push and production-policy evidence without
  claiming an unavailable exact deployed SHA, archive Cycle 6, and advance the
  plan index. A future terminal-reconciliation artifact could avoid repeating
  this one-cycle-late bookkeeping pattern.

## Revalidated carry-forward findings

The shared image-queue/backfill pool budget, warn-only single-writer topology,
failed-deploy rollback, SQL/file restore generation, large-map rendering,
semantic-vector scanning, upload RSS, environment-gated browser proofs, and
other explicit architecture/operator items remain in
`.context/plans/deferred-carry-forward.md` with their original severity,
confidence, reasons, and exit criteria. No exit criterion fired. Security
reviewer reported zero new security issues.

## Baseline evidence and final sweep

Fresh review baselines passed ESLint, API-auth lint, action-origin/mutation-
barrier lint, public-route-rate-limit lint, typecheck, production dependency
audit (zero vulnerabilities), full Vitest (362 files passed, 2 skipped; 3,421
tests passed, 4 expected skips), and `git diff --check` before review artifacts
were updated. Prompt 3 must still run every configured gate, including build
and full Playwright because browser-flow coverage is required.

The final aggregate sweep rechecked responsive siblings, memo invalidation,
route/action guards, privacy projections, migration/journal/reconcile,
upload/delete/restore races, background consumers, caches, PWA/build/runtime
configuration, deploy scripts, tests, and release ledgers. No fourth fresh
finding survived validation.

## AGENT FAILURES

None. The initial product-review launch was rejected by the global thread
limit; its required retry completed independent validation of all five files.
