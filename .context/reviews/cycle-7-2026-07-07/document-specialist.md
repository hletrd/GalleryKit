# Cycle 7 — document-specialist (doc/code mismatch) review

Baseline: committed HEAD `14d31ea4`. Scope: CLAUDE.md, apps/web/README.md, apps/web/.env.local.example,
apps/web/nginx/default.conf, package.json (root + apps/web), apps/web/drizzle/meta/_journal.json,
apps/web/tsconfig.typecheck.json, apps/web/drizzle.config.ts, and every source file cited by path/name
in CLAUDE.md's env-var table, admin-tunables table, advisory-lock list, migration list, and lint-gate
section. Special attention to the six freshly-landed peer commits (14d31ea4, 9cd8d3e8, d8fcb3d6,
57e2c5d3, 4d37daa4, 3acf638a, and 05fa5cd1).

## Result: no new substantive doc/code mismatches found

Every concrete numeric/string claim I could locate and cross-check against HEAD `14d31ea4` matches the
current implementation exactly. Detail below (what was checked and confirmed), followed by one
low-severity wording nuance that is arguably pre-existing and not new drift.

### Verified matching (no discrepancy)

- **`resolveImageQueueConcurrency`** (`apps/web/src/lib/image-queue.ts:123-134`): formula
  `min(requested, max(1, floor((poolLimit - max(3, ceil(poolLimit/2))) / 2)))` — at `POOL_CONNECTION_LIMIT=10`
  this is exactly `2`, matching the CLAUDE.md `QUEUE_CONCURRENCY` row and the boot-time clamp warning
  (`image-queue.ts:146-151`).
- **`SHARP_CONCURRENCY`** default (`apps/web/src/lib/process-image.ts:36-49`): `max(1, floor((cpuCount-1)/3))`
  default, explicit env value capped at `max(1, cpuCount-1)` — matches CLAUDE.md's env-var table exactly.
- **`COLOR_IMPACTING_KEYS`** (`apps/web/src/lib/settings-hash.ts` → `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS`,
  `apps/web/src/lib/gallery-config-shared.ts:75-85`): exactly 9 keys (5 color + 3 quality + `image_sizes`) —
  matches CLAUDE.md's "ETag / cache invalidation" section claim of **9** keys.
- **`getSingleWriterLockName`** (`apps/web/src/lib/advisory-locks.ts:60-64`): `gallerykit_web_singleton_<sha256(dbName) 16-hex>`,
  DB-scoped per C3-03 — matches CLAUDE.md's single-writer-guard description verbatim, including the
  16-hex-char truncation.
- **`sanitizeForOg`** (`apps/web/src/lib/og-sanitize.ts:26-29`): strips Unicode formatting via
  `stripUnicodeFormatting` then C0 control chars via `OG_C0_CONTROL_CHARS` — matches CLAUDE.md's OG
  sanitizer description.
- **`pickFirstAvailablePhotoBuffer`** (`apps/web/src/lib/og-photo-fetch.ts`): `OG_PHOTO_FETCH_TIMEOUT_MS=3500`,
  `OG_PHOTO_TOTAL_BUDGET_MS=10000`, `OG_PHOTO_MAX_BYTES=1024*1024` — matches CLAUDE.md's per-attempt/total-budget/byte-cap
  numbers exactly (3500 ms, 10 s, 1 MB).
- **Advisory lock names** (`apps/web/src/lib/advisory-locks.ts`): `gallerykit_db_restore`,
  `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`,
  `gallerykit_color_pipeline_backfill`, `gallerykit_semantic_embedding_backfill`,
  `gallerykit:image-processing:{jobId}`, and the DB-scoped `gallerykit_web_singleton_*` — all match
  CLAUDE.md's "Advisory-lock scope note" list, including the single DB-scoped exception vs. the
  server-scoped rest.
- **`withTopicRouteMutationLock` call sites** (`apps/web/src/app/actions/topics.ts`): wraps exactly
  `createTopic` (line 102, lock call at 163), `updateTopic` (205 → 279), `deleteTopic` (438 → 468),
  `createTopicAlias` (543 → 583) — matches CLAUDE.md's explicit claim that the lock covers "not just
  renames" but all four operations, and correctly does *not* wrap `deleteTopicAlias`/`setTopicMapVisible`.
- **DB pool config** (`apps/web/src/db/index.ts:29-42`): `connectionLimit=POOL_CONNECTION_LIMIT=10`,
  `queueLimit: 20`, `enableKeepAlive: true` — matches "Connection pool: 10 connections, queue limit 20,
  keepalive enabled."
