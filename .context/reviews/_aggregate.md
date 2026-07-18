# Aggregate Review — Cycle 13/100

Date: 2026-07-18
Reviewed HEAD: `8bd8999f`

## Review coverage

The collaboration runtime exposed two child slots after the root orchestrator
and this cycle agent. Both were launched together; the lead covered the
remaining roles while they ran:

- child `quality_review_team`: code-reviewer, critic, verifier, architect;
- child `risk_review_team`: security-reviewer, debugger, tracer,
  test-engineer;
- lead: perf-reviewer, document-specialist, designer.

All eleven required perspectives returned and wrote distinct provenance files.
No additional registered reviewer definitions exist in `.claude`; historical
review Markdown is evidence, not executable agent registration. Each lane
inventoried the maintained repository, traced relevant cross-file behavior,
and performed a final missed-issue sweep. The designer used the complete
agent-browser skill family against the live public application at desktop and
320 px mobile sizes with accessibility, DOM, runtime, network, theme, and
keyboard evidence.

## Executive result

Five unique findings survived deduplication:

1. **ARCHIVE-C13-01 (Medium/High):** archive callers accept years outside the
   range representation's valid MySQL domain; year 9999 constructs the invalid
   exclusive bound `10000-01-01`, while the query-string path also accepts
   `0000`.
2. **PERF-C13-02 (Medium/High):** timeline year discovery filters on the base
   `capture_date`, defeating the new `(processed, capture_year)` covering plan.
3. **UX-C13-03 (Medium/High):** syntactically valid but unavailable query years
   become fake selected archive years and produce a misleading review link.
4. **DOC-C13-04 (Low/High):** the timeline module header still claims all
   queries use the capture-date index although two now use generated-key
   indexes.
5. **DOC-C13-05 (Low/High):** the Cycle 12 ledger still says signed publication
   is pending although four GPG-good commits are on `origin/master`; deployment
   remains unknown without independent evidence.

No new authorization, authentication, privacy, data-loss, dependency,
concurrency, responsive-layout, keyboard/focus, touch-target, i18n, color/HDR,
or image-delivery defect survived validation.

## Deduplicated findings

### ARCHIVE-C13-01 — Accepted archive years exceed the range model's MySQL domain

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed by source trace and disposable MySQL 8.4 execution**
- Cross-agent agreement: code-reviewer, critic, verifier, architect, debugger,
  tracer, test-engineer.
- Regions: `apps/web/src/lib/data-timeline.ts:97-107,202-209`;
  `apps/web/src/app/[locale]/(public)/year/[year]/layout.tsx:18-23`;
  `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:37-43,82-99`;
  `apps/web/src/app/[locale]/(public)/timeline/page.tsx:68-79`; missing boundary
  coverage at `apps/web/src/__tests__/data-timeline-behavior.test.ts:59-91`.
- Evidence: route-segment guards accept integers 1..9999, timeline accepts any
  four digits, and `archiveRange` always represents a year by an exclusive
  January 1 bound in `year + 1`. MySQL `DATETIME` cannot represent year 10000.
  Both review teams independently executed the resulting comparison on MySQL
  8.4 and received error 1525 for the invalid literal.
- Concrete failure: `/en/year/9999` or `/en/timeline?year=9999` reaches
  `getTimelineImages(9999)`, binds `10000-01-01 00:00:00`, and can return a
  public 500 on a supported MySQL version. Conversely, `?year=0000` passes the
  timeline parser despite being below MySQL `DATETIME`'s minimum year.
- Required fix: establish one pure archive-year parser shared by both route
  forms and make range construction total over that domain. Represent the
  maximum year without a year-10000 sentinel, reject below-domain input, and
  add lower/upper boundary tests plus executable MySQL proof.

### PERF-C13-02 — Timeline year discovery does not use its generated index as covering

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed by query shape and disposable MySQL EXPLAIN**
- Cross-agent agreement: perf-reviewer, tracer, test-engineer.
- Regions: `apps/web/src/lib/data-timeline.ts:149-164`; index definition
  `apps/web/src/db/schema.ts:135`; migration
  `apps/web/drizzle/0033_capture_year_index.sql:4`.
- Evidence: the query selects and orders only `capture_year` through
  `(processed, capture_year)`, but filters `capture_date IS NOT NULL`, forcing
  clustered-row access for a column absent from that index. MySQL EXPLAIN used
  only the processed prefix and did not report an index-only plan. Replacing
  the redundant predicate with `capture_year IS NOT NULL` used both indexed
  key parts and the covering plan. The generated year is null exactly when
  nullable `capture_date` is null.
