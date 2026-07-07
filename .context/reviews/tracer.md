# Cycle 16 Tracer Review

Role: `tracer`
Scope: whole-repository causal-flow review across browser upload, Lightroom upload, image queue/backfill, admin mutation/restore maintenance, logout/session revocation, sharing/view counts, semantic/similar search, migration/reconcile, public data/privacy selection, and deployed request/proxy paths.
Allowed write: this report file only.
Source edits: none.
Validation evidence: static causal tracing from inventory-first file discovery, targeted symbol searches, and line-number citation sweeps. I did not run the full test suite because this lane produced a review artifact only.

## Required Context Read

- Project instructions supplied in the cycle prompt, including `AGENTS.md` rules.
- `CLAUDE.md` architecture/security/restore/upload/search sections.
- Review workflow instructions: `code-review` skill.
- Previous `.context/reviews/tracer.md` only as prior-cycle context; all findings below are independently re-traced against current code.

## Inventory

I built the inventory first using `rg --files`, route/action/library listings, and targeted symbol searches. I excluded generated/runtime output (`node_modules`, `.next`, coverage/build/dist, upload/data artifacts) but traced every file relevant to this lane's flows.

- Browser upload path: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`.
- Lightroom upload path: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, token/rate-limit/session helpers.
- Image queue/backfill path: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/app/actions/admin-backfill.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, CLIP/color-processing helpers.
- Admin mutation/restore maintenance path: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, advisory-lock helpers, admin action files.
- Logout/session revocation path: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/pending-session-revocations.ts`, `apps/web/src/instrumentation.ts`.
- Sharing/public view count path: `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/analytics.ts`, public shared routes under `apps/web/src/app/[locale]/(public)/s/[key]` and `/g/[key]`.
- Semantic/similar search path: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/gallery-config*.ts`.
- Migration/reconcile path: `apps/web/scripts/migrate.js`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/db/schema.ts`.
- Public data/privacy selection path: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, public page/feed/OG/search consumers, privacy/source tests under `apps/web/src/__tests__/`.
- Deployed request/proxy path: `apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/next.config.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/serve-upload.ts`.

No trace-relevant file in the categories above was intentionally skipped.

## Confirmed Issues

### T16-TRC-01: Color settings can change during color backfill, letting stale derivatives be stamped as current

- Severity: Major
- Confidence: High
- Code region: `apps/web/src/app/actions/settings.ts:168-200`, `apps/web/src/app/actions/settings.ts:207-234`, `apps/web/src/lib/admin-backfill-runner.ts:675-714`, `apps/web/src/lib/admin-backfill-runner.ts:749-756`, `apps/web/src/lib/admin-backfill-runner.ts:615-636`, `apps/web/scripts/backfill-color-pipeline.ts:325-340`, `apps/web/scripts/backfill-color-pipeline.ts:342-365`, `apps/web/scripts/backfill-color-pipeline.ts:453-492`.
- Why it is a problem: `updateGallerySettings()` treats derivative-byte-impacting keys other than `image_sizes`/`strip_gps_on_upload` as a warning-only backfill condition. It detects a relevant diff and returns `requiresBackfill` (`settings.ts:168-200`), then persists the new setting values without acquiring the `gallerykit_color_pipeline_backfill` advisory lock (`settings.ts:207-234`). Both color backfill implementations snapshot encoder settings once for a long run: the in-app runner reads `getGalleryConfigDetached()` once (`admin-backfill-runner.ts:675-714`) and processes later rows with that frozen `settings` object (`admin-backfill-runner.ts:749-756`); the sidecar snapshots config before even acquiring the global color-backfill lock (`backfill-color-pipeline.ts:325-365`). Successful rows are then written with `pipeline_version = IMAGE_PIPELINE_VERSION` (`admin-backfill-runner.ts:615-636`; sidecar batch update at `backfill-color-pipeline.ts:453-492`).
- Concrete failure scenario: an admin starts "Re-encode existing photos" to apply a quality/gamut/chroma setting, then another settings save changes `force_srgb_derivatives`, JPEG quality, AVIF effort, or another byte-impacting warning key while the run is still processing. The active runner keeps encoding with the old snapshot but writes `pipeline_version` as current. Rows processed after the settings change are no longer candidates for the normal pipeline-version backfill, even though their bytes do not match current settings. The gallery can remain mixed until an operator discovers the mismatch and runs a force re-encode.
- Suggested fix: coordinate settings writes with the color-backfill lock. The narrow fix is to make `updateGallerySettings()` fail or defer saves that touch `SETTINGS_BACKFILL_WARNING_KEYS` while `LOCK_COLOR_PIPELINE_BACKFILL` is held, and to acquire the same lock briefly while committing those settings so a new runner cannot snapshot mid-save. The more durable fix is to persist a settings hash/version per processed image and have backfill candidate selection compare that hash, not only `pipeline_version`.

## Likely Issues

