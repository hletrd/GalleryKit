# Cycle 73/100 Aggregate Review

HEAD reviewed: `96459b7a264c4e0110d15bb76840d260447335e8`.
Cycle date: 2026-07-01.

## Agent Coverage

- Code reviewer / debugger: 1 finding.
- Security reviewer: 0 findings.
- Performance / deploy reviewer: 1 finding.
- Test engineer / verifier: 3 findings.
- Architect / document-specialist / critic: 1 finding, deduped with deploy reviewer.
- Designer / product-risk reviewer: 0 independent findings.

## Deduplicated Findings

### C73-01 - Unprocessed photo IDs can cache the default OG fallback as a success

- Severity/confidence: Low / Medium.
- Source: code-reviewer, local aggregation.
- File/line: `apps/web/src/app/api/og/photo/[id]/route.tsx:74`, `apps/web/src/lib/data.ts:1052`.
- Problem: the per-photo OG route uses `getImageCached()`, which filters to processed rows, then applies a long success fallback when the result is null. Existing pending rows and missing rows collapse into the same branch.
- Failure scenario: social crawlers can cache the site-default card for an existing photo that finishes processing shortly afterward.
- Plan: scheduled.

### C73-02 - Cycle 72 terminal deploy/ledger state is stale

- Severity/confidence: Medium / High.
- Source: perf-deploy-reviewer, architect-document-specialist.
- File/line: `.context/plans/README.md:5`, `.context/plans/cycle-72-2026-07-01-plan.md:58`, `.context/plans/cycle-72-2026-07-01-plan.md:59`, `CLAUDE.md:467`.
- Problem: Cycle 72 is still listed as active and terminal commit/deploy boxes remain unchecked even though Cycle 73 started from deployed `master` HEAD `96459b7a`.
- Failure scenario: future cycles lose a reliable per-iteration deploy audit trail.
- Plan: scheduled.

### C73-03 - Feed conditional route behavior is covered by stale helper/source tests

- Severity/confidence: Medium / High.
- Source: carried forward from `C72-04`, selected this cycle.
- File/line: `apps/web/src/__tests__/feed-conditional.test.ts:2`, `apps/web/src/__tests__/feed-sized-derivative.test.ts:63`, `apps/web/src/app/feed.xml/route.ts:156`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:163`.
- Problem: existing tests did not directly exercise current root/topic feed route 200/304 behavior.
- Failure scenario: ETag, SEO/config invalidation, or topic locale/404 route behavior can regress while source tests remain green.
- Plan: scheduled.

### C73-04 - Per-photo OG temporary fallback cache header is not route-behavior tested

- Severity/confidence: Medium / High.
- Source: test-engineer.
- File/line: `apps/web/src/app/api/og/photo/[id]/route.tsx:127`, `apps/web/src/app/api/og/photo/[id]/route.tsx:283`, `apps/web/src/__tests__/og-photo-fallback.test.ts:88`.
- Problem: the temporary all-derivative-miss cache header was locked by source text only.
- Failure scenario: future refactors can wire the success cache into the redirect while preserving the searched constants.
- Plan: scheduled.

### C73-05 - Sidecar derivative write-boundary guard is source-locked, not behavior-proven

- Severity/confidence: Medium / Medium.
- Source: test-engineer.
- File/line: `apps/web/src/lib/process-image.ts:1187`, `apps/web/src/lib/process-image.ts:1417`, `apps/web/src/lib/process-image.ts:1472`, `apps/web/src/__tests__/cycle-72-source-contracts.test.ts:17`.
- Problem: source-contract tests do not behaviorally prove rollback when the write guard throws after final writes begin.
- Failure scenario: restore maintenance can regress under a future refactor while source strings remain present.
- Plan: deferred with exit criterion.

### C73-06 - Settings backfill warning persistence is only source-wired at the component boundary

- Severity/confidence: Low / High.
- Source: test-engineer.
- File/line: `apps/web/src/lib/settings-backfill-warning.ts:40`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:254`, `apps/web/src/__tests__/settings-backfill-warning-source.test.ts:10`.
- Problem: live Settings UI persistence is not behavior-tested.
- Failure scenario: component integration can drift while pure helper and source tests stay green.
- Plan: deferred with exit criterion.

## Scheduled Findings

- `C73-01`, `C73-02`, `C73-03`, `C73-04`.

## Deferred Findings

- `C73-05`, `C73-06`, plus carry-forward deferred items in `.context/plans/cycle-73-2026-07-01-deferred.md`.

## Agent Failures

The sixth concurrent UI/product reviewer spawn hit the environment thread limit. The lane was completed locally and persisted as `designer-product-reviewer.md`.