- Concrete failure: every uncached timeline render performs avoidable base-row
  reads across processed photos merely to return a handful of distinct years,
  retaining gallery-size-dependent I/O after migration 0033.
- Required fix: filter on `isNotNull(images.capture_year)` and pin that exact
  query contract in tests/executable schema evidence.

### UX-C13-03 — Unavailable query years are presented as real archive selections

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed in source and live browser behavior**
- Cross-agent agreement: designer; the archive-domain reviewers independently
  confirmed the same parser is not authoritative, but this availability defect
  remains after merely fixing numeric bounds.
- Regions: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:68-101` and
  year scrubber/review link `:166-203`.
- Evidence: any accepted query value becomes `selectedYear` without checking
  the authoritative `years` result. Live `/en/timeline?year=9999` returned a
  200 surface with only 2025 in the scrubber but exposed “9999 in Review” and
  “No photos found for 9999.” This live MySQL deployment tolerated the invalid
  comparison; the supported MySQL 8.4 lane above proves other deployments can
  fail earlier.
- Concrete failure: a malformed, bookmarked, or crawler URL presents an empty
  invented archive and a prominent destination outside the actual year
  scrubber, undermining the navigation's data authority.
- Required fix: accept a requested selection only when it is present in the
  loaded year list; otherwise fall back to the newest available year. Preserve
  the explicit-year parallel query for valid requests, discard it when the
  requested year is unavailable, and cover the fallback.

### DOC-C13-04 — Timeline module header names only one of three active indexes

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed documentation/code mismatch**
- Cross-agent agreement: document-specialist.
- Regions: `apps/web/src/lib/data-timeline.ts:1-9`, versus query contracts at
  `:112-116`, `:145-164`, and `:198-212`.
- Evidence: the header says all queries target
  `idx_images_processed_capture_date`; On This Day targets the month/day index
  and year discovery targets the new year index.
- Concrete failure: a maintainer reasons about the wrong query plan or removes
  a generated-key index believed redundant.
- Required fix: document the three query-family-to-index mappings explicitly.

### DOC-C13-05 — Cycle 12 signed publication is still recorded as pending

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed for signed push; deployment remains manual validation**
- Cross-agent agreement: code-reviewer, critic, verifier, architect.
- Regions: `.context/plans/cycle-12-2026-07-18-plan.md:3-5,101-114` and
  `.context/plans/README.md:34-48`.
- Evidence: commits `0c49d53b`, `83bb17c5`, `267ed7d7`, and `8bd8999f` all
  verify GPG-good, and local/remote master both resolve to `8bd8999f`; the plan
  still leaves signed push unchecked. Git does not prove deployment.
- Concrete failure: a recovery cycle repeats publication or starts from the
  obsolete `ff6532f4` frontier.
- Required fix: record signed push complete, leave the original deploy result
  unknown, archive Cycle 12 under the existing convention, and advance the
  active plan index.

## Cross-agent adjudication

- ARCHIVE-C13-01 and UX-C13-03 share the query parser but are not duplicates.
  A domain-correct year such as 2222 can still be absent from a gallery and
  must not become an invented selection.
- The production browser's tolerant 9999 response does not invalidate the
  supported-MySQL failure: both teams reproduced strict MySQL 8.4 error 1525.
  The fix must be portable across the documented MySQL 8.0+ contract.
- PERF-C13-02 is not a claim that the current 445-photo demo is visibly slow.
  The non-covering shape and corrected EXPLAIN are confirmed; representative
  latency remains a scale measurement.
- DOC-C13-05 records only facts Git proves. No deployed SHA or successful Cycle
  12 deploy is inferred.

## Validation evidence from Prompt 1

- Both specialist teams passed ESLint, API-auth lint, action-origin/mutation-
  barrier lint, public-route-rate-limit lint, typecheck, and the production
  dependency audit; security review found no configured vulnerability.
- Focused archive/schema/security suites passed (up to 145 tests per lane).
- Disposable MySQL 8.4 reproduced the archive-bound error and the covering-
  index EXPLAIN distinction; review containers were removed afterward.
- Live browser coverage included desktop/mobile, 320 px reflow, light/dark
  mode, EN structure, search-dialog focus/Escape behavior, runtime errors,
  network evidence, storage, touch targets, and accessibility semantics.

## Agent failures

None. A third child spawn was retried once and rejected by the runtime's
thread limit; the lead completed those three roles directly, so no review role
or provenance report failed.
