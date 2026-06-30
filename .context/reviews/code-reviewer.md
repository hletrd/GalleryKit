# Cycle 32 Code Reviewer Review

Reviewer: code-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `3d174c96`
Date: 2026-06-30 KST
Scope: full-repository review lane. Report artifact only; no product code or other review files were edited.

## Inventory And Method

I read `AGENTS.md` and `CLAUDE.md` before inspecting implementation files. I then built the repository inventory with `rg --files` and `find`, and used targeted `rg` sweeps to map the app, tests, scripts, migrations, and docs before line-level review.

Inventory counts from this checkout:

- `rg --files -g '!node_modules' -g '!.next' -g '!dist' -g '!coverage'`: 816 tracked/unignored workspace files.
- `find apps/web/src apps/web/scripts apps/web/drizzle apps/web/e2e .context -type f`: 2952 files across app, tests, scripts, migrations, e2e, and committed context.
- `apps/web/src` TypeScript/TSX files: 519.
- `apps/web/src/__tests__` plus `apps/web/e2e` TypeScript/TSX files: 283.
- `apps/web/scripts` top-level scripts: 29.
- `apps/web/drizzle` migration/meta files: 32.
- `.context` markdown files: 2182.

Primary surfaces inspected in detail:

- App routes: public pages, admin pages, `api/admin/*`, `api/search/*`, `api/og/*`, health/live, feeds, upload serving.
- Server actions: auth, public load-more/search/analytics, images, tags, topics, settings, SEO, sharing, collections, users, embeddings, Lightroom tokens, admin backfill.
- Libraries: data access, privacy field selections, rate limits, API auth, session auth, image processing, upload paths/storage, restore maintenance, smart collections, CLIP/semantic search, SQL restore scanning, CSP/SEO helpers.
- Tests: privacy guards, action/API route lint contracts, public rate-limit scanner, upload locks, semantic search, smart collection pagination, map privacy, migration journal monotonicity, restore/upload locks, source-contract tests.
- Scripts/migrations: deploy helper contracts, migration/reconcile flow, DB backup/restore, admin seed/migrate scripts, semantic/color backfills, service-worker build, e2e seed/server.
- Docs/context: `CLAUDE.md`, `AGENTS.md`, `.context/plans`, `.context/reviews`, and cycle history relevant to current invariants.

Validation commands run:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Final sweeps covered raw SQL/filesystem boundaries, env/config usage, exemptions, TODO/FIXME markers, pagination limits, migrations, and auth/rate-limit surfaces.

Full lint/typecheck/build/Vitest/e2e were not run in this read-only review lane.

## Summary

No critical or high-severity confirmed issue was found. The repo has strong guardrails around admin API auth, server-action origin checks, public route rate limits, privacy field omissions, restore maintenance, upload-processing locks, migration journal coverage, and semantic-search operator gating.

I found one low-severity confirmed helper-contract issue. I also noted two risks that need live/manual validation because their correctness depends on deployment configuration or external operator state.

## Confirmed Issues

### C32-CODE-01 - Listing page-size helpers can fetch 102 rows despite a documented 100-row cap

Severity: Low
Confidence: High

Exact citations:

- `apps/web/src/lib/data.ts:664-670`
- `apps/web/src/lib/data.ts:898-927`
- `apps/web/src/lib/data.ts:1437-1480`
- `apps/web/src/app/actions/public.ts:121-157`
- `apps/web/src/app/actions/public.ts:170-222`
- `apps/web/src/__tests__/smart-collection-pagination.test.ts:257-260`

Issue:

`LISTING_QUERY_LIMIT` is documented as the maximum number of image rows a listing query may return, and `LISTING_QUERY_LIMIT_PLUS_ONE` is intended only for has-more lookahead. `getImagesLitePage()` and `getImagesForSmartCollection()` clamp `pageSize` to `LISTING_QUERY_LIMIT_PLUS_ONE` at `data.ts:910` and `data.ts:1442`, then apply another lookahead with `.limit(normalizedPageSize + 1)` at `data.ts:926`, `data.ts:1458`, and `data.ts:1479`.

That means a direct caller passing `pageSize = 101` produces a SQL limit of 102, exceeding the documented listing cap by one row. Current public server-action callers clamp user input to 100 before reaching these helpers (`public.ts:126` and `public.ts:179`), and initial public pages pass `PAGE_SIZE = 30`, so this is not a current public DoS. The defect is in the exported helper contract and could become user-facing if a future route or admin surface calls these helpers directly with the advertised upper bound.

