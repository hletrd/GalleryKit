# document-specialist review — cycle 6

Start/baseline HEAD: `583277fb` (`docs(plan): schedule cycle 10 fixes` — planning-only commit,
no runtime/doc content changed by it). Prior document-specialist baseline: cycle 5 (`d9bcbf4c`),
which did a broad sweep and confirmed ~25 CLAUDE.md claims accurate. This review re-verifies the
team-lead's specific ask list (`IMAGE_PIPELINE_VERSION`, `COLOR_IMPACTING_KEYS` count, env-var
defaults, advisory-lock name list, migration count/journal, nginx body-size caps, index list)
against current committed HEAD, checks whether two previously-flagged doc issues (`AGG-C10-19`,
`AGG-C10-20`) and one previously-flagged staleness item (`DOC5-01`) are still open, and hunts for
NEW drift introduced by the 26 commits landed since cycle 5's baseline (`d9bcbf4c..583277fb`).

## Summary

- 2 genuinely NEW findings this cycle, both MED/High: the `Database Indexes` section in
  `CLAUDE.md` is missing the two composite indexes migration `0029` added for feed/sitemap
  "updated_at" ordering (F1), and the failed-image-retry / permanent-failure subsystem
  (`MAX_RETRIES`, `permanentlyFailedIds`, `processing_error`/`failed_at` columns, admin Retry
  button) is entirely undocumented in `CLAUDE.md` despite being a substantial, tested feature (F2).
- 1 new LOW finding: three env-var path overrides (`UPLOAD_ROOT`, `TOPIC_RESOURCES_ROOT`,
  `TOPIC_RESOURCES_TMP_ROOT`) mirror the documented `UPLOAD_ORIGINAL_ROOT` pattern but aren't in
  the CLAUDE.md env-var table (F3).
- 3 previously-known items (`AGG-C10-19`, `AGG-C10-20`, `DOC5-01`) confirmed **still open** at
  this HEAD — the commit that touched planning files for "cycle 10" only scheduled/deferred them,
  it did not fix them. No new evidence beyond reconfirmation, so kept brief.
- Broad-sweep re-verification of the team-lead's specific ask list: `IMAGE_PIPELINE_VERSION = 7`,
  `COLOR_IMPACTING_KEYS` = 9, DB pool (10/20)/backfill-concurrency formula (cap 2), advisory-lock
  name list, nginx body-size caps, and migration journal count/monotonicity **all still match
  code exactly** — no drift found on any of those specific asks beyond the index-list gap in F1.

## Findings

### F1 — `CLAUDE.md` "Database Indexes" section omits the two indexes migration `0029` added for feed/sitemap ordering [SEV: MED | CONF: High | `CLAUDE.md` "Database Indexes" section; `apps/web/drizzle/0029_feed_updated_indexes.sql`; `apps/web/src/db/schema.ts:120,122` (committed HEAD)]

- **Doc:** The `## Database Indexes` section lists the `images` table's composite indexes
  exhaustively as: `(processed, capture_date, created_at)`, `(processed, created_at)`,
  `(topic, processed, capture_date, created_at)`, `(user_filename)`, `(uploaded_by)`, plus the
  `image_tags`/`image_views`/`topic_views`/`shared_group_views` indexes with their migration
  numbers annotated (0010, 0021, 0026, 0027).
