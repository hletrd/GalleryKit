# Test Engineer — Cycle 3 provenance

Target: `afa11cf4`, 2026-07-18 KST. Review only.

## Test inventory and execution

I inventoried 368 tracked Vitest files, 9 Playwright specs plus helpers (48
discovered browser tests), three custom security scanners and their fixtures,
typecheck/build hooks, CI workflows, CLIP env-gated suites, migration/reconcile
fixtures, deploy shell tests, generated service-worker contracts, and all tests
mapped to the Cycle-2 source diff. Full Vitest passed 3,410 tests with 4 CLIP
tests skipped; lint/typecheck/build/scanners/audit passed. Playwright discovery
passed. Live Chromium was used for the missing responsive network proof, but
that ad-hoc validation is not a committed regression test.

## Genuinely new Cycle-3 findings

### TEST-C3-01 — Responsive preload coverage stops at source text

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed new gap**
- Regions: `apps/web/src/components/home-client.tsx:133-169,190-192`;
  `apps/web/src/__tests__/masonry-card-memo.test.ts:115-123,200-205`;
  `apps/web/e2e/public.spec.ts:21-50`;
  `.context/plans/cycle-2-2026-07-18-plan.md:29-32,64-78`

The unit test checks that selected strings appear and that the unmeasured eager
count is one. It never renders the server response, inspects the actual preload
links, or observes requests at a viewport. The E2E change tests only search
combobox states. Nevertheless, the plan says 320 px and desktop request-timeline
coverage was added.

Concrete failure: these tests pass if the intermediate 768/1280 media mappings
are reordered, React/Next drops or changes the emitted link attributes, or the
browser starts the same offscreen mobile requests through another scheduling
path. The original Medium bandwidth defect can recur with an all-green suite.

Suggested fix: add a Playwright test with deterministic image dimensions and a
cold browser context; record image requests before/through hydration at 320 px
and representative 2/3/4/5-column widths, inspect emitted `media`,
`imagesrcset`, and `imagesizes`, and assert only the viewport-eligible preload
hints activate. Avoid a final-DOM-only assertion.

### TEST-C3-02 — No automated test exercises failed-deploy recovery

- Severity: **Medium**
- Confidence: **High**
- Status: **Revalidated carry-forward gap; not new**
- Regions: `apps/web/src/__tests__/deploy-script-contract.test.ts:27-56`;
  `apps/web/deploy.sh:63-89`

The suite proves health-before-prune ordering but accepts exit-with-broken-
replacement behavior. Add a fake Docker state machine asserting automatic
prior-image restoration and health, or candidate-slot cleanup and no promotion.

## Coverage and flakiness sweep

The closing sweep checked skip conditions, fake-timer cleanup, source-only
contracts, scanner false-positive/negative fixtures, concurrency/race tests,
generated artifacts, E2E serialization, credential gates, and recent-change
coverage. The current live preload and search behavior passed manual Chromium
validation; real CLIP, credentialed admin E2E, proxy topology, multi-process
coordination, and failed-deploy recovery remain explicit non-default proofs. No
additional new high-confidence test gap survived the sweep.
