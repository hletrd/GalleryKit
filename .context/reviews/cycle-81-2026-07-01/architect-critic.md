# Cycle 81/100 Architect + Critic

Start HEAD: `4733d475be8f19fbddf4b82b589e28d6ca083992`
Compared against Cycle 80 start: `8c4999c9294e0196608b4a0bce8078edc3be2366`
Date: 2026-07-01

## Result

No new actionable architecture defects found.

## Scope Inspected

- Required repo instructions: `AGENTS.md`, `CLAUDE.md`.
- Prior-cycle baseline and deferred queue: `.context/reviews/cycle-80-2026-07-01/_aggregate.md:1-90`, `.context/reviews/cycle-80-2026-07-01/architect-debugger-tracer.md:1-32`, `.context/plans/cycle-80-2026-07-01-deferred.md:1-24`.
- Schema / migration / reconcile drift: `apps/web/src/db/schema.ts:19-123`, `apps/web/src/db/schema.ts:139-222`, `apps/web/src/db/schema.ts:269-315`, `apps/web/drizzle/meta/_journal.json:4-207`, `apps/web/scripts/migrate.js:317-452`, `apps/web/scripts/migrate.js:653-718`, `apps/web/scripts/migrate.js:764-824`.
- Privacy and source-of-truth lists: `apps/web/src/lib/data.ts:251-327`, `apps/web/src/lib/data.ts:368-507`, `apps/web/src/__tests__/privacy-fields.test.ts:7-132`, `apps/web/src/lib/search-enrichment-fields.ts:1-47`, `apps/web/src/lib/data-timeline.ts:20-79`.
- Settings / derivative byte-impacting lists: `apps/web/src/lib/gallery-config-shared.ts:26-85`, `apps/web/src/lib/settings-hash.ts:42-59`, `apps/web/src/lib/settings-hash.ts:72-95`.
- Upload and image-processing contracts: `apps/web/src/app/actions/images.ts:128-262`, `apps/web/src/app/actions/images.ts:370-481`, `apps/web/src/app/actions/images.ts:520-551`, `apps/web/src/lib/image-queue.ts:110-195`, `apps/web/src/lib/image-queue.ts:577-675`, `apps/web/src/lib/image-queue.ts:696-755`, `apps/web/src/lib/image-queue.ts:900-966`.
- Restore / sidecar / deploy contracts: `apps/web/src/app/[locale]/admin/db-actions.ts:365-565`, `apps/web/src/app/[locale]/admin/db-actions.ts:570-821`, `apps/web/src/lib/background-db-writes.ts:1-34`, `apps/web/scripts/backfill-alt-text.ts:30-115`, `apps/web/src/lib/restore-maintenance-durable.ts:53-63`, `apps/web/deploy.sh:45-55`, `apps/web/deploy.sh:79-104`, `apps/web/docker-compose.yml:28`, `apps/web/README.md:47-58`, `CLAUDE.md:469-491`.
- Product-policy drift: searched for paid-download/Stripe, storage-backend exposure, bundled Lightroom plugin, editing/culling/scoring surfaces; checked `CLAUDE.md:149`, `CLAUDE.md:271`, `CLAUDE.md:567-584`, `apps/web/src/lib/storage/index.ts:1-18`, `apps/web/src/lib/storage/index.ts:80-143`.

## Findings

None.

## Critic Notes

- Schema / reconcile parity: current schema objects and removals are mirrored in the reconcile path. The migration runner uses per-journal hashes and postconditions rather than trusting Drizzle's `MAX(created_at)` cursor (`apps/web/scripts/migrate.js:180-195`, `apps/web/scripts/migrate.js:803-824`), while reconcile creates current tables/indexes/FKs and drops removed paid-download/reaction schema (`apps/web/scripts/migrate.js:653-718`). Confidence: high.
- Upload / processing contracts: browser uploads hold the upload-processing contract lock, snapshot byte-impacting settings, save a pending row, then enqueue the same snapshot (`apps/web/src/app/actions/images.ts:191-205`, `apps/web/src/app/actions/images.ts:480-551`). Queue workers rehydrate pending-row snapshots, claim unprocessed rows, verify all derivatives, and update `processed=true` conditionally (`apps/web/src/lib/image-queue.ts:577-675`). Confidence: high.
- Restore / sidecar contracts: Cycle 80's alt-text backfill issue is fixed; the script now checks the durable restore marker before settings/candidate reads and write chunks (`apps/web/scripts/backfill-alt-text.ts:33-35`, `apps/web/scripts/backfill-alt-text.ts:54-60`, `apps/web/scripts/backfill-alt-text.ts:78-115`). Restore takes DB/upload/backfill locks, enters durable maintenance, drains queue/shared-view/background writes, imports, and runs post-restore migrations (`apps/web/src/app/[locale]/admin/db-actions.ts:390-497`, `apps/web/src/app/[locale]/admin/db-actions.ts:718-744`). Confidence: high.
- Product-policy drift: no current evidence of reintroduced Stripe/entitlements/payment flows, unsupported S3/MinIO admin switching, bundled Lightroom plugin, or photo culling/scoring features. Storage remains local-only in docs and code (`CLAUDE.md:149`, `apps/web/src/lib/storage/index.ts:1-18`, `apps/web/src/lib/storage/index.ts:80-143`). Confidence: medium-high.

## Deferred Items Not Re-Raised

- `C80-06` site-config runtime/build-time ambiguity remains a valid deferred item, but no new evidence changes severity or exit criteria. Existing deferred failure scenario: an operator edits the mounted `src/site-config.json` and restarts expecting runtime changes, while static imports can keep bundled values (`.context/plans/cycle-80-2026-07-01-deferred.md:8-13`, `apps/web/docker-compose.yml:28`, `CLAUDE.md:663-673`, `apps/web/src/lib/data.ts:1767-1794`). Fix remains the recorded dedicated contract decision: runtime loader or build-time-only docs/Compose cleanup. Confidence: high.
- `C77-ARCH-01` restore maintenance foreground-mutation barrier remains deferred, not escalated. Current restore drains known tracked background writes (`apps/web/src/lib/background-db-writes.ts:28-34`, `apps/web/src/app/[locale]/admin/db-actions.ts:492-498`), but a global foreground admin mutation barrier is still the recorded exit criterion (`.context/plans/cycle-80-2026-07-01-deferred.md:17`). No new current evidence changes that failure scenario or fix. Confidence: medium-high.
- `C76-04`, `C76-05`, and `C75-08` were not re-raised; this lane found no architecture evidence changing their recorded exit criteria (`.context/plans/cycle-80-2026-07-01-deferred.md:18-22`).

## Validation

- Verified generated service worker version from `apps/web/public/sw.template.js` + `IMAGE_PIPELINE_VERSION=7` matches `apps/web/public/sw.js`: `8fadda29-p7`.
- Ran `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/settings-hash.test.ts src/__tests__/sw-template-contract.test.ts`: 3 files, 53 tests passed.