- **Code:** `git show HEAD:apps/web/src/db/schema.ts` has two MORE composite indexes on `images`
  that the doc section never mentions:
  - `idx_images_processed_updated_at` on `(processed, updated_at, created_at, id)` (line 120)
  - `idx_images_topic_updated_at` on `(topic, processed, updated_at, created_at, id)` (line 122)

  Both were added by `apps/web/drizzle/0029_feed_updated_indexes.sql` (confirmed via
  `CREATE INDEX idx_images_processed_updated_at ON images (processed, updated_at, created_at, id);`
  / `CREATE INDEX idx_images_topic_updated_at ON images (topic, processed, updated_at, created_at, id);`),
  which landed after cycle 5's baseline (commit `f2a8c530 fix(migration): split feed index
  statements`, per the plans README: "feed/sitemap updated-order indexes (`0029` split for
  Drizzle)"). They exist specifically to support the `updated_at`-ordered queries in
  `apps/web/src/app/feed.xml/route.ts` (site Atom feed, "prefer updated_at over created_at so
  admin edits... advance the entry's `<updated>` instant") and `apps/web/src/app/sitemap.ts`
  (`lastModified: image.updated_at ?? image.created_at`), both of which ARE documented elsewhere
  in CLAUDE.md/README, just not cross-referenced from the index list.
- **Why it's a problem:** the "Database Indexes" section is written as the canonical inventory an
  agent or DBA would consult before adding a new query pattern or reasoning about whether an
  existing query is index-backed. A reader trusting this list would wrongly conclude that
  `updated_at`-ordered scans on `images` (feed/sitemap) are NOT index-backed and might propose
  adding a duplicate/conflicting index, or would miss these two indexes entirely when reasoning
  about write-amplification from the composite-index count on the hot `images` table.
- **Failure scenario:** a future contributor doing a schema/index audit reads only the CLAUDE.md
  list (as the recent `apps/web/scripts/migrate.js` "Adding a new migration" checklist instructs:
  update `reconcileLegacySchema` + `schema.ts`, but nothing tells them to also update this doc
  list), concludes the feed/sitemap `updated_at` sort is unindexed, and either adds a THIRD
  redundant index or spends time "fixing" a perf problem that migration 0029 already solved.
- **Suggested fix:** add two bullets to the `## Database Indexes` section, e.g.:
  `` `(processed, updated_at, created_at, id)` and `(topic, processed, updated_at, created_at, id)` — feed/sitemap `updated_at`-ordered listings (migration 0029) ``.
- **Confidence:** High — directly diffed the documented list against the committed schema and the
  migration SQL file; confirmed the supporting query sites exist and are live.

### F2 — Failed-image retry / permanent-failure subsystem is completely undocumented in `CLAUDE.md` [SEV: MED | CONF: High | `apps/web/src/lib/image-queue.ts` (committed HEAD, lines ~104-111, 317-325, 703-736, 868-1030); `apps/web/src/db/schema.ts:107-108,111`; `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`]

- **Code:** `git show HEAD:apps/web/src/lib/image-queue.ts` implements a full retry/permanent-failure
  architecture: `MAX_RETRIES = 3` with exponential backoff (line 713, 969-982), a bounded
  `permanentlyFailedIds: Set<number>` with `MAX_PERMANENTLY_FAILED_IDS` FIFO eviction (lines 111,
  325, 993-1005) so a permanently-failed job is skipped on future bootstrap scans instead of
  retried forever (`state.permanentlyFailedIds.has(job.id)` guard at line 703), and persistence of
  `processing_error` (truncated) + `failed_at` to the `images` row on final failure (line 1030),
  cleared on a later successful retry (line 870: `processing_error: null, failed_at: null,
  processing_settings_json: null`). `apps/web/src/db/schema.ts:107-108,111` (committed HEAD)
  confirms these are real columns: `processing_error varchar(512)`, `failed_at datetime`,
  `processing_settings_json text`. The admin dashboard
  (`apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`) has a dedicated
  UI: it imports `retryFailedImage` from `@/app/actions/images`, renders the `processing_error`
  string per failed row, and offers a `Retry` button (`handleRetry` → `retryFailedImage(id)`) with
  `dashboard.retrySuccess`/`retryFailed`/`retrying`/`retryImageAria` i18n strings.
- **Doc:** `CLAUDE.md` never describes this. `grep -n "processing_error\|permanent\|MAX_RETRIES\|permanentlyFailedIds" CLAUDE.md`
  returns only one indirect mention, in the color-pipeline backfill section: "Individual failed-image
  retries use the per-image processing claim rather than the global backfill lock" — a passing
  reference that assumes the reader already knows the feature exists. Neither the `## Image
  Processing Pipeline` section, the `## Race Condition Protections` section, nor the `##
  Database Schema (Key Tables)` `images` column notes mention `processing_error`, `failed_at`,
  `processing_settings_json`, the retry/backoff policy, the permanently-failed-ID tracking, or the
  admin dashboard Retry control at all.
