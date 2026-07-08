# CLAUDE.md — AI Assistant Context for GalleryKit

## Project Overview

**GalleryKit** is a high-performance, self-hosted photo gallery application built with Next.js 16. It features a masonry grid layout, automatic image optimization, EXIF extraction, and multiple root-admin accounts (authentication only; no role/capability separation yet).

**Demo:** https://gallery.atik.kr

## Tech Stack

- **Framework:** Next.js 16.2 (App Router, React 19, TypeScript 6)
- **Database:** MySQL 8.0+ with Drizzle ORM
- **Authentication:** Argon2 password hashing, HMAC-SHA256 session tokens
- **Image Processing:** Sharp (AVIF, WebP, JPEG conversion, parallel pipeline)
- **Styling:** Tailwind CSS, Radix UI, shadcn/ui (new-york style)
- **i18n:** next-intl (English, Korean)
- **Deployment:** Docker with standalone output

## Repository Structure

```
gallerykit/
├── apps/web/                 # Main Next.js application
│   ├── src/
│   │   ├── app/              # App Router pages and API routes
│   │   │   ├── [locale]/     # Localized routes (en, ko)
│   │   │   │   ├── admin/    # Admin dashboard (protected routes)
│   │   │   │   ├── p/[id]/   # Photo viewer page
│   │   │   │   ├── g/[key]/  # Shared group pages
│   │   │   │   ├── s/[key]/  # Shared link pages
│   │   │   │   └── c/[slug]/ # Smart collection pages
│   │   │   └── actions/      # Server actions (uploads, CRUD, topics, settings)
│   │   ├── components/       # React components
│   │   ├── db/               # Drizzle schema and connection
│   │   ├── lib/              # Utilities (image processing, etc.)
│   │   └── i18n/             # Internationalization config
│   ├── messages/             # Translation files (en.json, ko.json)
│   ├── public/uploads/       # Processed public image derivatives (PERSISTENT)
│   ├── public/resources/     # Runtime topic cover resources (PERSISTENT)
│   ├── scripts/              # DB init, migration, seed scripts
│   ├── drizzle/              # Database migrations
│   ├── Dockerfile            # Multi-stage production build
│   └── docker-compose.yml    # Docker deployment config
├── .context/                 # Review and plan artifacts generated during OMX loops
└── package.json              # Monorepo root (npm workspaces)
```

## Common Commands

```bash
# Development
npm install                    # Install all dependencies
npm run dev                    # Start dev server (localhost:3000)

# Building
npm run build                  # Build for production

# Database (run from apps/web/)
npm run db:push               # Local throwaway schema push only; use migrations for shared/prod DBs
npm run db:seed               # Seed admin user
npm run init                  # Full DB initialization

# Linting
npm run lint --workspace=apps/web  # ESLint check

# Local/manual Docker smoke only. Production per-iteration deploys use
# `npm run deploy` from the repo root.
docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build
```

## Environment Variables

Create `apps/web/.env.local` from `apps/web/.env.local.example` and keep it private (`chmod 600 apps/web/.env.local`):

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=gallerykit
DB_PASSWORD=<change-me>
DB_NAME=gallerykit
ADMIN_PASSWORD=<strong-16+-char-secret-or-argon2-hash>
SESSION_SECRET=<random-64-char-hex>
```

If you ever seeded an environment from older checked-in examples, rotate both
`SESSION_SECRET` and any bootstrap/admin credentials immediately. Historical
git values must be treated as compromised and must not be reused.

### Optional Operational Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DB_SSL` | auto | TLS is auto-enabled for non-localhost `DB_HOST`; set to `false` to disable (e.g., VPC-internal) |
| `DB_SSL_CA` | — | CA path for verified MySQL runtime + CLI TLS. **MANDATORY when `DB_HOST` is non-local and `DB_SSL` is not `false`**: `db/index.ts` / `mysql-connection-options.js` THROW at import if it is unset for a non-local host (fail-closed — importing `@/db` then 500s every route until the CA is provided or `DB_SSL=false` is set). Pins that exact CA (Node no longer trusts the system store on this path), so a managed/public-CA MySQL provider requires extracting + pinning its CA (C6-06) |
| `BASE_URL` | — | Public URL for sitemap, OpenGraph, and RSS feeds (e.g., `https://gallery.example.com`) |
| `IMAGE_BASE_URL` | — | Optional CDN origin/prefix for uploaded assets; must be absolute HTTPS **in production** (dev/test also allow `http://`), without credentials/query/hash (C7-14). **BUILD-TIME-FROZEN HALF (C7-06, cycle 7b):** the CSP header and generated image URLs read this at runtime, but `next/image`'s `images.remotePatterns` is serialized into the standalone build at `next build` (via the Dockerfile build ARG). Changing the value therefore requires a REBUILD (`npm run deploy`), not a container restart — a restart-only change updates CSP/URLs while `next/image` requests 400 against the stale baked pattern (broken thumbnails that look like a CDN problem). Same class as the site-config ARCH-03 inlining note |
| `TRUST_PROXY` | — | Set to `true` behind nginx/reverse proxy so per-IP rate limiting sees the real client IP |
| `TRUSTED_PROXY_HOPS` | `1` | Number of trusted proxies in front of the app. The client IP is the `X-Forwarded-For` entry appended by the OUTERMOST trusted proxy — the hop-count-th entry from the right (append-mode proxies each append the peer they accepted from). Keep `1` for shipped nginx-only (overwrite-mode XFF = exactly the client); use `2` for CDN→nginx with `$proxy_add_x_forwarded_for`. Chains shorter than the hop count fall through to `X-Real-IP` (AGG9B-22, loop-B c9b fixed a prior off-by-one that selected a client-spoofable slot under append mode) |
| `HEALTH_CHECK_DB` | — | Set to `true` to make `/api/health` probe DB readiness (default is liveness-only) |
| `QUEUE_CONCURRENCY` | `1` | Background image-processing jobs concurrency in this web process. Parser max 8, but the effective value is clamped by the pool budget: `min(requested, max(1, floor((POOL_CONNECTION_LIMIT − max(3, ceil(POOL_CONNECTION_LIMIT/2))) / 2)))` (`resolveImageQueueConcurrency` in `image-queue.ts`) — **2** at the shipped pool of 10, with a boot-time `console.warn` when clamped down (C3-15, run-10 c3) |
| `SHARP_CONCURRENCY` | `max(1, floor((cpuCount-1)/3))` | Upper bound for Sharp/libvips threads. When unset, defaults to `max(1, floor((cpuCount-1)/3))` (the `/3` accounts for the AVIF/WebP/JPEG format fan-out so one image stays near `cores-1` total threads). An explicit value is capped at `cpuCount-1` |
| `IMAGE_MAX_INPUT_PIXELS` | `268435456` | Decompression bomb protection cap (default 256M pixels) |
| `IMAGE_MAX_INPUT_PIXELS_TOPIC` | `67108864` | Separate cap for topic images (default 64M; smaller because topic images are 512x512) |
| `UPLOAD_MAX_TOTAL_BYTES` | `2147483648` | Cumulative batch upload size cap (default 2 GiB) |
| `UPLOAD_MAX_FILES_PER_WINDOW` | `100` | Max files accepted per upload tracking window |
| `AUDIT_LOG_RETENTION_DAYS` | `90` | How many days of audit log entries to keep |
| `VIEW_RETENTION_DAYS` | `395` | Analytics view-event retention (default 13 months / 395 days) |
| `ADMIN_BACKFILL_CONCURRENCY` | `1` | In-app color-pipeline backfill concurrency (capped by pool budget; see Operational Playbook) |
| `BACKFILL_CONCURRENCY` | `2` | Sidecar `--rm` backfill concurrency (default 2, max 8; separate MySQL pool, not capped by the live web pool-budget formula) |
| `IMAGE_CLEANUP_CONCURRENCY` | `5` | Post-DB image-file cleanup concurrency for deletes (max 32); tune for NAS/high-latency storage, not upload processing |
| `UPLOAD_ORIGINAL_ROOT` | — | Override path for private original uploads (used by sidecar scripts) |
| `UPLOAD_ROOT`, `TOPIC_RESOURCES_ROOT`, `TOPIC_RESOURCES_TMP_ROOT` | cwd-derived | Test/sandbox path overrides mirroring the `UPLOAD_ORIGINAL_ROOT` pattern (`lib/upload-paths.ts`, `lib/process-topic-image.ts`) so tests can redirect the derivative / topic-cover / topic-tmp roots. Production normally leaves these unset (C6-15) |
| `RESTORE_MAINTENANCE_DIR` | `/app/data` (prod) / `data` (dev) | Directory holding the durable restore-maintenance marker file (`restore-maintenance-durable.ts`). Must live on the persisted `./data` bind mount so the marker survives process restarts during a restore window (C4-38) |
| `SEMANTIC_SEARCH_ALLOW_PRODUCTION` | — | Operator-only opt-in for production CLIP semantic search (requires model weights) |
| `CLIP_MODELS_ROOT` | cwd-relative `data/models/clip` in code; `/app/data/models/clip` in production env | CLIP model weights root. Absolute paths are honored verbatim; relative/unset values resolve against cwd. Production should set the absolute bind-mount path so the seed script and runtime encoder agree |
| `CLIP_INFERENCE_CONCURRENCY` | `1` | Concurrent real CLIP inference slots, capped at 4 |
| `CLIP_INFERENCE_MAX_PENDING` | `32` | Max queued real CLIP inference requests before returning queue-full |
| `CLIP_INFERENCE_QUEUE_TIMEOUT_MS` | `30000` | Max wait for a real CLIP inference slot, capped at 300000 ms |
| `SEMANTIC_SCAN_LIMIT` | `2000` | Max recent embeddings scanned per semantic/similar query |
| `SEMANTIC_TOP_K_MAX` | `50` | Upper bound for semantic search result count (hard cap 100) |
| `NEXT_UPLOAD_BODY_MAX_BYTES` | `278921216` | Next.js server action body size limit (default 266 MiB = max(200 MiB upload, 250 MiB restore) + 16 MiB multipart overhead; see `upload-limits.ts`) |

## Key Files & Patterns

Ignored local notes under `.omc/wiki/` are agent memory/cache, not an
authoritative source for this repo. If those notes disagree with tracked
source, `CLAUDE.md`, committed docs, or `plan/` / `.context/plans/` records,
trust the tracked source. In particular, the current schema-migration contract
is the `apps/web/drizzle/*.sql` + `apps/web/scripts/migrate.js`
`reconcileLegacySchema` dual-update rule below, and CLIP semantic search is
operator-enabled rather than assumed live in production.