- **Migration journal**: 30 `.sql` files (`0000`–`0029`) match 30 `_journal.json` entries 1:1. Every
  specific migration-number citation in CLAUDE.md checked out: `0010_analytics_views.sql` (image_views/topic_views
  base + the two migration-0010 index citations), `0021_analytics_breakdown_indexes.sql` (country_code /
  referrer_host breakdown indexes), `0023_remove_paid_downloads.sql` (exact filename match for the Stripe-removal
  citation), `0026_analytics_top_view_indexes.sql`, `0027_analytics_retention_indexes.sql`.
- **`IMAGE_PIPELINE_VERSION`** = `7` (`apps/web/src/lib/gallery-config-shared.ts:22`) — matches "currently 7".
- **Upload/body-size env defaults** (`apps/web/src/lib/upload-limits.ts`): `UPLOAD_MAX_TOTAL_BYTES` default
  `2*1024^3=2147483648`, `UPLOAD_MAX_FILES_PER_WINDOW` default `100`,
  `NEXT_UPLOAD_BODY_MAX_BYTES` default `max(200MiB,250MiB)+16MiB=278921216` — all match the env-var table
  exactly, including the derivation arithmetic described in the table's footnote.
- **Decompression-bomb caps** (`apps/web/src/lib/process-image.ts:352-369`): `MAX_INPUT_PIXELS` default
  `256*1024*1024=268435456`, `MAX_INPUT_PIXELS_TOPIC` default `64*1024*1024=67108864` — match exactly.
- **Retention defaults**: `AUDIT_LOG_RETENTION_DAYS` default 90 (`apps/web/src/lib/audit.ts:110`),
  `VIEW_RETENTION_DAYS` default 395 (`apps/web/src/lib/view-retention.ts:14`) — match.
- **`IMAGE_CLEANUP_CONCURRENCY`** default 5 / max 32 (`apps/web/src/app/actions/images.ts:869-872`) — matches.
- **CLIP env caps** (`apps/web/src/lib/clip-model.ts:53-64`, `apps/web/src/lib/clip-embeddings.ts:36-48`):
  `CLIP_INFERENCE_CONCURRENCY` default 1/cap 4, `CLIP_INFERENCE_QUEUE_TIMEOUT_MS` default 30000/cap 300000,
  `SEMANTIC_SCAN_LIMIT` default 2000/hard-cap 25000, `SEMANTIC_TOP_K_MAX` default 50/hard-cap 100 — all
  match CLAUDE.md's env-var table and "Runtime limits" section precisely.
- **`RESTORE_MAINTENANCE_DIR`** default (`apps/web/src/lib/restore-maintenance-durable.ts:24-25`):
  `/app/data` in production, `data` otherwise — matches.
- **`tsconfig.typecheck.json`**: includes `**/*.ts`/`**/*.tsx` with only `node_modules`/`scripts`/`.next/dev`
  excluded, i.e. `src/__tests__/` is genuinely included — matches CLAUDE.md's testing-section claim.
- **package.json script names**: `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`,
  `test:clip:preflight`, `db:push`, `db:seed`, `init`, `typecheck` → `typecheck:app` + `typecheck:scripts`,
  `test:e2e:admin` running `e2e/admin.spec.ts e2e/origin-guard.spec.ts` — all present and named exactly as
  cited in CLAUDE.md/README.md.
- **nginx caps** (`apps/web/nginx/default.conf`): default `2M`, login `64K`, `/admin/db` `250M`,
  `/admin/dashboard` `216M`, `/api/admin/lr/upload` `216M`; `zone=public rate=10r/s burst=40`;
  `zone=nextimage rate=30r/s burst=120` — all match CLAUDE.md and apps/web/README.md exactly.
- **Admin PAT token format** (`apps/web/src/lib/admin-tokens.ts:5-23`): `gk_` (3 chars) + 43-char
  base64url(32 bytes) = 46 total — matches CLAUDE.md's `admin_tokens` schema note exactly.
- **CLIP model identity** (`apps/web/src/lib/clip-embeddings.ts:239`, `clip-model-id.ts:13`):
  `PRODUCTION_MODEL_VERSION='jina-clip-v2-d512-q8'`, `JINA_CLIP_MODEL_ID='jinaai/jina-clip-v2'` — matches
  README.md's "Model" line.
- **Cosine thresholds** (`apps/web/src/lib/clip-embedding-constants.ts:12`, `clip-embeddings.ts:257`):
  `COSINE_THRESHOLD=0.18` (stub) vs. a *separate* `PRODUCTION_COSINE_THRESHOLD=0.22` used when
  `isProd` in both the semantic and similar-image routes — confirms README.md's "Production cosine
  threshold `0.22`" is correct (initially looked like a possible mismatch against the single 0.18
  constant until the second, production-specific constant was found).
