# Tracer Review - Cycle 7/100

HEAD reviewed: `17124135`

Scope: causal tracing of suspicious flows across upload -> queue -> processing, delete/retry/backfill races, restore maintenance, public tag/search pagination, auth/session/token paths, semantic embeddings, service worker caching, migrations, and deploy. This was a read-only review. No fixes, commits, pushes, deploys, or full quality gates were run by this lane.

## Inventory Built Before Findings

Read first:
- `AGENTS.md`
- `CLAUDE.md`
- active OMX review instructions: `~/.agents/skills/ultrawork/SKILL.md`, `~/.agents/skills/code-review/SKILL.md`

Review-relevant files inventoried and examined by line-numbered read or targeted symbol search:
- Upload / queue / processing: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`
- Delete / retry / backfill: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`
- Restore / maintenance / deploy: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/scripts/migrate.js`, `apps/web/deploy.sh`, `package.json`, `apps/web/nginx/default.conf`
- Public tag/search pagination: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/tag-filter.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/tag-slugs.ts`, `apps/web/src/lib/data.ts`, related tests under `apps/web/src/__tests__/tag-slugs.test.ts` and `apps/web/src/__tests__/public-actions.test.ts`
- Auth / sessions / tokens: `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/request-origin.ts`
- Semantic embeddings: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-inference.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/search-enrichment-fields.ts`
- Service worker: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/components/register-service-worker.tsx`, `apps/web/src/lib/sw-cache.ts`

## Causal Trace Summary

Upload -> queue -> processing:
- Browser and Lightroom upload paths both check restore maintenance, acquire the upload-processing contract lock, snapshot processing settings, persist an unprocessed row, and enqueue work (`apps/web/src/app/actions/images.ts:107-229`, `apps/web/src/app/actions/images.ts:360-502`, `apps/web/src/app/api/admin/lr/upload/route.ts:216-237`, `apps/web/src/app/api/admin/lr/upload/route.ts:436-477`). The queue then claims per-image advisory locks and conditionally marks rows processed only if still pending (`apps/web/src/lib/image-queue.ts:256-283`, `apps/web/src/lib/image-queue.ts:364-467`). No new confirmed issue found.

Delete / retry / backfill races:
- Delete clears queue bookkeeping and removes all variant sizes by directory scan (`apps/web/src/app/actions/images.ts:641-688`). Retry clears failure state and removes the ID from the permanent-failure set before enqueueing (`apps/web/src/app/actions/images.ts:1130-1208`). The in-app backfill uses a global backfill lock and per-image processing locks (`apps/web/src/lib/admin-backfill-runner.ts:303-368`), and both in-app and sidecar paths clean variants when a row is deleted mid-reencode (`apps/web/src/lib/admin-backfill-runner.ts:421-440`, `apps/web/scripts/backfill-color-pipeline.ts:119-146`). The sidecar's documented per-image lock gap remains an operator constraint, not a new source finding.

Restore maintenance:
- Restore takes `LOCK_DB_RESTORE`, the upload-processing contract lock, and the color-backfill lock before setting maintenance and quiescing the queue (`apps/web/src/app/[locale]/admin/db-actions.ts:279-369`). The queue quiesce order is pause -> clear -> onIdle -> drain side effects, which avoids the known queued-job deadlock (`apps/web/src/lib/image-queue.ts:869-923`). No new confirmed issue found.