No additional likely code defects survived tracing. Two prior tracer findings were specifically rechecked and appear fixed in current code: `markTokenUsed()` is now guarded by `acquireAdminMutationSlot()` in `apps/web/src/lib/admin-tokens.ts:171-175`, and `deleteTopicAlias()` now runs through `withTopicRouteMutationLock()` in `apps/web/src/app/actions/topics.ts:648-664`.

## Manual-Validation Risks

### T16-TRC-02: Deployed per-IP protections depend on the documented proxy topology

- Severity: Medium
- Confidence: Medium
- Code region: `apps/web/nginx/default.conf:59-71`, `apps/web/nginx/default.conf:99-187`, `apps/web/nginx/default.conf:274-306`, `apps/web/docker-compose.yml:20-23`, `apps/web/src/lib/rate-limit.ts:175-198`, `apps/web/src/lib/request-origin.ts:81-107`.
- Why it is a risk: the shipped nginx config intentionally overwrites `X-Forwarded-For` with `$remote_addr` in every proxied location, while the app container sets `TRUST_PROXY=true`. This is safe only when `$remote_addr` is the real visitor or a source-preserving local/TLS edge, as the template comment states (`nginx/default.conf:59-71`). If the production topology has an upstream LB/CDN that connects from its own IP and this nginx template is used unchanged, nginx and the app both see the LB as the client. All per-IP buckets collapse together: nginx `limit_req_zone $binary_remote_addr` and app `getClientIp()` both meter the shared LB address.
- Concrete failure scenario: five failed admin-login attempts or a burst of semantic/search/share requests from one visitor behind the LB consumes the same app/nginx bucket used by every other visitor. Legitimate users then see global 429s/lockouts even though their own IPs are distinct. Conversely, operators may think app-level abuse telemetry is per visitor when it is actually per LB.
- Suggested validation/fix: verify the live edge source by checking nginx logs for distinct client IPs during requests from two networks. If an upstream proxy is present and does not preserve the TCP peer address, configure `real_ip_header`/`set_real_ip_from` or PROXY protocol for nginx, switch the app-facing XFF contract to append form where appropriate, and set `TRUSTED_PROXY_HOPS` to the actual trusted suffix length.

## Flows Traced Without New Findings

- Browser upload: restore/same-origin/admin checks precede mutation admission; upload quota claims settle on rollback paths; the upload-processing contract spans strict config snapshot, topic/tag validation, original save, DB insert, and enqueue; pending rows carry processing snapshots.
- Lightroom upload: PAT wrapper, body size, parse slot, quota tracker, topic validation, upload contract, original save, DB insert, and enqueue were traced. The prior restore-time `last_used_at` writer is now guarded by the admin mutation slot.
- Image queue/backfill: queue concurrency, per-image advisory claims, settings snapshot restoration for pending rows, restore quiesce/resume, derivative cleanup, semantic bootstrap gating, and admin color-backfill counters were traced. The confirmed issue is isolated to concurrent color setting saves versus long-running color backfills.
- Admin restore maintenance: SQL dump header/trailer validation, dangerous SQL scan, durable marker lifecycle, DB/processing/semantic/color locks, queue drains, background writer drains, maintenance sweep drain, admin mutation drain, post-restore migration, and pending session revocation flush were traced.
- Logout/session revocation: logout deletes live sessions inside the mutation barrier when possible, enqueues process-local pending revocations during maintenance failures, and `instrumentation.ts` drains pending revocations on shutdown. The process-local loss risk is already documented in `pending-session-revocations.ts`.
- Sharing/public view counts: share creation/revocation, public share lookup, photo/topic/group view recording, buffered shared-group view-count flushes, restore drains, and rate-limit rollback patterns were traced without a new defect.
- Semantic/similar search: same-origin, restore, content-type/length, abort checks, pre-increment rate limiting, mode gates, model-version filtering, production/stub scoring, and public-safe enrichment fields were traced. Search result payloads use `searchEnrichmentSelectFields`, which is guarded against `PrivacySensitiveKeys`.
- Migration/reconcile: journal ordering, baseline guards, DML-bearing historical migration handling, post-restore migration execution, reconcile additions/removals through current journal entries, and post-condition hash assertions were traced without a new defect.
- Public data/privacy: `publicSelectFields`, `publicMapSelectFields`, shared-link/group queries, feed/listing/detail/search consumers, and compile-time privacy guards were traced. I did not find a public selector leaking `filename_original`, `user_filename`, GPS outside map-visible topics, processing internals, or upload/admin identifiers.
- Deployed request/proxy: middleware CSP/admin-cookie prefiltering, request origin resolution, trusted proxy header handling, nginx route/body/rate-limit locations, derivative serving, and upload/original blocking were traced. The remaining concern is topology validation, not a code-only defect.

## Final Sweep

Final sweep searched for restore maintenance gaps, mutation-slot bypasses, advisory lock mismatches, color/semantic backfill writers, public selectors, rate-limit client IP derivation, token-auth side effects, upload quota settlement, background writer drains, migration journal drift, and proxy location omissions. The confirmed issue and manual-validation risk above are the review-relevant results I found.
