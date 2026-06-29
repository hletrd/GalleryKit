# Debugger Review - Cycle 7/100

Scope: latent bug surfaces, failure modes, regressions, exception paths, race boundaries, and edge cases in current `HEAD` (`17124135999a3d7cb4f5262e8b2b5917503088ae`) for `/Users/hletrd/flash-shared/gallery`.

Constraints honored:
- Read `AGENTS.md` and `CLAUDE.md` before reviewing code.
- Review-only lane: no implementation, commit, push, or deploy.
- Existing worktree changes in sibling review files were left untouched.

## Inventory Before Findings

Review-relevant inventory examined:
- Project rules/docs/config: `AGENTS.md`, `CLAUDE.md`, root and app `package.json`, Next/Vitest/TypeScript/ESLint/Drizzle/deploy config.
- App surface: 75 route/action/page files under `apps/web/src/app`.
- Runtime libraries: 94 files under `apps/web/src/lib`.
- Components/UI: 55 files under `apps/web/src/components`.
- DB layer: 3 files under `apps/web/src/db`, 24 migration SQL files, Drizzle journal/meta.
- Operational scripts: 22 files under `apps/web/scripts`.
- Regression surface: 251 files under `apps/web/src/__tests__`.

High-risk paths traced:
- Upload -> original save -> DB insert -> queue processing -> derivative write -> processed update.
- Sidecar and in-app color backfill -> advisory locks -> per-image encode -> detection -> DB update -> delete-race cleanup.
- Public gallery/tag filtering -> server canonicalization -> client URL state -> load-more action.
- Admin mutation guards, public route rate-limit contracts, restore/maintenance boundaries, and filesystem cleanup paths.

## Confirmed Issues

### DBG-C7-01 - Backfill can generate undersized derivatives when stored width is stale

Severity: High
Confidence: High
Status: Confirmed

Code regions:
- `apps/web/src/lib/process-image.ts:1002-1017` accepts `baseWidth` from the caller.
- `apps/web/src/lib/process-image.ts:1049-1064` initializes `processingBaseWidth` from `baseWidth`, then reads fresh Sharp metadata.
- `apps/web/src/lib/process-image.ts:1058-1060` says the upload flow's `baseWidth` is ignored, but the code only uses `freshBaseWidth` for pixel-count/downscale math.
- `apps/web/src/lib/process-image.ts:1145-1148` picks every derivative width from `processingBaseWidth`.
- `apps/web/src/lib/admin-backfill-runner.ts:400-403` and `apps/web/scripts/backfill-color-pipeline.ts:337-340` select stored `images.width`; both pass `row.width` into `processImageFormats` at `admin-backfill-runner.ts:502-517` and `backfill-color-pipeline.ts:206-221`.

Problem:
`processImageFormats` reads fresh metadata, but on the normal non-downscale path it leaves `processingBaseWidth = baseWidth`. That makes the derivative ladder depend on the database/caller width even after the function has already read the actual source dimensions. The inline comment says the stale caller width is ignored, but the resize loop still uses it.

Concrete failure scenario:
An old row has `images.width = 640` because metadata was imported incorrectly, repaired incompletely, or points at an original whose actual width is 4096. A color-pipeline backfill re-encodes it. `freshBaseWidth` becomes 4096, but because the image is not over the wide-gamut downscale cap, `processingBaseWidth` remains 640. For configured sizes `[640, 1536, 2048, 4096]`, line 1147 makes every larger variant resize to 640, and the base filename copied at line 1308 is also the largest configured slot backed by a 640 px file. The DB can then say the image is processed at the current pipeline version while the gallery serves undersized derivatives.

Suggested fix:
After validating fresh metadata, set `processingBaseWidth = freshBaseWidth` for the default path and reject missing/zero fresh dimensions before the size loop. Keep the downscale branch overriding it with `targetWidth`. Add a regression test that calls `processImageFormats` with a deliberately stale `baseWidth` smaller than the real fixture width and asserts larger configured variants use the fresh width.

