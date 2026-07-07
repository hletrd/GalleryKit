# Cycle 15 Code-Reviewer Review

Date: 2026-07-07

Mode: read-only whole-repository review from the code quality/correctness/maintainability angle. The only file written by this prompt is this report.

## Scope And Inventory

Required instructions read before review: `AGENTS.md`, the relevant `CLAUDE.md` architecture/security/testing/deploy sections, `.context/reviews/prompts/common_review_scope.md`, and `.context/reviews/prompts/code-reviewer.md`.

Inventory basis:

- `git ls-files` returned 3,468 tracked paths.
- The live review-relevant inventory contained 707 tracked paths: app source, server actions, route handlers, components, data/db modules, scripts, migrations, tests, e2e tests, messages, workflows, package files, and TypeScript/Next/Vitest/Playwright config.
- The production runtime TypeScript/TSX surface contained 261 files under `apps/web/src/{app,components,db,lib,i18n}` plus `proxy.ts` and `instrumentation.ts`.
- Category counts reviewed: `apps/web/src/app` 80, `components` 61, `lib` 114, `db` 3, `src/__tests__` 355, `apps/web/scripts` 28, `apps/web/e2e` 12, `apps/web/drizzle` 33, `apps/web/messages` 2, `.github/workflows` 2.
- Historical `.context/reviews` and `.context/plans` files were treated as context/history, not live behavior. Static/binary assets, build output, and dependency directories were excluded from live-code findings.

Review focus:

- Cross-file correctness around admin/session/PAT auth, same-origin guards, public route rate limits, public data privacy boundaries, upload/delete/bulk-edit flows, Lightroom upload, image queue/backfill/retry, restore/backup/migration flows, semantic search/CLIP gates, public share/feed/OG routes, pagination/cursor semantics, source-contract tests, and package/config quality gates.

## Validation Evidence

Executed read-only guard checks:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

Additional review evidence:

- Inventory-wide `rg` scans covered mutating calls, `catch`/rollback behavior, revalidation, rate-limit helpers, `cache()` usage, `process.env` usage, child processes, stream handling, filesystem cleanup, `TODO/FIXME/HACK`, TypeScript suppressions, and public/admin route surfaces.
- Direct code reads covered the largest and highest-risk files, including `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/app/actions/auth.ts`, shared feed/share/photo/topic/collection pages, search routes, upload routes, and package scripts.

Not run in this prompt:

- Full `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, and Playwright e2e. Those commands can create/update `.next`, Next typegen, tsbuildinfo, cache, coverage, browser artifacts, or DB state, while this assignment forbids modifications outside this review file.

## Findings Summary

- Confirmed issues: 0
- Likely issues: 0
- Risks requiring manual validation: 0 code risks found; 1 validation gap noted below.

## Confirmed Issues

None found in this pass.

## Likely Issues

None found in this pass.

## Risks Requiring Manual Validation

No source-backed code risk was found that warrants a manual-validation finding.

Validation gap:

- Location: `apps/web/package.json:8-29`, `AGENTS.md` quality-gate section.
- Issue: This review did not run the full lint/typecheck/build/unit/e2e gate because of the write restriction above.
- Failure scenario: A TypeScript, Next build, ESLint, or unit/e2e failure outside the three read-only custom guard scripts could still exist even though this source review did not identify one.
- Suggested validation: after the write restriction is lifted or in the implementation lane, run `npm run lint --workspace=apps/web`, `npm run typecheck --workspace=apps/web`, `npm run build --workspace=apps/web`, `npm test --workspace=apps/web`, and e2e where browser-flow coverage is required.
- Confidence: High that this is a validation gap, not a confirmed code defect.

## Cross-File Review Notes

- Admin API exports are wrapped by `withAdminAuth(...)`; the custom lint gate passed and the inspected PAT/session paths fail closed with no-store/nosniff response defaults.
- Mutating non-auth server actions consistently run same-origin checks before mutation and hold restore-maintenance fencing where the action writes shared state; the action-origin lint gate passed.
- Public expensive/mutating surfaces use pre-increment rate-limit helpers or explicit no-rate-limit annotations; route-level rollback policies in `apps/web/src/lib/rate-limit.ts` match inspected search, OG, share, feed, load-more, and analytics behavior.
- Public selectors in `apps/web/src/lib/data.ts` maintain admin-only field boundaries, with compile-time privacy guards around public/list/search/map surfaces.
- Pagination and cursor paths in `getImagesLite`, `getImagesForSmartCollection`, `loadMoreImages`, and `loadMoreSmartCollectionImages` use order-compatible cursor predicates and reject malformed server-action cursors before reaching the data layer.
- Upload/delete/batch delete/retry/bulk edit paths were checked for quota claim settlement, file cleanup ordering, restore fences, queue-state cleanup, stale-row handling, audit/revalidation ordering, and input shape validation. No confirmed defect found.
- Share/photo/group/feed metadata avoids unthrottled key existence lookups; page bodies enforce rate limits before enumeration-sensitive DB work.
- Drizzle migrations, journal metadata, and `apps/web/scripts/migrate.js` reconcile/post-condition logic were checked together; no journal ordering, baseline, or reconcile drift issue was found.
- JSON-LD injection sites route through `safeJsonLd`; no raw JSON-LD `dangerouslySetInnerHTML` path was found.

## Final Sweep

Commonly missed areas explicitly checked:

- Auth/session/PAT token verification and account/IP rate limits.
- Server-action same-origin and restore-maintenance ordering.
- Public route rate-limit admission and rollback/refund semantics.
- Upload processing queue, retry maps, advisory locks, and delete-during-processing cleanup.
- Shared group view buffering and shutdown flush behavior.
- Smart collection parsing/compilation and public/private collection handling.
- Semantic search mode gates, offline CLIP model loading, and embedding result shaping.
- OG image generation, bounded photo fetch fallback, and feed/ETag generation.
- Admin-only metadata privacy and public selector boundaries.
- Migration journal, legacy schema reconciliation, DB backup/restore child-process handling, and post-restore migration.
- Package scripts and custom lint gate wiring.

No relevant file in the 707-file live review inventory was intentionally skipped. Files excluded from live-code findings were historical review/plan artifacts, static/binary assets, generated output, dependency directories, and unrelated untracked review files created by other agents.