- **Why it's a problem:** this is not a minor internal detail — it's an operator-facing admin
  feature (a visible Retry button + error message in the dashboard) and a correctness-relevant
  queue behavior (a job that fails 3 times is silently excluded from all future automatic
  retries). An operator debugging "why does this one photo never finish processing" has no
  documented starting point; a future contributor changing `MAX_RETRIES`, the backoff schedule, or
  the `MAX_PERMANENTLY_FAILED_IDS` cap has no canonical description of the current contract to
  compare against (unlike, e.g., the color-pipeline backfill, which gets a full paragraph).
- **Failure scenario:** an operator sees a stuck/never-processed photo, greps CLAUDE.md for
  "retry" or "failed", finds only the one oblique color-backfill sentence, and either files it as
  a bug or manually pokes the DB (`UPDATE images SET processed=false...`) without realizing the
  row already carries a `processing_error` explaining the root cause and a dashboard button that
  does this safely (clears `processing_error`/`failed_at` and re-claims the row under the
  per-image lock).
- **Suggested fix:** add a short subsection (e.g. under `## Image Processing Pipeline` or as a new
  `### Failed-image retry` subsection) documenting: `MAX_RETRIES = 3` with backoff, the
  `permanentlyFailedIds` bounded in-memory tracking (and that it resets on process restart, so a
  restart gives permanently-failed images another `MAX_RETRIES` budget — worth confirming/stating
  explicitly), the `processing_error`/`failed_at`/`processing_settings_json` columns, and the
  admin dashboard Retry action (`retryFailedImage` in `app/actions/images.ts`).
- **Confidence:** High — read the committed queue logic, schema columns, and admin UI directly;
  confirmed dedicated test files exist (`apps/web/src/__tests__/failed-image-retry.test.ts`,
  `image-queue-permanent-failure.test.ts` — both present in the repo, though currently
  uncommitted-modified in the shared working tree by a change unrelated to this doc gap).

### F3 — Three `UPLOAD_ORIGINAL_ROOT`-pattern env-var overrides are undocumented [SEV: LOW | CONF: Medium | `apps/web/src/lib/upload-paths.ts:13-14`; `apps/web/src/lib/process-topic-image.ts:11-31`; `CLAUDE.md` "Optional Operational Variables" table]

- **Code:** `apps/web/src/lib/upload-paths.ts:13-14` derives `UPLOAD_ROOT` from
  `process.env.UPLOAD_ROOT?.trim()` (falling back to a cwd-derived path), exactly parallel to the
  `UPLOAD_ORIGINAL_ROOT` override two lines below it (line 29) which IS documented. Similarly,
  `apps/web/src/lib/process-topic-image.ts:11-26` and `:29-39` derive `RESOURCES_ROOT` /
  `TOPIC_TMP_ROOT` from `TOPIC_RESOURCES_ROOT` / `TOPIC_RESOURCES_TMP_ROOT` env vars, with a code
  comment explicitly stating "Mirrors the `UPLOAD_ROOT` / `UPLOAD_ORIGINAL_ROOT` override pattern
  in `lib/upload-paths.ts`." for tests/sandboxed runs.
- **Doc:** `CLAUDE.md`'s "Optional Operational Variables" table documents `UPLOAD_ORIGINAL_ROOT`
  but has no row for `UPLOAD_ROOT`, `TOPIC_RESOURCES_ROOT`, or `TOPIC_RESOURCES_TMP_ROOT`.
