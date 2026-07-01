# Cycle 70/100 Aggregate Review

Start HEAD: `6e3e54e99ad1d4472431d0ee760fea54c4fdb3af`.

## Review Inputs

- `code-quality-security.md`
- `perf-concurrency.md`
- `docs-i18n.md`
- `ui-accessibility.md`
- Main-lane review of the Cycle 69 changes, current plan/review ledgers, service-worker cache path, admin API auth scanner, settings copy, and data-cache documentation.

Native subagent capacity allowed five concurrent review lanes. The sixth requested photographer/product-risk lane hit the thread limit, so product/photographer risk was covered in the main lane while the other agents ran.

## Deduplicated Findings

### C70-01 - Admin API auth scanner misses mixed star re-exports

- Severity/confidence: High / High.
- Cross-agent agreement: test/quality lane; main-lane verification.
- File/line: `apps/web/scripts/check-api-auth.ts:125`.
- Evidence: non-type `export * from './impl'` is ignored when a route file also has a wrapped direct handler, so `checkRouteSource()` can return OK while hidden handlers are exported from another module.
- Failure scenario: an admin route can hide an unwrapped mutating handler behind a star re-export and bypass the blocking `lint:api-auth` gate.
- Fix direction: fail closed on star re-exports in admin route files and add a regression fixture.

### C70-02 - Same-ETag service-worker branch references `cachedSize` out of scope

- Severity/confidence: Medium / High.
- Cross-agent agreement: perf/concurrency lane + main-lane verification.
- File/line: `apps/web/public/sw.template.js:315`, `apps/web/public/sw.template.js:334`, generated `apps/web/public/sw.js:315`, test gap `apps/web/src/__tests__/sw-template-contract.test.ts:236`.
- Evidence: `cachedSize` is declared inside the `head.status === 304` block but used by the later `networkEtag === cachedEtag` branch.
- Failure scenario: a same-ETag `HEAD 200` throws `ReferenceError`, is swallowed by the broad catch, and falls through to the full background body revalidation Cycle 69 intended to avoid.
- Fix direction: hoist `cachedSize` into the shared HEAD-probe scope, regenerate `sw.js`, and pin the lexical scope.

### C70-03 - Auto-alt-text copy still names Florence-2

- Severity/confidence: Low / High.
- Cross-agent agreement: docs/i18n lane.
- File/line: `apps/web/messages/en.json:754`, `apps/web/messages/ko.json:754`.
- Evidence: current docs/source describe EXIF-derived hints and generic future model-generated descriptions; settings copy still names Florence-2.
- Failure scenario: operator or future-agent confusion about a model-specific runtime/roadmap that is not current product truth.
- Fix direction: remove model-specific copy while preserving the limitation.

### C70-04 - React cache inventory omits `getImageForViewerCached`

- Severity/confidence: Low / High.
- Cross-agent agreement: docs/i18n lane.
- File/line: `CLAUDE.md:409`, `apps/web/src/lib/data.ts:1731`.
- Evidence: `data.ts` exports `getImageForViewerCached`, but the docs list cached wrappers without it and keep a brittle count.
- Failure scenario: future reviews miss viewer-fetch cache behavior.
- Fix direction: update the inventory without a brittle count and include viewer/detail cache coverage.

## Scheduled This Cycle

`C70-01` through `C70-04` are scheduled.

## Deferred / Not Scheduled

No new Cycle 70 finding is deferred. Carry-forward items remain tracked in `.context/plans/cycle-70-2026-07-01-deferred.md`.

## Agent Failures / Deviations

- Requested reviewer-role agents such as `code-reviewer`, `security-reviewer`, `perf-reviewer`, and `designer` were not exposed as callable native roles in this environment. Available roles were `default`, `explorer`, and `worker`, so review slices ran through `explorer` lanes.
- The sixth review lane spawn hit the native thread limit. Its scope was covered in the main lane.
- Browser UI review was not run because the repo's configured Playwright path can mutate DB-backed state through analytics/admin flows.

## Disposition

Four new findings, all scheduled. No new deferred security/correctness/data-loss item.
