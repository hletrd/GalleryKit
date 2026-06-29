# Code Reviewer - review-plan-fix cycle 7

**Date:** 2026-06-29
**HEAD reviewed:** `17124135999a3d7cb4f5262e8b2b5917503088ae` (`17124135`)
**Role:** code-reviewer
**Scope:** current HEAD only; code quality, logic, SOLID/maintainability, cross-file contracts, scripts, tests, migrations, config, and docs. No implementation fixes made.

## Required Context Read

- Read `AGENTS.md` first.
- Read `CLAUDE.md` in full.
- Loaded the `code-review` skill instructions.
- Confirmed the current HEAD was `17124135 fix(review): harden cycle 6 review findings`.

## Inventory Built Before Findings

Review-relevant inventory at current HEAD:

- Non-binary, non-lockfile repository files: 755.
- Active app/source surface: `apps/web/src` 486 TypeScript/TSX/JS/CSS/JSON files.
- Tests: `apps/web/src/__tests__` plus `apps/web/e2e`.
- Runtime scripts: `apps/web/scripts`.
- Migrations: `apps/web/drizzle` SQL files plus `apps/web/drizzle/meta/_journal.json`.
- Config/deploy surface: root/app `package*.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, Dockerfile, compose, nginx, `.dockerignore`, env examples.
- Docs/plans/reviews inspected for current contracts: `AGENTS.md`, `CLAUDE.md`, current `.context/reviews/_aggregate.md`, prior code-reviewer artifact, and cycle plan lineage enough to avoid re-reporting stale fixed issues.

Files and cross-file flows examined:

- App routes/actions: upload/delete/bulk/retry image actions, auth/session actions, topic actions, sharing actions, admin DB restore/export/import actions, public pages, semantic/similar search APIs, Lightroom upload API, OG/feed routes, and admin settings flows.
- Core libraries: `data.ts`, `image-queue.ts`, `queue-shutdown.ts`, `admin-backfill-runner.ts`, `process-image.ts`, `clip-model.ts`, `gallery-config*.ts`, `settings-hash.ts`, `upload-processing-contract-lock.ts`, `advisory-locks.ts`, `restore-maintenance.ts`, `rate-limit.ts`, `serve-upload.ts`, `smart-collections.ts`, auth/session helpers, privacy/select-field contracts, pagination and tag-slug helpers.
- UI/data interaction surface: `HomeClient`, `TagFilter`, `LoadMore`, search UI, public home/topic pages, and the server-to-client state handoff for tag filtering.
- Scripts/config: `migrate.js`, backfill/CLIP scripts, action/auth/rate-limit scanner scripts, Dockerfile, compose, dockerignore, nginx, service worker template/generated output.
- Tests: targeted contract tests around restore locks, upload rollback, admin backfill, image queue wiring/quiesce, migration/schema coverage, settings hash, route/action lint gates, privacy guards, touch-target audit, and public-route rate-limit scanners.

Broad sweeps before finalizing:

- Largest-file triage across TypeScript/TSX/JS sources.
- Greps for lock acquisition/release, detached work, timers, raw SQL/`db.execute`, process environment use, route/action auth gates, same-origin gates, public mutating route rate limits, `eslint-disable`, `@ts-ignore`, `TODO`/`FIXME`, and pagination/filter-state handoffs.
- Re-checked prior cycle findings against current HEAD before deciding whether they still apply.

## Findings

### Confirmed Issues

#### MEDIUM - Tag filter derives active state and next URLs from raw query params instead of canonical server state

**File/region:** `apps/web/src/app/[locale]/(public)/page.tsx:161-166`, `apps/web/src/app/[locale]/(public)/page.tsx:221-222`; `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:172-177`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:214`; `apps/web/src/components/home-client.tsx:109-122`, `apps/web/src/components/home-client.tsx:259-270`, `apps/web/src/components/home-client.tsx:438-443`; `apps/web/src/components/tag-filter.tsx:10-35`, `apps/web/src/components/tag-filter.tsx:57-117`.

**Issue:** The public home/topic server pages parse and validate `tags` with `filterExistingTagSlugs(parseRequestedTagSlugs(...), allTags)` before querying data and pass the canonical result into `HomeClient` as `currentTags`. `HomeClient` uses that canonical state for the heading and `LoadMore`, but it renders `<TagFilter tags={tags} />` without passing `currentTags`. `TagFilter` then re-derives its own `currentTags` directly from `useSearchParams().get('tags')`.

