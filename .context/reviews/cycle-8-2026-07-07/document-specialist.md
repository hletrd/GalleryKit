# Cycle 8 — Document Specialist Review (docs vs code)

**Scope:** Documentation-vs-code consistency audit of GalleryKit at HEAD `6256a988` (apps/web).
**Method:** Built an inventory of doc surfaces (root `CLAUDE.md`, `apps/web/README.md`,
`apps/web/.env.local.example`, `apps/web/src/site-config.example.json`,
`apps/web/nginx/default.conf`), then cross-checked each concrete, testable claim in
`CLAUDE.md` against the corresponding source. Read-only; no files modified besides this one.

## Findings

### DOC8-01 — Migrations 0028/0029 (rate_limit_buckets index, feed-ordering indexes) undocumented

- **Severity:** LOW-MED **Confidence:** High
- **Doc location:** `CLAUDE.md` → "Database Schema (Key Tables)" (enumerates `images`,
  `topics`, `tags`/`imageTags`, `adminUsers`/`sessions`, `sharedGroups`/`sharedGroupImages`,
  `image_views`/`topic_views`/`shared_group_views`, `image_embeddings`, `admin_tokens`,
  `smart_collections` — no `rate_limit_buckets`) and → "Database Indexes" (enumerates indexes
  through migration `0027`, nothing for `0028`/`0029`).
