# Cycle 96 Tracer Review

Review lane: tracer / causal-flow review. Repository: `/tmp/gallery-recovery-check` at `2f22620c361304ba0408053f546f45e3c74ddfdb`. Review-only: no source edits.

## Scope and Inventory

- Restore and maintenance flows: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance*.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`.
- Foreground admin writes: settings, tags, topics, sharing, images, SEO, collections, users, tokens, and embeddings server actions.
- Public read/cache flows: `/feed.xml`, topic feeds, sitemap, public pages, public search, and OG/search API routes.
- Async/background jobs: image queue, CLIP backfill, color pipeline backfill, admin backfill runner, shared-group view counters.
- Deploy/migration flows: Drizzle migrations, `migrate.js`, Docker/NGINX/deploy scripts, release ledgers.

`omx explore` was attempted first but failed in this sandbox with an in-process app-server permission error, so source inspection was used.

## Confirmed Findings

### TRC-96-01 - Restore maintenance does not fence already-in-flight foreground admin mutations

- Severity/confidence: High / High.
- Evidence: restore enters durable maintenance and drains background work in `apps/web/src/app/[locale]/admin/db-actions.ts:365-452` and runs import work at `db-actions.ts:492-503`. Representative foreground writes check maintenance at entry and write later: `apps/web/src/app/actions/settings.ts:41-48` and `settings.ts:163-175`; `apps/web/src/app/actions/tags.ts:42-98`; `apps/web/src/app/actions/sharing.ts:91-156`; `apps/web/src/app/actions/topics.ts:85-154`.
- Failure scenario: a foreground admin write passes the maintenance precheck, restore begins, and the write commits into restored tables during or after import.
- Suggested fix: add a shared admin-write barrier/lease used by foreground table mutations and acquired exclusively by restore before import, with a post-barrier maintenance recheck and race tests.

### TRC-96-02 - Atom feeds bypass restore-maintenance behavior and can cache partial restore data

- Severity/confidence: Medium / High.
- Evidence: feed handlers build cacheable XML from DB rows in `apps/web/src/app/feed.xml/route.ts:36-81` and `apps/web/src/app/[topic]/feed.xml/route.ts:36-90`, with `CACHE_CONTROL = 'public, max-age=600, s-maxage=1800'`. Public page paths have restore-aware handling elsewhere, but the feed routes do not check restore state.
- Failure scenario: a crawler hits a feed while restore is importing rows; the handler publishes a partial feed and caches it at browser/CDN layers for up to 30 minutes.
- Suggested fix: gate feed routes on restore maintenance, returning a no-store `503` or a deliberately empty no-store maintenance response until restore completes.

### TRC-96-03 - LR token list masks DB/table errors as an empty state

- Severity/confidence: Medium / High.
- Evidence: `apps/web/src/lib/admin-tokens.ts:178-190` catches list failures and returns `[]`; `apps/web/src/app/actions/lr-tokens.ts:131-140` returns the array; `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:146-163` shows the empty state when no error is returned.
- Failure scenario: a missing table or DB outage is displayed as "No tokens yet", leading admins to trust false token state.
- Suggested fix: surface list failures through the action error path and keep the empty state only for successful zero-result responses.

### TRC-96-04 - `image_embeddings` single-row identity blocks staged CLIP rollback/cutover

- Severity/confidence: Medium / High.
- Evidence: schema primary key is `image_id` only in `apps/web/src/db/schema.ts:284-299` and `apps/web/drizzle/0012_image_embeddings.sql:5-12`; upserts overwrite the row in `apps/web/src/lib/image-queue.ts:352-390`; search routes filter by active model in `apps/web/src/app/api/search/semantic/route.ts:263-289` and `apps/web/src/app/api/search/similar/[id]/route.ts:132-179`.
- Failure scenario: a model upgrade overwrites old embeddings before the new model is fully validated, so rollback produces empty or incomplete results.
- Suggested fix: migrate identity to `(image_id, model_version)`, update queries/backfills, and garbage-collect old rows only after cutover.

### TRC-96-05 - Initial public listing exact counts still force grouped window scans

- Severity/confidence: Medium / High.
- Evidence: listing queries use `COUNT(*) OVER()` across grouped tag joins in `apps/web/src/lib/data.ts:898-927` and smart collection initial paths in `data.ts:1495-1510`; UI consumes that count in `apps/web/src/components/home-client.tsx:267-269`.
- Failure scenario: large tag-heavy galleries pay a full grouped count before the first page can render.
- Suggested fix: use `limit + 1` for `hasMore` and move exact counts to a separate cached or explicit request.

### TRC-96-06 - LR token label `maxLength` conflicts with server code-point validation

- Severity/confidence: Low / High.
- Evidence: server validation counts code points in `apps/web/src/app/actions/lr-tokens.ts:60-69`; tests accept 128 emoji in `apps/web/src/__tests__/lr-tokens-action.test.ts:136-143`; browser input uses `maxLength={128}` at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:209-223`.
- Failure scenario: a valid 128-emoji label is blocked/truncated by the browser before it reaches the server.
- Suggested fix: remove or raise the HTML code-unit cap and validate by code points in React/server.

## Likely / Manual-Validation Risks

- Sidecar color backfill queues all candidates before draining: `apps/web/scripts/backfill-color-pipeline.ts:383-400` and `apps/web/scripts/backfill-color-pipeline.ts:525-562`.
- Sitemap restore behavior may cache a homepage-only fallback during restore; validate crawler/cache behavior before changing.

## Final Sweep

Checked restore races, public cache/read routes, async queues/backfills, embedding rollover, listing query shape, token admin state, and release evidence. Full browser, MySQL restore drills, and production cache behavior were not executed in this review-only lane.