- **`lib/image-base-url.ts`**: this file does **not** exist — peer commit `05fa5cd1`'s own commit
  message explicitly records "Rejected: keep a separate image-base-url TS helper" in favor of
  co-locating `parseCspImageBaseUrl` / `sanitizeImageBaseUrl` / `sanitizeImageBaseUrlSafely` inside
  `apps/web/src/lib/content-security-policy.ts` (imported by `constants.ts`). Checked whether CLAUDE.md
  or apps/web/README.md reference a `lib/image-base-url.ts` path anywhere — they do not, so there is no
  actual doc/code mismatch here, just a note that the task's premise of a dedicated new file was
  inaccurate for this commit.
- **`admin-mutation-barrier` restore-window fence**: `apps/web/src/app/actions/topics.ts` and
  `apps/web/src/app/actions/auth.ts` both call `acquireAdminMutationSlot()` via `using mutationSlot = ...`
  in every mutating export, consistent with CLAUDE.md's C1-03 description.

### One low-severity wording nuance (pre-existing, not new drift)

- **[C7-DOC1] `IMAGE_BASE_URL` table row overstates an unconditional HTTPS requirement**
  `[SEV: LOW | CONF: Med | docs]`
  - File: `CLAUDE.md` env-var table row for `IMAGE_BASE_URL` ("must be absolute HTTPS without
    credentials"), vs. `apps/web/src/lib/content-security-policy.ts:1,16-22` (`parseCspImageBaseUrl`):
    `ALLOWED_IMAGE_BASE_PROTOCOLS = new Set(['http:', 'https:'])`, and the `https:`-only check is gated
    on `environment === 'production'`.
  - Why: read literally, the CLAUDE.md table cell claims an unconditional HTTPS requirement, but the
    code (and the more precise `apps/web/README.md` wording, "Production builds reject plaintext
    `http://` asset origins…") only enforces HTTPS in production; `http://` is accepted in dev/test.
  - Failure scenario: none realistic — this is a table-cell simplification, not a behavior the code
    contradicts in the environment that matters (production). apps/web/.env.local.example and
    apps/web/README.md already carry the correctly-scoped "Production values must be…HTTPS" phrasing, so
    an operator reading either of those wouldn't be misled.
  - Suggested fix: optionally reword the CLAUDE.md table cell to "must be absolute http(s); HTTPS
    required in production" for consistency with the README wording, but this is cosmetic.
  - Confidence: Med — this is a genuine textual imprecision, but it's very likely already known/accepted
    given the correct wording exists in two other docs, and it does not rise to a real operational risk.
    Not flagging as new/actionable; recording for completeness only.

## Final sweep for commonly-missed issues

Confirmed I did not skip:
- `.env.local.example` (fully read, cross-checked against every default cited).
- `apps/web/README.md` (fully read, 106 lines, cross-checked scripts table, semantic-search section,
  upload-API-contract section against source).
- `apps/web/nginx/default.conf` (fully read, all `client_max_body_size` and `limit_req_zone` values
  cross-checked).
- `apps/web/drizzle.config.ts` and `apps/web/src/db/index.ts` (both touched indirectly by the DB_SSL_CA
  peer commit 05fa5cd1 / 9cd8d3e8) — both consistent with the DB_SSL / DB_SSL_CA doc rows.
- Root `package.json` and `apps/web/package.json` scripts (fully enumerated, no stale/renamed script
  names found).
- `apps/web/drizzle/meta/_journal.json` and every `.sql` filename (30/30 match; every explicit migration
  number cited in CLAUDE.md checked against the real filename).
- Currently-dirty peer-owned/in-flight files (`apps/web/src/app/sitemap.ts`,
  `apps/web/src/__tests__/cycle12-ops-contracts.test.ts`, `scripts/check-proxy-topology.mjs`,
  `.context/plans/README.md`) were inspected only via `git show HEAD:<path>` where relevant to a
  documented claim (none of them are referenced by path/name in CLAUDE.md or apps/web/README.md, so no
  doc/code mismatch applies to them from this angle); no edits were made to any of them per the
  shared-worktree rules.
- Cross-checked the six freshly-landed peer commits' diffs (`14d31ea4`, `9cd8d3e8`, `d8fcb3d6`,
  `57e2c5d3`, `4d37daa4`, `3acf638a`, `05fa5cd1`) against the specific CLAUDE.md passages they relate to
  (request-origin fail-closed contract, DB connection-init timeout/pool config, topic route-lock
  coverage, mutation-barrier ordering in `logout`) — all consistent with current doc text.

No CRIT/HIGH/MED findings from this specialist lane this cycle. One LOW/informational wording nuance
recorded above (not a new regression — the correct wording already exists in two sibling docs).