- **Code location:** `apps/web/drizzle/0028_rate_limit_bucket_start_idx.sql` (adds
  `idx_rate_limit_buckets_bucket_start` on `rate_limit_buckets.bucket_start`),
  `apps/web/drizzle/0029_feed_updated_indexes.sql` (adds `idx_images_processed_updated_at`
  on `images(processed, updated_at, created_at, id)` and `idx_images_topic_updated_at` on
  `images(topic, processed, updated_at, created_at, id)`);
  `apps/web/src/db/schema.ts:222` (`rateLimitBuckets` table definition);
  `apps/web/src/app/feed.xml/route.ts` and
  `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts` (the Atom feed queries that
  these two `images` indexes exist to serve — `getImagesForFeed` orders by `updated_at DESC`,
  a different sort key than the masonry listing's `capture_date` indexes already documented).
- **Why it misleads:** `CLAUDE.md`'s "Database Indexes" section is the repo's own authoritative
  index inventory (used elsewhere in this file to reason about query plans and to gate the
  "Adding a new migration" checklist). A maintainer reasoning about the `images` table's index
  footprint, or extending the checklist for a future migration, would not learn that a second,
  `updated_at`-ordered composite index pair now exists specifically for the Atom-feed sort order
  — distinct from and additional to the `capture_date`-ordered indexes already listed. Likewise,
  `rate_limit_buckets` (the DB-backed rate-limit table referenced in prose under "Login rate
  limiting enforced in two buckets…") is never listed as a schema table, so its index is
  invisible to anyone consulting the Database Schema section.
- **Suggested fix:** Add `rate_limit_buckets` to "Database Schema (Key Tables)" and add both
  new indexes to "Database Indexes" with a short note that they serve the Atom feed's
  `updated_at`-ordered listing (`getImagesForFeed`), distinct from the masonry/gallery
  `capture_date` sort.

### DOC8-02 — Restore-window logout session-revocation queue (C7-01) undocumented in Security Architecture / Race Condition Protections

- **Severity:** MED **Confidence:** High
- **Doc location:** `CLAUDE.md` → "Authentication & Sessions" ("Expired sessions purged
  automatically by the independent hourly maintenance scheduler") and → "Race Condition
  Protections" → "Restore-window admin-mutation fence" bullet. Neither mentions that a
  **logout** occurring during a restore/mutation-barrier window is handled specially.
- **Code location:** `apps/web/src/lib/pending-session-revocations.ts` (new module, commit
  `c882e82d`), `apps/web/src/app/actions/auth.ts` (`logout()` now calls
  `enqueuePendingSessionRevocation(hashSessionToken(token))` when the DB-side delete was
  skipped because a restore/mutation-barrier window is active),
  `apps/web/src/lib/maintenance-scheduler.ts` (the hourly sweep now also runs
  `flushPendingSessionRevocations` as a backstop), and
  `apps/web/src/app/[locale]/admin/db-actions.ts` (the restore flow flushes the queue
  immediately after `endDurableRestoreMaintenance()`, i.e. after the DB import has replaced
  the `sessions` table).
- **Why it misleads:** This is a genuine, previously-a-bug security behavior: before this fix, a
  logout during a restore window cleared the cookie and looked like a successful logout while
  silently leaving the session **verifiable server-side for up to its remaining TTL**. The fix
  queues the revocation (a bounded, process-local, deduplicated set — capped at 256 entries per
  the test fixture) and guarantees it is flushed either right after the restore window closes or
  by the next hourly maintenance sweep. The module itself documents an accepted residual risk
  (a process crash between the skipped delete and the flush loses the pending revocation). None
  of this — the queuing behavior, the flush triggers, or the accepted residual risk — is
  reflected in `CLAUDE.md`, even though the file otherwise documents restore-window mutation
  fencing in comparable detail (e.g., the admin-mutation-barrier bullet immediately above where
  this would belong). Someone auditing session-security posture or writing an incident runbook
  from `CLAUDE.md` alone would not learn that logout-during-restore has this queued-revocation
  behavior or its residual crash-loss caveat.
- **Suggested fix:** Add a bullet under "Race Condition Protections" (near the existing
  "Restore-window admin-mutation fence" entry) or under "Authentication & Sessions" describing:
  logout during a restore/mutation-barrier window queues the session revocation instead of
  dropping it; the queue flushes immediately after the restore's durable maintenance marker
  clears and again on the hourly maintenance sweep as backstop; residual risk is a lost
  revocation only on a process crash between the skip and the flush (bounded by the cookie
  already being cleared client-side and the normal session TTL).

### DOC8-03 — `site-config.json` supports an undocumented `copyright` field (Atom `<rights>`)

- **Severity:** LOW **Confidence:** Medium-High
- **Doc location:** `CLAUDE.md` → "Deployment Checklist" step 3, which enumerates the
  `site-config.json` keys and states "the key names below are exactly what you must write":
  `title`, `description`, `url`, `locale`, `author`, `nav_title`, `home_link`, `footer_text`,
  `google_analytics_id` — 9 keys. `apps/web/src/site-config.example.json` mirrors exactly these
  9 keys, no more.
- **Code location:** `apps/web/src/app/feed.xml/route.ts` (~line 127-131): reads
  `(siteConfig as unknown as { copyright?: unknown }).copyright`, trims it, and uses it verbatim
  as the Atom feed's `<rights>` element when present, falling back to `© {year} {author}`
  otherwise. `apps/web/src/lib/atom-feed.ts:79` documents `feedRights` as an "Optional
  copyright / rights statement (RFC 4287 §4.2.10)".
- **Why it misleads:** `CLAUDE.md` explicitly frames its key list as exhaustive ("exactly what
  you must write"), so an operator who wants to set a custom copyright/rights notice in their
  syndication feed (e.g., "All rights reserved" or a Creative Commons line) has no documented way
  to discover that adding a `copyright` string to `site-config.json` is supported and honored.
  It's a real, working, low-risk feature that is simply invisible outside the source.
- **Suggested fix:** Add `copyright` (optional) to the `CLAUDE.md` site-config key list and to
  `site-config.example.json` (commented out or with a placeholder), noting it feeds the Atom
  feed's `<rights>` element and defaults to `© {year} {author}` when absent.

## Areas checked and found consistent (no finding — listed for coverage confidence)

The following concrete, numeric/behavioral claims in `CLAUDE.md` were verified against source
and found accurate, so they are **not** repeated as findings:

- `QUEUE_CONCURRENCY` pool-budget clamp formula and effective value of 2 at pool=10
  (`apps/web/src/lib/image-queue.ts` `resolveImageQueueConcurrency` / `IMAGE_QUEUE_RESERVED_LIVE_CONNECTIONS`).
- `SHARP_CONCURRENCY` default formula `max(1, floor((cpuCount-1)/3))` and the explicit-value cap
  at `cpuCount-1` (`apps/web/src/lib/process-image.ts`).
- `IMAGE_PIPELINE_VERSION = 7` (`gallery-config-shared.ts`).
- `NEXT_UPLOAD_BODY_MAX_BYTES` default `278921216` = `max(200 MiB, 250 MiB) + 16 MiB`
  (`apps/web/src/lib/upload-limits.ts`).
- `IMAGE_MAX_INPUT_PIXELS` default `268435456` and `IMAGE_MAX_INPUT_PIXELS_TOPIC` default
  `67108864` (`process-image.ts`).
- `COLOR_IMPACTING_KEYS` count of 9 (5 color + 3 quality + 1 size) — exact array match in
  `gallery-config-shared.ts` `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS`.
- Settings-hash `HASH_LENGTH = 8` with no separate `.slice(0,8)` at the `serve-upload.ts` ETag
  site — confirmed single source of truth.
- All 7 advisory lock name constants (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`,
  `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`,
  `gallerykit_semantic_embedding_backfill`, `gallerykit:image-processing:{jobId}`, and the
  DB-scoped `gallerykit_web_singleton_<sha256(DB_NAME) 16-hex>` exception) — all match
  `apps/web/src/lib/advisory-locks.ts` exactly, including the DB-scoping exception carve-out.
- Nginx body-size caps: default 2 MiB, login 64 KiB, `/admin/db` 250 MiB, `/admin/dashboard`
  216 MiB, `/api/admin/lr/upload` 216 MiB, and the longest-prefix-match precedence claim — all
  match `apps/web/nginx/default.conf` verbatim, including the `zone=public`/`zone=nextimage`
  limiter configuration and the "deploys do not touch host nginx" operational claim.
- Migration journal: 30 entries, confirmed genuinely non-monotonic `when` timestamps (matches
  the "Migration & Schema-Drift Runbook" narrative).
- Admin tunables defaults table (`image_quality_webp=90`, `avif=85`, `jpeg=90`, `avif_effort=6`
  vs Sharp native default 4, `force_srgb_derivatives=false`, `allow_hdr_ingest=false`,
  `force_show_color_chips=false`, `wide_gamut_jpeg_chroma=4:4:4`, `sdr_jpeg_chroma=4:2:0`,
  `wide_gamut_max_source_pixels=50000000`) — exact match in `gallery-config-shared.ts` `DEFAULTS`/`VALIDATORS`.
- "Gated, not shipped" claims: HDR AVIF encoder (WI-09, `hdr-filenames.ts` reserved/unwired),
  storage backend (`src/lib/storage` local-only, not wired into upload/serve paths), smart
  collections admin UI (server actions exist, no admin nav entry or UI found), semantic search
  code default `disabled` with the `SEMANTIC_SEARCH_ALLOW_PRODUCTION` healing-to-disabled gate —
  all confirmed accurate.
- Single-writer boot guard: 60s keepalive interval, unref'd 60s re-acquire loop, ~25s
  (`REPROBE_DELAY_MS = 25_000`) single re-probe before a persistent-holder LOUD error, DB-scoped
  lock name via `sha256(dbName).slice(0,16)` — all match `single-writer-guard.ts` /
  `advisory-locks.ts` exactly.
- `RESTORE_MAINTENANCE_DIR` default (`/app/data` prod / `data` dev), `ADMIN_BACKFILL_CONCURRENCY`
  formula and effective cap of 2 at pool=10, `IMAGE_CLEANUP_CONCURRENCY` default 5 — all confirmed.
- OG route Cache-Control headers (`s-maxage=86400` / `stale-while-revalidate=86400` only on the
  OG image routes, not the general derivative-serving 3600 policy) — confirmed in both
  `api/og/route.tsx` and `api/og/photo/[id]/route.tsx`.
- `apps/web/README.md` and `.env.local.example`: cross-checked the semantic-search section
  (model id `jinaai/jina-clip-v2`, threshold values `COSINE_THRESHOLD=0.18` /
  `PRODUCTION_COSINE_THRESHOLD=0.22`), the LR upload token-scope contract (`lr:upload`), and all
  env-var defaults against source — all accurate and consistent with `CLAUDE.md`.
- Lint gate scripts (`lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`,
  `typecheck` = `typecheck:app` + `typecheck:scripts`) all exist in `package.json` exactly as
  named in `CLAUDE.md`'s "Lint Gates" and "Testing" sections.

## Not re-flagged (already tracked as known-deferred)

Per `.context/plans/deferred-carry-forward.md`, the CLIP/backfill runbook refresh items
(C96-15/16/17) and the `.omc/wiki` CLIP-drift item (C6-25) are already open deferred rows —
skimmed but not re-investigated in depth to avoid duplicating existing tracking.

---

**Summary: 3 findings — 0 CRIT, 0 HIGH, 1 MED, 2 LOW-MED/LOW.**
