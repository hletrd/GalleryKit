# Test Engineer Review - Cycle 7/100 Prompt 1

**Date:** 2026-06-29
**HEAD inspected:** `17124135999a3d7cb4f5262e8b2b5917503088ae`
**Role:** test-engineer
**Scope:** current HEAD only. Deep review for coverage gaps, flaky tests, false confidence, missing regression tests, and TDD opportunities. No fixes implemented.

## Inventory Before Findings

Required instructions read first: `AGENTS.md`, then `CLAUDE.md`.

Review-relevant files inventoried:

- Test/config surface: root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/tsconfig.typecheck.json`, `.github/workflows/quality.yml`.
- Tests: 250 Vitest files under `apps/web/src/__tests__/` and 8 Playwright e2e files/fixtures under `apps/web/e2e/` (35,288 total test/e2e LOC).
- App code relevant to public filtering: `apps/web/src/components/tag-filter.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/lib/tag-slugs.ts`, and adjacent tag/filter/source-contract tests.
- Current active review artifacts were checked for cross-agent signal, but historical `.context/archive/**` bodies were not treated as current source.

Coverage map for the finding below:

- `tag-slugs.test.ts` covers canonical server parsing (`parseRequestedTagSlugs`, `filterExistingTagSlugs`).
- `data-tag-names-sql.test.ts` covers SQL shape for tag aggregation/filtering.
- `tag-label-consolidation.test.ts` only source-checks that `tag-filter.tsx` imports/mentions `humanizeTagLabel`.
- `touch-target-audit.test.ts` covers prior tag-filter touch-target regressions.
- `public.spec.ts` covers homepage visibility, search, lightbox, headings, 404, shared pages, but no tag-filter chip click or query canonicalization.

## Confirmed Issues

### TE-C7-01 - No behavioral regression test covers `TagFilter` active state or URL writes

Severity: Medium
Confidence: High
Status: Confirmed coverage gap with a current user-visible failure mode

Exact region:

- `apps/web/src/components/tag-filter.tsx:13-16`, `apps/web/src/components/tag-filter.tsx:18-39`, `apps/web/src/components/tag-filter.tsx:61-92`
- `apps/web/src/app/[locale]/(public)/page.tsx:161-166`, `apps/web/src/app/[locale]/(public)/page.tsx:221-223`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:172-177`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:203-214`
- `apps/web/src/__tests__/tag-slugs.test.ts:5-38`
- `apps/web/src/__tests__/tag-label-consolidation.test.ts:73-76`
- `apps/web/e2e/public.spec.ts:4-19`, `apps/web/e2e/public.spec.ts:85-99`

Problem:

The server canonicalizes requested tag slugs with `parseRequestedTagSlugs()` plus `filterExistingTagSlugs()` before fetching images and before passing `currentTags` into `HomeClient`. `TagFilter` does not receive that canonical `currentTags`; instead it re-derives active chips and next URLs directly from `useSearchParams().get('tags')`. The existing tests lock the parser and some source-shape details, but no test mounts/clicks `TagFilter` or drives the browser through `?tags=...` variants.

Concrete failure scenario:

Open `/en?tags=missing` or `/en?tags=missing,landscape`. The page body uses the canonical server-filtered list, so `missing` is ignored for data loading. The chip UI still sees the raw query string. In the first case, the "All" chip is not active even though the gallery is unfiltered. In the second case, clicking `portrait` builds `?tags=missing,landscape,portrait`, preserving a non-existent slug the server will keep dropping. The UI and canonical data state drift, and current Vitest/Playwright gates stay green because they never assert chip `aria-pressed` state or the resulting `router.push()` URL.

Suggested fix:

Add a focused behavioral regression before or with the production fix. Prefer changing `TagFilter` to accept `currentTags` from `HomeClient` and use that canonical list for active state and URL mutations. Then add either:

- a Vitest component-level test with mocked `next/navigation` asserting `?tags=missing` renders "All" as pressed and clicking a real tag pushes only canonical slugs; or
- a Playwright test seeded with existing E2E tags that visits `/en?tags=missing,e2e`, verifies only the real chip is active, clicks another chip, and asserts the URL does not preserve `missing`.

The test should cover both the home page and topic page if the component remains shared across both surfaces.

## Risks Needing Manual Validation

- The real browser E2E suite is present and CI-wired, but this lane did not run Playwright or Vitest; the finding is based on static coverage inspection and cross-file behavior tracing.
- Most tag-related tests are source-shape tripwires. They are useful, but they do not prove browser behavior for URL mutation, `aria-pressed`, or client/server canonicalization boundaries.

## Missed-Issues Sweep

Final sweep covered:

- `rg` for `TagFilter`, `currentTags`, `tags=`, `aria-pressed`, `useSearchParams`, and tag/filter terminology across `src`, `__tests__`, and `e2e`.
- `rg` for `.skip`, `.only`, `TODO`/`FIXME`, flake notes, timeout overrides, `@ts-ignore`, and broad suppressions across test and e2e files.
- Package scripts, Vitest config, Playwright config, CI workflow, and current seed safety guard wiring.
- Adjacent scanner tests and source-contract tests for touch targets, focus-visible, public route rate limits, action-origin gates, and tag label consolidation.

No relevant test/config/e2e file from the active inventory was intentionally skipped except binary image fixtures and historical `.context/**` review archives.
