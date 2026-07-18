# Aggregate Review — Cycle 11/100

Date: 2026-07-18
Reviewed HEAD: `7e40e95c46e09faf5faf6e87989a5586874b02d1`

## Review coverage

The collaboration runtime exposed two child slots after the root orchestrator
and this cycle agent. Both slots were launched together and covered every
required and repository-specific perspective in specialist bundles:

- `review_engineering`: code-reviewer, perf-reviewer, security-reviewer,
  architect, debugger, and tracer.
- `review_product`: critic, verifier, test-engineer, document-specialist,
  designer, photographer-workflow-reviewer, product-marketer-reviewer, and
  UI/UX-designer-reviewer.

The fourteen provenance reports are under
`.context/reviews/run-current-cycle11/`. Each lane inventoried the complete
tracked repository, routed the historical review/plan corpus through the
current authoritative ledgers, examined the Cycle 10 change end to end, and
completed a final missed-issue sweep. The design lanes used the complete
required agent-browser skill family against the deployed public application,
with DOM/accessibility/computed-style/network evidence rather than screenshot-
only inference. No child failed.

## Executive result

Three unique actionable findings survived aggregation:

1. **COR-C11-01 (Medium/High, confirmed):** `processImageFormats` persists the
   source/WI-15 processing ceiling as `derivative_max_width`, even when the
   largest configured derivative is smaller. The public field can therefore
   exceed every delivered file.
2. **TEST-C11-02 (High/High validation obligation, confirmed trigger; no live
   drift claimed):** migration 0031 fired the preserved disposable-MySQL
   reconcile-convergence exit criterion, but current coverage still stops at
   source-text/name presence and cannot prove executable DDL convergence.
3. **PERF-C11-03 (Medium/High, confirmed live):** search result links use
   default Next prefetch. One ordinary deployed query caused 16 dynamic photo
   RSC fetches for 10 unique result ids, including six duplicate destinations,
   before hover, focus, or activation.

No new authorization, privacy, data-loss, accessibility-conformance, i18n,
color-fidelity, dependency, or deployment-code defect survived validation.

## Deduplicated findings

### COR-C11-01 — Persisted derivative maximum exceeds the largest delivered file

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed correctness/data-contract defect**
- Cross-agent agreement: code-reviewer, architect, debugger, and tracer.
- Regions: producer `apps/web/src/lib/process-image.ts:1044-1046,
  1214-1219,1366-1377,1462-1465`; schema contract
  `apps/web/src/db/schema.ts:79-85`; public projection
  `apps/web/src/lib/data.ts:294-302`; consumer
  `apps/web/src/lib/image-url.ts:96-145`; documentation `CLAUDE.md:189-190`.
- Evidence: each output uses `min(processingBaseWidth, configuredSize)` and
  the unsuffixed base file is linked from the largest configured output. The
  return value is nevertheless the uncapped `processingBaseWidth`.
- Concrete failure: a 10,000 px input under the default ladder produces
  AVIF/WebP/JPEG derivatives and a base file no wider than 7,680 px, while all
  three persistence paths store and publicly project
  `derivative_max_width=10000`. Current markup stays truthful only because the
  serializer independently iterates aliases no larger than 7,680, a hidden
  cross-module invariant.
- Required fix: return and persist
  `min(processingBaseWidth, largestConfiguredSize)`, validate the non-empty
  normalized ladder invariant, and add a real wide-source encode regression
  that compares the returned value with decoded output widths.

### TEST-C11-02 — Migration 0031 has no executable reconcile-convergence gate

- Severity: **High** (schema-safety validation risk)
- Confidence: **High**
- Status: **Confirmed fired carry-forward trigger; no current drift claimed**
- Cross-agent agreement: architect and tracer; debugger independently noted
  the same validation boundary.
- Regions: trigger records
  `.context/plans/cycle-19-2026-07-08-deferred.md:13-20`,
  `.context/plans/cycle-20-2026-07-08-deferred.md:37`, and
  `.context/plans/cycle-21-2026-07-08-deferred.md:19`; migration
  `apps/web/drizzle/0031_derivative_max_width.sql:1-2`; reconcile mirror
  `apps/web/scripts/migrate.js:433-475`; source-only coverage
  `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19,76-103`.
- Evidence: the three preserved High/High records reopen on the next schema
  authoring cycle. Migration 0031 is that cycle. Its name appears in migration,
  schema, reconcile, and source tests, but the test explicitly says it cannot
  verify types, defaults, nullability, index/foreign-key shape, idempotence, or
  live baseline/reconcile ordering.
