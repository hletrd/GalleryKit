# Aggregate Review — Cycle 12/100

Date: 2026-07-18
Reviewed HEAD: `ff6532f4`

## Review coverage

The collaboration runtime exposed two child slots after the root orchestrator
and this cycle agent. Both slots were launched together and covered seven
engineering perspectives; the lead covered the four remaining perspectives in
parallel:

- child `review_code_arch`: code-reviewer, architect, debugger, test-engineer;
- child `review_sec_perf`: security-reviewer, perf-reviewer, tracer;
- lead: critic, verifier, document-specialist, designer.

All eleven required perspectives returned. Each lane inventoried the tracked
implementation and documentation, examined cross-file interactions, reviewed
the complete Cycle 11 change surface, and performed a final missed-issue sweep.
The designer read and used the full agent-browser skill family against the live
public application with accessibility/DOM/computed-metric/runtime evidence.
No child failed.

## Executive result

Five unique findings survived deduplication:

1. **SCHEMA-C12-01 (High/High):** the new convergence CI lane bootstraps its
   reference schema through `reconcileLegacySchema`, then damages and repairs
   that same reconcile-authored schema. It never executes the real latest
   pending migration SQL, so a broken upgrade can pass.
2. **SCHEMA-C12-02 (Medium/High):** reconcile accepts same-named malformed
   generated columns and indexes whose column list matches but whose material
   definition differs.
3. **PERF-C12-03 (Medium/High):** every uncached timeline render applies
   `DISTINCT YEAR(capture_date)` over all processed dates, and even an explicit
   year waits for that unbounded predecessor before its bounded photo query.
4. **TEST-C12-04 (Medium/High):** On This Day's new generated-column behavior
   is asserted by source strings and a JavaScript imitation, not executable
   MySQL date-generation/query semantics.
5. **DOC-C12-05 (Low/High):** the Cycle 11 plan remains active and says signed
   publication is pending although signed local and remote HEAD are equal.
   Deployment remains unknown without independent evidence.

No new authorization, privacy, data-loss, dependency, UI/accessibility, i18n,
color-fidelity, or image-delivery defect survived validation.

## Deduplicated findings

### SCHEMA-C12-01 — Convergence CI never executes the real latest upgrade SQL

- Severity: **High**
- Confidence: **High**
- Status: **Confirmed validation defect; current 0032 SQL appears correct by
  inspection; live existing-DB upgrade remains manual-validation**
- Cross-agent agreement: code-reviewer, architect, debugger, test-engineer,
  tracer.
- Regions: fresh bootstrap `apps/web/scripts/migrate.js:917-937`; production
  migration call `apps/web/scripts/migrate.js:1073-1075`; convergence setup and
  degradation `apps/web/scripts/check-schema-convergence.mjs:11,28-102`; source
  test `apps/web/src/__tests__/schema-convergence-gate.test.ts:12-31`; CI order
  `.github/workflows/quality.yml:72-78`.
- Evidence: CI initializes an empty DB. The empty branch creates the current
  schema via reconcile and baselines every journal hash, so the subsequent
  migration runner is a no-op. The convergence script snapshots that output,
  hard-codes damage to 0032 objects, calls the same reconcile function again,
  and compares it with its own earlier output. Neither phase executes
  `0032_capture_date_indexes.sql` as a pending upgrade.
- Concrete failure: a future/latest migration contains invalid SQL or diverges
  from its reconcile mirror. Fresh CI init baselines it without executing it,
  and the self-comparison remains green; an existing production DB reaches the
  pending-tail path and fails or converges to a different schema after earlier
  DDL has auto-committed.
- Required fix: retain the useful reconcile recovery/idempotence lane, but add
  an independent keyed prior-release fixture that removes the latest hash and
  restores the exact prior schema, invokes the real production migration
  runner, asserts the latest hash, and compares the structured result with the
  current schema. A new latest journal tag must fail until it has its own
  explicit upgrade fixture.

### SCHEMA-C12-02 — Same-named malformed generated columns/indexes survive reconcile

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed reconciliation limitation; occurrence on the live DB
  requires manual validation**
- Cross-agent agreement: code-reviewer, architect, debugger, test-engineer.
- Regions: column inspection/helpers `apps/web/scripts/migrate.js:234-283`;
  generated-column adds `apps/web/scripts/migrate.js:505-506`; index inspection
  and repair `apps/web/scripts/migrate.js:319-343,753-765`; convergence snapshot
  dimensions `apps/web/scripts/check-schema-convergence.mjs:38-70` versus
  absence/list-only degradation `:73-80`.
- Evidence: `ensureColumn` checks only name presence. `ensureIndexColumns`
  checks only ordered column names. The snapshot already records type,
  nullability, generation expression, index uniqueness/direction/type/
  visibility/sub-parts, but the repair path neither validates nor degrades
  those fields.
- Concrete failure: `capture_day` exists as an ordinary nullable integer, or
  its intended index is invisible while retaining the correct columns.
  Reconcile reports success; generated values remain null/stale or the optimizer
  cannot use the promised index, so matching photos disappear or the query
  regresses without an application error.