| File | Purpose |
|------|---------|
| `apps/web/src/app/actions/` | Server actions for uploads, image CRUD, topics, settings, and admin mutations |
| `apps/web/src/db/schema.ts` | Drizzle ORM schema with composite indexes |
| `apps/web/src/lib/process-image.ts` | Sharp pipeline (parallel AVIF/WebP/JPEG, ICC parsing, bounds checks). `IMAGE_PIPELINE_VERSION` (currently 7) is DEFINED in `gallery-config-shared.ts` (search for `export const IMAGE_PIPELINE_VERSION`) and re-exported here |
| `apps/web/src/lib/color-detection.ts` | NCLX `colr` ISOBMFF walker + ICC heuristic + gain-map + ICC chromaticity unifier |
| `apps/web/src/lib/color-primaries.ts` | Client-safe `WIDE_GAMUT_PRIMARIES` set + `isWideGamutPrimary` helper |
| `apps/web/src/lib/color-pipeline-decisions.ts` | Canonical `COLOR_PIPELINE_DECISIONS` enum + `isP3Pipeline` predicate (client-safe) |
| `apps/web/src/lib/icc-extractor.ts` | ICC `desc` (v2) / `mluc` (v4 UTF-16BE, locale-matched) descriptor parser |
| `apps/web/src/lib/icc-chromaticity.ts` | Custom-monitor ICC gamut detection from `wtpt`/`rXYZ`/`gXYZ`/`bXYZ` (P4-A2) |
| `apps/web/src/lib/gain-map-detection.ts` | Apple HDR gain map detection in HEIF `iinf`/`infe`/`iref` (P4-A1) |
| `apps/web/src/lib/use-display-capability.ts` | Layered display gamut + HDR detection: `screen.colorGamut` → color-gamut MQ → conservative `'srgb'` for browsers whose wide-gamut signals are absent/false. **Snapshot-memoized** — `getSnapshot` MUST return a stable reference or `useSyncExternalStore` infinite-loops (React #185) |
| `apps/web/src/lib/settings-hash.ts` | 8-char SHA-256 prefix over color-impacting admin settings, embedded in ETag (P4-E2) |
| `apps/web/src/lib/og-sanitize.ts` | Shared `sanitizeForOg` (Unicode-format + C0 strip) for the Satori OpenGraph cards; imported by both OG routes AND the JSON-LD photo page (AGG-R8-13 / AGG-R8c3-02) |
| `apps/web/src/lib/og-photo-fetch.ts` | `pickFirstAvailablePhotoBuffer` ascending sized-derivative fetch chain for the per-photo OG card. Per-attempt timeout `OG_PHOTO_FETCH_TIMEOUT_MS` (3500 ms, R20C20) is held BELOW the whole-chain `OG_PHOTO_TOTAL_BUDGET_MS` (10 s, R19C19 CQ19-01) so a hung cold/broken path can't exceed the social-crawler deadline; `OG_PHOTO_MAX_BYTES` 1 MB byte cap on each candidate |
| `apps/web/src/lib/color-label.ts` | Client-safe `humanizeColorPrimaries` / `humanizeColorPrimariesOrLabel` (extracted from `color-details-section.tsx` so `wide-gamut-hint.tsx` imports the helper without force-bundling the section, R19C19 CQ19-04) |
| `apps/web/src/lib/search-enrichment-fields.ts` | PII-compile-guarded `searchEnrichmentSelectFields` Drizzle select shared by the semantic + similar-image search routes (type-only `PrivacySensitiveKeys` import keeps the `Extract<…>` guard with no runtime data.ts dependency, R19C19 A2) |
| `apps/web/src/app/api/og/photo/[id]/route.tsx` | Per-photo Satori OG card (1200×630, on-disk size fallback via `pickFirstAvailablePhotoBuffer`; `OG_PHOTO_MAX_BYTES` is the 1 MB cap for EACH fetched derivative candidate before embedding, not a final-output JPEG size cap). The HOME page `og:image` points HERE (`/api/og/photo/${latestId}`, AGG-R8-02) — NOT the base JPEG (which is the largest configured size, 6–12 MB, rejected by Twitter/X > 5 MB). The latest-image id+title for the home card comes from the minimal `getLatestImageForOg` (cached via React `cache()` as `getLatestImageForOgCached`, AGG-R8c3-05), not the full masonry-listing query |
| `apps/web/src/lib/hdr-filenames.ts` | `_hdr.avif` filename derivation helper (RESERVED — NOT WIRED until WI-09 ships; honesty invariant enforced by `_PrivacySensitiveKeys` guard, not a feature flag) |
| `apps/web/src/lib/data.ts` | Data access layer with React cache() deduplication. `_PrivacySensitiveKeys` compile-time guard enforces admin-only fields |
| `apps/web/src/proxy.ts` | i18n routing + middleware-level admin auth guard |
| `apps/web/src/lib/auth-rate-limit.ts` | Account-scoped and password-change rate limiting (in-memory Maps with DB backup for login) |
| `apps/web/src/app/[locale]/admin/db-actions.ts` | DB backup/restore with security hardening |
| `apps/web/src/app/api/admin/db/download/route.ts` | Authenticated backup file download |
| `apps/web/src/site-config.json` | File-backed site defaults and static links; DB-backed admin settings override editable SEO/branding fields. **Build-time-inlined** (ARCH-03, run-10 c2): every consumer uses `import siteConfig from '@/site-config.json'`, which Next inlines at build — the read-only compose bind mount is inert at runtime, so editing the mounted file changes NOTHING until the next image rebuild. Fields NOT DB-overridable (`footer_text`, `home_link`, `url`, `google_analytics_id`) require a rebuild to change. `locale` is a file fallback for SEO/OpenGraph; DB `seo_locale` can override that fallback, while normal HTML `lang` remains route-driven |

- **Storage Backend (Not Yet Integrated):** The `@/lib/storage` module still exists as an internal abstraction, but the product currently supports local filesystem storage only. Do not document or expose S3/MinIO switching as a supported admin feature until the upload/processing/serving pipeline is wired end-to-end.

## Database Schema (Key Tables)

- `images` - Photo metadata, EXIF data, filenames, color/HDR audit columns
- `topics` - Photo albums/categories
- `tags` / `imageTags` - Tagging system
- `adminUsers` / `sessions` - Multi-user authentication
- `sharedGroups` / `sharedGroupImages` - Public sharing
- `image_views` / `topic_views` / `shared_group_views` - Analytics events (US-P44). **Retention (AGG-H2, run-6 cycle-2):** these are written by per-IP-rate-limited but otherwise anonymous public endpoints, so to bound growth on the single MySQL writer the independent hourly maintenance scheduler (`apps/web/src/lib/maintenance-scheduler.ts`, started from `instrumentation.ts`) runs `purgeOldViewEvents()` (`apps/web/src/lib/view-retention.ts`), a chunked DELETE of rows older than `VIEW_RETENTION_DAYS` (default 395 days / 13 months, preserving a full prior year for year-in-review). A negative / non-finite `VIEW_RETENTION_DAYS` falls back to the default (never a future cutoff — same R4C6 COR-R4C6-10 guard as the audit-log sweep). Locked by `__tests__/view-retention.test.ts` and `__tests__/maintenance-scheduler-source.test.ts`.
- `image_embeddings` - CLIP embeddings (US-P51). The real jina-clip-v2 encoder is **operator-enabled, not on by default**: production serving requires `semantic_search_mode=production` (DB `admin_settings` row), `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (env), seeded weights, and real `jina-clip-v2-d512-q8` embeddings. The repository proves the code gates and runbook, not the current live production row count; verify the deployed host before treating semantic search as active. The CODE default in `gallery-config-shared.ts` remains `semantic_search_mode: 'disabled'` — correct for fresh installs; the production DB row overrides it at runtime only when the env opt-in is set (the resolver heals a stored `'production'` to `'disabled'` without `SEMANTIC_SEARCH_ALLOW_PRODUCTION`). Stub mode uses non-meaningful deterministic (non-normalized) vectors for demo/smoke only, not semantic similarity. The production weights load OFFLINE (`allowRemoteModels=false`) from the `CLIP_MODELS_ROOT` bind-mount (the prod `.env.local` MUST set the absolute `CLIP_MODELS_ROOT` so the downloader seed target and the runtime offline-load source agree — see `lib/clip-paths.ts`). MEDIUMBLOB stores the raw 2048-byte float32 vector (read via `decodeEmbeddingColumn`, AGG-C10-01). The table stores one active row per `image_id`; `model_version` labels the current vector, and upload/backfill retries converge by upserting that image row instead of appending duplicate history. Running a different mode/model for the same image destructively replaces the prior vector.
- `admin_tokens` - Lightroom-compatible publish API PATs (US-P53). Each token is issued in the format `gk_<base64url(32 random bytes)>` (46 chars total: a 3-char `gk_` prefix + 43 base64url chars), scoped to one admin user, stored SHA-256-hashed in the DB. Beyond the owning admin, each token also carries a **functional scope set** (`AdminTokenScope` = `'lr:upload' | 'lr:read' | 'lr:delete'`, `lib/admin-tokens.ts`): a non-empty subset enforced at the route via `withAdminAuth({ allowTokenScope })` → `tokenHasScope()`, so a token without the required scope is rejected even though it authenticates. Each row also has an optional `expires_at` (a token past its expiry fails verification) and a `last_used_at` touched on use. The upload API (`/api/admin/lr/upload`) accepts the token in an `X-GalleryKit-Token` header (case-insensitive; the constant is `x-gallerykit-token` in `lib/api-auth.ts`) and creates images directly without a session cookie. The repo ships the server API, not a bundled external-client plugin. Tokens can be rotated or revoked from the dedicated admin Tokens page. The LR upload route has a dedicated nginx body-size location (216 MiB) that wins over the generic `/api/admin/` 2 MiB catch-all by longest-prefix match.
- `pending_file_deletions` - Durable retry queue for on-disk file cleanup that failed AFTER an image's DB rows were already deleted (migration `0030_pending_file_deletions.sql`, run-10 lineage cycle 21). `deleteImage`/`deleteImages` (`apps/web/src/app/actions/images.ts`) insert one row per deleted image (the original + webp/avif/jpeg derivative filenames) inside the SAME transaction as the row delete, so a post-delete filesystem failure is retryable even though the image row is gone. Drained by the hourly `maintenance-scheduler.ts` sweep (`drainPendingFileDeletions` in `apps/web/src/lib/pending-file-deletions.ts`; bounded batch, per-row `attempts`/`last_error` tracking, small retry budget) and once best-effort after a restore; a row is removed once its file cleanup succeeds. **No retention/TTL (operational note):** unlike the view-event, audit-log, and session sweeps, there is no age-based purge — a persistently-failing row (e.g. an un-deletable file / permission error) accumulates until its cleanup finally succeeds. This is bounded in practice by the number of deleted images whose files cannot be removed, but an operator seeing the table grow should investigate the underlying filesystem/permission failure rather than expect a TTL to reclaim it. Locked by `__tests__/pending-file-deletions.test.ts` and `__tests__/maintenance-scheduler-pending-deletions.test.ts`.
- `smart_collections` - Admin-defined dynamic galleries (US-P42). Each row stores a name, slug, and a JSON predicate AST in the `query_json` column (search `apps/web/src/db/schema.ts` for `smartCollections`) that defines matching criteria (e.g., topic, tag, date range, camera/lens metadata). Color pipeline decisions are not currently supported smart-collection predicates. Photos are matched dynamically at query time; no materialized join table. The public route `/c/[slug]` renders a smart collection the same way as a topic gallery (NOTE: `/s/[key]` is the shared-links route, NOT smart collections). Smart collection mutations (create, update, delete) exist as hardened server actions (`apps/web/src/app/actions/collections.ts`, gated by `getRestoreMaintenanceMessage()` + same-origin + admin like all other mutating admin actions), but **no admin UI or API surface invokes them yet** — there is no Collections entry in the admin nav, and rows are currently authored via direct DB INSERT into `query_json`. Only the public read side (`/c/[slug]`) is wired. Do not document smart-collection authoring as an operable admin feature until a UI ships (run-10 cycle-1 C1-25).

### `images` color / HDR columns (admin-only via `_PrivacySensitiveKeys` guard)

| Column | Source | Notes |
|--------|--------|-------|
| `color_space` | EXIF `ColorSpace` tag value (`'sRGB'` / `'Uncalibrated'`) | admin-only — NOT the ICC name |
| `icc_profile_name` | ICC `desc` (v2) / `mluc` (v4 UTF-16BE) descriptor | admin-only — locale-matched on `mluc` (P4-E1) |
| `bit_depth` | Sharp `metadata.depth` mapped to bits | admin-only — source bit depth, not delivered |
| `color_pipeline_decision` | Resolver enum (`p3-from-displayp3`, `p3-from-adobergb`, etc.) | admin-only |
| `color_primaries` | NCLX > ICC chromaticity > ICC name | public |
| `transfer_function` | NCLX (PQ / HLG / sRGB / gamma22 / gamma24 / gamma26 / gamma28 / gamma18 / linear / unknown) | admin-only — `gamma24` (NCLX 14/15, BT.1886) and `gamma26` (NCLX 17, DCI-P3) are emitted for real files; `gamma28` (NCLX 5 = BT.470BG, PAL·SECAM gamma 2.8 — AGG-R7C2-01) corrects the prior gamma22/"System M" mislabel (System M is code 4); `gamma18` comes from ICC name heuristics (search `apps/web/src/lib/color-detection.ts` for `prophoto`, AGG-D3) |
| `matrix_coefficients` | NCLX | admin-only |
| `is_hdr` | Derived from `transfer_function in ('pq', 'hlg')` | admin-only — the public HDR badge is now gated on `isAdmin && isHdr` EXPLICITLY at the render point (AGG-M3), not on field-nullness coincidence; locked by `color-details-section-delivered` / `lightbox-color-pip-hdr` tests |
| `has_gain_map` | Apple HDR gain map detection in HEIF `iinf`/`infe`/`iref` (P4-A1) | admin-only |
| `was_downscaled` | Whether a 50 MP+ wide-gamut source was downscaled to ≤ `WIDE_GAMUT_MAX_SOURCE_PIXELS` before the rgb16 fan-out | admin-only — omitted from `publicSelectFields`, in `_PrivacySensitiveKeys`, persisted by both backfill entry points |
| `avif_10bit` | libheif 10-bit-encode probe result (whether the AVIF was actually encoded at 10-bit) | public-safe (R10-M4) — describes encoded output, not source PII; present in `publicSelectFields` and surfaced in the public Color Details audit |
| `pipeline_version` | Encoder version used to produce derivatives (current: 7) | admin-only |
| `uploaded_by` | Admin user id captured on upload; FK to `admin_users(id)` with `ON DELETE SET NULL` (R17-L2) | admin-only — Atom uses the configured feed-level author, not per-entry admin ids |

## Image Upload Flow

1. Files uploaded via `uploadImages()` server action
2. Original saved to the private upload store under `data/uploads/original/`
3. Sharp processes to AVIF/WebP/JPEG (async queue)
4. EXIF extracted and stored in database
5. Processed files in `public/uploads/{avif,webp,jpeg}/`

## Security Architecture

### Authentication & Sessions
- Passwords hashed with **Argon2** (industry-standard memory-hard KDF; Argon2id, memoryCost=65536 / 64 MiB, timeCost=3, parallelism=4 — exceeds OWASP minimums; see `apps/web/src/lib/password-hashing.ts`)
- Session tokens: HMAC-SHA256 signed, verified with `timingSafeEqual` (constant-time)
- Cookie attributes: `httpOnly`, `secure` (when the trusted effective request protocol is HTTPS, or in production — `requestIsHttps || NODE_ENV === 'production'` in `auth.ts`), `sameSite: lax`, `path: /`
- Session secret: `SESSION_SECRET` env var is required in production; dev/test can fall back to a DB-stored generated secret in `admin_settings`
- Expired sessions purged automatically by the independent hourly maintenance scheduler
- Login rate limiting enforced in two buckets: per-IP (5 attempts / 15-min window) and per-account (`acct:<sha256-prefix>` key, same 5/15-min limits) to prevent distributed brute-force where each IP gets a fresh budget but all target the same username. Both buckets use bounded Maps with oldest-entry eviction when caps are exceeded.

### Middleware Auth Guard
- `proxy.ts` checks `admin_session` cookie for all `/[locale]/admin/*` sub-routes
- Unauthenticated requests redirected to login page
- Every mutating admin server action independently verifies auth via `isAdmin()` (defense in depth). Public actions such as search/load-more are intentionally anonymous and rely on validation plus bounded per-IP rate limiting instead.
- Last admin deletion prevented to avoid lockout

### File Upload Security
- **Path traversal prevention**: `SAFE_SEGMENT` regex + `ALLOWED_UPLOAD_DIRS` whitelist + `resolvedPath.startsWith()` containment
- **Symlink rejection**: Both upload routes use `lstat()` and reject `isSymbolicLink()`
- **Filename sanitization**: UUIDs via `crypto.randomUUID()` (no user-controlled filenames on disk)
- **Decompression bomb mitigation**: Sharp `limitInputPixels` configured
- **Directory whitelist**: Only `jpeg`, `webp`, `avif` served publicly; `original/` excluded
- **Headers**: `X-Content-Type-Options: nosniff` (global `headers()` rule); derivatives use `Cache-Control: public, max-age=3600, must-revalidate` — deliberately NOT `immutable`, because a backfill re-encode replaces the derivative under the SAME filename (C4-41: temp-file write + `fs.rename` atomic rename-over in `process-image.ts writeFinalPathAtomically`, NOT an in-place byte rewrite — the serve-upload fd-stat safety depends on the atomic swap so an in-flight reader sees the whole old inode or the whole new one, never a half-written file), which changes mtime + size (R4C6 ARCH-R4C6-06; same policy in `next.config.ts headers()`, `serve-upload.ts`, and `nginx/default.conf`)

### Database Security
- Most application queries use Drizzle ORM parameterization; audited raw-SQL surfaces are confined to schema/admin maintenance helpers and must not concatenate untrusted input
- LIKE wildcards (`%`, `_`, `\`) escaped in search to prevent wildcard abuse
- DB backup dumps stored in `data/backups/` (non-public), served via authenticated API route. Dumps are plaintext SQL at rest; host/storage encryption is the operator boundary.
- Admin DB backup/restore is SQL-only. It snapshots and restores database rows, then runs the committed migration/reconcile postconditions after import, but it does not snapshot or roll back host files in `data/uploads/original`, `public/uploads`, or `public/resources`. Use host-level filesystem backups/reconciliation for full rollback.
- DB restore validates file headers and uses `--one-database` flag
- CSV export escapes formula injection characters (`=`, `+`, `-`, `@`) with leading-whitespace tolerance (C7R-RPL-01), strips C0/C1 control characters, strips Unicode bidi override and isolate chars (U+202A-202E, U+2066-2069) against Trojan-Source-style visual reordering (C7R-RPL-11), and strips zero-width / invisible formatting chars (U+200B-200F ZWSP/ZWNJ/ZWJ/LRM/RLM, U+2060 WJ, U+FEFF BOM, U+180E MVS, U+FFF9-FFFB interlinear anchors) against invisible-character formula-injection bypasses (C8R-RPL-01). See `apps/web/src/lib/csv-escape.ts`
- Admin-controlled persistent string fields (`topic.alias`, `tag.name`, `topic.label`, `image.title`, `image.description`, `seo_title`, `seo_description`, `seo_nav_title`, `seo_author`) reject Unicode bidi overrides (U+202A-202E LRE/RLE/PDF/LRO/RLO, U+2066-2069 LRI/RLI/FSI/PDI) and zero-width / invisible formatting characters (U+200B-200F, U+2060, U+FEFF, U+180E, U+FFF9-FFFB) at the validation layer — the actual enforcement points are the `requireCleanInput` / `sanitizeAdminString` wrappers in `apps/web/src/lib/sanitize.ts`, both built on the shared `UNICODE_FORMAT_CHARS` regex from `apps/web/src/lib/validation.ts` (`containsUnicodeFormatting` is the underlying predicate, not the literal call site — VER-02, run-10 c2). Closes Trojan-Source-style spoofing on every admin string surface that is rendered back to admins or end users (admin tables, public navigation, photo viewer, lightbox, OG images, SEO `<title>` / `<meta description>` / `<meta og:*>`). Lineage: C7R-RPL-11 / C8R-RPL-01 (CSV) → C3L-SEC-01 (topic alias) → C4L-SEC-01 (tag name) → C5L-SEC-01 (topic.label / image.title / image.description) → C6L-SEC-01 (SEO settings)
- Defense-in-depth runtime strip for the Satori-rendered OpenGraph cards: `sanitizeForOg` in `apps/web/src/lib/og-sanitize.ts` strips Unicode bidi/zero-width formatting (the global-flag `stripUnicodeFormatting`) **and** C0 control chars before any admin-controlled string (site title, topic label, tags, JSON-LD camera/lens/exposure) reaches the image render. ONE shared sanitizer is imported by all three consumers — both OG image routes (`api/og/route.tsx`, `api/og/photo/[id]/route.tsx`) and the JSON-LD photo page (`p/[id]/page.tsx`) — so a future loosened SEO/topic/tag validator cannot let bidi/C0 chars reach ONE card while the others strip them. Non-exploitable today (admin-controlled + validator-rejected inputs, Satori renders text into an image), pure symmetry/defense-in-depth. Lineage: AGG-R8-13 (extract shared lib + wire both OG routes) → AGG-R8c3-02 (migrate the JSON-LD page's third copy + add C0 parity). Pinned by `__tests__/sanitize-for-og-global.test.ts` (all three consumers import the shared helper) + `__tests__/og-sanitize.test.ts`
- **OG route SSRF hardening:** production builds validate the effective canonical base URL (`BASE_URL || siteConfig.url`) through `apps/web/scripts/ensure-site-config.mjs` before `next build` runs. The per-photo OG route still treats the inbound request origin as attacker-controllable at request time: internal derivative fetches are pinned to that trusted effective canonical origin, and fallback redirects are derived from the canonical SEO/site URL, never from `new URL(req.url).origin`. If the canonical URL cannot be parsed, the fallback fails closed instead of redirecting to a request-derived host. The topic OG route does not perform the per-photo internal derivative fetch.
- `MYSQL_PWD` env var used for mysqldump/restore (not `-p` flag)

### Privacy
- GPS coordinates (`latitude`, `longitude`) excluded from normal public photo/list/search API responses. The public GPS map is the explicit opt-in exception: topics with `map_visible=true` may expose coordinates through the map projection so the map can render.
- `strip_gps_on_upload` additionally scrubs the on-disk ORIGINAL: lossless byte-level GPS-IFD / GPS-bearing-XMP neutralization for JPEG / TIFF / HEIF-AVIF-HEIC / WebP via `apps/web/src/lib/gps-exif-strip.ts`; PNG and most structurally anomalous formats (JPEG/WebP/TIFF/AVIF) take a metadata-free re-encode (autoOrient + keepIccProfile, explicit high-quality settings). Structurally anomalous HEIC/HEIF and any unrecognized extension instead FAIL CLOSED (VER-01, run-10 c2): `stripGpsFromOriginal` returns `false` (Sharp's bundled build has no HEVC encoder to re-encode with), and both upload paths delete the just-saved original and reject the upload rather than persisting GPS. Never use Sharp `withMetadata()` for stripping — `withMetadata()` keeps most input metadata (EXIF/XMP/IPTC) including GPS coordinates; in Sharp 0.33+ this behaviour is explicit (R4C8 COR-R4C8-01)
- `filename_original` and `user_filename` excluded from public queries
- `adminSelectFields` includes all fields (including PII) for authenticated admin routes
- `publicSelectFields` derived from `adminSelectFields` by omitting PII fields — separate object reference prevents accidental leakage
- Compile-time guard (`_SensitiveKeysInPublic`) enforces no sensitive keys in `publicSelectFields`


### Runtime topology
- The shipped Docker Compose deployment is a **single web-instance / single-writer** topology. Restore maintenance uses a host-side marker plus process state; upload quota tracking and image queue state are process-local, so do not horizontally scale the web service unless those coordination states are moved to a shared store. The admin-backfill-runner status (`running`/counts/`lastError`) and several in-memory rate-limit fast-path buckets are ALSO process-local (AGG-D5/ARCH-07): the backfill runner is correctness-fenced by the `gallerykit_color_pipeline_backfill` advisory lock (only its status surface is per-process), and the login/search/load-more/view-record buckets have DB-backed checks — but OG/share/semantic fast paths are per-process, so distributed-attack defense weakens under scale-out. The shared-group view-count buffer is best-effort-by-design (flushed on graceful SIGTERM, lost on SIGKILL).
- **Single-writer boot guard (C2-03, run-10 c2; hardened C3-02/C3-03, run-10 c3):** at startup the web process best-effort-acquires a DB-scoped singleton advisory lock (`getSingleWriterLockName(DB_NAME)` = `gallerykit_web_singleton_<sha256(DB_NAME) 16-hex>`) on a dedicated non-pool connection (`apps/web/src/lib/single-writer-guard.ts`, wired in `instrumentation.ts`) and keeps that connection query-active with an unref'd 60 s `SELECT 1` keepalive so MySQL's `wait_timeout` cannot silently reap the connection (which would release the lock server-side and blind the guard to a second instance started later); a keepalive failure or connection error warns once that the guard has lapsed, then a background unref'd 60 s re-acquire loop (C4-06, run-10 c4) keeps trying on a fresh dedicated connection — success quietly re-arms the guard (transient blip / DB restart), while CONTENTION (someone else now holds the freed lock) emits the loud topology error once per lapse, because that is exactly the second-instance condition the guard exists to detect. A clean `stopSingleWriterGuard()` sets a stopping latch so shutdown never logs a scary lapse and no in-flight probe can take ownership after stop. If the lock is already held at boot, the guard closes its probe connection QUIETLY and re-probes once after ~25 s (a rolling deploy's old process legitimately holds the lock through its drain window); only a persistent holder earns the LOUD `console.error` announcing that a second live instance shares this DATABASE and that the per-process coordination state above is not multi-instance safe. The DB-scoped name means two separate galleries (separate databases) co-located on one MySQL server do not false-alarm each other. The guard is warn-only and never blocks startup or crashes on DB errors (deploys recreate containers; a guard must not take production down).
- **Public catch-all edge rate limiting (C2-06, run-10 c2; wording corrected C35):** the app-layer limiters cover API routes and server actions only; public PAGES (`/`, `/[topic]`, `/p/[id]`, `/map`, `/timeline`, `/year/*`, `/c/*` — all `revalidate = 0`) are throttled at the NGINX EDGE via the shipped `limit_req_zone … zone=public:10m rate=10r/s` + `limit_req zone=public burst=40 nodelay` on the catch-all `location /`. That same catch-all also covers public non-admin API routes that do not have a longer nginx location, including public search/OG/live/health routes; admin API, uploads, `_next/static`, and `_next/image` have longer locations and separate policies. Applying a config change to the live host requires an operator `nginx -t && systemctl reload nginx` — per-iteration deploys rebuild the container only and DO NOT touch host nginx. Operators fronting the app with a different proxy/CDN must supply their own equivalent edge limit; there is intentionally no app-layer page limiter.
- Admin accounts are multiple root admins. The current schema has no role/capability model, so any admin can upload, edit, export/restore DB backups, change settings, and manage other admins.
- Shared-group `view_count` is best-effort approximate analytics: increments are buffered in process memory and flushed asynchronously, so a crash, process kill, or extended DB outage can undercount delivered views. Do not treat it as billing/audit-grade state unless it is moved to durable storage. View counts are only incremented on the initial shared-group page load (when no per-photo query param is present), not on intra-share photo navigation within the same session.

## Database Indexes

The `images` table has composite indexes optimized for query patterns:
- `(processed, capture_date, created_at)` — homepage and gallery listing sort
- `(processed, created_at)` — prev/next navigation
- `(topic, processed, capture_date, created_at)` — topic-filtered listings
- `(processed, updated_at, created_at, id)` and `(topic, processed, updated_at, created_at, id)` — `updated_at`-ordered feed/sitemap listings so admin edits advance the entry's freshness instant (`idx_images_processed_updated_at` / `idx_images_topic_updated_at`, migration 0029)
- `(user_filename)` — upload deduplication
- `(uploaded_by)` — admin upload-attribution queries
- `image_tags(tag_id)` — tag JOIN performance
- `image_views(image_id, viewed_at)` — per-image view lookups (`idx_image_views_image_id_viewed_at`, migration 0010)
- `image_views(bot, viewed_at, country_code)` — analytics country breakdown (migration 0021)
- `image_views(bot, viewed_at, referrer_host)` — analytics referrer breakdown (migration 0021)
- `image_views(bot, viewed_at, image_id)`, `topic_views(bot, viewed_at, topic)`, `shared_group_views(bot, viewed_at, group_id)` — top-view analytics scans (migration 0026)
- `image_views(viewed_at, id)`, `topic_views(viewed_at, id)`, `shared_group_views(viewed_at, id)` — retention cleanup scans (migration 0027)
- `rate_limit_buckets(bucket_start)` — pruning old login/search/share/admin-token buckets without scanning the whole table (migration 0028)
- `(processed, pipeline_version, id)` — color-pipeline backfill candidate scans (`WHERE processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < X)` for both the in-app runner and the sidecar; `idx_images_processed_pipeline_version`, migration 0030)
- `pending_file_deletions(image_id)` and `pending_file_deletions(updated_at)` — pending-cleanup lookup + retry-sweep ordering (`idx_pending_file_deletions_image_id` / `idx_pending_file_deletions_updated_at`, migration 0030)
- `topic_views(topic, viewed_at)` and `shared_group_views(group_id, viewed_at)` — per-topic/per-share view lookups (migration 0010)

Connection pool: 10 connections, queue limit 20, keepalive enabled. Budget note (TRC-07, run-10 c2):
the documented image-queue / backfill concurrency formulas model only their own claim connections vs
live requests — a concurrent topic route-segment mutation transiently pins 1 extra dedicated
connection (`withTopicRouteMutationLock` + its transaction), and an in-flight DB restore pins 2
(the chained-locks connection + the upload-contract lock connection) for the restore-preparation
window. Rare/short at the documented single-admin scale, but count them when reasoning about pool
headroom during simultaneous admin maintenance operations. **Mutual over-subscription (C6-04, run-10
c6):** the image-queue (`resolveImageQueueConcurrency`) and admin-backfill (`resolveBackfillConcurrency`)
resolvers EACH reserve `max(3, ceil(pool/2))` = 5 "for live traffic" and each cap at 2 workers, but
neither subtracts the OTHER background consumer. They run under DIFFERENT locks (per-image processing
claim vs the global color-pipeline-backfill lock), so an admin-triggered re-encode and active
upload-queue processing can run SIMULTANEOUSLY — pinning ~1 (lock) + 2×2 backfill + 2×2 queue = 9 of
10, leaving 1 free, not the 5 each formula independently "proves". A concurrent live `getImage()`
fan-out then queues behind encode-duration holds against `queueLimit=20`. The two formulas are the
LARGEST overlap not enumerated above; treat "re-encode while uploads process" as a near-saturation
window until a shared background-connection budget lands.

## Image Processing Pipeline

1. Files uploaded via `uploadImages()` server action
2. Original saved to the private upload store under `data/uploads/original/`
3. Enqueued to `PQueue` (default concurrency: 1; override with `QUEUE_CONCURRENCY`, pool-budget-clamped — effective cap **2** at the shipped 10-connection pool, warned on clamp; see the env-var table) for background processing
4. Queue job **claims** image (conditional `WHERE processed = false`) before processing
5. Sharp processes to **AVIF/WebP/JPEG in parallel** (`Promise.all`) at configurable sizes each (default: 640, 1536, 2048, 4096, 5120, 7680; admin-configurable up to 8 sizes)
6. Per-format **fresh** `sharp(inputPath, …)` instance (WI-14 cross-format isolation — see the Color & HDR "Encoder decision matrix" note), with `clone()` used only WITHIN a format (e.g. the 10-bit AVIF fallback). NOTE (AGG-R7-08): the encoder does NOT keep a single decoded instance across formats/sizes — it opens a fresh decode per output to eliminate shared-state contamination, trading decode reuse for correctness (the encoder no longer keeps a shared decoded `image` var across formats, and the per-path WI-14 "fresh sharp instance per format for ALL paths" note lives in `generateForFormat` in `process-image.ts` — search the `WI-14 / R8-R8` comment rather than a brittle line number, which drifts on every edit)
7. Conditional UPDATE marks as processed; if image was deleted mid-processing, orphaned files are cleaned up
8. EXIF extracted with **bounds-checked ICC profile parsing** (capped tagCount, string lengths)
9. Blur placeholder generated at 16px for instant loading. The `blur_data_url` is rendered by `apps/web/src/components/photo-viewer.tsx` as the inner `motion.div` background-image preview during AVIF/WebP/JPEG decode. Values flow through `apps/web/src/lib/blur-data-url.ts` (`isSafeBlurDataUrl` / `assertBlurDataUrl`) at producer (`lib/process-image.ts` blur builder), write time (`uploadImages` in `apps/web/src/app/actions/images.ts`), and read time (photo viewer) so a `data:image/{jpeg,png,webp};base64,…` contract is enforced and the payload is capped at 4096 chars (~3 KB decoded; `MAX_BLUR_DATA_URL_LENGTH` in `blur-data-url.ts`). The producer-side wrap (cycle 4 RPF loop AGG4-L01) closes the symmetric defense — a future MIME drift in the producer is caught at the source rather than masked by the consumer-side validation. Locked by fixture tests `__tests__/process-image-blur-wiring.test.ts` and `__tests__/images-action-blur-wiring.test.ts`

### Failed-image retry (C6-08)

The queue (`apps/web/src/lib/image-queue.ts`) retries a failing conversion up to `MAX_RETRIES` (3) with exponential backoff. After the final failure it persists the truncated error to the `images` row's `processing_error` (varchar 512) + `failed_at` (datetime) columns and adds the job id to a bounded in-memory `permanentlyFailedIds` set (FIFO-evicted at `MAX_PERMANENTLY_FAILED_IDS`) so the bootstrap/continuation scan skips it instead of retrying forever. That set is process-local and resets on restart — a container restart therefore grants a permanently-failed image a fresh `MAX_RETRIES` budget. The admin dashboard (`app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`) surfaces `processing_error` per failed row and offers a **Retry** button (`retryFailedImage` in `app/actions/images.ts`) that clears `processing_error` / `failed_at` / `processing_settings_json` and re-claims the row under the per-image processing advisory lock. `processing_error`, `failed_at`, and `processing_settings_json` are admin-only (in `_PrivacySensitiveKeys`). Locked by `__tests__/failed-image-retry.test.ts` and `__tests__/image-queue-permanent-failure.test.ts`.

## Color & HDR Pipeline (photographer-intent surface)

The product premise: photos arrive AFTER the photographer's editing. The encoder + viewer must preserve the photographer's intent — gamut, tonality, dynamic range — as accurately as the deployed browser, display, and codec stack allow. **No edit / culling / scoring features ship in product.**

### Source detection (precedence)

`detectColorSignals(filepath, sharpInstance, metadata)` in `lib/color-detection.ts` resolves color primaries in priority order:

1. **NCLX `colr` box** (HEIF / AVIF) — ITU-T H.273 codes via the bounded ISOBMFF walker (max box depth 5, max scan 1 MB). Maps: primaries `1=BT.709`, `9=BT.2020`, `11=DCI-P3`, `12=Display P3`; transfer `1=BT.709 (labelled 'srgb' — practical SDR approximation; 13=sRGB IEC61966-2-1 is the canonical code; full mapping in color-detection.ts NCLX_TRANSFER_MAP)`, `4=gamma22 (BT.470M)`, `5=gamma28 (BT.470BG / PAL·SECAM gamma 2.8 — AGG-R7C2-01, NOT "System M" which is code 4)`, `14/15=BT.2020→gamma24 (BT.1886)`, `16=PQ`, `17=DCI-P3→gamma26`, `18=HLG`; matrix `0=identity`, `1=BT.709`, `8=YCgCo`, `9=BT.2020-NCL`, `10=BT.2020-CL` (AGG-D5).
2. **ICC chromaticity** (`lib/icc-chromaticity.ts`, P4-A2) — parses `wtpt`/`rXYZ`/`gXYZ`/`bXYZ` from the ICC tag table, converts XYZ→xy chromaticity, matches against the sRGB / Display P3 / Adobe RGB / ProPhoto / Rec.2020 presets within ΔE ≤ 0.005 (high-confidence) or ≤ 0.015 (medium). Catches custom monitor profiles (Eizo CG2700X, BenQ SW-series, X-Rite calibrations) whose name doesn't match the allowlist.
3. **ICC name allowlist** — `resolveColorPipelineDecision` / `resolveAvifIccProfile` string-match against the description for "Display P3", "DCI-P3", "Adobe RGB", "ProPhoto", "Rec.2020" / "BT.2020", "sRGB". Both resolvers accept an optional `signals` parameter so NCLX-only sources (no ICC) still resolve correctly.

### Encoder decision matrix (`process-image.ts`)

| Source ICC | Decision | AVIF output | WebP / JPEG output |
|---|---|---|---|
| sRGB | `srgb` | sRGB 8-bit | sRGB 8-bit |
| Display P3 / P3-D65 | `p3-from-displayp3` | **P3 10-bit** | P3 8-bit (4:4:4 JPEG) |
| DCI-P3 | `p3-from-dcip3` | **P3 10-bit** (Bradford D65) | P3 8-bit (4:4:4) |
| Adobe RGB | `p3-from-adobergb` | P3 10-bit (rgb16 pipeline) | P3 8-bit (4:4:4) |
| ProPhoto | `p3-from-prophoto` | P3 10-bit (rgb16, may clip cyan) | P3 8-bit (4:4:4) |
| Rec.2020 / BT.2020 | `p3-from-rec2020` | P3 10-bit (rgb16) | P3 8-bit (4:4:4) |
| `force_srgb_derivatives=true` | (decision unchanged) | (still gamut-preserved) | sRGB 8-bit |
| Unknown / no ICC | `srgb-from-unknown` | sRGB 8-bit | sRGB 8-bit |

- Wide-gamut path: `pipelineColorspace('rgb16')` resize for non-DCI-P3 sources (DCI-P3 skips rgb16 to keep its source ICC for the Bradford transform). Per-format fresh `sharp(inputPath, …)` to eliminate shared-state cross-format contamination (WI-14).
- 50 MP wide-gamut sources are downscaled to ≤ `WIDE_GAMUT_MAX_SOURCE_PIXELS` (admin-tunable, default 50 M) before fan-out — prevents OOM on the rgb16 pipeline.
- 10-bit AVIF gated on a Promise-singleton libheif probe; falls back to 8-bit per-image on encode-time rejection.

### HDR ingest

- PQ / HLG sources are **rejected at upload** by default. The `allow_hdr_ingest` admin setting (default `false`) gates ingestion; when enabled, the ingest is accepted with a warning that the SDR-only delivery pipeline will encode the source as SDR.
- Honesty rule: until WI-09 (HDR AVIF encoder shell-out via `avifenc`) ships, `is_hdr` / `transfer_function` / `matrix_coefficients` are **admin-only fields** so the public never sees an HDR badge whose bytes don't fulfill it.
- Apple HDR gain maps (iPhone 14+ HEIC) are detected via the `urim` / `tmap` boxes and surfaced to admin in the Color Details audit row. The gain map itself isn't transcoded yet — the SDR base is delivered with an admin-visible "delivered as SDR base only" label.

### ETag / cache invalidation

**Serving precedence (R4C6 ARCH-R4C6-06):** derivatives live in `public/uploads/`, and Next resolves requests in order: `headers()` config → filesystem (pages + `public/`) → route handlers. For existing files the production serving path is therefore Next's static server (`W/"{size-hex}-{mtime-hex}"` ETag), not `serve-upload.ts`. Two route handlers delegate to `serveUploadFile` (AGG-D2): the non-locale `app/uploads/[...path]/route.ts` (primary path for Service-Worker HEAD revalidation) and its locale-prefixed twin `app/[locale]/(public)/uploads/[...path]/route.ts`. They execute for `/uploads/...` and `/{locale}/uploads/...` URLs respectively, and as a fallback whenever a file is missing from `public/` (existing files are served by Next's static server, above). All layers now share one cache policy: `public, max-age=3600, must-revalidate` (set for the static path via `next.config.ts headers()`).

On the paths it serves, `serve-upload.ts` emits `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` (the hash is already 8 chars — `HASH_LENGTH` in `settings-hash.ts` — so there is no `.slice(0,8)` at the ETag site). The settings hash (P4-E2) covers all **9** `COLOR_IMPACTING_KEYS` (search `apps/web/src/lib/settings-hash.ts` for `COLOR_IMPACTING_KEYS`) — the 5 color keys `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, the 3 quality keys `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, and `image_sizes` — so flipping any color-, quality-, or size-impacting admin setting invalidates cached variants on that path automatically (AGG-R7-08 corrected the count from a stale "5"). **Hash stability note:** `image_sizes` is sorted ascending before hashing so that `[640,1536]` and `[1536,640]` produce the same hash — the admin UI stores the array in display order, but the encoder normalizes before hashing to prevent spurious invalidation (AGG-R7C3-02). On the static path, invalidation rides the mtime+size ETag: a backfill re-encode replaces the file via temp-file + atomic rename (C4-41), changing both mtime and size. Pipeline version bumps invalidate all variants for all images on the serve-upload path and (via re-encode mtime changes) on the static path after backfill. **Operational gotcha (CRT-D1):** flipping a color/quality/size admin setting does NOT invalidate already-served STATIC derivatives (the on-disk bytes — and therefore the mtime+size ETag — are unchanged until a re-encode). The settings-hash ETag only affects the serve-upload path. The static path serves the overwhelming majority of real traffic, so an admin who changes a setting and expects new bytes everywhere must run a backfill re-encode to rewrite the files. **Adding a new color-impacting setting (AGG-R7C3-02 / C6-02):** when a new admin setting changes derivative BYTES, add it to `COLOR_IMPACTING_KEYS` in `settings-hash.ts` so the serve-upload-path ETag invalidates on change, AND add a matching entry to the `CONFIG_HASH_VALUE_MAPPERS` record in the same file. That record is now typed `Record<(typeof COLOR_IMPACTING_KEYS)[number], (config) => string>`, so a forgotten mapper is a hard `tsc` error rather than a silently config-path-invariant ETag (before C6-02 the config-arg hash path — the serve-upload hot path — hand-maintained a decoupled object literal, so a forgotten key there made the ETag ignore the new setting). A compile-time guard (`_ColorKeysAreSettingKeys`, `settings-hash.ts`) catches a typo'd or removed key at `tsc`, and the `__tests__/settings-hash.test.ts` per-key flip test asserts each key's config field moves the hash. Whether a *new* key was added to `COLOR_IMPACTING_KEYS` at all is still on the author (a valid setting key is still a valid key) — same class as the migration admin-only-column checklist.

### Audit surface (UI)

- **`<ColorDetailsSection>`** — accordion in photo viewer + mobile bottom sheet. Default-open for non-trivial color (`isNonTrivialColor` = wide-gamut OR HDR OR non-`srgb` decision). Renders ICC name, primaries, transfer function, decision (admin), source bit depth, delivered bit depth, delivered formats chips, HDR badge, gain map row (admin), copy-to-clipboard button.
- **`<LightboxColorPip>`** (`components/lightbox-color-pip.tsx`) — slide-up panel in lightbox showing the same color metadata + a compact lazy-mounted `<Histogram>`. Closed-state pip uses `min-h-11` for a 44 px touch target.
- **`<WideGamutHint>`** — shown to sRGB-display visitors viewing a wide-gamut photo. Uses `useDisplayCapability` (NOT raw matchMedia) so Firefox (all versions) doesn't false-positive the hint; Firefox parses the MQ syntax since v110 but it always returns false (wide-gamut rendering not implemented, Mozilla bug 1626624).
- **`<Histogram>`** — 256-px-canvas worker-driven RGB / luminance histogram with grid + clip blink (≥ 0.5% bins above white / below black). Priority chain: AVIF (if wide-gamut + P3 display + canvas-P3 supported) → sized JPEG → fallback base JPEG. URLs that fail an `<img>` load are short-circuited so legacy photos missing a `_640.jpg` derivative cleanly fall through to the base filename (always exists per encoder atomic-rename contract).
- **`force_show_color_chips`** admin opt-in unhides the `gamut-p3-badge` / `hdr-badge` on non-matching displays via `:root[data-force-show-color-chips="true"]` — useful for photographer demos on sRGB laptops.

### Admin tunables (color/HDR)

| Setting | Default | Effect |
|---|---|---|
| `force_srgb_derivatives` | `false` | When ON, WebP/JPEG are sRGB regardless of source. AVIF still gamut-preserved |
| `allow_hdr_ingest` | `false` | When OFF, PQ/HLG sources rejected at upload with a localized error |
| `force_show_color_chips` | `false` | Admin demo override — show P3/HDR badges regardless of display capability |
| `wide_gamut_jpeg_chroma` | `'4:4:4'` | Chroma subsampling for wide-gamut JPEG (`'4:4:4' | '4:2:2' | '4:2:0'`) |
| `sdr_jpeg_chroma` | `'4:2:0'` | Chroma subsampling for sRGB JPEG (same enum) |
| `avif_effort` | `6` | AVIF encoder effort (0-9). Higher = smaller files, slower encode. Sharp's native default is 4; we ship 6 for ~10% smaller files at ~30% extra CPU (R28-CP-LOW-1) |
| `wide_gamut_max_source_pixels` | `50_000_000` | Pixel-count cap above which wide-gamut sources downscale before rgb16 fan-out |
| `image_quality_webp` | `90` | WebP encoder quality (0-100). Color-impacting → in `COLOR_IMPACTING_KEYS` (AGG-D4) |
| `image_quality_avif` | `85` | AVIF encoder quality (0-100). Color-impacting → in `COLOR_IMPACTING_KEYS` (AGG-D4) |
| `image_quality_jpeg` | `90` | JPEG encoder quality (0-100). Color-impacting → in `COLOR_IMPACTING_KEYS` (AGG-D4) |

All admin tunables flow through `gallery-config-shared.ts` (validation) → `gallery-config.ts` (resolution) → `image-queue.ts` (passes to `processImageFormats`). Flipping any of these requires a backfill pass to re-encode existing photos at the new settings. (`image_sizes` — the derivative size ladder — is ALSO a `COLOR_IMPACTING_KEY` and byte-impacting, configured under the upload-limits surface rather than this color/HDR table.)

### Backfill

`apps/web/scripts/backfill-color-pipeline.ts` re-runs `processImageFormats` on photos whose `pipeline_version != IMAGE_PIPELINE_VERSION`. Idempotent: skips rows already at current version unless `--force-reencode` is passed. Acquires the `gallerykit_color_pipeline_backfill` MySQL advisory lock on a dedicated connection. The sidecar waits up to 10 seconds for that lock and exits non-zero if another full run is still active.

**Two safe entry points with different candidate selection** — the sidecar `--rm` script above and the in-app admin Settings "Re-encode existing photos" button (`apps/web/src/app/actions/admin-backfill.ts` → `apps/web/src/lib/admin-backfill-runner.ts`, R27-UX-HIGH-1) both re-encode behind the same `gallerykit_color_pipeline_backfill` advisory lock and persist the SAME DB column set as a fresh upload (`pipeline_version`, `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`, `was_downscaled`, `avif_10bit`). They are not candidate-equivalent: the in-app button processes rows behind the current pipeline version and returns `already_running` immediately if the global backfill lock is held; settings-only byte changes for current-version rows require the sidecar with `--force-reencode` (or a future explicit in-app force mode). Individual failed-image retries use the per-image processing claim rather than the global backfill lock. On a successful re-encode whose color detection THEN fails transiently, both paths leave `pipeline_version` behind the current version (the re-encode is idempotent) so a later run retries detection — they never strand stale color metadata at the current version (Run-2 Cycle 1 AGG-01 / AGG-02). Both paths ALSO guard the delete-during-reencode race identically: every UPDATE checks `affectedRows`, and on `0` (the row was deleted mid-reencode — `deleteImage` does NOT take the per-image processing lock, so it can interleave) they clean up the just-written derivative files via `deleteImageVariants(dir, fn, [])` (full directory scan, so non-default-size variants are caught too) and count the row as `deleted-mid-reencode` (neither a success nor a failure), so re-encoding an already-deleted image never orphans files on disk (the in-app runner landed this in Run-8 Cycle-3 AGG-R8c3-03; the sidecar `flushBatch` in Run-9 Cycle-1 AGG-C4-02). The contract is locked by `__tests__/backfill-color-pipeline.test.ts` (column set) and `__tests__/admin-backfill-runner-detection-failure.test.ts` (no version bump on detection failure).

**Concurrency env vars (distinct — AGG-R7-08):** the two entry points read DIFFERENT env vars with DIFFERENT budgeting:
- **In-app** `ADMIN_BACKFILL_CONCURRENCY` (default 1) is clamped at runner start to a connection-budget cap so a background re-encode cannot starve live request traffic on the shared 10-connection pool. The cap (`resolveBackfillConcurrency` in `admin-backfill-runner.ts`) is `max(1, floor((POOL_CONNECTION_LIMIT − RESERVED − 1) / 2))` with `RESERVED = max(3, ceil(POOL_CONNECTION_LIMIT / 2))` — at the shipped pool of 10 this is **2** (a backfill pins ≤ 1 advisory-lock + 2×2 worker connections = 5, leaving ≥ 5 free so a live photo/gallery render's multi-query `Promise.all` doesn't queue behind encode-duration holds; AGG-5 raised the reserve from the prior 1-free cap of 4). Requests above the cap are clamped DOWN with a warning log.
- **Sidecar** `BACKFILL_CONCURRENCY` (default 2, max 8; see the `--rm` command below) runs in a separate `--rm` container with its own MySQL pool, so it is not bound by the live web instance's pool-budget formula. It is still capped by the sidecar script to avoid overwhelming DB and filesystem I/O during long maintenance runs.

**Operational pattern (production)** — the production runtime container has prod-deps only and lacks `tsx` + the TypeScript source files. Running the backfill safely:

```bash
docker run --rm \
  --name gk-backfill \
  --network host \
  -v <deploy-root>/apps/web/src:/app/apps/web/src:ro \
  -v <deploy-root>/apps/web/scripts:/app/apps/web/scripts:ro \
  -v <deploy-root>/apps/web/data:/app/data \
  -v <deploy-root>/apps/web/public/uploads:/app/apps/web/public/uploads \
  -v <deploy-root>/apps/web/public/resources:/app/apps/web/public/resources \
  -v <deploy-root>/apps/web/tsconfig.json:/app/apps/web/tsconfig.json:ro \
  --env-file <deploy-root>/apps/web/.env.local \
  -e BACKFILL_CONCURRENCY=2 -e UPLOAD_ORIGINAL_ROOT=/app/data/uploads/original \
  --user root -w /app/apps/web web-web:latest \
  sh -c "npx --yes tsx@4.22.4 scripts/backfill-color-pipeline.ts"
```

**Critical:** never `npm install` inside the running `gallerykit-web` container. The runtime's `/app/node_modules` is the prod-deps tree from the Dockerfile build; an in-container `npm install --no-save` clobbered `argon2` / `mysql2` / `sharp` once and triggered a restart loop until the next deploy rebuilt the image. The `--rm` sidecar pattern above leaves the prod container untouched.

### Browser × OS × display matrix (delivery honesty)

| Browser | OS | Display | P3 AVIF | `(color-gamut: p3)` MQ | `(dynamic-range: high)` MQ | `screen.colorGamut` API |
|---|---|---|---|---|---|---|
| Safari 17+ | macOS / iOS | P3 (+HDR on Pro) | ✓ | ✓ | ✓ | Safari 18+ TP |
| Chrome 122+ | macOS / Win / Android 14+ | P3 | ✓ | ✓ | ✗ (Chromium gap) | ✓ |
| Edge 122+ | Windows 11 | P3 + Auto HDR | ✓ | ✓ | ✓ (Auto HDR ON) | ✓ |
| Firefox 124+ | macOS / Win | P3 | ✓ (FF 113+) | ✓ (parsed; `p3` / `rec2020` remain false for wide-gamut display detection — bug 1626624) | ✓ (FF 100+; actual `high` depends on output capability) | ✗ |
| Chrome | Android 13- | sRGB-only mid-range | sRGB-clipped delivery | ✗ | ✗ | varies |

`useDisplayCapability` layers `screen.colorGamut` -> `(color-gamut: p3)` MQ -> conservative `'srgb'` default (for browsers that support neither). The canvas-P3 probe is NOT used for display detection because it tests API capability, not display gamut, producing systematic false positives on sRGB displays (R9-R1). Source: caniuse mdn-css_at-rules_media_color-gamut (verified 2026-06-12).

**Firefox photographer-visible impact (R10-H4):**
- Firefox parses the `(color-gamut: p3)` MQ syntax since v110, but `p3` / `rec2020` are still effectively false for wide-gamut display detection because Firefox does not expose wide-gamut rendering through that media feature (Mozilla bug 1626624, still open). So `useDisplayCapability` falls back to the conservative `'srgb'` default for Firefox gamut. P3 badges and the `WideGamutHint` are suppressed for Firefox visitors regardless of actual display capability. `screen.colorGamut` is unsupported in Firefox across all versions.
- **Firefox ≤ 109:** no `color-gamut` MQ support at all, so the same conservative `'srgb'` fallback applies.
- **HDR detection:** Firefox supports the `dynamic-range` media feature (MDN lists Firefox 100+). `useDisplayCapability` asks `(dynamic-range: high)` generically; a `high` match still depends on the user agent, OS, and output device capability.
- **Mitigation:** The `force_show_color_chips` admin toggle overrides display detection and renders P3/HDR badges unconditionally — useful for demos on Firefox ≤ 109, Firefox gamut testing, or HDR metadata display. The admin settings UI documents this gap (R10-H4-FULL).

**Display-change limitations:**
- `screen.colorGamut` has no change-event API. Chrome/Safari/Edge compensate via the `color-gamut` MQ change event, but the MQ may fire before `screen.colorGamut` updates, causing a brief mismatch.
- Firefox ≤ 109 has no `color-gamut` MQ at all, so display-gamut changes (dragging between monitors) are only detected on `focus` / `visibilitychange` (R9-R3). Firefox 110+ parses the MQ syntax but it always returns false (wide-gamut rendering not implemented), so the practical behavior is the same as ≤109.
- Dual-monitor macOS: when a browser window spans P3 + sRGB displays, `screen.colorGamut` reports the primary/focused display, leaving the other half incorrect (R9-M12). There is no web-platform per-display gamut API.

## Race Condition Protections

- **Delete-while-processing**: Queue checks row exists before + conditional UPDATE after processing; orphaned files cleaned up
- **Concurrent tag creation**: `INSERT IGNORE` + slug collision detection with warnings
- **Topic route-segment serialization**: the `gallerykit_topic_route_segments` advisory lock (`withTopicRouteMutationLock`) wraps **`createTopic`, `updateTopic`, `deleteTopic`, AND `createTopicAlias`** — not just renames — so a topic create, rename, delete, or alias creation cannot race another route-segment mutation. A `TopicRouteLockTimeoutError` can therefore surface on any of the four operations.
- **Topic slug rename**: the rename is a delete+insert recreate; one transaction re-points EVERY store that references the old slug before deleting the old row — `images.topic`, `topicAliases.topicSlug`, `topic_views.topic` (the three FK children; `topic_views` was added R16C16 DBG-16-01 — missing it CASCADE-wiped up to `VIEW_RETENTION_DAYS` of analytics), and `smart_collections.query_json` eq/in topic predicates (R16C16 DBG-16-03; `contains`/range predicates are intentionally NOT remapped). No `ON UPDATE CASCADE` exists, so each child is re-pointed by hand — adding a new slug-referencing store requires extending this transaction.
- **Upload quota TOCTOU**: per-window upload count/byte limits are checked SYNCHRONOUSLY then the claim is made before the first `await` (disk + topic-exists), so two concurrent same-key uploads cannot both pass before either claims (R16C16 CR-16-01). Every awaited early-return AND the topic-exists query's throw path rolls the claim back via `settleUploadTrackerClaim(..., 0, 0)` so a rejected/errored upload leaves no phantom claim (R17C17 CR-17-1).
- **Batch delete**: Wrapped in DB transaction (imageTags + images atomic)
- **Single delete**: Also transactional, removes ID from enqueued set
- **`createTopic` TOCTOU**: Catches `ER_DUP_ENTRY` instead of check-then-insert
- **`ensureDirs`**: Promise-based singleton prevents concurrent mkdir
- **Session secret init**: `INSERT IGNORE` + re-fetch pattern for multi-process safety
- **Concurrent DB restore prevention**: MySQL advisory lock `gallerykit_db_restore` acquired on a dedicated pool connection for the entire restore window. Concurrent restore requests fail fast with `restoreInProgress` instead of racing the 250 MB upload path. The lock is released automatically on connection close, so a crashed restore never wedges the next attempt
- **Restore-window admin-mutation fence (run-10 cycle-1 C1-03, closes C77-ARCH-01)**: every mutating admin server action holds a shared process-local barrier slot for its WHOLE body (`using mutationSlot = acquireAdminMutationSlot()` in `apps/web/src/lib/admin-mutation-barrier.ts` — TS explicit resource management releases on every exit path). The restore sets the durable maintenance marker, then acquires the exclusive side and DRAINS in-flight slot holders before importing; on drain timeout (30 s) the restore ABORTS instead of importing over concurrent writes. A mutation admitted a moment before the marker flipped can therefore no longer commit into the freshly restored database. The slot is acquired AFTER `requireSameOriginAdmin()` (no resource holds for unauthenticated callers). LR uploads are equivalently fenced by the upload-processing-contract advisory lock the restore acquires fail-fast.
- **Restore-maintenance recovery**: the restore window is also guarded by a host-side durable marker so uploads and queue workers stay blocked across process restarts. Inspect it with `npm run restore:maintenance --workspace=apps/web -- status`. Clear only a confirmed stale failed-restore marker with `npm run restore:maintenance --workspace=apps/web -- clear --confirm-clear-restore-maintenance`; do not remove the marker manually. The recovery command is production-runnable and clears the durable marker. If it is run from a separate shell/process after the live web process entered maintenance, restart/redeploy `gallerykit-web` after the clear so the process-local maintenance flag is reset from the cleared marker.
- **Pending session revocations:** logout during restore, or during a transient DB delete failure, clears the browser cookie but queues the hashed session id in `pending-session-revocations.ts`. After a successful restore import, the queue is flushed **before** the durable marker is cleared; if a non-empty queued flush fails, restore maintenance stays active rather than reopening admin auth with a re-imported session row. The hourly maintenance scheduler remains a best-effort backstop for transient non-restore failures. The post-import timing is required because a pre-import delete would be undone by the restore itself.
- **Pending image file deletions:** image deletes commit the DB removal before unlinking filesystem objects. Any unlink failure is recorded durably in `pending_file_deletions` and retried by `drainPendingFileDeletions()` after restore maintenance clears and from the hourly maintenance scheduler. Missing files are treated as already-cleaned by the strict delete helpers, so a restored stale row is removed automatically once all referenced originals/derivatives are absent. Inspect unresolved rows with `SELECT id, image_id, attempts, last_error, updated_at FROM pending_file_deletions ORDER BY updated_at, id;`; non-empty rows after repeated sweeps mean the stored filenames are unsafe or storage is still refusing deletes.
- **Upload-processing contract changes**: MySQL advisory lock `gallerykit_upload_processing_contract` serializes uploads with `image_sizes` / `strip_gps_on_upload` changes so the first committed image cannot race a setting that is intended to lock once photos exist
- **Per-image-processing claim**: MySQL advisory lock `gallerykit:image-processing:{jobId}` acquired before processing so two queue workers (e.g. across a restart boundary or a multi-process deployment) cannot both convert the same upload. Paired with a `WHERE processed = false` conditional UPDATE so the losing worker detects the already-processed state and cleans up its leftover variant files
- **Concurrent backfill prevention**: MySQL advisory locks `gallerykit_color_pipeline_backfill`, `gallerykit_semantic_embedding_backfill`, and `gallerykit_alt_text_backfill` are acquired on dedicated connections for their respective color-pipeline, semantic-embedding, and alt-text backfill windows. Concurrent invocations are mutually exclusive rather than racing the same image rows or a database restore; color sidecar runs wait briefly, while the in-app color backfill returns `already_running` immediately and the alt-text sidecar exits non-zero on contention.
- **Advisory-lock scope note** (C8R-RPL-06 / AGG8R-05): MySQL advisory lock names (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit_semantic_embedding_backfill`, `gallerykit_alt_text_backfill`, `gallerykit:image-processing:{jobId}`) are scoped to the MySQL SERVER, not to an individual database. Two GalleryKit instances pointed at the same MySQL server share the same lock namespace and will serialize each other's restores, upload-contract changes, topic create/rename/alias mutations, admin-user deletes, backfill runs, and image-processing claims across tenants. Run one GalleryKit per MySQL server — or prefix advisory-lock names with a per-instance identifier if multi-tenant co-location is required. EXCEPTION (C3-03, run-10 c3): the single-writer singleton lock is deliberately DB-scoped — `gallerykit_web_singleton_<sha256(DB_NAME) 16-hex>` via `getSingleWriterLockName` in `lib/advisory-locks.ts` — so co-located separate galleries do not false-alarm each other's boot guard; all OTHER locks remain server-scoped as listed
- **DB child watchdog:** backup/restore subprocesses use `db-child-watchdog.ts` so stalled `mysqldump`/`mysql` children are timed out and restore import failures keep maintenance active for operator recovery. The returned cleanup cancels the watchdog only BEFORE the timeout fires; after it fires, cleanup is a no-op — the `once`-registered settle listeners stay attached so a child exiting during the 5 s SIGKILL grace window still cancels the force-kill (AGG8b-14, run-10 c8b).
- **Pooled advisory-lock release discipline (destroy-don't-release, C7-02 / run-10 c7b+c8b):** every POOLED-connection advisory-lock site releases through `apps/web/src/lib/advisory-lock-release.ts` — `releasePooledAdvisoryLocks` (one-shot), `createPooledAdvisoryLockReleaser` (staged, for the restore path's chained locks; one terminal `finish()` destroy-or-release decision), and `destroyPooledAdvisoryLockConnectionOnAcquireError` (a failed `GET_LOCK` round-trip is ambiguous — the server may have granted the lock before the client observed the error). When any `RELEASE_LOCK` fails, the helper `conn.destroy()`s the connection instead of returning a possibly-still-lock-holding session to the pool (which would silently wedge every future fail-fast `GET_LOCK` for that name until process restart). Enforced by `__tests__/advisory-lock-release-contract.test.ts`: no raw `RELEASE_LOCK(?)` call sites outside the allowlist (the two `--rm` sidecar scripts, whose process exit frees the session, and `single-writer-guard.ts`, which owns a dedicated non-pool connection).

## Performance Optimizations

- **React `cache()`** wraps request-scoped data access for SSR deduplication — `data.ts` exports cached wrappers for image detail/viewer lookups, latest OG image, topics/tags/aliases, image-by-share-key, shared groups, smart collections, and SEO settings (`getSeoSettings`)
- **`Promise.all`** parallelizes independent DB queries in `getImage()` (tags + prev + next)
- **Public route freshness**: public home, topic, photo, shared single/group, smart collection, timeline, year-in-review, and GPS map pages currently set `revalidate = 0` so asynchronous image processing, metadata updates, share state, archive data, and map-visibility changes are visible immediately; static policy pages such as privacy do not need that dynamic contract. Admin pages remain dynamic. Reintroduce ISR on gallery/photo/archive/map surfaces only with an explicit invalidation/freshness plan
- **Masonry grid**: pure CSS multi-column layout (`columns-1 sm:columns-2 … 2xl:columns-5` + `break-inside-avoid`) — no JS reorder pass; `requestAnimationFrame`-debounced resize handler for column-count-dependent sizing
- **ImageZoom**: Ref-based DOM manipulation (no React re-renders on mousemove)
- **Histogram**: Canvas capped at 256x256 for fast computation
- **`tag_names` aggregation**: the masonry-list queries (`getImagesLite`, `getImagesLitePage`, `getAdminImagesLite`, plus the full `getImages`) all use a shared `tagNamesAgg` constant in `apps/web/src/lib/data.ts` that compiles to `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` over a `LEFT JOIN imageTags … LEFT JOIN tags … GROUP BY images.id`. A scalar correlated subquery shape using raw SQL aliases (`it`, `t`) previously returned NULL in production, breaking the gallery aria-labels (cycle 1 RPF v3 NF-3, commit aca754c). The fixture-style test at `apps/web/src/__tests__/data-tag-names-sql.test.ts` locks this contract: do not migrate the queries away from `tagNamesAgg` without updating the test.

## Service Worker / PWA (US-P24)

- `public/sw.template.js` is the SHIPPED service worker source; `scripts/build-sw.ts` stamps `__SW_VERSION__` (`<template-hash>-p{IMAGE_PIPELINE_VERSION}`) into `public/sw.js` via the `prebuild` hook. After editing the template, regenerate and commit `sw.js`.
- `lib/sw-cache.ts` is the unit-tested REFERENCE implementation of the LRU logic; `__tests__/sw-template-contract.test.ts` pins the template against drift (R4C6 TEST-R4C6-11).
- **Image derivatives**: stale-while-revalidate with an ETag HEAD probe, 50 MB LRU cap. The synchronous HEAD revalidation is **bounded by `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` (300 ms, AGG-R8-05)** — on a slow/hung network the probe aborts and the SW serves the cached bytes immediately + revalidates in the background, so a warm masonry paint never stalls per-tile on the network. The synchronous-freshness intent (serve fresh colors right after an admin color-setting change, R10-H3/R4C9) is preserved on a fast network, just bounded. Pinned by `__tests__/sw-template-contract.test.ts` (template + generated `sw.js`).
- **LRU meta invariants (C4-36):** the per-entry `meta` map is the RECENCY AUTHORITY for the LRU — the entry's stored `time` (not the Cache API's own ordering) decides eviction victims, so (1) every write that (re)caches or serves-fresh an image MUST `touchMeta` under the mutation queue (`withMetaMutation`) so the timestamp stays current, (2) those meta writes must stay covered by the SW's lifetime (`event.waitUntil`) so a terminated fetch can't drop the size accounting, and (3) an entry is NEVER recorded with size 0 — a 0-size entry would let the `total` accounting under-count and the 50 MB cap drift. During the eviction walk, `total` is decremented by `entry.size` unconditionally (the entry leaves the tracked set whether or not `cache.delete` succeeds) so phantom entries are paid down instead of forcing eviction of a just-written real entry (C4-02).
- **Opaque / CDN-origin gap (C4-25):** the image strategy only caches SAME-ORIGIN 200 responses. If `IMAGE_BASE_URL` points derivatives at a cross-origin CDN, those responses are opaque (`type: 'opaque'`, status 0) and are deliberately NOT cached — browsers over-report opaque body sizes massively, which would wreck the 50 MB byte accounting the cap depends on. A CDN deployment that wants SW image caching must decide the story explicitly (same-origin proxy, or skip SW caching for cross-origin and accept the network round-trip); do not naively enable opaque caching. (Deferred register C4-25 code-half; exit criterion: `IMAGE_BASE_URL` actually configured in production.)
- **HTML offline fallback (deliberate Cache-Control (`no-cache`) exemption, R4C6 COR-R4C6-05)**: dynamic public gallery listing pages set `revalidate = 0` (dynamic rendering; Next.js emits no-cache response headers for dynamically rendered routes), so a Cache-Control-honoring SW could never populate an offline cache for those core browsing surfaces. `networkFirstHtml` therefore caches 200 GET HTML explicitly as an OFFLINE-ONLY fallback (entries served exclusively when the network is unreachable; 24 h TTL; 50-entry cap), excluding admin routes, normal public photo pages (`/p/<id>`), revocable share pages (`/s/<key>` and `/g/<key>`), public smart collections (`/c/<slug>`), the GPS map (`/map`) with optional locale prefix, and any page rendered WITH an admin session. Public photo pages remain network-only because cached HTML can outlive deletion, metadata, or privacy changes. Admin-rendered pages are identified by the `x-gk-admin-render: 1` response header set in `proxy.ts` — the SW cannot read the request `Cookie` header (Fetch-spec forbidden header), so the server makes the personalization decision and the SW honors it.

## Migration & Schema-Drift Runbook

The Drizzle MySQL migrator (`node_modules/drizzle-orm/mysql-core/dialect.cjs:62` — internal reference; file/line drifts across drizzle-orm versions; informational only, migrate.js uses its own hash-based post-conditions) decides whether to apply each journal entry by:

```js
if (lastDbMigration.created_at < migration.folderMillis) apply
```

It only checks `MAX(created_at)` — not per-entry hashes — across `__drizzle_migrations`. **The journal in this repo has non-monotonic `when` timestamps** (some 2026 dates, some 2025), so a single max-row baseline poisons the cursor and the migrator silently skips every entry whose `when` is below the cursor. This burned production once: the schema sat at the post-`0011` state for months while every deploy logged "[Migration] Complete." with no error, and the new color/HDR + gain-map columns never got applied.

**Permanent fix in `apps/web/scripts/migrate.js`:**

- `getAllJournalMigrations(folder)` reads the full journal and returns one record per entry (tag + `folderMillis = entry.when` + `hash = SHA256(SQL file content)`).
- `prepareLegacyDatabaseIfNeeded` no longer compares `MAX(created_at)` to `Math.max(...whens)`. Instead it checks `every(journal entry's hash present in __drizzle_migrations)`. **Pending-vs-drift split (FDR-01, run-10 c2):** when the DB carries gallery tables and every missing hash sits strictly ABOVE the recorded `MAX(created_at)` cursor, that is the normal "new migrations pending" case — the function returns WITHOUT baselining so `drizzle.migrate()` genuinely executes the committed `.sql` (including DML backfills, which `reconcileLegacySchema` never mirrors) and records the hash rows itself; the previous flow baselined new entries before `migrate()` ran, so new migration SQL never executed on deployed DBs and the post-condition was unreachable. Only true drift (a missing hash at/below the cursor, or an empty/poisoned log) runs `reconcileLegacySchema(connection, dbName)` (idempotent CREATE/ALTER guards for every table + column the schema knows about) followed by `baselineAllJournalMigrations(connection, trueDrift, { maxFolderMillis: cursor })` (one row per entry, idempotent on hash). **Mixed-case rule (C3-01, run-10 c3):** in a MIXED state (true drift below the cursor AND pending new migrations above it), only the at/below-cursor drift entries are baselined; the above-cursor tail is left UN-baselined so `drizzle.migrate()` genuinely applies its SQL — the previous behavior baselined the whole batch, silently dropping the tail's SQL (one misdated sibling swallowed every pending migration with it) while the post-condition passed. `baselineAllJournalMigrations` also carries a hard guard that throws rather than baseline any entry above the caller's cursor. Trade-off: because `reconcileLegacySchema` mirrors the CURRENT full schema (including the tail's DDL per authoring step 3), the tail's non-idempotent DDL can fail loudly (duplicate DDL) in this mixed state — resolve the drift, then baseline those entries manually; a loud deploy failure is strictly preferred over silent SQL loss. **DDL-only invariant (qualified, C4-35):** `reconcileLegacySchema` mirrors schema DDL, with ONE narrow legacy exception — a self-gated, one-time `shared_group_images.position` ordering backfill (an UPDATE that runs only when `ensureColumn` reports the column was just added). Any FUTURE migration carrying a DML backfill must rely exclusively on the drizzle-apply path (never a new reconcile-side UPDATE), which is exactly why baselining an unexecuted migration is forbidden. **DML-baseline guard (C4-01, run-10 c4):** `baselineAllJournalMigrations` scans each candidate's SQL and THROWS rather than baseline any DML-bearing entry (INSERT/UPDATE/DELETE/REPLACE) on ANY path — including the empty-log/`cursor === null` legacy-bootstrap branch that the above-cursor guard cannot reach — except tags explicitly allowlisted in `LEGACY_DML_MIRRORED_BY_RECONCILE` (currently only `0001_sync_current_schema`, whose DML is the reconcile exception above). Operator-visible behavior change (C4-43): a mixed-drift state that previously booted with silent DML loss now fails the deploy loudly and requires manual resolution. Locked by `__tests__/migrate-pending-migrations.test.ts` (incl. the mixed-batch, refusal-guard, null-cursor DML, and allowlist cases).
- `runMigrations(connection, folder, expectedMigrations)` calls drizzle's `migrate()` then post-conditions: every journal hash MUST be in `__drizzle_migrations`, otherwise `throw new Error(\`Drizzle silently skipped N migration(s): tag1, tag2, …\`)` and the deploy fails loud. This catches future drift the moment it happens.

**Adding a new migration:**

1. Drop a new SQL file in `apps/web/drizzle/NNNN_<name>.sql`.
2. Add an entry to `apps/web/drizzle/meta/_journal.json` with `idx = NNNN`, `tag = "NNNN_<name>"`, and a `when` value **strictly greater** than `Math.max(...current journal whens)`. Use `Date.now()` at commit time. Failing to monotonically advance `when` causes drizzle to silently skip your migration; the post-condition assertion will then fail the next deploy.
3. Update `reconcileLegacySchema` in `migrate.js` to mirror the new schema state (idempotent CREATE/ALTER) so a fresh DB without `__drizzle_migrations` rows can baseline cleanly.
4. Update `apps/web/src/db/schema.ts`.
5. If the new column is admin-only, add it to the `_omit*` block in `apps/web/src/lib/data.ts` AND to the `_PrivacySensitiveKeys` type guard AND to the `SENSITIVE_KEYS` fixture in `apps/web/src/__tests__/privacy-fields.test.ts`.

**Historical-comment errata:** older migration comments may mention prior product surfaces such as the Lightroom plugin or Florence-2 planning language. Treat migration SQL files as historical schema records, not current operator runbooks or current feature-state evidence. Use this file, `apps/web/README.md`, and current source/tests for live behavior.

**Forensics on a stuck deploy:**

```bash
docker exec gallerykit-web sh -c "node -e \"
const m=require('mysql2/promise');
const o=require('./apps/web/scripts/mysql-connection-options').getMysqlConnectionOptions();
m.createConnection(o).then(async c => {
  const [r] = await c.query('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id DESC LIMIT 25');
  console.log(JSON.stringify(r, null, 2));
  await c.end();
});\""
```

Compare against `apps/web/drizzle/meta/_journal.json` entries × `SHA256` of each migration file content. Missing hashes = un-applied migrations. The new post-condition assertion in `migrate.js` raises this automatically; this command is for digging deeper after the assertion fires.

## Operational Playbook

### Per-iteration deploy directive

`npm run deploy` from the repo root reads the gitignored root `.env.deploy` when present, otherwise falls back to `$HOME/.gallerykit-secrets/gallery-deploy.env` unless `DEPLOY_ENV_FILE` points somewhere else. It connects to the configured deploy host and runs `apps/web/deploy.sh` on the host (which `git pull`s the worktree and rebuilds the Docker image via compose). The deploy target is configuration-owned by that deploy env file, not hardcoded in documentation. The deploy is **per-iteration** by project policy — every commit pushed to `master` is followed by a deploy. There is no staging environment.

### Applying host-nginx config changes (C3-08, run-10 c3)

**Deploys do NOT touch host nginx.** `apps/web/nginx/default.conf` is a committed template; a change to it (new `limit_req_zone`, body-size caps, location blocks) is INERT in production until an operator applies it on the deploy host by hand. Do not mark an nginx-config finding "closed" on commit alone — the ledger disposition is "shipped config; prod-apply pending" until the steps below are verified.

Operator apply + verify procedure:

1. Copy/sync the committed `default.conf` into the host's nginx config location (operator-owned; not part of `deploy.sh`).
2. `nginx -t` — MUST pass before any reload; a failed test leaves the running config untouched.
3. `nginx -s reload` (or `systemctl reload nginx`) — reload, never restart, so in-flight requests drain.
4. Verify the limiter is live: a rapid same-IP burst beyond the relevant zone budget (e.g. >50 rapid GETs of `/` for `zone=public` rate=10r/s burst=40; >150 rapid `/_next/image` requests for `zone=nextimage` rate=30r/s burst=120) must return HTTP 429 for the overflow, AND a normal page load with its full asset fan-out must NOT 429.
5. Record the verification (date + zone + result) in the current cycle's plan/ledger.

The `zone=public` (added run-10 c2) and `zone=nextimage` (added run-10 c3) limiters both await this procedure on any host whose nginx predates them.

### Disk hygiene

The deploy host has 124 G total. Repeated deploys accumulate Docker images + builder cache that can fill the disk; once disk hits 100 % the next `git pull` on the deploy host fails with `unable to write loose object file: No space left on device`.

**`apps/web/deploy.sh` now auto-prunes after every deploy** so the host stays clean without manual intervention. Immediately after `docker compose up -d --build` it runs `docker container prune -f`, `docker image prune -af`, `docker builder prune -af`, and `docker volume prune -f`, then prints `df -h /`. The prune runs AFTER the stack is back up, so the live `gallerykit-web` container + its just-built image are in-use and survive it.

**In-use data is never deleted — guaranteed by the persistence model, not by luck:** GalleryKit persistence is BIND MOUNTS (`./data` → originals + DB backups, `./public/uploads` → processed derivatives, `./public/resources` → topic cover resources, `./src/site-config.json` → config), which are host directories `docker volume prune` cannot touch; immutable public assets such as `sw.js`, icons, fonts, and workers come from the freshly built image. MySQL runs on the host (`network_mode: host`, 127.0.0.1), so there is no DB Docker volume. The automatic volume prune deliberately omits `-a` (anonymous/dangling volumes only, never named volumes). When changing the deploy prune logic, preserve all three guarantees: prune-after-`up`, bind-mounted data, and no `-a` on the automatic `volume prune`.

If the host is ALREADY wedged at 100 % (so a deploy can't even `git pull`), free disk manually first, then re-deploy:

```bash
# SSH to the configured DEPLOY_USER@DEPLOY_HOST from .env.deploy
# (or $HOME/.gallerykit-secrets/gallery-deploy.env), using DEPLOY_KEY when set.
docker container prune -f
docker image prune -af          # only removes images not referenced by a running container
docker builder prune -af        # frees BuildKit cache (often 10-20 G)
docker volume prune -f          # anonymous/dangling volumes only; matches deploy.sh safety contract
df -h /
```

The running `gallerykit-web` container's image survives `docker image prune -af` because `-a` only removes unused images. Treat `docker volume prune -af` as a dedicated GalleryKit-only host break-glass step after inspecting `docker volume ls`; it is host-global and can delete unused named volumes belonging to other Docker workloads.

**Real incident (2026-06-17) — userspace starvation past the point of SSH recovery:** disk exhaustion once wedged the host so hard that userspace itself was starved — `nginx`, `sshd`, AND the Node app all stopped responding at the application layer while TCP handshakes on `:443` / `:22` still completed (kernel/network alive, userspace blocked). `ssh` hung at "banner exchange" even with a 60 s `ConnectTimeout`, so the manual `ssh … && docker prune` recovery above was UNREACHABLE. Recovery was a **block-volume resize** — the host self-healed once disk pressure lifted (no reboot needed, no data loss; bind-mounted `./data`, `./public/uploads`, `./public/resources`, and host MySQL were never at risk; the filesystem now reports 124 G at ~21 % used). Lesson: if the host is starved past the point where `ssh` can return a shell, the prune recovery cannot run — use the cloud provider's **console / serial console (or resize the block volume)** to relieve disk first, then prune. The per-deploy auto-prune is the primary prevention; watch the `df -h /` line in the deploy logs for a host trending toward full.

### Don't `npm install` inside the running production container

The runtime container's `/app/node_modules` is a curated prod-deps tree from the Dockerfile's `prod-deps` stage. An in-container `npm install --no-save <anything>` will resolve and reinstall the dep tree against `package.json`, which can drop production deps that aren't reachable from `package.json`'s `dependencies` field directly (e.g. argon2, mysql2 transitives), break startup, and put `gallerykit-web` into a restart loop. The site goes 502 until the next deploy rebuilds the image cleanly.

For one-off scripts that need source files / dev-only deps (tsx, vitest, etc.), use a **sidecar `--rm` container** off the just-built `web-web:latest` image with read-only source mounts (see "Backfill" section under "Color & HDR Pipeline" for the canonical pattern). This leaves the production container untouched.

### CLIP semantic search — seeding model weights on the deploy host

The CLIP model weights are **NOT baked into the Docker image** (they are tens-of-hundreds of MB and live on the host volume). The image only guarantees the production mount point exists (`/app/data/models/clip`, created by `mkdir -p` in the runner stage and surfaced via the production `CLIP_MODELS_ROOT`). In code, an unset or relative `CLIP_MODELS_ROOT` resolves against the current working directory as `data/models/clip`; production must set the absolute bind-mount path so the downloader seed target and runtime offline-load source agree. The runtime encoder reads weights from that path at first inference.

`CLIP_INFERENCE_CONCURRENCY` defaults to `1` and is capped in `lib/clip-model.ts`. `CLIP_INFERENCE_MAX_PENDING` and `CLIP_INFERENCE_QUEUE_TIMEOUT_MS` bound queued visitors waiting for an inference slot; aborted requests are removed from the queue. Raise these only after measuring CPU, RSS, and tail latency on the deploy host because each concurrent request runs an ONNX forward pass. `SEMANTIC_SCAN_LIMIT` bounds scanned embeddings per search, and `SEMANTIC_TOP_K_MAX` bounds the public result count (hard cap 100).

**One-time seed procedure (run before enabling semantic search in production):**

```bash
# On the deploy host, seed weights into the bind-mount directory.
# The ./data/models directory is part of the ./data bind mount declared in
# docker-compose.yml, so it persists across every deploy and is never touched
# by docker image prune / builder prune (bind mounts are not managed volumes).
docker run --rm \
  --name gk-clip-seed \
  --network host \
  -v <deploy-root>/apps/web/src:/app/apps/web/src:ro \
  -v <deploy-root>/apps/web/scripts:/app/apps/web/scripts:ro \
  -v <deploy-root>/apps/web/tsconfig.json:/app/apps/web/tsconfig.json:ro \
  -v <deploy-root>/apps/web/data:/app/data \
  --env-file <deploy-root>/apps/web/.env.local \
  -e CLIP_MODELS_ROOT=/app/data/models/clip \
  --user root -w /app/apps/web web-web:latest \
  sh -c "npx --yes tsx@4.22.4 scripts/download-clip-models.ts"
```

**After seeding, run a forced `--production` backfill** to generate CLIP embeddings for all existing photos before production mode is enabled:

```bash
docker run --rm \
  --name gk-clip-backfill \
  --network host \
  -v <deploy-root>/apps/web/src:/app/apps/web/src:ro \
  -v <deploy-root>/apps/web/scripts:/app/apps/web/scripts:ro \
  -v <deploy-root>/apps/web/tsconfig.json:/app/apps/web/tsconfig.json:ro \
  -v <deploy-root>/apps/web/data:/app/data \
  --env-file <deploy-root>/apps/web/.env.local \
  -e SEMANTIC_SEARCH_ALLOW_PRODUCTION=true \
  -e CLIP_MODELS_ROOT=/app/data/models/clip \
  --user root -w /app/apps/web web-web:latest \
  sh -c "npx --yes tsx@4.22.4 scripts/backfill-clip-embeddings.ts --production --force"
```

The `--force` flag is required in the documented pre-enable flow because a fresh DB still stores `semantic_search_mode='disabled'`; without `--force`, the backfill exits successfully without processing. The script still requires `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` for every `--production` run, including forced pre-enable backfills. After the DB mode is already set to `stub` or `production`, `--force` is only needed when intentionally re-embedding existing rows.

The sidecar backfill uses `SEMANTIC_SCAN_LIMIT` as an embedding-attempt budget per run and logs `Reached SEMANTIC_SCAN_LIMIT (...)` when that budget is exhausted. Missing-original candidates advance the keyset cursor and may be scanned/skipped without consuming the embedding-attempt budget, so candidate rows scanned can exceed the limit when the backlog contains broken rows. For galleries larger than that limit, repeat the same sidecar command until it finishes without that message and reports no remaining rows to process.

**In-app scan vs sidecar backfill are NOT mutually exclusive (C4-27):** once semantic search is in `stub`/`production` mode, the live web process ALSO runs a bounded missing-embedding scan on every queue bootstrap/continuation (`bootstrapMissingActiveEmbeddings` in `image-queue.ts`), and the two paths do not coordinate via an advisory lock (unlike the color-pipeline backfill). They converge rather than corrupt — the embedding write is an idempotent `onDuplicateKeyUpdate`, so at worst the two paths duplicate one image's inference — but running a large `--production --force` sidecar while the web process is also embedding wastes CLIP inference CPU on overlapping rows. Schedule big sidecar backfills during low-traffic windows and let the in-app scan handle steady-state drift, rather than expecting one to block the other.

**Activating production (operator-only, deliberate):** the resolver heals a stored
`semantic_search_mode='production'` to `'disabled'` UNLESS the app environment sets
`SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (AGG-C10-02). The admin Settings UI intentionally
offers only Disabled/Stub — there is no one-click production toggle. To go live: seed the
weights (above), run the `--production --force` backfill (above), set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`
in `.env.local`, apply that env change to the live web container with the normal root
`npm run deploy` (or a local/manual `docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build`
smoke), then set the DB row `admin_settings.semantic_search_mode='production'`. The running
Node process reads this flag from its container environment, so editing `.env.local` alone does
not update an already-running container. Without the env flag the routes 503 regardless of the DB value.

**Pre-activation test gate (TEST-06, run-10 c2):** before flipping the DB row to `production`, run the
two env-gated integration suites against the seeded weights — they are permanently skipped in CI (CI has
no model weights), so this manual pre-flight is the ONLY verification that the real encoder loads offline
and ranks semantically:

```bash
cd apps/web
CLIP_MODELS_ROOT=<abs-models-root> npm run test:clip:preflight
```

**Runtime limits:** `SEMANTIC_SCAN_LIMIT` (default 2000, hard cap 25000) caps the newest-first brute-force vector scan
for semantic search — the maximum number of embedding rows the route will read from the
DB per query. `SEMANTIC_TOP_K_MAX` (default 50, hard cap 100) is the hard ceiling on results returned
to the client; the admin UI default is 20. Both limits prevent unbounded CPU/DB consumption
on expensive natural-language queries. The route still performs a bounded scan rather than
using a vector index, but top-K selection keeps only the current winner set instead of sorting
every candidate above threshold.

**Why the binary is already present without extra Dockerfile steps:** `onnxruntime-node` (the CPU inference engine used by `@huggingface/transformers`) bundles its native `.node` binding for all platforms — including `linux/arm64` and `linux/x64` — **directly inside the npm package tarball** (`bin/napi-v3/linux/{arm64,x64}/onnxruntime_binding.node`). Its `postinstall` script only downloads CUDA `.so` files, which are not needed for CPU inference. Since `onnxruntime-node` is a non-dev, non-optional transitive production dependency (via `@huggingface/transformers → onnxruntime-node`), it is installed by `npm ci --omit=dev` in the `prod-deps` stage without any `--include=optional` or explicit extra install step. No Dockerfile change is required to make the CPU binding available at runtime.

### Auto alt-text hints

Auto alt-text (`auto_alt_text_enabled`) is an opt-in local hint pipeline, not a hosted AI captioning feature. The current caption generator derives suggested text from available EXIF/metadata context and stores it as `alt_text_suggested`; public image alt text falls back through meaningful title, tag-derived labels, suggested text, and then the localized generic photo label. Existing rows are not rewritten merely by enabling the setting. Operators can copy suggestions into empty public title/description fields from the admin bulk action or run `apps/web/scripts/backfill-alt-text.ts` intentionally for existing processed photos. The sidecar holds the `gallerykit_alt_text_backfill` advisory lock for the full run; database restore acquires the same lock fail-fast before maintenance so sidecar writes cannot cross a restore window.

### Production photographer-perspective audit history

The `.context/reviews/` directory contains the running history of "as photographers" comprehensive reviews:

- `photographer-r3/` (2026-05-08) — first comprehensive R3 pass, 4 CRIT + 7 HIGH findings.
- `cycle1-rpf-photographer/` … `cycle8-rpf-photographer/` — the 8 cycles of /review-plan-fix that closed nearly all of R3 (commits `94c43393` through `689822d4`).
- `photographer-r4/` (2026-05-08) — R4 fresh pass after cycle 9 convergence; 0 CRIT + 2 HIGH (Apple gain map detection, ICC chromaticity-based gamut detection) + 5 MED + 4 LOW.
- Later photographer-perspective and cycle review artifacts, including `photographer-r6`, `photographer-r8`, and `run-9`/cycle review outputs, are also committed under `.context/reviews/`; check the newest aggregate before treating an older round as the current baseline.

Do not use `photographer-r4/_aggregate.md` alone as the current state. It is an important historical baseline; the current photographer surface is the latest committed aggregate plus the implementation history through the current HEAD.

## Permanently Deferred
- **2FA/WebAuthn**: Not planned. Multiple root admins with Argon2id + rate limiting is sufficient for a personal gallery. Adding TOTP/WebAuthn would add complexity without proportional benefit.
- **Paid downloads / Stripe (US-P54): REMOVED, do not re-add.** GalleryKit is a free, open-source gallery with **no payment surface**. The Stripe paid-download feature was removed entirely (operator decision, run-8): the `entitlements` table + `images.license_tier` column were dropped (migration `0023_remove_paid_downloads`), and the checkout/webhook/paid-download routes, the `sales` admin page + action, the `stripe`/`license-tiers`/`download-tokens`/`download-interstitial` libs, the paid i18n keys, and the `stripe` dependency were all deleted. The **free** direct-download button (JPEG/AVIF derivatives) was KEPT and made unconditional. Do not reintroduce Stripe, entitlements, `license_tier`, or any checkout/payment flow without an explicit new product decision.

## Important Notes

- **Node.js 24+** required, **TypeScript 6.0+**
- Processed images are stored in `apps/web/public/uploads/`, runtime topic covers are stored in `apps/web/public/resources/`, and original uploads are stored privately under the data volume — **ensure all three mutable stores are persisted in Docker**
- Memory envelope: multipart uploads are buffered on the heap by the framework before the disk-streaming step, so each in-flight upload transiently pins roughly its file size in RSS on top of Sharp encode memory (run-10 cycle-1 C1-33, pending an on-host RSS measurement). Budget container memory for the largest expected concurrent uploads.
- Max upload size: 200 MB per file; batch byte cap (`UPLOAD_MAX_TOTAL_BYTES`, default 2 GiB) and batch file-count cap (`UPLOAD_MAX_FILES_PER_WINDOW`, default 100) are separate limits that both apply to every upload
- Keep the reverse proxy body caps aligned with the app limits: the shipped nginx config uses **2 MiB** by default, **64 KiB** for login, **250 MiB** for `/admin/db` restore requests, **216 MiB** for admin dashboard uploads, and **216 MiB** for the PAT-authenticated external upload route `/api/admin/lr/upload` (a dedicated `^~ /api/admin/lr/upload` location that wins over the generic `^~ /api/admin/` 2 MiB catch-all by longest-prefix match — without it the generic 2 MiB cap 413s every real photo at the edge before the route runs; run-6 cycle-10 AGG-C10-01). The app enforces **200 MiB per file**, a default **2 GiB** cumulative upload window, and **100 files per window**.
- Uses `output: 'standalone'` for Docker deployments
- DB backups stored in `data/backups/` (volume-mounted, not public)
- Docker liveness should probe `/api/live`; `/api/health` is liveness-only by default and performs a DB readiness probe only when `HEALTH_CHECK_DB=true`

## Git Workflow (from AGENTS.md)

- Always commit and push all changes
- Use gitmoji in commit messages (e.g., ✨ :sparkles:, 🐛 :bug:, 📝 :memo:)

## Testing

The repository has a formal test surface:

- `npm test --workspace=apps/web` — Vitest unit tests in `apps/web/src/__tests__/`
- `npm run test:e2e --workspace=apps/web` — Playwright end-to-end tests in `apps/web/e2e/`
- `npm run test:e2e:admin --workspace=apps/web` — authenticated admin Playwright proof; requires local/remote e2e admin credentials
- `CLIP_MODELS_ROOT=<abs-models-root> npm run test:clip:preflight --workspace=apps/web` — real CLIP offline-load + ranking proof before production semantic-search activation
- `npm run lint --workspace=apps/web` — ESLint
- `npm run typecheck --workspace=apps/web` — blocking type gate: `typecheck:app` (tsc against `tsconfig.typecheck.json`, which INCLUDES `src/__tests__/`) + `typecheck:scripts` (JS script checker). Production builds embed the app config, but test-file type errors only surface through this command — run it before committing test changes.
- `npm run audit:prod` — blocking production dependency audit, equivalent to CI's `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` step.

**i18n plural convention (DOC-R5C3-07):** the i18n key-parity check requires the SAME key set in `en.json` and `ko.json`, but the VALUE shape may differ by language. English count strings use ICU plural syntax (`{count, plural, one {# photo} other {# photos}}`); Korean uses a single fixed form (`{count}장`) with no `plural` block — Korean has no grammatical plural, so an ICU `plural` wrapper would be redundant noise. This asymmetry is intentional and expected; do NOT "fix" the ko side to add a `plural` block to match en.

## Lint Gates (security-critical)

Four lint scripts enforce architectural invariants; all are blocking in CI.

- `npm run lint:api-auth --workspace=apps/web`
  - Scans every `apps/web/src/app/api/admin/**/route.{ts,tsx,js,mjs,cjs}` file.
  - Requires each HTTP-method export (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) to wrap `withAdminAuth(...)`. Function-declaration and aliased exports are rejected — use the direct variable-export form so the wrapper is explicit.
  - Fixture-based coverage lives at `apps/web/src/__tests__/check-api-auth.test.ts`.
- `npm run lint:action-origin --workspace=apps/web`
  - Scans `apps/web/src/app/actions/` recursively for server-action-capable extensions (`.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`), including `auth.ts`, plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
  - Requires each exported async mutating function (both `export async function` form and `export const foo = async (...) => {}` / `async function() {}` variable-export forms) to store the `requireSameOriginAdmin()` result and return early when that result is present. Auth actions are scanned too, but they use the approved `hasTrustedSameOrigin` branch before login/logout/password-change mutation. A bare call or ignored result is rejected. Aliased exports are rejected so the scanner can inspect the committed implementation body.
  - Read-only exports must carry an explicit leading comment containing `@action-origin-exempt: <reason>`; getter-style names are not automatically exempt because names are not proof of read-only behavior.
  - **The same pass ALSO enforces the admin-mutation barrier (ARCH9-03):** every mutating export must additionally acquire the restore-window write fence (`using ... = acquireAdminMutationSlot()` from `@/lib/admin-mutation-barrier`, which closes the C77-ARCH-01 restore-race) OR carry an explicit leading `@mutation-barrier-exempt: <reason>` comment. This mirrors the origin-guard requirement so a new action cannot copy the origin check but silently forget the barrier and reopen the restore-window write race — previously the barrier was followed by hand in 12/13 action files with no automated enforcement. Legitimate exemptions live in `db-actions.ts`: `exportImagesCsv` / `dumpDatabase` (read-only w.r.t. application tables, and the restore-maintenance gate already refuses them during a restore window) and `restoreDatabase` (it IS the exclusive side of the barrier — it drains slot holders via `drainAdminMutationsForRestore`, so acquiring a shared slot would deadlock against its own drain; concurrent restores are serialized by the `gallerykit_db_restore` advisory lock instead).
  - Fixture-based coverage lives at `apps/web/src/__tests__/check-action-origin.test.ts`.
- `npm run lint:public-route-rate-limit --workspace=apps/web`
  - Scans every public App Router route handler file under `apps/web/src/app/**/route.*` excluding admin/private segments (including non-`/api` handlers such as feeds, upload-serving fallbacks, and OG routes) that exports a mutating HTTP handler (POST/PUT/PATCH/DELETE) or an expensive public GET handler.
  - Requires each such file to either call a documented rate-limit pre-increment helper from `@/lib/rate-limit` / `@/lib/auth-rate-limit` (helper names starting with `preIncrement` or `checkAndIncrement`), or carry an explicit `@public-no-rate-limit-required: <reason>` comment.
  - Expensive GET detection includes DB/image/filesystem/embedding markers such as `ImageResponse`, DB helpers/imports, file streams, Sharp, and embedding work. Cheap operational GET routes may pass without a limiter; DB-backed health/readiness routes must carry a reasoned exemption if intentionally unauthenticated.
  - Fixture-based coverage lives at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`.
- `npm run lint --workspace=apps/web` — standard ESLint.

**Adding a new mutating server action:** drop a new file in `apps/web/src/app/actions/` and the action-origin scanner will discover it automatically; every mutating export must (1) return early on the `requireSameOriginAdmin()` result AND (2) acquire the `acquireAdminMutationSlot()` restore-window fence — or carry an explicit `@action-origin-exempt` / `@mutation-barrier-exempt` comment for whichever guard it legitimately skips (ARCH9-03). `auth.ts` is scanned and owns its stricter `hasTrustedSameOrigin` guard shape. `public.ts` is scanned too: intentionally unauthenticated public mutating actions must carry `@action-origin-exempt` and prove their own rate-limit-before-mutation contract in code/tests.

## Touch-Target Audit

**Policy: 44x44 px minimum** — all interactive elements (buttons, links, checkboxes, etc.) must present a tappable/clickable area of at least 44x44 px, per WCAG 2.5.5 Target Size (Enhanced) — Level AAA in WCAG 2.2 (44×44 px; WCAG 2.2 also adds 2.5.8 Target Size (Minimum), Level AA, 24×24 px — this repo exceeds both), Apple HIG, and Google MDN guidelines. This is enforced as a blocking unit test at `apps/web/src/__tests__/touch-target-audit.test.ts`.

The vitest fixture at that path enforces the 44 px touch-target floor as a blocking unit test (not a lint script — runs under `npm test --workspace=apps/web`). The audit walks every `.tsx`/`.jsx` file under `SCAN_ROOTS` (= `components/` + the admin route group `app/[locale]/admin/` + the public route group `app/[locale]/(public)/`) recursively, plus app-level entry files listed in `appLevelExtraFiles` such as root error/loading/layout surfaces.

**Pattern coverage** — the FORBIDDEN regex set catches:
- shadcn `<Button size="sm">` / `<Button size="icon">` without an explicit `h-11` / `h-12` / `min-h-11` / `size-11` / `size-12` override — kept as belt-and-braces: `ui/button.tsx` now floors every size variant at ≥ 44 px (`min-h-11`/`size-11`/`min-h-12`/`size-12`), so these hits are 44 px-compliant at runtime today, but the scanner cannot see variant CSS and a future variant downgrade must surface here (R4C15 / OBS-R4C14-A);
- `<Button className="...h-8...">` / `...h-9...` literals and `cn()` composites (explicit downsize overrides — these DO render sub-44);
- HTML `<button className="...h-8/h-9...">` literals;
- sub-44 arbitrary values `min-h-[0-43px]` on `<Button>`, `<button>`, and interactive `<Badge asChild>` wrappers (className lands on the child via Radix Slot), string-literal and `cn()` composite forms (R4C15 DES-R4C15-03).
- native `<select className="...h-8/h-9/h-10...">` literals, `cn()` composites, and sub-44 arbitrary `min-h-[NNpx]` values — hand-styled selects sit outside the shadcn `SelectTrigger` primitive's built-in `min-h-11` floor (R4C16 DES-R4C16-04).
- raw `<input type="checkbox|radio">` whose wrapping interactive element (label/div) carries a sub-44 size (`scanRawCheckboxes`, AGG-R8-03) — the FORBIDDEN regex set never inspected bare native checkboxes/radios, so a 32 px select-all checkbox shipped unseen until run-8 c2.
- sub-44 Tailwind **scale tokens** (`{min-h|min-w|size|h|w}-1..10`, i.e. 4–40 px) on `<Button>`/`<button>` (AGG-R8c3-06) AND `<Link>`/`<a>`/`<select>` (extended in AGG-C7-03; `<select>` uses the height-only `{min-h|h}-1..10` reach since the closed-state trigger is height-sized), string-literal + `cn()` composite, with the usual ≥ 44 (`h-11`/`min-h-11`/`size-11`, plus `w-11`/`min-w-11` where the token reaches `w`) override lookahead and the `(?<!max-)` ceiling lookbehind — the prior literals (`h-8/h-9/h-10/size-10`) + `min-h-[NNpx]` arbitrary-value patterns never matched the scale shorthands, so a 24 px (`min-h-6 min-w-6`) alias-remove button shipped unseen until run-8 c3, and a sub-44 `h-7`/`size-8` on a `<Link>`/`<a>`/`<select>` was likewise invisible until run-9 c4 (the recurring "fix one sibling, miss the next" theme: the catch-all reached Button/button first, then Link/a/select).

**`max-` ceiling exemption (all interactive tag classes)** — every bare `h-8`/`h-9`/`h-10` (and the scale-token catch-all) branch carries a `\b(?<!max-)…` lookbehind so a `max-height`/`max-width` utility (a CEILING, which never constrains the tap target) does NOT false-positive as a sub-44 floor. This lookbehind is present on `<Button>`/`<button>` (added AGG-C4-01 / commit `40a65aef`), native `<select>` (added AGG-C5-02 / commit `07a838d6`), AND `<Link>`/`<a>` (added AGG-C6-04). So `<Link className="max-h-10">` / `<select className="max-h-8">` / `<button className="max-w-9">` are correctly treated as ceilings, not floors. The does-not-flag self-check block carries `max-` negative fixtures for each tag class. This is the recurring "fix one sibling, miss the next" theme — the lookbehind was added one tag-class at a time (Button → select → a/Link) as each adjacent gap surfaced.

**Multi-line tags** — the scanner normalizes multi-line `<Button>` / `<button>` / `<Badge>` / native `<select>` JSX openings into a single logical line (Prettier-default formatting writes any 3+ prop tag across multiple lines). The normalizer balances strings/braces/comments and rewrites `=>` to `=ARROW` so the `[^>]*` lookahead in FORBIDDEN does not stop at arrow operators inside event handlers. See `normalizeMultilineButtonTags` and `scanSource` in the test file. Cycle 3 RPF loop AGG3-M01 added this normalization after the cycle-2 audit was found to silently miss every multi-line Button; R4C15 added `Badge` after the tag-filter chips shipped 32 px through the `asChild` blind spot. R4C16 added native `select` after the upload topic picker shipped 40 px unseen.

**Adding a documented exemption** — raise the `KNOWN_VIOLATIONS[<rel-path>]` count in the test file by the appropriate delta and add a comment block above the entry that:
1. Explains why each violation is acceptable (typically: keyboard-primary admin surface, decorative spinner, or larger pointer-events hit-zone wrapping a smaller visible icon).
2. Provides a concrete re-open criterion (e.g. "when admin becomes mobile-priority OR a fresh violation lands").

Files NOT listed default to 0 violations. Adding a new violation in a file with N existing violations is a hard failure with the offending lines.

## Deployment Checklist

1. Configure `.env.local` with production MySQL credentials and private file permissions (`chmod 600 apps/web/.env.local`; deploy refuses group/world-readable runtime secret files)
2. Generate a unique runtime `SESSION_SECRET`: `openssl rand -hex 32`
3. Copy `apps/web/src/site-config.example.json` to `apps/web/src/site-config.json` and customize it; deploy/build paths now fail fast if the real file is missing. The file is a flat JSON object with **snake_case** keys (read directly via `import siteConfig from '@/site-config.json'` — there is NO camelCase mapping layer, so the key names below are exactly what you must write):
   - `title` — fallback site title and OG/title metadata unless DB `seo_title` overrides it
   - `description` — OG description fallback
   - `url` — canonical base URL used when `BASE_URL` is unset. Production deploy/build paths validate the effective base URL (`BASE_URL || siteConfig.url`) before build; OG runtime paths still fail closed rather than falling back to request-derived hosts
   - `locale` — OpenGraph/SEO locale fallback (e.g. `en_US`); DB `seo_locale` can override the fallback, while HTML `lang` comes from the `[locale]` route
   - `author` — Atom feed-level attribution
   - `copyright` — optional Atom `<rights>` / feed copyright text
   - `nav_title` — nav-bar brand fallback unless DB `seo_nav_title` overrides it
   - `home_link` — nav brand link target (e.g. `/`)
   - `footer_text` — footer text (build-time JSON value)
   - `google_analytics_id` — optional GA measurement id (empty to disable)
   DB-backed admin settings override the editable SEO/branding fields at runtime, but `site-config.json` is the fallback for fresh installs and static build-time values.
4. For local/manual Docker smoke only, run `docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build`. Production per-iteration deploys use `npm run deploy` from the repo root.
5. Initialize DB: container runs committed migrations automatically
6. Access the app through your reverse proxy; the documented host-network compose file binds the app to localhost and enables `TRUST_PROXY=true`. `TRUST_PROXY=true` is REQUIRED behind any proxy: without it the app fails safe but silently degrades — `getClientIp` returns `'unknown'` and every per-IP rate limit collapses into one shared global bucket (five failed logins from anyone lock out everyone), and cookie `secure` falls back to the NODE_ENV branch. The only runtime signal is a first-request `console.error` (run-10 cycle-1 C1-13)

## Remote Deploy Helper

The repo-level deploy helper reads a gitignored root `.env.deploy` file when present, otherwise falls back to `$HOME/.gallerykit-secrets/gallery-deploy.env`; set `DEPLOY_ENV_FILE` to use another path. It derives the SSH deploy command from it by default:

```bash
cp .env.deploy.example .env.deploy
chmod 600 .env.deploy
npm run deploy
```

Keep real SSH keys, hostnames, and optional `DEPLOY_REMOTE_SCRIPT` / `DEPLOY_CMD` overrides in `.env.deploy`; never commit that file.