Public tag/search pagination:
- Server pages parse, dedupe, and filter tag slugs against existing tags before querying and before passing `currentTags` to `HomeClient` (`apps/web/src/app/[locale]/(public)/page.tsx:149-166`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:166-176`). `LoadMore` uses that canonical prop, and the server action canonicalizes again before querying (`apps/web/src/components/home-client.tsx:438-447`, `apps/web/src/app/actions/public.ts:113-145`). The `TagFilter` chip state and next URL, however, derive from raw URL search params; confirmed issue TRC-C7-01 below.

Auth / session / tokens:
- Sessions use signed HMAC tokens, DB hash lookup, constant-time signature compare, production env-secret enforcement, and expiry deletion (`apps/web/src/lib/session.ts:16-151`). API admin routes centralize cookie auth plus same-origin, while PAT routes require an allowed token scope and no-store headers (`apps/web/src/lib/api-auth.ts:54-133`). PATs are SHA-256-hashed, scope-checked, expiry-checked, and fail closed if the table is missing (`apps/web/src/lib/admin-tokens.ts:137-171`). No new confirmed issue found.

Semantic embeddings:
- Semantic text search gates same-origin, maintenance, JSON content type, body size, active mode, rate limiting, active model version, and processed-image enrichment (`apps/web/src/app/api/search/semantic/route.ts:98-335`). Similar-image search is production-only and uses the production model version (`apps/web/src/app/api/search/similar/[id]/route.ts:60-237`). Production mode is operator-gated by `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (`apps/web/src/lib/gallery-config.ts:126-145`). No new confirmed issue found.

Service worker:
- The shipped template and generated SW bypass admin routes, cache only derivative images with bounded ETag revalidation, and bypass revocable share HTML pages (`apps/web/public/sw.template.js:176-272`, `apps/web/public/sw.template.js:348-381`, `apps/web/public/sw.js:26-32`). No new confirmed issue found.

Migrations / deploy:
- Migration bootstrap baselines every journal hash and fails if Drizzle silently skips any committed migration (`apps/web/scripts/migrate.js:170-185`, `apps/web/scripts/migrate.js:712-772`). Deploy runs `git pull --ff-only`, builds via compose, then prunes only unused Docker artifacts after the stack is up (`apps/web/deploy.sh:10-61`). No new confirmed issue found.

## Confirmed Issues

### TRC-C7-01 - Tag filter chips derive active state and next URLs from raw query params instead of canonical server tags

Severity: Medium
Confidence: High
Status: Confirmed

Code region:
- `apps/web/src/components/tag-filter.tsx:10-39`
- `apps/web/src/components/tag-filter.tsx:57-117`
- `apps/web/src/app/[locale]/(public)/page.tsx:149-166`
- `apps/web/src/app/[locale]/(public)/page.tsx:221-223`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:166-176`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:214-215`
- `apps/web/src/components/home-client.tsx:241-270`
- `apps/web/src/components/home-client.tsx:438-447`

Why it is a problem:
The server canonicalizes the requested `tags` query by parsing, deduplicating, length-limiting, and filtering to tags that exist in the current gallery/topic (`page.tsx:149-166`, `[topic]/page.tsx:166-176`). That canonical list is passed to `HomeClient` as `currentTags`, and `LoadMore` uses it for query continuity (`home-client.tsx:438-447`). But `TagFilter` ignores that canonical prop and recomputes `currentTags` directly from `useSearchParams().get('tags')` without the same canonicalization or existence filtering (`tag-filter.tsx:13-15`). Its "All" active state, per-chip `aria-pressed`, chip variant, and click handler all use that raw array (`tag-filter.tsx:21-39`, `tag-filter.tsx:57-117`).

Concrete failure scenario:
Visit `/?tags=missing` or `/?tags=landscape,missing`. The server correctly filters with no valid missing tag, so the gallery data, heading, total count, and load-more requests reflect either all photos or only valid tags. The chip bar still sees raw `missing`, so "All" is not active for `/?tags=missing`; for mixed valid+invalid params, clicking a real chip preserves the invalid slug in the next URL because `handleTagClick` appends/removes against the raw array. The UI can show a filtered/unfiltered gallery while the filter controls announce a different state, and malformed query params can persist across subsequent navigation.

Suggested fix:
Make `TagFilter` accept the canonical `currentTags` from `HomeClient`, derive active state from that prop, and build next URLs from the canonical list. When preserving unrelated search params, replace only `tags` with the canonical next list and remove it when empty. Add a focused test for `TagFilter` or a source-level contract test covering `/?tags=missing` and `/?tags=valid,missing` so raw URL state cannot diverge from server-filtered state again.

## Likely Issues

None beyond the confirmed finding above.

## Risks Needing Manual Validation

- Production CLIP readiness: source proves offline load configuration, operator gating, model-version filtering, and production-row checks, but not that the deploy host's `CLIP_MODELS_ROOT` bind mount has the seeded weights or that production embedding row count is non-zero.
- Runtime topology: restore maintenance flags, upload quota reservations, queue state, and some rate-limit buckets are process-local. `CLAUDE.md` and the shipped compose topology describe a single web-instance deployment; horizontal scaling would need shared coordination first.
- Sidecar color backfill overlap: `apps/web/scripts/backfill-color-pipeline.ts:36-43` documents that the sidecar does not take per-image processing locks while its batched update design runs. Keep sidecar use as an operator maintenance action and avoid concurrent manual retry/delete workflows unless separately validated.

## Final Missed-Issues Sweep

Final searches covered advisory lock acquisition/release sites, restore maintenance checks, upload quota claim/settle paths, queue retry/permanent-failure state, delete-mid-processing cleanup, backfill update affectedRows handling, public tag canonicalization, search/semantic route gates, session/token verification, service-worker cache bypasses, migration postconditions, deploy prune safety, and relevant tests. The only current-head confirmed issue found by this tracer lane is TRC-C7-01.

Validation not run: no tests or build were executed because this lane was review-only and changed only the review artifact.