- Concrete failure: executable DDL can carry the right column name with a
  wrong structural definition and every current unit test remains green. That
  is the same class that historically let legacy/fresh databases report a
  successful deploy while remaining structurally incomplete.
- Required fix: add a deliberately disposable-DB-only MySQL gate that removes
  the latest schema artifact, runs `reconcileLegacySchema`, compares the live
  schema with its pre-mutation/current contract, proves a second reconcile is
  idempotent, and is mandatory in CI after database initialization. The gate
  must fail closed against production/non-test database names.

### PERF-C11-03 — Search results prefetch unused dynamic photo pages

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed performance/perceived-performance defect**
- Cross-agent agreement: critic, verifier, test-engineer, designer,
  product-marketer-reviewer, and UI/UX-designer-reviewer.
- Regions: `apps/web/src/components/search.tsx:77-85,498-513`; missing network
  assertion `apps/web/e2e/public.spec.ts:21-69`; contrast with the explicit
  no-prefetch grid contract in `apps/web/src/components/masonry-card.tsx:80-83`.
- Evidence: a fresh deployed session made zero `/en/p/*` requests before
  search. Showing one populated result set then made 16 successful dynamic
  `/en/p/{id}?_rsc=...` requests for 10 unique ids; six ids were fetched twice
  with different RSC keys, without a result being focused, hovered, or opened.
- Concrete failure: a visitor refining several queries on a phone spends
  bandwidth and backend/DB work rendering unused detail pages, competing with
  the next search and result thumbnails.
- Required fix: set `prefetch={false}` on `SearchResultItem` links and add an
  E2E request listener proving that a populated list emits no photo-detail RSC
  request until the visitor activates a result.

## Cross-agent adjudication

- COR-C11-01 is one root cause despite four role labels. The photographer and
  verifier reports say the actual derivative maximum is persisted, but their
  claim is disproved by the direct producer trace above. Their live examples
  covered sources below the configured maximum, where source ceiling and
  delivered maximum happen to be identical. The engineering evidence is
  retained.
- TEST-C11-02 is not a claim that migration 0031 is currently malformed. It is
  the explicit High/High validation exit criterion reopening; the planned
  disposable test is the closure condition.
- PERF-C11-03 and its E2E gap are one product defect, not separate performance,
  UX, marketing, and testing findings.
- The Cycle 10 plan's deploy-pending terminal state is not counted as a new
  review defect. The orchestrator's Cycle 10 report records
  `DEPLOY: per-cycle-success`; Prompt 2 must reconcile/archive that ledger using
  the prior-cycle evidence rather than invent a production SHA.

## Reopened and stale carry-forward records for Prompt 2

These are existing findings, not additional Cycle 11 findings, but the planner
must not silently ignore them:

- `C2-16` explicitly reopened when migration 0031 became the next schema-
  touching cycle. Its non-sargable `MONTH()/DAY()` on-this-day predicates still
  need the recorded generated-column/index remedy or a newly justified
  disposition with original Medium/Medium severity.
- `AGG-C20-12` explicitly reopened on the next schema/index migration. The
  listing indexes still omit the final `id` tie-breaker used by keyset ordering;
  the current cycle must resolve the overlap/drop decision rather than re-list
  the trigger unchanged.
- `C2-21` and `C8b-04/PERF8-BF-01` are stale open rows in the consolidated
  register: migrations 0029 and 0030/current Drizzle schema already provide
  the processed/topic `updated_at` indexes and the processed-pipeline-version
  index respectively. Prompt 2 should retire those rows with citations.
- `C94-10/C88-03` has reached the repository's approximately 16-cycle Medium
  checkpoint. Its detailed exit criterion remains a dedicated multi-model
  embedding-storage migration, not any unrelated schema edit; if it remains
  deferred, the current ledger must explicitly re-justify it without changing
  its Medium/High severity.

## Validation evidence from Prompt 1

- ESLint, API-auth lint, action-origin/mutation-barrier lint, public-route-rate-
  limit lint, full app/script typecheck, production build, production
  dependency audit, and full Vitest passed in the review bundles.
- Vitest: 363 files passed; 3,447 tests passed; expected CLIP skips only.
- The lead independently passed full app/script typecheck and four focused
  suites (35 tests) covering image URLs, privacy, sidecar persistence, and
  admin-backfill detection-failure persistence.
- Live browser review covered desktop/mobile, EN/KO, theme modes, keyboard and
  focus behavior, accessibility structure, network/console state, offline,
  320 px reflow, and responsive-resource selection.
- Local and remote `master` match `7e40e95c`, and the four Cycle 10 commits
  verify with good GPG signatures.

## Agent failures

None. Both available child agents returned and wrote all fourteen required and
project-specific provenance reports.
