# Verifier Review - Cycle 7/100

Date: 2026-06-29
Role: verifier
Scope: current `HEAD` only (`17124135`, `master`). No implementation fixes made in this lane.

Note: sibling review lanes had already modified other `.context/reviews/*.md` files while this report was being written. Those files were treated as concurrent user/agent work and were not reverted.

## Inventory Built Before Findings

Read first, per repo contract: `AGENTS.md`, `CLAUDE.md`.

Review-relevant inventory was built with `rg --files`, `git rev-parse --short HEAD`, targeted `nl -ba` reads, and package/script inspection. The verifier lane examined all files relevant to the requested contracts:

- Repo controls and gates: `AGENTS.md`, `CLAUDE.md`, root `package.json`, `apps/web/package.json`.
- Migrations/schema: `apps/web/drizzle/meta/_journal.json`, all `apps/web/drizzle/00*.sql` entries, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, `apps/web/src/__tests__/migration-journal.test.ts`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`.
- Privacy/select boundaries: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/__tests__/map-privacy.test.ts`, `apps/web/src/__tests__/search-route-privacy.test.ts`.
- Auth/origin/rate-limit contracts: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, admin API routes, public search API routes, server action files under `apps/web/src/app/**/actions.ts`.
- Color/HDR pipeline: `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/color-detection.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, related color/settings/upload tests.
- Service worker/PWA/cache behavior: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/scripts/build-sw.ts`, `apps/web/src/proxy.ts`, `apps/web/src/__tests__/sw-template-contract.test.ts`, `apps/web/next.config.ts`.
- Deploy/runbook/runtime: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, deploy and nginx contract tests.

## Confirmed Issues

### V-C7-01 - Color backfill can silently generate undersized derivatives from stale database width

Severity: High
Confidence: High
Status: Confirmed

Regions:
- `apps/web/src/lib/process-image.ts:1050-1064`
- `apps/web/src/lib/process-image.ts:1145-1148`
- `apps/web/src/lib/admin-backfill-runner.ts:502-517`
- `apps/web/scripts/backfill-color-pipeline.ts:206-221`

Why this is a problem:
`processImageFormats` reads fresh Sharp metadata and explicitly comments that the upload flow's `baseWidth` is ignored (`process-image.ts:1058-1060`). The implementation does not actually assign that fresh width to `processingBaseWidth` in the normal, non-downscale path. It initializes `processingBaseWidth` from the caller-provided `baseWidth` (`process-image.ts:1050`) and only replaces it when the wide-gamut OOM downscale branch runs (`process-image.ts:1085`). The size ladder later uses `processingBaseWidth` to choose every derivative width (`process-image.ts:1145-1148`).

Both color backfill callers pass the database row width into this parameter (`admin-backfill-runner.ts:502-517`, `backfill-color-pipeline.ts:206-221`). If the row width is stale, corrupt, imported from an older schema state, or mismatched with the private original, the fresh metadata read does not protect the derivative ladder.

Concrete failure scenario:
An original file on disk is 4000 px wide, but `images.width` is 640 due to an old import, a stale row, or a previous metadata bug. A color-pipeline backfill reprocesses the image and passes `row.width = 640` to `processImageFormats`. The function reads `freshBaseWidth = 4000`, but still uses `processingBaseWidth = 640`, so configured sizes above 640 all collapse to 640 px derivatives. The row can then be advanced to the current `pipeline_version`, leaving the gallery with low-resolution WebP/AVIF/JPEG derivatives even though the original supports the intended larger sizes.

Suggested fix:
Set `processingBaseWidth` from `freshBaseWidth` immediately after metadata validation, and reject/throw if Sharp cannot provide a positive width. Keep the downscale branch override for the temporary intermediate width. Add a regression test that invokes `processImageFormats` with a larger real source image and an intentionally stale smaller `baseWidth`, then asserts at least one configured larger derivative uses the fresh source width/configured size rather than the stale caller width.

## Likely Issues

None found beyond the confirmed item above.

## Risks Needing Manual Validation

- `apps/web/public/sw.js` is stamped with an older generated service-worker version than current `HEAD`, while `apps/web/scripts/build-sw.ts` regenerates it from `git rev-parse --short HEAD` during `prebuild`. I am not treating this as a finding because production builds regenerate the file and the template matched the generated file after normalizing the version token. A strict generated-artifact freshness gate would remove this ambiguity.
- I verified migration contracts from source and tests, not by running a disposable MySQL migration/import. A live DB smoke test remains the only direct proof that advisory locks, reconcile, Drizzle journal hashes, and deploy-time migration behavior interact correctly against an actual MySQL instance.

