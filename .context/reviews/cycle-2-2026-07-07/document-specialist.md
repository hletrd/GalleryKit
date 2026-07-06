# Document Specialist Review — Doc/Code Mismatch Audit

Date: 2026-07-07
Scope: CLAUDE.md (root), apps/web/README.md, apps/web/.env.local.example, .env.deploy.example,
apps/web/nginx/default.conf, apps/web/docker-compose.yml, package.json (root + apps/web),
drizzle migrations (drizzle/meta/_journal.json, scripts/migrate.js), messages/en.json vs ko.json.

## Method

For every documented command, env var default, file path, port, limit, and behavioral claim
in the target docs, the actual code was located and diffed against the documented value.
Checks performed (all via direct source read/grep, no code execution beyond read-only JSON/
journal parsing and a Node.js key-diff script over messages/en.json vs ko.json):

- Every env var default in CLAUDE.md's "Optional Operational Variables" table cross-checked
  against its resolver in source: `QUEUE_CONCURRENCY` (image-queue.ts), `SHARP_CONCURRENCY`
  (process-image.ts), `IMAGE_MAX_INPUT_PIXELS(_TOPIC)` (process-image.ts), `UPLOAD_MAX_TOTAL_BYTES`
  / `UPLOAD_MAX_FILES_PER_WINDOW` / `NEXT_UPLOAD_BODY_MAX_BYTES` (upload-limits.ts),
  `AUDIT_LOG_RETENTION_DAYS` (audit.ts), `VIEW_RETENTION_DAYS` (view-retention.ts),
  `ADMIN_BACKFILL_CONCURRENCY` + pool-budget formula (admin-backfill-runner.ts, db/index.ts),
  `BACKFILL_CONCURRENCY` (backfill-color-pipeline.ts), `IMAGE_CLEANUP_CONCURRENCY` (actions/images.ts),
  `CLIP_INFERENCE_CONCURRENCY` / `_MAX_PENDING` / `_QUEUE_TIMEOUT_MS` (clip-model.ts),
  `SEMANTIC_SCAN_LIMIT` / `SEMANTIC_TOP_K_MAX` (clip-embeddings.ts), `CLIP_MODELS_ROOT`
  resolution (clip-paths.ts) and Dockerfile `ENV` default. **All matched exactly.**
- Admin color/HDR tunable defaults (`avif_effort=6`, `wide_gamut_max_source_pixels=50000000`,
  quality defaults 90/85/90, chroma defaults 4:4:4/4:2:0, `image_sizes` default
  `[640,1536,2048,4096,5120,7680]`) verified in `gallery-config-shared.ts`. **All matched.**
- `COLOR_IMPACTING_KEYS` (`DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS`) counted directly in source:
  9 keys (5 color + 3 quality + `image_sizes`), matching the "**9**" claim and its breakdown
  in CLAUDE.md exactly.
- DB connection pool: `connectionLimit: POOL_CONNECTION_LIMIT` (=10) and `queueLimit: 20` in
  `db/index.ts` match "Connection pool: 10 connections, queue limit 20."
- `resolveBackfillConcurrency` formula/cap (=2 at pool limit 10) matches the documented
  `max(1, floor((POOL_CONNECTION_LIMIT − RESERVED − 1) / 2))`, `RESERVED = max(3, ceil(10/2))=5`.
- Login rate limiting: `LOGIN_WINDOW_MS = 15 * 60 * 1000`, `LOGIN_MAX_ATTEMPTS = 5` in
  `rate-limit.ts`, applied to both per-IP and per-account (`login_account`) buckets in
  `actions/auth.ts` — matches "5 attempts / 15-min window" for both buckets.
- Admin token format: `TOKEN_PREFIX='gk_'`, `TOKEN_PLAINTEXT_LENGTH = 3 + 43 = 46` in
  `admin-tokens.ts` — matches "46 chars total... 3-char `gk_` prefix + 43 base64url chars."
- OG photo fetch constants in `og-photo-fetch.ts`: `OG_PHOTO_FETCH_TIMEOUT_MS=3500`,
  `OG_PHOTO_TOTAL_BUDGET_MS=10000`, `OG_PHOTO_MAX_BYTES=1024*1024` — all match.
- Service worker `HEAD_REVALIDATE_TIMEOUT_MS=300` in `public/sw.template.js` — matches.
- `MAX_BLUR_DATA_URL_LENGTH=4096` in `blur-data-url.ts` — matches.
- `next.config.ts` `Cache-Control: public, max-age=3600, must-revalidate` and
  `serve-upload.ts` ETag format `W/"v${IMAGE_PIPELINE_VERSION}-${mtime}-${size}-${settingsHash}"`
  (HASH_LENGTH=8, no `.slice(0,8)` needed) — both match documented claims verbatim.
- `IMAGE_PIPELINE_VERSION = 7` in `gallery-config-shared.ts` — matches "(currently 7)" claims
  in both CLAUDE.md and README.
- `DB_SSL` auto-TLS logic in `scripts/mysql-connection-options.js`
  (`useTls = !LOCAL_DB_HOSTS.has(host) && process.env.DB_SSL !== 'false'`) — matches "auto"
  default description and the `.env.local.example` comments.