- Required fix: definition-aware generated-column reconciliation must validate
  type, nullability, generated/stored state, and normalized expression. The
  latest three capture indexes must validate all material index properties and
  recreate on drift. The live convergence fixture must damage same-named
  definitions, not only remove/shorten objects.

### PERF-C12-03 — Timeline year discovery scales with the full gallery

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed query shape and uncached sequencing; production
  `EXPLAIN ANALYZE`/latency requires manual validation**
- Cross-agent agreement: perf-reviewer and tracer.
- Regions: `apps/web/src/lib/data-timeline.ts:145-165,192-227`;
  `apps/web/src/app/[locale]/(public)/timeline/page.tsx:21,63-96`; current
  indexes `apps/web/src/db/schema.ts:131-138`.
- Evidence: `getTimelineYears()` selects and sorts
  `DISTINCT YEAR(capture_date)`. The processed/capture-date index can constrain
  `processed=true`, but applying `YEAR()` still scans every qualifying date.
  `revalidate=0` makes it request-time work. The page awaits the year list
  before starting `getTimelineImages()` even when `?year=YYYY` is already valid.
- Concrete failure: at 100,000 processed photos, every timeline request scans
  the full processed date index and builds/sorts the expression result before
  a bounded 501-row year query begins. TTFB and MySQL CPU grow with total
  gallery size rather than the requested year.
- Required fix: add a stored/indexed capture-year key (or an equivalent bounded
  summary/cache), query it directly, and run explicit-year image retrieval in
  parallel with year discovery. Cover the no-`YEAR(capture_date)` contract.

### TEST-C12-04 — On This Day lacks executable generated-date/query proof

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed test-oracle gap; current query is correct by inspection**
- Cross-agent agreement: test-engineer; the verifier independently challenged
  this boundary without filing a duplicate.
- Regions: query `apps/web/src/lib/data-timeline.ts:110-138`; source/JavaScript
  tests `apps/web/src/__tests__/data-timeline.test.ts:49-89,184-207`; intended
  schema/index `apps/web/src/db/schema.ts:40-47,131-138`.
- Evidence: the tests assert source substrings and reproduce month/day matching
  with JavaScript `Date`. They never ask MySQL to compute the stored generated
  columns or execute the equivalent filtered order over null, cross-year,
  nonmatching, and leap-day rows.
- Concrete failure: an incorrect generated expression, storage definition, or
  database binding/order discrepancy can keep the source checks and JavaScript
  imitation green while the production widget omits or misorders photos.
- Required fix: extend the disposable MySQL lane with executable fixtures for
  null, cross-year, nonmatching, and February 29 dates, asserting generated
  values, exact matching ids/order/limit, and the intended usable index shape.

### DOC-C12-05 — Cycle 11 release ledger stops before proven publication

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed repository-state mismatch; deployment status unknown**
- Cross-agent agreement: code-reviewer, architect, debugger.
- Regions: `.context/plans/cycle-11-2026-07-18-plan.md:4,59-62,109-111`;
  `.context/plans/README.md` active/recently-completed sections; signed Git
  history `ff6532f4` and `origin/master`.
- Evidence: the plan says publication is in progress and leaves signed
  commit/push unchecked, while local and remote master are identical at signed
  `ff6532f4` and the Cycle 11 work is present in history. Git equality does not
  prove the deployment result.
- Concrete failure: a recovery agent treats the stale plan as authoritative,
  repeats publication, or starts from the pre-publication frontier.
- Required fix: record signed push as complete, preserve deploy as unknown
  unless independent evidence exists, archive Cycle 11, and advance the active
  plan index.

## Cross-agent adjudication

- The five schema-validation reports under SCHEMA-C12-01 are one root cause,
  not five findings. The existing self-comparison remains useful for reconcile
  recovery and should be supplemented, not deleted.
- SCHEMA-C12-02 is distinct: even a real pending-migration lane does not make
  reconcile repair same-named malformed objects. Both upgrade equivalence and
  definition-aware repair are required.
- TEST-C12-04 is narrower than SCHEMA-C12-02. The former proves date behavior;
  the latter proves schema repair. They may share one disposable-MySQL harness
  but have separate acceptance criteria.
- PERF-C12-03 is not a claim that the current 445-photo demo is slow. The
  unbounded request-time query shape is confirmed; representative-cardinality
  latency remains a measurement obligation.
- DOC-C12-05 records only facts Git can prove. No deployed SHA or successful
  Cycle 11 deploy is inferred.

## Validation evidence from Prompt 1

- Security lanes passed API-auth lint, action-origin/mutation-barrier lint,
  public-route-rate-limit lint, and production dependency audit with zero
  configured vulnerabilities.
- Engineering lanes passed 176 focused migration, timeline, image, privacy,
  and contract tests plus `git diff --check`.
- Live browser review covered desktop/mobile, 320 px reflow, EN/KO structure,
  search-dialog focus/Escape behavior, 44 px visible controls, dark mode,
  runtime errors, and accessibility semantics. No UI finding survived.
- No local MySQL was running during review; current SQL correctness and query
  latency are not misrepresented as runtime-observed facts.

## Agent failures

None.