## Contract Checks With No Finding

Migration/journal:
- `apps/web/drizzle/meta/_journal.json` entries `0018` through `0024` are globally monotonic after the documented historical nonmonotonic range. Current migration tests cover sequential indices, tag/file existence, known historical inversion allowances, and the silent-skip postcondition in `migrate.js`.
- `apps/web/scripts/migrate.js` computes one hash per committed journal entry, reconciles fresh/legacy DBs before baseline insertion, and asserts every expected journal hash exists after Drizzle completes. The schema reconcile/drop tripwire tests cover current table/column/index names and historical table removal guards.

Privacy/select guards:
- `apps/web/src/lib/data.ts` derives public image selects from admin selects by omitting sensitive keys and has type guards for public and map selects.
- `apps/web/src/__tests__/privacy-fields.test.ts` symmetrically compares admin-only keys against the sensitive fixture and separately checks timeline fields.
- Public semantic/similar search routes enrich from `apps/web/src/lib/search-enrichment-fields.ts`; route privacy tests scan for PII column use in those route sources.
- Map image retrieval requires `topics.map_visible = true` in the join predicate and keeps runtime guard coverage in `map-privacy.test.ts`.

Auth/origin/rate-limit:
- `npm run lint:api-auth --workspace=apps/web` passed during this lane.
- `npm run lint:action-origin --workspace=apps/web` passed during this lane.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed during this lane.
- The lints fail closed on admin API exports, mutating server actions, and mutating public route handlers respectively; current routes/actions matched the declared contracts.

Color/HDR pipeline:
- Color-impacting config hashing includes the current derivative-quality, size, chroma, force-sRGB, AVIF effort, and wide-gamut pixel-cap keys.
- Upload serving ETags include `IMAGE_PIPELINE_VERSION` and the serving settings hash, so changed rendering policy invalidates cached derivative responses.
- HDR/P3/NCLX detection, AVIF bit-depth probing, ICC extraction, wide-gamut max-pixel downscale, and derivative cleanup paths were inspected. The stale-width derivative bug above is the confirmed correctness issue in this surface.

Service worker and deploy/runbook:
- `sw.template.js` bypasses admin routes, does bounded lazy HEAD revalidation for cached upload assets, avoids caching admin-rendered HTML via the proxy marker, and uses the documented HTML fallback age limit.
- `build-sw.ts` stamps version/pipeline tokens into `public/sw.js`; `sw-template-contract.test.ts` covers the important template/generated-file contracts.
- `scripts/deploy-remote.sh` reads the gitignored deploy environment and delegates to the configured SSH deploy command.
- `apps/web/deploy.sh` uses `git pull --ff-only`, rebuilds via docker compose, and prunes after `up -d`; `docker-compose.yml` keeps runtime persistence on bind mounts for `./data`, `./public/uploads`, `./public/resources`, and read-only site config.
- `apps/web/nginx/default.conf` preserves the larger upload limits for DB download, dashboard import, and Lightroom upload before the generic low-limit admin API location.

## Validation Evidence

Commands run during this verifier lane:
- `npm run lint:api-auth --workspace=apps/web` -> passed.
- `npm run lint:action-origin --workspace=apps/web` -> passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` -> passed.
- Source-level journal monotonicity check for `apps/web/drizzle/meta/_journal.json` -> entries after the documented historical range are monotonic.
- Template/generated service-worker normalization check -> `sw.js` matches `sw.template.js` after replacing the generated version token.

Not run in this verifier lane:
- Full `npm run lint --workspace=apps/web`, `npm run typecheck --workspace=apps/web`, `npm run build --workspace=apps/web`, and full `npm test --workspace=apps/web`; this lane was a read-only verifier report plus the three contract lints above. The cycle implementer should run the complete gate list before committing fixes.

## Final Missed-Issues Sweep

Final sweeps covered:
- Migration journal `when` ordering, journal file/tag existence, reconcile coverage, and post-migration hash assertion.
- Sensitive admin-only fields against public/timeline/map/search select surfaces.
- Admin API auth wrappers, server-action origin guards, and public route rate-limit pre-increments.
- Color/HDR source metadata freshness, settings hashing, ETag invalidation, derivative cleanup, backfill call paths, and current tests.
- Service-worker cache strategy, generated SW stamping, admin HTML cache bypass, upload cache headers, proxy marker, deploy helper, compose mounts, nginx upload limits, and Docker prune policy.

I intentionally did not inspect archived review screenshots/binary artifacts or unrelated historical `.context/reviews/archive/**` files beyond using current plan/review context. They are not part of the requested current-HEAD behavior contracts.