- **Why it's a (minor) problem:** lower severity than F1/F2 because the code comments frame these
  as primarily test/sandbox conveniences ("so tests... can redirect... Production leaves this
  unset"), not documented production knobs — so the omission is more a parity/completeness gap
  than an operator-facing miss. Still, `UPLOAD_ROOT`'s own doc comment ("Root directory for all
  uploaded files. Derived from `UPLOAD_ROOT` env var or cwd.") doesn't carry the same test-only
  framing as the topic-resources pair, so an operator scanning source for override hooks (e.g. to
  relocate public derivatives without a bind-mount-path change) would find it works but isn't
  mentioned in the authoritative env table.
- **Suggested fix:** either add three rows to the operational-variables table (lowest-effort:
  one combined row noting the "test/sandbox path override" pattern for all of
  `UPLOAD_ROOT`/`TOPIC_RESOURCES_ROOT`/`TOPIC_RESOURCES_TMP_ROOT`, distinct from the
  operator-facing `UPLOAD_ORIGINAL_ROOT` row), or add a one-line comment to the CLAUDE.md
  `UPLOAD_ORIGINAL_ROOT` row cross-referencing the sibling test-only overrides so a reader
  doesn't assume it's the only one.
- **Confidence:** Medium — the code and doc gap are both directly confirmed; severity/urgency is
  soft-capped because the code frames these as test-infra conveniences, not a production
  correctness gap.

## Previously known — reconfirmed still open (no new fix landed for these at this HEAD)

- **`AGG-C10-19`** (from `.context/reviews/_aggregate.md`) — `.omc/wiki/schema-derived-list-drift-migration-reconcile-lesson.md`
  "Lesson 1" (lines ~19-27) still describes the OLD pre-`FDR-01` migration behavior ("This repo
  does **not** apply a new `.sql` migration through drizzle's migrator on an already-provisioned
  DB... it idempotently CREATE/ALTER/DROPs... then baselines the new migration's hash as
  'applied' — without ever executing the .sql file's statements") as if still current. Verified
  against the committed `apps/web/scripts/migrate.js`: `FDR-01` (comment at line 889) and the
  `C3-01` mixed-case follow-up (line 919) are present and implement exactly the pending-vs-drift
  split CLAUDE.md's own "Migration & Schema-Drift Runbook" section describes — i.e. the code has
  moved on from the behavior the wiki lesson describes, but the wiki page wasn't updated. The
  last commit at this HEAD (`583277fb docs(plan): schedule cycle 10 fixes`) only touched
  `.context/plans/*`, not the wiki file, so this remains open. No new evidence beyond
  reconfirmation.
- **`AGG-C10-20`** — `.omc/wiki/clip-semantic-search-us-p51.md:15` still titles the page
  `# CLIP Semantic Search (US-P51) — LIVE in production`, and
  `.omc/wiki/gallerykit-architecture-overview.md:33` still states "Semantic search (CLIP,
  US-P51): in-process jina-clip-v2 encoder — LIVE in production." Both confirmed unchanged at
  this HEAD. By contrast, I re-checked `README.md` and `apps/web/README.md`'s CLIP sections
  (originally cited alongside the wiki pages in `AGG-C10-20`) and found them properly hedged —
  "Disabled by default; production mode is not enabled from the Settings UI", "A production
  deployment may enable it after the runbook checks; fresh installs do not" — so the overclaim is
  isolated to the two wiki pages, not the primary docs. No new evidence beyond reconfirmation.
- **`DOC5-01`** (from cycle 5) — `AGENTS.md:37` still reads `` `npm test --workspace=apps/web` —
  Vitest 2000+ unit tests... ``. Actual count at this HEAD: `npm test --workspace=apps/web`
  reports `Test Files 342 passed | 2 skipped (345)` / `Tests 3168 passed | 4 skipped (3174)` (plus
  2 currently-failing tests from an in-progress peer edit to `photo-title.ts`, see caveat below —
  the passing count alone is already ~3168, well past "2000+"). The gap has widened since cycle 5
  measured it (was 3113, now 3168+ passed) — the sibling `apps/web/README.md` copy was fixed in
  cycle 4 (`C4-40`) but `AGENTS.md`'s copy still was not, exactly as flagged in cycle 5. No new
  evidence beyond reconfirmation + updated measurement.

## Caveat on test-run baseline (not a doc finding, noted for context)

`npm test --workspace=apps/web` currently reports 2 failing tests in
`apps/web/src/__tests__/photo-title.test.ts` (`getPhotoResultLabel`). `apps/web/src/lib/photo-title.ts`
is on the briefing's peer-dirty list (a second session's uncommitted in-progress edit), and the
test file itself is not literally named in that list but is clearly downstream of the same
in-progress edit. Per the shared-worktree instructions I did not investigate or propose a fix
here — flagging only so the aggregate doesn't mistake this session's test run for a regression in
committed code. The two modified test files that appeared in `git status` but are NOT on the
peer-dirty list (`failed-image-retry.test.ts`, `image-queue-permanent-failure.test.ts`) have an
empty `git diff`, i.e. no actual uncommitted change — not relevant to this failure.