The source-contract test for smart collections currently locks in the two internal `normalizedPageSize + 1` lookaheads (`smart-collection-pagination.test.ts:257-260`) but does not assert that `normalizedPageSize` itself is capped to the visible row maximum before the lookahead is added.

Recommended fix:

Clamp visible page size to `LISTING_QUERY_LIMIT`, not `LISTING_QUERY_LIMIT_PLUS_ONE`, in `getImagesLitePage()` and `getImagesForSmartCollection()`. Keep the SQL lookahead as `normalizedPageSize + 1`. Add a targeted test/source contract asserting the visible cap is 100 and the SQL limit cannot exceed 101.

## Likely Issues

None confirmed enough to classify as likely code defects after cross-file inspection.

One investigated path was the settings upload-contract lock: `SettingsClient` sends only changed fields at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:238-253`, so `updateGallerySettings()` does not normally acquire the upload-processing contract lock for no-op or unrelated saves. That suspected issue is not present in the standard UI path.

## Risks Needing Manual Validation

### C32-RISK-01 - Production reverse-proxy rate limiting depends on `TRUST_PROXY=true`

Severity: Medium
Confidence: Medium

Exact citations:

- `apps/web/src/lib/rate-limit.ts:166-196`
- `apps/web/scripts/run-e2e-server.mjs:35-36`

Risk:

`getClientIp()` intentionally ignores `x-forwarded-for` and `x-real-ip` unless `TRUST_PROXY === 'true'`. If production is behind nginx or another reverse proxy and `TRUST_PROXY` is missing, all users collapse into the `"unknown"` bucket. The code logs a security warning at `rate-limit.ts:192-194`, but login/public-action rate limits can still globally throttle legitimate users until configuration is fixed.

This is the correct secure default against spoofed proxy headers, so it is not a code bug by itself. It needs live environment validation: confirm the deployed app has `TRUST_PROXY=true` and an appropriate `TRUSTED_PROXY_HOPS` value for the actual proxy chain.

### C32-RISK-02 - Semantic-search production mode remains operator-state dependent

Severity: Medium
Confidence: Medium

Exact citations:

- `apps/web/src/lib/gallery-config.ts:125-129`
- `apps/web/src/app/api/search/semantic/route.ts:107-168`
- `apps/web/src/app/api/search/similar/[id]/route.ts:68-122`
- `apps/web/scripts/backfill-clip-embeddings.ts:95-116`
- `apps/web/src/lib/clip-paths.ts:62-93`

Risk:

The repo correctly gates production semantic search behind config/env/model/backfill state: production mode is healed unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, routes check mode before expensive work, backfill refuses production without the env gate, and model paths are validated. The remaining correctness risk is live operator state: DB mode, env flag, CLIP weights/manifests, and image embeddings must agree on the deployed host.

Manual validation should confirm production semantic search is either intentionally disabled or fully activated with weights present and embeddings backfilled. This cannot be proven from the repository alone.

## Positive Cross-File Checks

- Admin API route exports are covered by `withAdminAuth(...)`; the auth lint gate passed.
- Mutating server actions return early on `requireSameOriginAdmin()`; the action-origin lint gate passed.
- Public mutating/expensive routes are rate-limited or explicitly exempted; the public-route rate-limit lint gate passed.
- Public image select fields omit admin/private fields, and the symmetric privacy guard is locked by `apps/web/src/__tests__/privacy-fields.test.ts`.
- Migration journal and reconcile rules are present: migrations live in `apps/web/drizzle`, journal metadata is in `apps/web/drizzle/meta/_journal.json`, and legacy reconciliation is centralized in `apps/web/scripts/migrate.js`.
- Upload, restore, and backfill flows use advisory/maintenance locks across server actions, API routes, and scripts; I did not find an unguarded cross-flow mutation path in the inspected surfaces.
- OG image fetching uses the configured canonical origin and bounded fetch behavior, avoiding user-controlled SSRF surfaces.
- The settings client only submits changed fields, limiting transaction size and avoiding unnecessary upload-contract lock contention.

## Final Missed-Issues Sweep

Final sweeps covered:

- Raw SQL and database execution calls.
- Filesystem read/write/unlink/rename/copy boundaries.
- Auth, token, session, password, env, and proxy configuration usage.
- Public-route exemptions and server-action origin exemptions.
- Pagination limit/cursor paths.
- TODO/FIXME/HACK markers and explicit error/log paths.
- Migration/reconcile files and tests around migration journal monotonicity.

No additional confirmed medium/high issues were found in that sweep. The only product-code change I would recommend from this review is the low-risk pagination cap adjustment in `apps/web/src/lib/data.ts` plus its focused test.
