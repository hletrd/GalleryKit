# Cycle 68 Code Quality Review

Reviewer: code-quality
Date: 2026-07-01
Scope: read-only repository review plus this artifact. I did not modify source, tests, plans, or existing Cycle 68 artifacts.

## Inventory

Required context read:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/cycle-67-2026-07-01/_aggregate.md`
- `.context/plans/cycle-67-2026-07-01-plan.md`
- `.context/plans/cycle-67-2026-07-01-deferred.md`

Current tree context:

- HEAD: `e221b01a` (`fix(cycle-67): 🐛 align backfill warnings and controls`)
- `origin/master`: `e221b01a`
- `git rev-list --left-right --count origin/master...HEAD`: `0 0`
- Pre-existing Cycle 68 artifact observed: `.context/reviews/cycle-68-2026-07-01/security.md`; left untouched.

Review-relevant source/docs/tests inspected:

- Cycle 67 changed code/tests/docs: `apps/web/src/lib/settings-backfill-warning.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/components/lightbox.tsx`, and the matching Cycle 67 tests.
- Adjacent high-risk surfaces: `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/admin-backfill.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, public photo/home/topic pages, and JSON-LD sanitization.
- Schema/test inventory: `apps/web/drizzle/meta/_journal.json`, migration monotonicity state, public/admin auth lint surfaces, privacy guard tests, source-contract tests, settings/backfill tests, semantic/similar tests, upload tests, and backfill runner tests.

Deferred/carry-forward items intentionally not re-raised:

- `C65-02` durable settings-only re-encode marker.
- `C61-06`, `C61-07`, `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`.

## Findings

### CQ68-01 - Settings-only re-encode warning is paired with a no-op runner response

- Severity / confidence: Medium / High
- Files / lines:
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:180-185`
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:198-204`
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:248-266`
  - `apps/web/src/lib/admin-backfill-runner.ts:413-418`
  - `apps/web/src/lib/admin-backfill-runner.ts:856-864`
  - `apps/web/messages/en.json:787-797`
- Evidence: the Settings client now keeps `showBackfillRequired` true after saving byte-impacting setting changes, and `hasSavedBackfillPending` is set from the saved backfill-relevant diff. The same UI shows the in-app "Re-encode now" control. When clicked, `runBackfill()` maps `affectedRows === 0` to `settings.backfillNothingToDo`. The runner's candidate query only selects processed rows whose `pipeline_version` is missing or below `IMAGE_PIPELINE_VERSION`; current-version rows affected only by saved quality/chroma/force-sRGB settings are therefore excluded and `triggerAdminBackfill()` returns `{ status: 'queued', affectedRows: 0 }`.
- Failure scenario: a photographer changes `image_quality_jpeg`, `avif_effort`, `force_srgb_derivatives`, or another byte-impacting setting while all photos are already at the current pipeline version. The page correctly displays "Backfill required", but clicking the visible re-encode button shows "All photos are already at the current pipeline version. Nothing to re-encode." That contradicts the warning and can make the operator believe existing derivatives have been refreshed when the required settings-only sidecar `--force-reencode` work has not happened.
- Fix direction: make the zero-candidate path aware of saved settings-only pending state. Either hide/disable the in-app trigger while `hasSavedBackfillPending` comes only from settings-only changes, or show a distinct toast/banner that says no pipeline-version candidates exist and the sidecar `--force-reencode` is still required. Add a focused Settings client test/source contract that covers the `hasSavedBackfillPending && affectedRows === 0` branch so it cannot regress to "nothing to re-encode".

## No Additional Findings Confirmed

- Cycle 67 fixes for `allow_hdr_ingest` exclusion, CLIP scan-limit notice placement, lightbox `e.repeat` handling, and whitespace-tolerant Similar Photos abort source contract match their stated intent.
- Public rendering paths reviewed use dynamic freshness where required, public select-field privacy guards, `safeJsonLd`, and shared OG sanitization.
- Upload/delete cleanup paths still validate filenames, delete historical derivative variants with directory scans, and preserve quota-settlement guards.
- Admin API/action guard and public route rate-limit surfaces are covered by the repo lint scanners and representative source review did not show a new bypass.
