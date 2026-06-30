# Cycle 32 Tracer Review

Scope: causal tracing only. Product code and other review files were not edited.

## Relevant File Inventory

- Upload/process/delete races: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/process-image.ts`.
- Restore maintenance: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/db-restore.ts`.
- Auth/session/rate-limit paths: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/proxy.ts`.
- Search and semantic state: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/image-queue.ts`.
- Pagination/filter state: `apps/web/src/lib/data.ts`, `apps/web/src/lib/pagination.ts`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/tag-filter.tsx`.
- Feed/OG generation: `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`, `apps/web/src/lib/feed-conditional.ts`, `apps/web/src/lib/atom-feed.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/image-url.ts`.
- Deployment scripts: `package.json`, `apps/web/package.json`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/scripts/entrypoint.sh`, `apps/web/scripts/migrate.js`.

## Findings

### TRC-32-01 - MEDIUM - Atom feed 304 freshness ignores feed-shaping SEO settings

- Location: `apps/web/src/app/feed.xml/route.ts:29-44`, `apps/web/src/app/feed.xml/route.ts:46-141`, `apps/web/src/app/feed.xml/route.ts:160-182`; `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:50-72`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:74-153`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:165-186`.
- Related state: `apps/web/src/lib/data.ts:856-874`, `apps/web/src/lib/data.ts:1749-1769`, `apps/web/src/app/actions/seo.ts:54-61`, `apps/web/src/app/actions/seo.ts:136-157`, `apps/web/src/db/schema.ts:137-140`.
- Severity: Medium.
- Confidence: High.

Causal chain:

1. Both feed routes answer conditional requests from `getFeedUpdatedAt()` before they load the SEO/config state used to compose the feed body. The root route can return 304 at `feed.xml/route.ts:29-44`; the topic route can return 304 at `[topic]/feed.xml/route.ts:50-72`.
2. `getFeedUpdatedAt()` only consults processed image rows and orders by `images.updated_at`, `images.created_at`, and `images.id` (`data.ts:856-874`).
3. The XML body also depends on SEO settings: root `feedTitle`, author, rights fallback, self URL, alternate URL, and entry author fallback are composed after the early 304 branch (`feed.xml/route.ts:46-141`); the topic feed does the same (`[topic]/feed.xml/route.ts:74-153`).
4. Admins can change those SEO fields through `updateSeoSettings()`, which writes `admin_settings` and revalidates app data (`seo.ts:54-61`, `seo.ts:136-157`), but `admin_settings` has only `key` and `value` columns and no timestamp/revision usable by feed conditionals (`schema.ts:137-140`).
5. A reader that previously cached the feed with `Last-Modified` equal to the newest image update can send `If-Modified-Since`; the feed route compares that timestamp only to image freshness and returns 304, even though the feed title/author/rights/body would now be different.

Failure scenario:

- The site owner changes SEO title, author, locale, or OG-related copy from the admin UI after the latest published image remains unchanged. RSS readers such as Feedly/Miniflux/FreshRSS poll with `If-Modified-Since` from the last photo update. The route returns 304 and the reader keeps stale feed-level metadata indefinitely until an image row is uploaded or edited. This is visible public output, and it bypasses the intended `revalidateAllAppData()` invalidation because the route handler's HTTP conditional path is independent of the Next cache tree.

Suggested fix:

- Give feed-shaping settings a freshness source and include it in the feed validator. Options: add `updated_at` to `admin_settings`, add a dedicated feed/settings revision row, or compute a monotonic feed revision during `updateSeoSettings()`. Then set `Last-Modified` and both 304 comparisons to the max of image freshness and relevant feed settings freshness. Add route tests that change `seo_title` or `seo_author`, send a matching `If-Modified-Since`, and assert the route returns 200 with the new XML.

## Traced But No New Finding

- Upload/process/delete races: upload actions acquire the upload-processing contract lock before config-sensitive ingest (`images.ts:175-180`), do a late restore maintenance cleanup before DB insert (`images.ts:404-416`), delete queue bookkeeping before row removal (`images.ts:680-698`), and queue processing conditionally updates `processed=false` rows before cleaning derivatives on delete-mid-processing (`image-queue.ts:677-699`).
- Restore maintenance: restore holds the DB restore lock, upload-processing lock, color backfill lock, and semantic backfill lock before entering durable maintenance (`db-actions.ts:390-490`), then quiesces queue side effects and resumes/bootstrap after verified restore (`db-actions.ts:492-519`, `image-queue.ts:1060-1113`).
- Auth/session/rate-limit: mutating auth actions perform same-origin checks before credential work, pre-increment rate limits before password verification, roll back only on expected auth failures, and rely on HMAC-backed session verification for privileged routes.
- Search/semantic state: public search and semantic routes rate-limit before expensive work, bound query sizes and embedding scans, and keep stub/production embedding provenance separated.
- Pagination/filter state: cursor state, tag URL mutation, and load-more query reset paths were traced without finding a stale-cursor scenario that survives the current query-key reset.
- OG generation: the suspected photo-OG origin mismatch was rejected because `BASE_URL` falls back to `site-config.json`; generated OG routes validate/rate-limit before render and use bounded photo fetches.
- Deployment scripts: deploy still follows pull, compose up, health gate, then prune. No causal script issue met the finding bar in this pass.

## Final Sweep

Final sweep rechecked the feed conditional helpers, both feed routes, SEO persistence, settings schema, upload/restore interlocks, queue delete cleanup, semantic endpoints, client pagination state, OG routes, and deploy scripts. I found one medium-confidence-to-high-confidence feed freshness defect and no critical or high-severity causal break in the other traced flows.