## Broad re-verification — confirmed accurate, no drift (so cycle 7 doesn't re-check these)

- `IMAGE_PIPELINE_VERSION = 7` — `apps/web/src/lib/gallery-config-shared.ts:22`, re-exported from
  `process-image.ts:397`. Matches all CLAUDE.md mentions.
- `COLOR_IMPACTING_KEYS` — 9 total (5 color + 3 quality + 1 size) in
  `apps/web/src/lib/settings-hash.ts`; `HASH_LENGTH = 8`. Matches the "all **9**" / "already 8
  chars" claims exactly.
- DB pool: `POOL_CONNECTION_LIMIT = 10`, `queueLimit: 20` (`apps/web/src/db/index.ts`, committed
  HEAD) — matches "Connection pool: 10 connections, queue limit 20."
- Admin-backfill concurrency formula (`resolveBackfillConcurrency` /
  `BACKFILL_RESERVED_LIVE_CONNECTIONS` in `admin-backfill-runner.ts`, committed HEAD): cap =
  `max(1, floor((10 - 5 - 1)/2)) = 2` at pool 10 — matches CLAUDE.md's worked example exactly.
- Advisory-lock name list (`apps/web/src/lib/advisory-locks.ts`): `gallerykit_db_restore`,
  `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`,
  `gallerykit_admin_delete`, `gallerykit:image-processing:{jobId}`,
  `gallerykit_color_pipeline_backfill`, `gallerykit_semantic_embedding_backfill`, and the
  DB-scoped `gallerykit_web_singleton_<hash>` exception — matches the "Advisory-lock scope note"
  list in CLAUDE.md exactly, including the single-writer-guard exception carve-out. Spot-checked
  that `admin-users.ts`, `topics.ts`, and `embeddings.ts` all import and use the shared constants
  (`LOCK_ADMIN_DELETE`, `LOCK_TOPIC_ROUTE_SEGMENTS`, `LOCK_SEMANTIC_EMBEDDING_BACKFILL`) rather
  than hardcoding parallel string literals that could drift.
- nginx body-size caps (`apps/web/nginx/default.conf`): 2M generic / 64K login (`/admin` exact) /
  250M `/admin/db` / 216M `/admin/dashboard` / 2M other named admin subpaths / 216M
  `/api/admin/lr/upload` / 2M `/api/admin/` catch-all — matches CLAUDE.md and README.md exactly,
  including the `zone=public` (10r/s) and `zone=nextimage` (30r/s) limiter zones both already
  documented as awaiting operator apply.
- Migration journal: 30 `.sql` files (`0000`-`0029`), 30 journal entries, 1:1. The last 5 entries'
  `when` values are strictly increasing (`...1782200000000, 1782300000000, 1782400000000,
  1782812037323, 1783397921062`), correctly satisfying the "strictly greater than current max"
  rule CLAUDE.md's "Adding a new migration" checklist requires — no monotonicity violation in the
  recently-added tail (the doc's own caveat about historical non-monotonic dates elsewhere in the
  journal remains accurate and is not a new issue).