### DBG-C7-02 - Tag filter client state can diverge from canonical server filters

Severity: Medium
Confidence: High
Status: Confirmed

Code regions:
- `apps/web/src/lib/tag-slugs.ts:6-15` caps and canonicalizes requested tag slugs.
- `apps/web/src/lib/tag-slugs.ts:37-48` filters requested slugs to tags that actually exist.
- `apps/web/src/app/[locale]/(public)/page.tsx:161-166` filters the page data query to canonical existing tag slugs, then passes `currentTags={tagSlugs}` at `page.tsx:222`.
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:172-176` does the same for topic pages, then passes `currentTags={tagSlugs}` at `[topic]/page.tsx:214`.
- `apps/web/src/components/tag-filter.tsx:14-15` ignores that canonical server state and reparses raw `useSearchParams().get('tags')`.
- `apps/web/src/components/tag-filter.tsx:24-35`, `61-65`, `80-92`, and `104-110` derive next URLs, active chips, `aria-pressed`, and chip count styling from the raw query tokens.

Problem:
The server canonicalizes the requested tag list before querying data and rendering the heading/load-more props. `TagFilter` then recomputes active state from the raw browser query instead of consuming the canonical `currentTags` already passed into `HomeClient`. Invalid, over-limit, duplicate, or deleted tag slugs are dropped by the data path but remain active in the chip logic and next URL construction.

Concrete failure scenario:
Visit `/?tags=deleted-slug`. The server drops `deleted-slug`, so the gallery renders the unfiltered image set and `HomeClient` receives `currentTags=[]`. `TagFilter` still sees `currentTags=['deleted-slug']` from the raw URL, marks "All" inactive (`variant="outline"`), and when the user clicks a real `landscape` chip it sets `?tags=deleted-slug,landscape`. The next server render filters only by `landscape`, but the UI keeps carrying a non-existent active token. This creates misleading active-state/ARIA output and can leave stale query garbage through pagination and sharing.

Suggested fix:
Make `TagFilter` accept the canonical active slug list from `HomeClient` and use that for active state and URL mutation. When constructing the next query, start from the canonical list rather than the raw query, so unknown tokens are dropped on the first interaction. Add a component or source-contract test proving `TagFilter` does not parse `useSearchParams().get('tags')` as its active source.

## Non-Findings / Ruled Out

- Fresh upload processing mostly avoids DBG-C7-01 because `saveOriginalAndGetMetadata` writes dimensions from Sharp metadata at `process-image.ts:899-904` and `images.ts:360-389` before enqueueing. The bug is still reachable through backfill and any legacy/repair path with stale DB width.
- Backfill delete-mid-reencode cleanup is present in both in-app and sidecar paths: `admin-backfill-runner.ts:574-612` and `backfill-color-pipeline.ts:437-460`.
- Queue delete-during-processing cleanup uses full variant scans for non-default size ladders at `image-queue.ts:469-485`.
- Public load-more sanitizes tag arrays again at `actions/public.ts:129-131`; this limits query abuse but does not fix the client/server active-state divergence in DBG-C7-02.
- Restore-maintenance, upload quota rollback, admin API auth, mutating action origin checks, and public mutating route rate-limit gates were inspected by source and did not produce a new confirmed debugger finding in this pass.

## Final Missed-Issues Sweep

Final sweeps run:
- `rg --files` inventory across app, lib, components, scripts, migrations, and tests.
- Targeted searches for `processImageFormats`, `baseWidth`, `freshBaseWidth`, `processingBaseWidth`, tag filter/query handling, `GET_LOCK`/`RELEASE_LOCK`, fire-and-forget `void`, cleanup/unlink/rename paths, broad catches, and known risk markers.
- Cross-checked existing review files already written this cycle to avoid stale pre-cycle assumptions while independently validating current code.

Result:
No additional higher-confidence latent bug was found beyond the two confirmed issues above. This lane did not run the full quality gates because it was review-only; validation was static source tracing plus exact line-region inspection.