That duplicates filter-state ownership and lets the tag chips disagree with the page's authoritative data state whenever the URL contains stale, invalid, or otherwise non-canonical tag slugs.

**Concrete failure scenario:** Visit `/en?tags=deleted-tag` after a tag has been removed. The server filters `deleted-tag` out, queries the unfiltered gallery, and passes `currentTags=[]` to `HomeClient`. The heading and `LoadMore` are unfiltered, but `TagFilter` sees the raw query string, so the "All" chip is not active and no valid tag chip is active. If the user clicks a valid tag such as `wedding`, `TagFilter` builds the next URL from the stale local state and pushes `?tags=deleted-tag,wedding` instead of the canonical `?tags=wedding`. The server will keep discarding `deleted-tag`, but the client keeps carrying it forward and the UI state remains harder to reason about.

**Why it matters:** This is a small user-visible correctness bug and a maintainability smell. The public page already has a single canonical tag parser; the client component bypasses it, so future changes to tag normalization, aliases, or deleted-tag handling can easily split behavior between heading/data/loading and chip interactions.

**Suggested fix:** Make `TagFilter` controlled by canonical state:

- Change the component signature to accept `currentTags: string[]`.
- Pass `currentTags={currentTags ?? []}` from `HomeClient`.
- Use the canonical prop for chip variants, `aria-pressed`, and toggle calculations.
- When constructing the next URL, preserve unrelated search params but set/delete `tags` from the canonical list rather than the raw query list.
- Add a focused component/unit test or source-contract test for `?tags=unknown` proving "All" is active and clicking a valid tag emits only the valid slug.

**Severity:** Medium.
**Confidence:** High.
**Classification:** Confirmed.

### Likely Issues

None promoted separately. Other suspicious areas were either already guarded in current HEAD or lacked enough current-source evidence to call actionable.

### Risks Needing Manual Validation

- No additional manual-validation risks were promoted from this code-quality lane. The confirmed tag-filter issue is source-verifiable and can be reproduced with a stale/unknown `tags` query parameter.

## Non-Findings / Verified Current Fixes

- Cycle 6 restore-lock acquisition cleanup is now hardened in `apps/web/src/app/[locale]/admin/db-actions.ts`; the acquisition phase has explicit held-lock tracking and cleanup tests cover setup failures.
- Cycle 6 detached production embedding work is now behind tracked queue lifecycle helpers in `apps/web/src/lib/image-queue.ts`; restore/shutdown coordination tests cover the embedding queue.
- Upload rollback, Lightroom topic validation rollback, public route rate-limit scanning, admin API auth wrapping, action same-origin scanning, privacy-field guards, and migration journal/hash coverage all have current-source contracts or scanner coverage.
- `getImageCount(..., { includeUnprocessed: true })` with no filters was checked against Drizzle behavior; `and()` with no conditions returns `undefined`, so the empty-filter path is not a bug.

## Final Missed-Issues Sweep

Final sweep covered:

- All tracked file inventory at HEAD and review-relevant category counts.
- App routes/actions, public/admin API routes, server actions, core data access, upload/processing/backfill/restore flows, semantic-search flows, and public pagination/filtering.
- Schema, migrations, migration journal, reconcile script, and migration-related tests.
- Deployment/config surfaces: Dockerfile, compose, dockerignore, nginx, Next config, service worker, package scripts, env examples.
- Test/lint architecture: auth route scanner, action-origin scanner, public mutating route rate-limit scanner, privacy guards, touch-target audit, migration coverage, restore lock tests, image queue embedding lifecycle tests, and upload rollback/source contracts.
- Prior cycle aggregate/review findings checked against current HEAD so stale fixed issues were not re-reported.

Files intentionally not inspected in depth:

- Binary assets, screenshots, fixture images, generated visual artifacts, and historical archived review screenshots.
- Most historical `.context/reviews/archive/**` and `.context/plans/done/**` files beyond current aggregate/lineage checks, because they are not executable current behavior.
- `node_modules` and untracked/generated local build outputs.

## Validation Evidence

- This was a read-only review of current HEAD except for writing this report artifact.
- Source evidence was gathered with tracked-file inventory, `nl -ba` line checks, `rg` sweeps, focused cross-file tracing, and current HEAD/log verification.
- I did not run the full lint/typecheck/build/test suite because no code was changed and this lane requested review findings, not implementation.

## Recommendation

**REQUEST CHANGES** for the confirmed tag-filter state ownership bug. No high/critical code-quality findings were found in this lane at current HEAD.