- `package.json` (root, committed HEAD) and `apps/web/package.json` (committed HEAD) scripts: every
  command CLAUDE.md/AGENTS.md/README.md tell an operator or agent to run
  (`lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, `test:clip:preflight`,
  `test:e2e:admin`, `restore:maintenance`, `db:push`, `db:seed`, `init`, `deploy`) exists verbatim
  in the committed scripts block.
- `NEXT_PUBLIC_GA_ID` (found via env-var sweep, referenced in `content-security-policy.ts`'s
  default parameter) is NOT a live production knob despite appearing to be an undocumented env
  var: `proxy.ts:50` always calls `buildCspSafely({ ..., googleAnalyticsId: siteConfig.google_analytics_id })`,
  explicitly overriding that default parameter in the only production call site. The actual GA
  script embed (`app/[locale]/(public)/layout.tsx`) also reads `siteConfig.google_analytics_id`,
  not the env var. So there's no functional CSP/GA-embed mismatch — the env var default is
  effectively dead code in production, not a documentation gap worth a separate finding.

## Files examined (inventory)

Docs: `CLAUDE.md` (full), `AGENTS.md`, `README.md`, `apps/web/README.md`,
`.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`,
`.context/reviews/_aggregate.md`, `.context/reviews/cycle-5-2026-07-07/document-specialist.md`,
`.omc/wiki/schema-derived-list-drift-migration-reconcile-lesson.md`,
`.omc/wiki/clip-semantic-search-us-p51.md`, `.omc/wiki/gallerykit-architecture-overview.md`.

Code (committed HEAD unless noted): `apps/web/src/lib/gallery-config-shared.ts`,
`apps/web/src/lib/process-image.ts`, `apps/web/src/lib/settings-hash.ts`,
`apps/web/src/db/schema.ts` (via `git show HEAD:...`, since working tree copy is peer-dirty),
`apps/web/src/db/index.ts`, `apps/web/src/lib/admin-backfill-runner.ts`,
`apps/web/src/lib/advisory-locks.ts`, `apps/web/src/lib/single-writer-guard.ts`,
`apps/web/src/lib/image-queue.ts` (via `git show HEAD:...`), `apps/web/src/lib/upload-paths.ts`,
`apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/content-security-policy.ts`,
`apps/web/src/proxy.ts`, `apps/web/src/app/[locale]/(public)/layout.tsx`,
`apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/topics.ts`,
`apps/web/src/app/actions/embeddings.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`,
`apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/backfill-color-pipeline.ts`,
`apps/web/scripts/migrate.js`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`,
`apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/sitemap.ts`,
`apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`, `apps/web/nginx/default.conf`,
`apps/web/drizzle/*.sql` (all 30), `apps/web/drizzle/meta/_journal.json`,
`package.json` and `apps/web/package.json` (via `git show HEAD:...`).

Ran: `npm test --workspace=apps/web` (full suite, for the AGENTS.md test-count reconfirmation and
to surface the peer-dirty-related failure noted above); `git log`, `git show --stat`, `git diff
--stat` for lineage/diff verification; a full-repo env-var sweep (`process.env.[A-Z_]+` across
`src`/`scripts`) diffed against every backtick-quoted token in `CLAUDE.md`.

## Final sweep (commonly-missed) notes

- Checked for the classic "doc says X, three files say X, only one got fixed" pattern (per cycle
  5's `DOC5-02` observation) — this cycle's `DOC5-01`/`AGENTS.md` recheck confirms that pattern is
  still live; no other instance of the same partial-fix pattern found this cycle.
- Checked whether the committed HEAD's last commit (`583277fb`) itself introduced any doc content
  drift — confirmed via `git show --stat` that it touched only `.context/plans/*` planning files,
  zero doc/code content changed, so nothing to verify there beyond the scheduling bookkeeping
  itself (which correctly cites `AGG-C10-01` through `AGG-C10-20`).
- Cross-checked that `IMAGE_SIZES` (which appeared in an early broad grep hit) is NOT actually a
  `process.env.IMAGE_SIZES` reference anywhere in source — false positive from a string/key-name
  match, not a real undocumented env var; excluded from F3.
- Did not find evidence of the doc/code review scope's other requested items (env-var defaults
  table beyond F3, generic index list beyond F1) having any additional drift beyond what's listed
  above — the broad-sweep section above is exhaustive for the team-lead's specific ask list.