- Migration journal (`drizzle/meta/_journal.json`): 29 entries (0000–0028), confirmed
  genuinely non-monotonic `when` timestamps (idx 7–17 fall back to 2025 dates between
  2026-dated neighbors) — matches the documented "non-monotonic" claim precisely.
  `scripts/migrate.js` contains `getAllJournalMigrations`, `reconcileLegacySchema`,
  `baselineAllJournalMigrations`, `prepareLegacyDatabaseIfNeeded`, `runMigrations`, and the
  `"[Migration] Drizzle silently skipped N migration(s)"` throw text — all match the
  documented runbook exactly.
- nginx `apps/web/nginx/default.conf` body-size caps: generic 2M, login 64K (regex-matched
  `/admin$` route), `/admin/db` 250M, `/admin/dashboard` 216M, `/api/admin/lr/upload` 216M
  (longest-prefix `^~` match before the generic `^~ /api/admin/` 2M block) — all match
  CLAUDE.md / README claims exactly, including the longest-prefix-wins ordering rationale.
- `package.json` (root and apps/web) scripts: every command named in CLAUDE.md / README
  ("npm run dev/build/lint/typecheck/test/test:e2e", "db:push", "db:seed", "init",
  "lint:api-auth", "lint:action-origin", "lint:public-route-rate-limit", "deploy") exists
  verbatim and wires to the described script file.
- `check-public-route-rate-limit.ts`: `RATE_LIMIT_NAME_PREFIXES = ['preIncrement',
  'checkAndIncrement']`, exempt tag `@public-no-rate-limit-required` — matches.
- `check-action-origin.ts`: exempt tag `@action-origin-exempt` — matches.
- `/api/live` and `/api/health` routes exist; `/api/health` gates DB probe on
  `process.env.HEALTH_CHECK_DB !== 'true'` — matches "liveness-only by default."
- PAT header constant `TOKEN_HEADER = 'x-gallerykit-token'` in `api-auth.ts` — matches
  `X-GalleryKit-Token` (HTTP headers are case-insensitive, consistent with docs).
- CLIP model constants: `PRODUCTION_MODEL_VERSION = 'jina-clip-v2-d512-q8'`,
  `PRODUCTION_COSINE_THRESHOLD = 0.22` in `clip-embeddings.ts` — match README exactly.
- `site-config.example.json` keys (`title, description, url, locale, author, nav_title,
  home_link, footer_text, google_analytics_id`) — match the snake_case key list documented
  in both CLAUDE.md and README verbatim, no extra/missing keys.
- `docker-compose.yml`: `network_mode: host`, bind mounts (`./data`, `./public/uploads`,
  `./public/resources`, `./src/site-config.json:ro`), `TRUST_PROXY: "true"`,
  `HOSTNAME: 127.0.0.1` — all match the documented single-writer / host-network topology.
- `.env.deploy.example` fields (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`, `DEPLOY_PATH`,
  `DEPLOY_REMOTE_SCRIPT`, `DEPLOY_CMD` escape hatch) — match README's remote-deploy section.
- i18n key parity: programmatically flattened and diffed `messages/en.json` (854 leaf keys)
  against `messages/ko.json` (854 leaf keys) — **zero keys present in only one file.**
  Placeholder audit (regex-extracted `{name}` tokens per matching key) found 4 apparent
  mismatches, all false positives from the documented English-ICU-plural /
  Korean-fixed-form asymmetry (e.g. `upload.skippedTitle`: en uses
  `{count, plural, one {1 file...} other {# files...}}`, ko uses `{count}개 파일...`) — this
  is the exact intentional asymmetry CLAUDE.md's i18n plural convention note describes, not
  a bug. No genuine placeholder-parity issues found.
- Dockerfile: `ENV CLIP_MODELS_ROOT="/app/data/models/clip"` and
  `mkdir -p ... /app/data/models/clip` — matches the "production sidecar absolute path" /
  "mount point guaranteed to exist" claims. (Known Dockerfile workspace-nested
  `node_modules` build issue explicitly excluded from this audit per instructions.)

## Findings

No doc/code mismatches were found. Every checked claim — env var default, file path,
constant, script command, nginx cap, migration-runbook behavior, and i18n key/placeholder
parity — matched the current source exactly. This appears to be the result of the repo's
extensive iterative `review-plan-fix` history (100+ prior cycles under `plan/` and
`.context/reviews/`), which has evidently already hunted down and closed doc/code drift as
a recurring category of finding.

## Audited / Skipped

**Audited:** `CLAUDE.md` (root), `apps/web/README.md`, `apps/web/.env.local.example`,
`.env.deploy.example`, `apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`,
`package.json` (root + apps/web), `apps/web/drizzle/meta/_journal.json`,
`apps/web/scripts/migrate.js`, `apps/web/messages/en.json` vs `ko.json`,
`apps/web/src/site-config.example.json`, `apps/web/Dockerfile` (env/mkdir sections only),
root `README.md`.

**Skipped:** Dockerfile workspace-nested `node_modules` build failure (explicitly excluded
per instructions, handled elsewhere). Full Playwright e2e execution and `npm install`/build
were not run (read-only audit per instructions).

