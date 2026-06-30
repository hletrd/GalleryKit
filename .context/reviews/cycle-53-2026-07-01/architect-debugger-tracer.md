# Cycle 53 Architect / Debugger / Tracer Review

Reviewed HEAD: `17db8e38` (`fix(settings): prevent hidden production search state`).
Baseline: Cycle 52 aggregate at `d7326789`; this pass focused on new evidence since then plus the requested cross-file risk boundaries.

## Inventory

- Context and carry-forward filter: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/cycle-52-2026-07-01/_aggregate.md`, `.context/reviews/cycle-52-2026-07-01/architect-debugger-tracer.md`.
- Current delta from Cycle 52: semantic Settings affordance and ledger/test files in `17db8e38`.
- Settings resolution and semantic activation: `apps/web/src/lib/gallery-config-shared.ts:206`, `apps/web/src/lib/gallery-config.ts:123`, `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:31`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:298`, `apps/web/src/app/api/search/semantic/route.ts:189`, `apps/web/src/app/api/search/similar/[id]/route.ts:114`.
- Data privacy selects: `apps/web/src/lib/data.ts:368`, `apps/web/src/lib/data.ts:473`, `apps/web/src/lib/search-enrichment-fields.ts:29`, `apps/web/src/__tests__/privacy-fields.test.ts:86`.
- Route/action lint gates: `apps/web/scripts/check-api-auth.ts:107`, `apps/web/scripts/check-action-origin.ts:91`, `apps/web/scripts/check-public-route-rate-limit.ts:128`, semantic/similar routes above.
- Image processing and backfill: `apps/web/src/lib/process-image.ts:59`, `apps/web/src/lib/process-image.ts:644`, `apps/web/src/lib/image-queue.ts:122`, `apps/web/src/lib/image-queue.ts:646`, `apps/web/src/lib/admin-backfill-runner.ts:316`, `apps/web/scripts/backfill-color-pipeline.ts:327`.
- Migrations and deploy docs/scripts: `apps/web/scripts/migrate.js:180`, `apps/web/scripts/migrate.js:317`, `apps/web/drizzle/meta/_journal.json:201`, `apps/web/deploy.sh:56`, `scripts/deploy-remote.sh:65`, `.env.deploy.example:3`.

## Findings

No new architect/debugger/tracer findings met the actionability bar.

### Non-Findings Checked

- **Semantic production state is no longer hidden.** The server resolves the raw stored value with the same production env gate used by runtime config (`settings/page.tsx:31`, `gallery-config-shared.ts:206`, `gallery-config.ts:123`). The client now shows a disabled production-active select item and a status message when the stored row plus env opt-in really make production active (`settings-client.tsx:298`, `settings-client.tsx:823`, `settings-client.tsx:831`). The public semantic route and similar route still read `getGalleryConfig()` and serve only the resolved active modes (`semantic/route.ts:189`, `similar/[id]/route.ts:114`).
- **Privacy projections remain guarded at the shared public-search boundary.** Public search enrichment uses `searchEnrichmentSelectFields` with a type-only `PrivacySensitiveKeys` guard (`search-enrichment-fields.ts:29`, `search-enrichment-fields.ts:43`). The canonical public select omits admin-only fields and the symmetric fixture still forces unknown admin-only additions to be classified (`data.ts:368`, `data.ts:473`, `privacy-fields.test.ts:86`).
- **Route and action lint boundaries still cover the suspicious surfaces.** Admin API routes are required to export direct `withAdminAuth(...)` wrappers (`check-api-auth.ts:107`). Server actions are recursively discovered under `app/actions/` plus the admin DB action file (`check-action-origin.ts:91`). Public route rate-limit discovery excludes admin routes and flags expensive GET/HEAD handlers (`check-public-route-rate-limit.ts:128`).
- **Image processing/backfill column symmetry still matches the documented contract.** Fresh queue processing persists `pipeline_version`, `was_downscaled`, `avif_10bit`, and clears pending snapshots after successful encode (`image-queue.ts:646`, `image-queue.ts:680`). In-app and sidecar backfill share `gallerykit_color_pipeline_backfill`, clean deleted-mid-reencode derivatives through full directory scans, and leave `pipeline_version` behind on detection failure while refreshing derivative-only columns (`admin-backfill-runner.ts:316`, `admin-backfill-runner.ts:589`, `admin-backfill-runner.ts:624`, `backfill-color-pipeline.ts:327`).
- **Migration and deploy contracts did not show new drift.** Journal whens remain monotonic through `0028_rate_limit_bucket_start_idx` (`_journal.json:201`). `migrate.js` hashes every journal entry and reconciles legacy schemas before baselining (`migrate.js:180`, `migrate.js:317`). Deploy still checks `.env.deploy` permissions before sourcing and prunes only after a healthy `up -d` with bind-mounted data preserved (`scripts/deploy-remote.sh:65`, `deploy.sh:56`).

## Validation

- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- `npm test --workspace=apps/web -- cycle-52-source-contracts gallery-config semantic-search-route semantic-route-production privacy-fields migrate-reconcile-coverage deploy-script-contract` - pass, 9 files / 145 tests.

## Final Sweep

No current evidence changes the severity of the carry-forward deferred items (`PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`). The only source change since Cycle 52 closes the known semantic Settings misrepresentation without creating a new enablement path. I found no new cross-file failure scenario in settings resolution, semantic search activation, privacy selects, route/action gates, image/backfill flow, migrations, or deploy docs/scripts.
