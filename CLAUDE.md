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
npm run db:push               # Push schema to MySQL (drizzle-kit)
npm run db:seed               # Seed admin user
npm run init                  # Full DB initialization

# Linting
npm run lint --workspace=apps/web  # ESLint check

# Docker Deployment
docker compose -f apps/web/docker-compose.yml up -d --build
```

## Environment Variables

Create `apps/web/.env.local` from `apps/web/.env.local.example`:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=gallery
DB_PASSWORD=<change-me>
DB_NAME=gallery
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
| `BASE_URL` | — | Public URL for sitemap, OpenGraph, and RSS feeds (e.g., `https://gallery.example.com`) |
| `IMAGE_BASE_URL` | — | Optional CDN origin/prefix for uploaded assets; must be absolute HTTPS without credentials |
| `TRUST_PROXY` | — | Set to `true` behind nginx/reverse proxy so per-IP rate limiting sees the real client IP |
| `TRUSTED_PROXY_HOPS` | `1` | Number of trusted proxy hops from the right of `X-Forwarded-For`; keep `1` for nginx-only |
| `HEALTH_CHECK_DB` | — | Set to `true` to make `/api/health` probe DB readiness (default is liveness-only) |
| `QUEUE_CONCURRENCY` | `1` | Background image-processing jobs concurrency in this web process |
| `SHARP_CONCURRENCY` | `max(1, floor((cpuCount-1)/3))` | Upper bound for Sharp/libvips threads. When unset, defaults to `max(1, floor((cpuCount-1)/3))` (the `/3` accounts for the AVIF/WebP/JPEG format fan-out so one image stays near `cores-1` total threads). An explicit value is capped at `cpuCount-1` |
| `IMAGE_MAX_INPUT_PIXELS` | `268435456` | Decompression bomb protection cap (default 256M pixels) |
| `IMAGE_MAX_INPUT_PIXELS_TOPIC` | `67108864` | Separate cap for topic images (default 64M; smaller because topic images are 512x512) |
| `UPLOAD_MAX_TOTAL_BYTES` | `2147483648` | Cumulative batch upload size cap (default 2 GiB) |
| `UPLOAD_MAX_FILES_PER_WINDOW` | `100` | Max files accepted per upload tracking window |
| `AUDIT_LOG_RETENTION_DAYS` | `90` | How many days of audit log entries to keep |
| `VIEW_RETENTION_DAYS` | `395` | Analytics view-event retention (default 13 months / 395 days) |
| `ADMIN_BACKFILL_CONCURRENCY` | `1` | In-app color-pipeline backfill concurrency (capped by pool budget; see Operational Playbook) |
| `BACKFILL_CONCURRENCY` | `2` | Sidecar `--rm` backfill concurrency (uncapped; separate MySQL pool) |
| `UPLOAD_ORIGINAL_ROOT` | — | Override path for private original uploads (used by sidecar scripts) |
| `SEMANTIC_SEARCH_ALLOW_PRODUCTION` | — | Operator-only opt-in for production CLIP semantic search (requires model weights) |
| `CLIP_MODELS_ROOT` | `/app/data/models/clip` | Bind-mount path for CLIP model weights (production) |
| `NEXT_UPLOAD_BODY_MAX_BYTES` | `278921216` | Next.js server action body size limit (default 266 MiB = max(200 MiB upload, 250 MiB restore) + 16 MiB multipart overhead; see `upload-limits.ts`) |

## Key Files & Patterns

| File | Purpose |
|------|---------|
| `apps/web/src/app/actions/` | Server actions for uploads, image CRUD, topics, settings, and admin mutations |
| `apps/web/src/db/schema.ts` | Drizzle ORM schema with composite indexes |
| `apps/web/src/lib/process-image.ts` | Sharp pipeline (parallel AVIF/WebP/JPEG, ICC parsing, bounds checks). `IMAGE_PIPELINE_VERSION` (currently 7) is DEFINED in `gallery-config-shared.ts:21` and re-exported here |
| `apps/web/src/lib/color-detection.ts` | NCLX `colr` ISOBMFF walker + ICC heuristic + gain-map + ICC chromaticity unifier |
| `apps/web/src/lib/color-primaries.ts` | Client-safe `WIDE_GAMUT_PRIMARIES` set + `isWideGamutPrimary` helper |
| `apps/web/src/lib/color-pipeline-decisions.ts` | Canonical `COLOR_PIPELINE_DECISIONS` enum + `isP3Pipeline` predicate (client-safe) |
| `apps/web/src/lib/icc-extractor.ts` | ICC `desc` (v2) / `mluc` (v4 UTF-16BE, locale-matched) descriptor parser |
| `apps/web/src/lib/icc-chromaticity.ts` | Custom-monitor ICC gamut detection from `wtpt`/`rXYZ`/`gXYZ`/`bXYZ` (P4-A2) |
| `apps/web/src/lib/gain-map-detection.ts` | Apple HDR gain map detection in HEIF `iinf`/`infe`/`iref` (P4-A1) |
| `apps/web/src/lib/use-display-capability.ts` | Layered display gamut + HDR detection: `screen.colorGamut` → MQ → conservative `'srgb'` for Firefox (R9-R1). **Snapshot-memoized** — `getSnapshot` MUST return a stable reference or `useSyncExternalStore` infinite-loops (React #185) |
| `apps/web/src/lib/settings-hash.ts` | 8-char SHA-256 prefix over color-impacting admin settings, embedded in ETag (P4-E2) |
| `apps/web/src/lib/og-sanitize.ts` | Shared `sanitizeForOg` (Unicode-format + C0 strip) for the Satori OpenGraph cards; imported by both OG routes AND the JSON-LD photo page (AGG-R8-13 / AGG-R8c3-02) |
| `apps/web/src/lib/og-photo-fetch.ts` | `pickFirstAvailablePhotoBuffer` ascending sized-derivative fetch chain for the per-photo OG card. Per-attempt timeout `OG_PHOTO_FETCH_TIMEOUT_MS` (3500 ms, R20C20) is held BELOW the whole-chain `OG_PHOTO_TOTAL_BUDGET_MS` (10 s, R19C19 CQ19-01) so a hung cold/broken path can't exceed the social-crawler deadline; `OG_PHOTO_MAX_BYTES` 1 MB byte cap on each candidate |
| `apps/web/src/lib/color-label.ts` | Client-safe `humanizeColorPrimaries` / `humanizeColorPrimariesOrLabel` (extracted from `color-details-section.tsx` so `wide-gamut-hint.tsx` imports the helper without force-bundling the section, R19C19 CQ19-04) |
| `apps/web/src/lib/search-enrichment-fields.ts` | PII-compile-guarded `searchEnrichmentSelectFields` Drizzle select shared by the semantic + similar-image search routes (type-only `PrivacySensitiveKeys` import keeps the `Extract<…>` guard with no runtime data.ts dependency, R19C19 A2) |
| `apps/web/src/app/api/og/photo/[id]/route.tsx` | Per-photo Satori OG card (1200×630, ≤ `OG_PHOTO_MAX_BYTES` 1 MB, on-disk size fallback via `pickFirstAvailablePhotoBuffer`). The HOME page `og:image` points HERE (`/api/og/photo/${latestId}`, AGG-R8-02) — NOT the base JPEG (which is the largest configured size, 6–12 MB, rejected by Twitter/X > 5 MB). The latest-image id+title for the home card comes from the minimal `getLatestImageForOg` (cached via React `cache()` as `getLatestImageForOgCached`, AGG-R8c3-05), not the full masonry-listing query |
| `apps/web/src/lib/hdr-filenames.ts` | `_hdr.avif` filename derivation helper (RESERVED — NOT WIRED until WI-09 ships; honesty invariant enforced by `_PrivacySensitiveKeys` guard, not a feature flag) |
| `apps/web/src/lib/data.ts` | Data access layer with React cache() deduplication. `_PrivacySensitiveKeys` compile-time guard enforces admin-only fields |
| `apps/web/src/proxy.ts` | i18n routing + middleware-level admin auth guard |
| `apps/web/src/lib/auth-rate-limit.ts` | Account-scoped and password-change rate limiting (in-memory Maps with DB backup for login) |
| `apps/web/src/app/[locale]/admin/db-actions.ts` | DB backup/restore with security hardening |
| `apps/web/src/app/api/admin/db/download/route.ts` | Authenticated backup file download |
| `apps/web/src/site-config.json` | File-backed site defaults and static links; DB-backed admin settings override editable SEO/branding fields |

- **Storage Backend (Not Yet Integrated):** The `@/lib/storage` module still exists as an internal abstraction, but the product currently supports local filesystem storage only. Do not document or expose S3/MinIO switching as a supported admin feature until the upload/processing/serving pipeline is wired end-to-end.

## Database Schema (Key Tables)

- `images` - Photo metadata, EXIF data, filenames, color/HDR audit columns
- `topics` - Photo albums/categories
- `tags` / `imageTags` - Tagging system
- `adminUsers` / `sessions` - Multi-user authentication
- `sharedGroups` / `sharedGroupImages` - Public sharing
- `image_views` / `topic_views` / `shared_group_views` - Analytics events (US-P44). **Retention (AGG-H2, run-6 cycle-2):** these are written by per-IP-rate-limited but otherwise anonymous public endpoints, so to bound growth on the single MySQL writer the hourly background GC (`image-queue.ts`) runs `purgeOldViewEvents()` (`apps/web/src/lib/view-retention.ts`), a chunked DELETE of rows older than `VIEW_RETENTION_DAYS` (default 395 days / 13 months, preserving a full prior year for year-in-review). A negative / non-finite `VIEW_RETENTION_DAYS` falls back to the default (never a future cutoff — same R4C6 COR-R4C6-10 guard as the audit-log sweep). Locked by `__tests__/view-retention.test.ts`.
- `image_embeddings` - CLIP embeddings (US-P51). The real jina-clip-v2 encoder is **ACTIVATED in production** (operator decision): the production deployment runs `semantic_search_mode=production` (DB `admin_settings` row) with `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (env) and ~445 real `jina-clip-v2-d512-q8` embeddings serving live natural-language (ko+en) + image→image search. The CODE default in `gallery-config-shared.ts` remains `semantic_search_mode: 'disabled'` — correct for fresh installs; the production DB row overrides it at runtime only when the env opt-in is set (the resolver heals a stored `'production'` to `'disabled'` without `SEMANTIC_SEARCH_ALLOW_PRODUCTION`). Stub mode uses non-meaningful deterministic (non-normalized) vectors. The production weights load OFFLINE (`allowRemoteModels=false`) from the `CLIP_MODELS_ROOT` bind-mount (the prod `.env.local` MUST set the absolute `CLIP_MODELS_ROOT` so the downloader seed target and the runtime offline-load source agree — see `lib/clip-paths.ts`). MEDIUMBLOB stores the raw 2048-byte float32 vector (read via `decodeEmbeddingColumn`, AGG-C10-01)
- `admin_tokens` - Lightroom Classic publish-plugin PATs (US-P53). Each token is issued in the format `gk_<base64url(32 random bytes)>` (46 chars total: a 3-char `gk_` prefix + 43 base64url chars), scoped to one admin user, stored SHA-256-hashed in the DB. Beyond the owning admin, each token also carries a **functional scope set** (`AdminTokenScope` = `'lr:upload' | 'lr:read' | 'lr:delete'`, `lib/admin-tokens.ts`): a non-empty subset enforced at the route via `withAdminAuth({ allowTokenScope })` → `tokenHasScope()`, so a token without the required scope is rejected even though it authenticates. Each row also has an optional `expires_at` (a token past its expiry fails verification) and a `last_used_at` touched on use. The plugin (`/api/admin/lr/upload`) accepts the token in an `X-GalleryKit-Token` header (case-insensitive; the constant is `x-gallerykit-token` in `lib/api-auth.ts`) and creates images directly without a session cookie. Tokens can be rotated or revoked from the dedicated admin Tokens page. The LR upload route has a dedicated nginx body-size location (216 MiB) that wins over the generic `/api/admin/` 2 MiB catch-all by longest-prefix match.
- `smart_collections` - Admin-defined dynamic galleries (US-P42). Each row stores a name, slug, and a JSON predicate AST in the `query_json` column (`schema.ts:297`) that defines matching criteria (e.g., topic, tag, date range, color pipeline decision). Photos are matched dynamically at query time; no materialized join table. The public route `/c/[slug]` renders a smart collection the same way as a topic gallery (NOTE: `/s/[key]` is the shared-links route, NOT smart collections). Smart collection mutations (create, update, delete) are gated by `getRestoreMaintenanceMessage()` like all other mutating admin actions.

### `images` color / HDR columns (admin-only via `_PrivacySensitiveKeys` guard)

| Column | Source | Notes |
|--------|--------|-------|
| `color_space` | EXIF `ColorSpace` tag value (`'sRGB'` / `'Uncalibrated'`) | admin-only — NOT the ICC name |
| `icc_profile_name` | ICC `desc` (v2) / `mluc` (v4 UTF-16BE) descriptor | admin-only — locale-matched on `mluc` (P4-E1) |
| `bit_depth` | Sharp `metadata.depth` mapped to bits | admin-only — source bit depth, not delivered |
| `color_pipeline_decision` | Resolver enum (`p3-from-displayp3`, `p3-from-adobergb`, etc.) | admin-only |
| `color_primaries` | NCLX > ICC chromaticity > ICC name | public |
| `transfer_function` | NCLX (PQ / HLG / sRGB / gamma22 / gamma24 / gamma26 / gamma28 / gamma18 / linear / unknown) | admin-only — `gamma24` (NCLX 14/15, BT.1886) and `gamma26` (NCLX 17, DCI-P3) are emitted for real files; `gamma28` (NCLX 5 = BT.470BG, PAL·SECAM gamma 2.8 — AGG-R7C2-01) corrects the prior gamma22/"System M" mislabel (System M is code 4); `gamma18` comes from ICC name heuristics (ProPhoto path via `lib/color-detection.ts:99-108`, AGG-D3) |
| `matrix_coefficients` | NCLX | admin-only |
| `is_hdr` | Derived from `transfer_function in ('pq', 'hlg')` | admin-only — the public HDR badge is now gated on `isAdmin && isHdr` EXPLICITLY at the render point (AGG-M3), not on field-nullness coincidence; locked by `color-details-section-delivered` / `lightbox-color-pip-hdr` tests |
| `has_gain_map` | Apple HDR gain map detection in HEIF `iinf`/`infe`/`iref` (P4-A1) | admin-only |
| `was_downscaled` | Whether a 50 MP+ wide-gamut source was downscaled to ≤ `WIDE_GAMUT_MAX_SOURCE_PIXELS` before the rgb16 fan-out | admin-only — omitted from `publicSelectFields`, in `_PrivacySensitiveKeys`, persisted by both backfill entry points |
| `avif_10bit` | libheif 10-bit-encode probe result (whether the AVIF was actually encoded at 10-bit) | public-safe (R10-M4) — describes encoded output, not source PII; present in `publicSelectFields` and surfaced in the public Color Details audit |
| `pipeline_version` | Encoder version used to produce derivatives (current: 7) | admin-only |
| `uploaded_by` | Admin user id captured on upload; FK to `admin_users(id)` with `ON DELETE SET NULL` (R17-L2) | admin-only — public Atom currently uses the feed-level author until a safe public display-name field exists |

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
- Cookie attributes: `httpOnly`, `secure` (in production), `sameSite: lax`, `path: /`
- Session secret: `SESSION_SECRET` env var is required in production; dev/test can fall back to a DB-stored generated secret in `admin_settings`
- Expired sessions purged automatically (hourly background job)
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
- **Headers**: `X-Content-Type-Options: nosniff` (global `headers()` rule); derivatives use `Cache-Control: public, max-age=3600, must-revalidate` — deliberately NOT `immutable`, because backfill re-encodes rewrite bytes in place under unchanged filenames (R4C6 ARCH-R4C6-06; same policy in `next.config.ts headers()`, `serve-upload.ts`, and `nginx/default.conf`)

### Database Security
- Most application queries use Drizzle ORM parameterization; audited raw-SQL surfaces are confined to schema/admin maintenance helpers and must not concatenate untrusted input
- LIKE wildcards (`%`, `_`, `\`) escaped in search to prevent wildcard abuse
- DB backup dumps stored in `data/backups/` (non-public), served via authenticated API route
- Admin DB backup/restore is SQL-only. It snapshots and restores database rows, then runs the committed migration/reconcile postconditions after import, but it does not snapshot or roll back host files in `data/uploads/original`, `public/uploads`, or `public/resources`. Use host-level filesystem backups/reconciliation for full rollback.
- DB restore validates file headers and uses `--one-database` flag
- CSV export escapes formula injection characters (`=`, `+`, `-`, `@`) with leading-whitespace tolerance (C7R-RPL-01), strips C0/C1 control characters, strips Unicode bidi override and isolate chars (U+202A-202E, U+2066-2069) against Trojan-Source-style visual reordering (C7R-RPL-11), and strips zero-width / invisible formatting chars (U+200B-200F ZWSP/ZWNJ/ZWJ/LRM/RLM, U+2060 WJ, U+FEFF BOM, U+180E MVS, U+FFF9-FFFB interlinear anchors) against invisible-character formula-injection bypasses (C8R-RPL-01). See `apps/web/src/lib/csv-escape.ts`
- Admin-controlled persistent string fields (`topic.alias`, `tag.name`, `topic.label`, `image.title`, `image.description`, `seo_title`, `seo_description`, `seo_nav_title`, `seo_author`) reject Unicode bidi overrides (U+202A-202E LRE/RLE/PDF/LRO/RLO, U+2066-2069 LRI/RLI/FSI/PDI) and zero-width / invisible formatting characters (U+200B-200F, U+2060, U+FEFF, U+180E, U+FFF9-FFFB) at the validation layer (`UNICODE_FORMAT_CHARS` / `containsUnicodeFormatting` in `apps/web/src/lib/validation.ts`). Closes Trojan-Source-style spoofing on every admin string surface that is rendered back to admins or end users (admin tables, public navigation, photo viewer, lightbox, OG images, SEO `<title>` / `<meta description>` / `<meta og:*>`). Lineage: C7R-RPL-11 / C8R-RPL-01 (CSV) → C3L-SEC-01 (topic alias) → C4L-SEC-01 (tag name) → C5L-SEC-01 (topic.label / image.title / image.description) → C6L-SEC-01 (SEO settings)
- Defense-in-depth runtime strip for the Satori-rendered OpenGraph cards: `sanitizeForOg` in `apps/web/src/lib/og-sanitize.ts` strips Unicode bidi/zero-width formatting (the global-flag `stripUnicodeFormatting`) **and** C0 control chars before any admin-controlled string (site title, topic label, tags, JSON-LD camera/lens/exposure) reaches the image render. ONE shared sanitizer is imported by all three consumers — both OG image routes (`api/og/route.tsx`, `api/og/photo/[id]/route.tsx`) and the JSON-LD photo page (`p/[id]/page.tsx`) — so a future loosened SEO/topic/tag validator cannot let bidi/C0 chars reach ONE card while the others strip them. Non-exploitable today (admin-controlled + validator-rejected inputs, Satori renders text into an image), pure symmetry/defense-in-depth. Lineage: AGG-R8-13 (extract shared lib + wire both OG routes) → AGG-R8c3-02 (migrate the JSON-LD page's third copy + add C0 parity). Pinned by `__tests__/sanitize-for-og-global.test.ts` (all three consumers import the shared helper) + `__tests__/og-sanitize.test.ts`
- **OG route SSRF hardening:** production builds validate the effective canonical base URL (`BASE_URL || siteConfig.url`) through `apps/web/scripts/ensure-site-config.mjs` before `next build` runs. The per-photo OG route still treats the inbound request origin as attacker-controllable at request time: internal derivative fetches are pinned to trusted `siteConfig.url`, and fallback redirects are derived from the canonical SEO/site URL, never from `new URL(req.url).origin`. If the canonical URL cannot be parsed, the fallback fails closed instead of redirecting to a request-derived host. The topic OG route does not perform the per-photo internal derivative fetch.
- `MYSQL_PWD` env var used for mysqldump/restore (not `-p` flag)

### Privacy
- GPS coordinates (`latitude`, `longitude`) excluded from public API responses
- `strip_gps_on_upload` additionally scrubs the on-disk ORIGINAL: lossless byte-level GPS-IFD / GPS-bearing-XMP neutralization for JPEG / TIFF / HEIF-AVIF-HEIC / WebP via `apps/web/src/lib/gps-exif-strip.ts`; PNG and structurally anomalous files take a metadata-free re-encode (autoOrient + keepIccProfile, explicit high-quality settings). Never use Sharp `withMetadata()` for stripping — `withMetadata()` keeps most input metadata (EXIF/XMP/IPTC) including GPS coordinates; in Sharp 0.33+ this behaviour is explicit (R4C8 COR-R4C8-01)
- `filename_original` and `user_filename` excluded from public queries
- `adminSelectFields` includes all fields (including PII) for authenticated admin routes
- `publicSelectFields` derived from `adminSelectFields` by omitting PII fields — separate object reference prevents accidental leakage
- Compile-time guard (`_SensitiveKeysInPublic`) enforces no sensitive keys in `publicSelectFields`


### Runtime topology
- The shipped Docker Compose deployment is a **single web-instance / single-writer** topology. Restore maintenance flags, upload quota tracking, and image queue state are process-local; do not horizontally scale the web service unless those coordination states are moved to a shared store. The admin-backfill-runner status (`running`/counts/`lastError`) and the in-memory rate-limit fast-path buckets are ALSO process-local (AGG-D5/ARCH-07): the backfill runner is correctness-fenced by the `gallerykit_color_pipeline_backfill` advisory lock (only its status surface is per-process), and the login rate-limit bucket has a DB backup — but the other rate-limit buckets (OG/share/search/semantic) are per-process, so distributed-attack defense weakens under scale-out. The shared-group view-count buffer is best-effort-by-design (flushed on graceful SIGTERM, lost on SIGKILL).
- Admin accounts are multiple root admins. The current schema has no role/capability model, so any admin can upload, edit, export/restore DB backups, change settings, and manage other admins.
- Shared-group `view_count` is best-effort approximate analytics: increments are buffered in process memory and flushed asynchronously, so a crash, process kill, or extended DB outage can undercount delivered views. Do not treat it as billing/audit-grade state unless it is moved to durable storage. View counts are only incremented on the initial shared-group page load (when no per-photo query param is present), not on intra-share photo navigation within the same session.

## Database Indexes

The `images` table has composite indexes optimized for query patterns:
- `(processed, capture_date, created_at)` — homepage and gallery listing sort
- `(processed, created_at)` — prev/next navigation
- `(topic, processed, capture_date, created_at)` — topic-filtered listings
- `(user_filename)` — upload deduplication
- `(uploaded_by)` — admin upload-attribution queries
- `image_tags(tag_id)` — tag JOIN performance
- `image_views(image_id, viewed_at)` — per-image view lookups (`idx_image_views_image_id_viewed_at`, migration 0010)
- `image_views(bot, viewed_at, country_code)` — analytics country breakdown (migration 0021)
- `image_views(bot, viewed_at, referrer_host)` — analytics referrer breakdown (migration 0021)

Connection pool: 10 connections, queue limit 20, keepalive enabled.

## Image Processing Pipeline

1. Files uploaded via `uploadImages()` server action
2. Original saved to the private upload store under `data/uploads/original/`
3. Enqueued to `PQueue` (default concurrency: 1; override with `QUEUE_CONCURRENCY`) for background processing
4. Queue job **claims** image (conditional `WHERE processed = false`) before processing
5. Sharp processes to **AVIF/WebP/JPEG in parallel** (`Promise.all`) at configurable sizes each (default: 640, 1536, 2048, 4096, 5120, 7680; admin-configurable up to 8 sizes)
6. Per-format **fresh** `sharp(inputPath, …)` instance (WI-14 cross-format isolation — see the Color & HDR "Encoder decision matrix" note), with `clone()` used only WITHIN a format (e.g. the 10-bit AVIF fallback). NOTE (AGG-R7-08): the encoder does NOT keep a single decoded instance across formats/sizes — it opens a fresh decode per output to eliminate shared-state contamination, trading decode reuse for correctness (the encoder no longer keeps a shared decoded `image` var across formats, and the per-path WI-14 "fresh sharp instance per format for ALL paths" note lives in `generateForFormat` in `process-image.ts` — search the `WI-14 / R8-R8` comment rather than a brittle line number, which drifts on every edit)
7. Conditional UPDATE marks as processed; if image was deleted mid-processing, orphaned files are cleaned up
8. EXIF extracted with **bounds-checked ICC profile parsing** (capped tagCount, string lengths)
9. Blur placeholder generated at 16px for instant loading. The `blur_data_url` is rendered by `apps/web/src/components/photo-viewer.tsx` as the inner `motion.div` background-image preview during AVIF/WebP/JPEG decode. Values flow through `apps/web/src/lib/blur-data-url.ts` (`isSafeBlurDataUrl` / `assertBlurDataUrl`) at producer (`lib/process-image.ts` blur builder), write time (`uploadImages` in `apps/web/src/app/actions/images.ts`), and read time (photo viewer) so a `data:image/{jpeg,png,webp};base64,…` contract is enforced and the payload is capped at 4096 chars (~3 KB decoded; `MAX_BLUR_DATA_URL_LENGTH` in `blur-data-url.ts`). The producer-side wrap (cycle 4 RPF loop AGG4-L01) closes the symmetric defense — a future MIME drift in the producer is caught at the source rather than masked by the consumer-side validation. Locked by fixture tests `__tests__/process-image-blur-wiring.test.ts` and `__tests__/images-action-blur-wiring.test.ts`

## Color & HDR Pipeline (photographer-intent surface)

The product premise: photos arrive AFTER the photographer's editing. The encoder + viewer must deliver the photographer's intent — gamut, tonality, dynamic range — accurately to every viewer's display, on every supported browser. **No edit / culling / scoring features ship in product.**

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

On the paths it serves, `serve-upload.ts` emits `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` (the hash is already 8 chars — `HASH_LENGTH` in `settings-hash.ts` — so there is no `.slice(0,8)` at the ETag site). The settings hash (P4-E2) covers all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:45-57`) — the 5 color keys `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, the 3 quality keys `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, and `image_sizes` — so flipping any color-, quality-, or size-impacting admin setting invalidates cached variants on that path automatically (AGG-R7-08 corrected the count from a stale "5"). **Hash stability note:** `image_sizes` is sorted ascending before hashing so that `[640,1536]` and `[1536,640]` produce the same hash — the admin UI stores the array in display order, but the encoder normalizes before hashing to prevent spurious invalidation (AGG-R7C3-02). On the static path, invalidation rides the mtime+size ETag: a backfill re-encode rewrites the file, changing both. Pipeline version bumps invalidate all variants for all images on the serve-upload path and (via re-encode mtime changes) on the static path after backfill. **Operational gotcha (CRT-D1):** flipping a color/quality/size admin setting does NOT invalidate already-served STATIC derivatives (the on-disk bytes — and therefore the mtime+size ETag — are unchanged until a re-encode). The settings-hash ETag only affects the serve-upload path. The static path serves the overwhelming majority of real traffic, so an admin who changes a setting and expects new bytes everywhere must run a backfill re-encode to rewrite the files. **Adding a new color-impacting setting (AGG-R7C3-02):** when a new admin setting changes derivative BYTES, add it to `COLOR_IMPACTING_KEYS` in `settings-hash.ts` so the serve-upload-path ETag invalidates on change. A compile-time guard (`_ColorKeysAreSettingKeys`, `settings-hash.ts`) catches a typo'd or removed key at `tsc`, but it CANNOT catch a forgotten *new* byte-impacting key (a valid setting key is still a valid key) — that is on the author, same class as the migration admin-only-column checklist.

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

`apps/web/scripts/backfill-color-pipeline.ts` re-runs `processImageFormats` on photos whose `pipeline_version != IMAGE_PIPELINE_VERSION`. Idempotent: skips rows already at current version unless `--force-reencode` is passed. Acquires the `gallerykit_color_pipeline_backfill` MySQL advisory lock on a dedicated connection so two concurrent runs serialize.

**Two equivalent entry points** — the sidecar `--rm` script above and the in-app admin Settings "Re-encode existing photos" button (`apps/web/src/app/actions/admin-backfill.ts` → `apps/web/src/lib/admin-backfill-runner.ts`, R27-UX-HIGH-1) both re-encode behind the same `gallerykit_color_pipeline_backfill` advisory lock and persist the SAME DB column set as a fresh upload (`pipeline_version`, `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`, `was_downscaled`, `avif_10bit`). They serialize against each other, so you can use whichever is convenient. On a successful re-encode whose color detection THEN fails transiently, both paths leave `pipeline_version` behind the current version (the re-encode is idempotent) so a later run retries detection — they never strand stale color metadata at the current version (Run-2 Cycle 1 AGG-01 / AGG-02). Both paths ALSO guard the delete-during-reencode race identically: every UPDATE checks `affectedRows`, and on `0` (the row was deleted mid-reencode — `deleteImage` does NOT take the per-image processing lock, so it can interleave) they clean up the just-written derivative files via `deleteImageVariants(dir, fn, [])` (full directory scan, so non-default-size variants are caught too) and count the row as `deleted-mid-reencode` (neither a success nor a failure), so re-encoding an already-deleted image never orphans files on disk (the in-app runner landed this in Run-8 Cycle-3 AGG-R8c3-03; the sidecar `flushBatch` in Run-9 Cycle-1 AGG-C4-02). The contract is locked by `__tests__/backfill-color-pipeline.test.ts` (column set) and `__tests__/admin-backfill-runner-detection-failure.test.ts` (no version bump on detection failure).

**Concurrency env vars (distinct — AGG-R7-08):** the two entry points read DIFFERENT env vars with DIFFERENT budgeting:
- **In-app** `ADMIN_BACKFILL_CONCURRENCY` (default 1) is clamped at runner start to a connection-budget cap so a background re-encode cannot starve live request traffic on the shared 10-connection pool. The cap (`resolveBackfillConcurrency` in `admin-backfill-runner.ts`) is `max(1, floor((POOL_CONNECTION_LIMIT − RESERVED − 1) / 2))` with `RESERVED = max(3, ceil(POOL_CONNECTION_LIMIT / 2))` — at the shipped pool of 10 this is **2** (a backfill pins ≤ 1 advisory-lock + 2×2 worker connections = 5, leaving ≥ 5 free so a live photo/gallery render's multi-query `Promise.all` doesn't queue behind encode-duration holds; AGG-5 raised the reserve from the prior 1-free cap of 4). Requests above the cap are clamped DOWN with a warning log.
- **Sidecar** `BACKFILL_CONCURRENCY` (default 2, see the `--rm` command below) is **uncapped** — it runs in a separate `--rm` container with its own MySQL pool, so it is not bound by the live web instance's pool budget.

**Operational pattern (production)** — the production runtime container has prod-deps only and lacks `tsx` + the TypeScript source files. Running the backfill safely:

```bash
docker run --rm \
  --name gk-backfill \
  --network host \
  -v /home/ubuntu/gallery/apps/web/src:/app/apps/web/src:ro \
  -v /home/ubuntu/gallery/apps/web/scripts:/app/apps/web/scripts:ro \
  -v /home/ubuntu/gallery/apps/web/data:/app/data \
  -v /home/ubuntu/gallery/apps/web/public/uploads:/app/apps/web/public/uploads \
  -v /home/ubuntu/gallery/apps/web/public/resources:/app/apps/web/public/resources \
  -v /home/ubuntu/gallery/apps/web/tsconfig.json:/app/apps/web/tsconfig.json:ro \
  --env-file /home/ubuntu/gallery/apps/web/.env.local \
  -e BACKFILL_CONCURRENCY=2 -e UPLOAD_ORIGINAL_ROOT=/app/data/uploads/original \
  --user root -w /app/apps/web web-web:latest \
  sh -c "npx --yes tsx@4.21.0 scripts/backfill-color-pipeline.ts"
```

**Critical:** never `npm install` inside the running `gallerykit-web` container. The runtime's `/app/node_modules` is the prod-deps tree from the Dockerfile build; an in-container `npm install --no-save` clobbered `argon2` / `mysql2` / `sharp` once and triggered a restart loop until the next deploy rebuilt the image. The `--rm` sidecar pattern above leaves the prod container untouched.

### Browser × OS × display matrix (delivery honesty)

| Browser | OS | Display | P3 AVIF | `(color-gamut: p3)` MQ | `(dynamic-range: high)` MQ | `screen.colorGamut` API |
|---|---|---|---|---|---|---|
| Safari 17+ | macOS / iOS | P3 (+HDR on Pro) | ✓ | ✓ | ✓ | Safari 18+ TP |
| Chrome 122+ | macOS / Win / Android 14+ | P3 | ✓ | ✓ | ✗ (Chromium gap) | ✓ |
| Edge 122+ | Windows 11 | P3 + Auto HDR | ✓ | ✓ | ✓ (Auto HDR ON) | ✓ |
| Firefox 124+ | macOS / Win | P3 | ✓ (FF 113+) | ✓ (parsed, always false — bug 1626624) | ✗ | ✗ |
| Chrome | Android 13- | sRGB-only mid-range | sRGB-clipped delivery | ✗ | ✗ | varies |

`useDisplayCapability` layers `screen.colorGamut` -> `(color-gamut: p3)` MQ -> conservative `'srgb'` default (for browsers that support neither). The canvas-P3 probe is NOT used for display detection because it tests API capability, not display gamut, producing systematic false positives on sRGB displays (R9-R1). Source: caniuse mdn-css_at-rules_media_color-gamut (verified 2026-06-12).

**Firefox photographer-visible impact (R10-H4):**
- Firefox parses the `(color-gamut: p3)` MQ syntax since v110, but it **always returns false** because Firefox does not implement wide-gamut rendering (Mozilla bug 1626624, still open). So `useDisplayCapability` falls back to the conservative `'srgb'` default on ALL Firefox versions. P3 badges and the `WideGamutHint` are suppressed for all Firefox visitors regardless of actual display capability. `screen.colorGamut` is unsupported in Firefox across all versions.
- **Firefox ≤ 109:** no `color-gamut` MQ support at all, so the same conservative `'srgb'` fallback applies.
- **Consequence — HDR detection gap (all Firefox):** the `(dynamic-range: high)` MQ is not implemented in Firefox, so `isHdr` always returns `false` on Firefox regardless of version.
- **Mitigation:** The `force_show_color_chips` admin toggle overrides display detection and renders P3/HDR badges unconditionally — useful for demos on Firefox ≤ 109 or when testing HDR metadata display. The admin settings UI documents this gap (R10-H4-FULL).

**Display-change limitations:**
- `screen.colorGamut` has no change-event API. Chrome/Safari/Edge compensate via the `color-gamut` MQ change event, but the MQ may fire before `screen.colorGamut` updates, causing a brief mismatch.
- Firefox ≤ 109 has no `color-gamut` MQ at all, so display-gamut changes (dragging between monitors) are only detected on `focus` / `visibilitychange` (R9-R3). Firefox 110+ parses the MQ syntax but it always returns false (wide-gamut rendering not implemented), so the practical behavior is the same as ≤109.
- Dual-monitor macOS: when a browser window spans P3 + sRGB displays, `screen.colorGamut` reports the primary/focused display, leaving the other half incorrect (R9-M12). There is no web-platform per-display gamut API.

## Race Condition Protections

- **Delete-while-processing**: Queue checks row exists before + conditional UPDATE after processing; orphaned files cleaned up
- **Concurrent tag creation**: `INSERT IGNORE` + slug collision detection with warnings
- **Topic route-segment serialization**: the `gallerykit_topic_route_segments` advisory lock (`withTopicRouteMutationLock`) wraps **`createTopic`, `updateTopic`, AND `createTopicAlias`** — not just renames — so a topic create, rename, or alias creation cannot race another into the same route segment. A `TopicRouteLockTimeoutError` can therefore surface on any of the three operations.
- **Topic slug rename**: the rename is a delete+insert recreate; one transaction re-points EVERY store that references the old slug before deleting the old row — `images.topic`, `topicAliases.topicSlug`, `topic_views.topic` (the three FK children; `topic_views` was added R16C16 DBG-16-01 — missing it CASCADE-wiped up to `VIEW_RETENTION_DAYS` of analytics), and `smart_collections.query_json` eq/in topic predicates (R16C16 DBG-16-03; `contains`/range predicates are intentionally NOT remapped). No `ON UPDATE CASCADE` exists, so each child is re-pointed by hand — adding a new slug-referencing store requires extending this transaction.
- **Upload quota TOCTOU**: per-window upload count/byte limits are checked SYNCHRONOUSLY then the claim is made before the first `await` (disk + topic-exists), so two concurrent same-key uploads cannot both pass before either claims (R16C16 CR-16-01). Every awaited early-return AND the topic-exists query's throw path rolls the claim back via `settleUploadTrackerClaim(..., 0, 0)` so a rejected/errored upload leaves no phantom claim (R17C17 CR-17-1).
- **Batch delete**: Wrapped in DB transaction (imageTags + images atomic)
- **Single delete**: Also transactional, removes ID from enqueued set
- **`createTopic` TOCTOU**: Catches `ER_DUP_ENTRY` instead of check-then-insert
- **`ensureDirs`**: Promise-based singleton prevents concurrent mkdir
- **Session secret init**: `INSERT IGNORE` + re-fetch pattern for multi-process safety
- **Concurrent DB restore prevention**: MySQL advisory lock `gallerykit_db_restore` acquired on a dedicated pool connection for the entire restore window. Concurrent restore requests fail fast with `restoreInProgress` instead of racing the 250 MB upload path. The lock is released automatically on connection close, so a crashed restore never wedges the next attempt
- **Upload-processing contract changes**: MySQL advisory lock `gallerykit_upload_processing_contract` serializes uploads with `image_sizes` / `strip_gps_on_upload` changes so the first committed image cannot race a setting that is intended to lock once photos exist
- **Per-image-processing claim**: MySQL advisory lock `gallerykit:image-processing:{jobId}` acquired before processing so two queue workers (e.g. across a restart boundary or a multi-process deployment) cannot both convert the same upload. Paired with a `WHERE processed = false` conditional UPDATE so the losing worker detects the already-processed state and cleans up its leftover variant files
- **Concurrent backfill prevention**: MySQL advisory lock `gallerykit_color_pipeline_backfill` acquired on a dedicated connection for the whole color-pipeline backfill window. Two concurrent backfill invocations serialize cleanly rather than racing the same image rows.
- **Advisory-lock scope note** (C8R-RPL-06 / AGG8R-05): MySQL advisory lock names (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`) are scoped to the MySQL SERVER, not to an individual database. Two GalleryKit instances pointed at the same MySQL server share the same lock namespace and will serialize each other's restores, upload-contract changes, topic create/rename/alias mutations, admin-user deletes, backfill runs, and image-processing claims across tenants. Run one GalleryKit per MySQL server — or prefix advisory-lock names with a per-instance identifier if multi-tenant co-location is required

## Performance Optimizations

- **React `cache()`** wraps 10 data-access functions for SSR deduplication — every `data.ts` export ending in `Cached` (`getImageCached`, `getLatestImageForOgCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSmartCollectionBySlugCached`) plus `getSeoSettings`
- **`Promise.all`** parallelizes independent DB queries in `getImage()` (tags + prev + next)
- **Public route freshness**: public photo, topic, shared, and home pages currently set `revalidate = 0` so asynchronous image processing and metadata updates are visible immediately; admin pages remain dynamic. Reintroduce ISR only with an explicit invalidation/freshness plan
- **Masonry grid**: pure CSS multi-column layout (`columns-1 sm:columns-2 … 2xl:columns-5` + `break-inside-avoid`) — no JS reorder pass; `requestAnimationFrame`-debounced resize handler for column-count-dependent sizing
- **ImageZoom**: Ref-based DOM manipulation (no React re-renders on mousemove)
- **Histogram**: Canvas capped at 256x256 for fast computation
- **`tag_names` aggregation**: the masonry-list queries (`getImagesLite`, `getImagesLitePage`, `getAdminImagesLite`, plus the full `getImages`) all use a shared `tagNamesAgg` constant in `apps/web/src/lib/data.ts` that compiles to `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` over a `LEFT JOIN imageTags … LEFT JOIN tags … GROUP BY images.id`. A scalar correlated subquery shape using raw SQL aliases (`it`, `t`) previously returned NULL in production, breaking the gallery aria-labels (cycle 1 RPF v3 NF-3, commit aca754c). The fixture-style test at `apps/web/src/__tests__/data-tag-names-sql.test.ts` locks this contract: do not migrate the queries away from `tagNamesAgg` without updating the test.

## Service Worker / PWA (US-P24)

- `public/sw.template.js` is the SHIPPED service worker source; `scripts/build-sw.ts` stamps `__SW_VERSION__` (git short-SHA + `-p{IMAGE_PIPELINE_VERSION}`) into `public/sw.js` via the `prebuild` hook. After editing the template, regenerate and commit `sw.js`.
- `lib/sw-cache.ts` is the unit-tested REFERENCE implementation of the LRU logic; `__tests__/sw-template-contract.test.ts` pins the template against drift (R4C6 TEST-R4C6-11).
- **Image derivatives**: stale-while-revalidate with an ETag HEAD probe, 50 MB LRU cap. The synchronous HEAD revalidation is **bounded by `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` (300 ms, AGG-R8-05)** — on a slow/hung network the probe aborts and the SW serves the cached bytes immediately + revalidates in the background, so a warm masonry paint never stalls per-tile on the network. The synchronous-freshness intent (serve fresh colors right after an admin color-setting change, R10-H3/R4C9) is preserved on a fast network, just bounded. Pinned by `__tests__/sw-template-contract.test.ts` (template + generated `sw.js`).
- **HTML offline fallback (deliberate Cache-Control (`no-cache`) exemption, R4C6 COR-R4C6-05)**: every public page sets `revalidate = 0` (dynamic rendering; Next.js emits no-cache response headers for dynamically rendered routes), so a Cache-Control-honoring SW could never populate an offline cache. `networkFirstHtml` therefore caches 200 GET HTML explicitly as an OFFLINE-ONLY fallback (entries served exclusively when the network is unreachable; 24 h TTL; 50-entry cap), excluding admin routes, revocable share pages (`/s/<key>` and `/g/<key>` with optional locale prefix), and any page rendered WITH an admin session. Admin-rendered pages are identified by the `x-gk-admin-render: 1` response header set in `proxy.ts` — the SW cannot read the request `Cookie` header (Fetch-spec forbidden header), so the server makes the personalization decision and the SW honors it.

## Migration & Schema-Drift Runbook

The Drizzle MySQL migrator (`node_modules/drizzle-orm/mysql-core/dialect.cjs:62` — internal reference; file/line drifts across drizzle-orm versions; informational only, migrate.js uses its own hash-based post-conditions) decides whether to apply each journal entry by:

```js
if (lastDbMigration.created_at < migration.folderMillis) apply
```

It only checks `MAX(created_at)` — not per-entry hashes — across `__drizzle_migrations`. **The journal in this repo has non-monotonic `when` timestamps** (some 2026 dates, some 2025), so a single max-row baseline poisons the cursor and the migrator silently skips every entry whose `when` is below the cursor. This burned production once: the schema sat at the post-`0011` state for months while every deploy logged "[Migration] Complete." with no error, and the new color/HDR + gain-map columns never got applied.

**Permanent fix in `apps/web/scripts/migrate.js`:**

- `getAllJournalMigrations(folder)` reads the full journal and returns one record per entry (tag + `folderMillis = entry.when` + `hash = SHA256(SQL file content)`).
- `prepareLegacyDatabaseIfNeeded` no longer compares `MAX(created_at)` to `Math.max(...whens)`. Instead it checks `every(journal entry's hash present in __drizzle_migrations)`. If any are missing AND the DB carries gallery tables, it runs `reconcileLegacySchema(connection, dbName)` (idempotent CREATE/ALTER guards for every table + column the schema knows about) and then `baselineAllJournalMigrations(connection, journalMigrations)` (one row per entry, idempotent on hash).
- `runMigrations(connection, folder, expectedMigrations)` calls drizzle's `migrate()` then post-conditions: every journal hash MUST be in `__drizzle_migrations`, otherwise `throw new Error(\`Drizzle silently skipped N migration(s): tag1, tag2, …\`)` and the deploy fails loud. This catches future drift the moment it happens.

**Adding a new migration:**

1. Drop a new SQL file in `apps/web/drizzle/NNNN_<name>.sql`.
2. Add an entry to `apps/web/drizzle/meta/_journal.json` with `idx = NNNN`, `tag = "NNNN_<name>"`, and a `when` value **strictly greater** than `Math.max(...current journal whens)`. Use `Date.now()` at commit time. Failing to monotonically advance `when` causes drizzle to silently skip your migration; the post-condition assertion will then fail the next deploy.
3. Update `reconcileLegacySchema` in `migrate.js` to mirror the new schema state (idempotent CREATE/ALTER) so a fresh DB without `__drizzle_migrations` rows can baseline cleanly.
4. Update `apps/web/src/db/schema.ts`.
5. If the new column is admin-only, add it to the `_omit*` block in `apps/web/src/lib/data.ts` AND to the `_PrivacySensitiveKeys` type guard AND to the `SENSITIVE_KEYS` fixture in `apps/web/src/__tests__/privacy-fields.test.ts`.

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

`npm run deploy` from the repo root reads gitignored `.env.deploy`, ssh-deploys to `gallery.atik.kr`, and runs `apps/web/deploy.sh` on the host (which `git pull`s the worktree and rebuilds the Docker image via compose). The deploy is **per-iteration** by project policy — every commit pushed to `master` is followed by a deploy. There is no staging environment.

### Disk hygiene

The deploy host has 124 G total. Repeated deploys accumulate Docker images + builder cache that can fill the disk; once disk hits 100 % the next `git pull` on the deploy host fails with `unable to write loose object file: No space left on device`.

**`apps/web/deploy.sh` now auto-prunes after every deploy** so the host stays clean without manual intervention. Immediately after `docker compose up -d --build` it runs `docker container prune -f`, `docker image prune -af`, `docker builder prune -af`, and `docker volume prune -f`, then prints `df -h /`. The prune runs AFTER the stack is back up, so the live `gallerykit-web` container + its just-built image are in-use and survive it.

**In-use data is never deleted — guaranteed by the persistence model, not by luck:** GalleryKit persistence is BIND MOUNTS (`./data` → originals + DB backups, `./public/uploads` → processed derivatives, `./public/resources` → topic cover resources, `./src/site-config.json` → config), which are host directories `docker volume prune` cannot touch; immutable public assets such as `sw.js`, icons, fonts, and workers come from the freshly built image. MySQL runs on the host (`network_mode: host`, 127.0.0.1), so there is no DB Docker volume. The automatic volume prune deliberately omits `-a` (anonymous/dangling volumes only, never named volumes). When changing the deploy prune logic, preserve all three guarantees: prune-after-`up`, bind-mounted data, and no `-a` on the automatic `volume prune`.

If the host is ALREADY wedged at 100 % (so a deploy can't even `git pull`), free disk manually first, then re-deploy:

```bash
ssh ubuntu@atik.kr
docker container prune -f
docker image prune -af          # only removes images not referenced by a running container
docker builder prune -af        # frees BuildKit cache (often 10-20 G)
docker volume prune -af         # safe here: gallery data is bind-mounted, not a Docker volume
df -h /
```

The running `gallerykit-web` container's image survives `docker image prune -af` because `-a` only removes unused images.

**Real incident (2026-06-17) — userspace starvation past the point of SSH recovery:** disk exhaustion once wedged the host so hard that userspace itself was starved — `nginx`, `sshd`, AND the Node app all stopped responding at the application layer while TCP handshakes on `:443` / `:22` still completed (kernel/network alive, userspace blocked). `ssh` hung at "banner exchange" even with a 60 s `ConnectTimeout`, so the manual `ssh … && docker prune` recovery above was UNREACHABLE. Recovery was a **block-volume resize** — the host self-healed once disk pressure lifted (no reboot needed, no data loss; bind-mounted `./data`, `./public/uploads`, `./public/resources`, and host MySQL were never at risk; the filesystem now reports 124 G at ~21 % used). Lesson: if the host is starved past the point where `ssh` can return a shell, the prune recovery cannot run — use the cloud provider's **console / serial console (or resize the block volume)** to relieve disk first, then prune. The per-deploy auto-prune is the primary prevention; watch the `df -h /` line in the deploy logs for a host trending toward full.

### Don't `npm install` inside the running production container

The runtime container's `/app/node_modules` is a curated prod-deps tree from the Dockerfile's `prod-deps` stage. An in-container `npm install --no-save <anything>` will resolve and reinstall the dep tree against `package.json`, which can drop production deps that aren't reachable from `package.json`'s `dependencies` field directly (e.g. argon2, mysql2 transitives), break startup, and put `gallerykit-web` into a restart loop. The site goes 502 until the next deploy rebuilds the image cleanly.

For one-off scripts that need source files / dev-only deps (tsx, vitest, etc.), use a **sidecar `--rm` container** off the just-built `web-web:latest` image with read-only source mounts (see "Backfill" section under "Color & HDR Pipeline" for the canonical pattern). This leaves the production container untouched.

### CLIP semantic search — seeding model weights on the deploy host

The CLIP model weights are **NOT baked into the Docker image** (they are tens-of-hundreds of MB and live on the host volume). The image only guarantees the mount point exists (`/app/data/models/clip`, created by `mkdir -p` in the runner stage and surfaced via `CLIP_MODELS_ROOT`). The runtime encoder reads weights from that path at first inference.

**One-time seed procedure (run before enabling semantic search in production):**

```bash
# On the deploy host, seed weights into the bind-mount directory.
# The ./data/models directory is part of the ./data bind mount declared in
# docker-compose.yml, so it persists across every deploy and is never touched
# by docker image prune / builder prune (bind mounts are not managed volumes).
docker run --rm \
  --name gk-clip-seed \
  --network host \
  -v /home/ubuntu/gallery/apps/web/src:/app/apps/web/src:ro \
  -v /home/ubuntu/gallery/apps/web/scripts:/app/apps/web/scripts:ro \
  -v /home/ubuntu/gallery/apps/web/data:/app/data \
  --env-file /home/ubuntu/gallery/apps/web/.env.local \
  -e CLIP_MODELS_ROOT=/app/data/models/clip \
  --user root -w /app/apps/web web-web:latest \
  sh -c "npx --yes tsx@4.21.0 scripts/download-clip-models.ts"
```

**After seeding, run a forced `--production` backfill** to generate CLIP embeddings for all existing photos before production mode is enabled:

```bash
docker run --rm \
  --name gk-clip-backfill \
  --network host \
  -v /home/ubuntu/gallery/apps/web/src:/app/apps/web/src:ro \
  -v /home/ubuntu/gallery/apps/web/scripts:/app/apps/web/scripts:ro \
  -v /home/ubuntu/gallery/apps/web/data:/app/data \
  --env-file /home/ubuntu/gallery/apps/web/.env.local \
  -e CLIP_MODELS_ROOT=/app/data/models/clip \
  --user root -w /app/apps/web web-web:latest \
  sh -c "npx --yes tsx@4.21.0 scripts/backfill-clip-embeddings.ts --production --force"
```

The `--force` flag is required in the documented pre-enable flow because a fresh DB still stores `semantic_search_mode='disabled'`; without `--force`, the backfill exits successfully without processing. After the DB mode is already set to `stub` or `production`, `--force` is only needed when intentionally re-embedding existing rows.

**Activating production (operator-only, deliberate):** the resolver heals a stored
`semantic_search_mode='production'` to `'disabled'` UNLESS the app environment sets
`SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (AGG-C10-02). The admin Settings UI intentionally
offers only Disabled/Stub — there is no one-click production toggle. To go live: seed the
weights (above), run the `--production --force` backfill (above), set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`
in `.env.local`, and set the DB row `admin_settings.semantic_search_mode='production'`. Without
the env flag the routes 503 regardless of the DB value.

**Runtime limits:** `SEMANTIC_SCAN_LIMIT` (default 2000) caps the brute-force vector scan
for semantic search — the maximum number of embedding rows the route will read from the
DB per query. `SEMANTIC_TOP_K_MAX` (default 50) is the hard ceiling on results returned
to the client; the admin UI default is 20. Both limits prevent unbounded CPU/DB consumption
on expensive natural-language queries.

**Why the binary is already present without extra Dockerfile steps:** `onnxruntime-node` (the CPU inference engine used by `@huggingface/transformers`) bundles its native `.node` binding for all platforms — including `linux/arm64` and `linux/x64` — **directly inside the npm package tarball** (`bin/napi-v3/linux/{arm64,x64}/onnxruntime_binding.node`). Its `postinstall` script only downloads CUDA `.so` files, which are not needed for CPU inference. Since `onnxruntime-node` is a non-dev, non-optional transitive production dependency (via `@huggingface/transformers → onnxruntime-node`), it is installed by `npm ci --omit=dev` in the `prod-deps` stage without any `--include=optional` or explicit extra install step. No Dockerfile change is required to make the CPU binding available at runtime.

### Production photographer-perspective audit history

The `.context/reviews/` directory contains the running history of "as photographers" comprehensive reviews:

- `photographer-r3/` (2026-05-08) — first comprehensive R3 pass, 4 CRIT + 7 HIGH findings.
- `cycle1-rpf-photographer/` … `cycle8-rpf-photographer/` — the 8 cycles of /review-plan-fix that closed nearly all of R3 (commits `94c43393` through `689822d4`).
- `photographer-r4/` (2026-05-08) — R4 fresh pass after cycle 9 convergence; 0 CRIT + 2 HIGH (Apple gain map detection, ICC chromaticity-based gamut detection) + 5 MED + 4 LOW.

The current state of the photographer surface is documented in `photographer-r4/_aggregate.md` and the implementation plan that landed in commits `94c43393` through `2b6cfdb5`.

## Permanently Deferred
- **2FA/WebAuthn**: Not planned. Multiple root admins with Argon2id + rate limiting is sufficient for a personal gallery. Adding TOTP/WebAuthn would add complexity without proportional benefit.
- **Paid downloads / Stripe (US-P54): REMOVED, do not re-add.** GalleryKit is a free, open-source gallery with **no payment surface**. The Stripe paid-download feature was removed entirely (operator decision, run-8): the `entitlements` table + `images.license_tier` column were dropped (migration `0023_remove_paid_downloads`), and the checkout/webhook/paid-download routes, the `sales` admin page + action, the `stripe`/`license-tiers`/`download-tokens`/`download-interstitial` libs, the paid i18n keys, and the `stripe` dependency were all deleted. The **free** direct-download button (JPEG/AVIF derivatives) was KEPT and made unconditional. Do not reintroduce Stripe, entitlements, `license_tier`, or any checkout/payment flow without an explicit new product decision.

## Important Notes

- **Node.js 24+** required, **TypeScript 6.0+**
- Processed images are stored in `apps/web/public/uploads/`, runtime topic covers are stored in `apps/web/public/resources/`, and original uploads are stored privately under the data volume — **ensure all three mutable stores are persisted in Docker**
- Max upload size: 200 MB per file; batch byte cap (`UPLOAD_MAX_TOTAL_BYTES`, default 2 GiB) and batch file-count cap (`UPLOAD_MAX_FILES_PER_WINDOW`, default 100) are separate limits that both apply to every upload
- Keep the reverse proxy body caps aligned with the app limits: the shipped nginx config uses **2 MiB** by default, **64 KiB** for login, **250 MiB** for `/admin/db` restore requests, **216 MiB** for admin dashboard uploads, and **216 MiB** for the Lightroom Classic publish-plugin upload route `/api/admin/lr/upload` (a dedicated `^~ /api/admin/lr/upload` location that wins over the generic `^~ /api/admin/` 2 MiB catch-all by longest-prefix match — without it the generic 2 MiB cap 413s every real photo at the edge before the route runs; run-6 cycle-10 AGG-C10-01). The app enforces **200 MiB per file**, a default **2 GiB** cumulative upload window, and **100 files per window**.
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
- `npm run lint --workspace=apps/web` — ESLint
- `npm run typecheck --workspace=apps/web` — blocking type gate: `typecheck:app` (tsc against `tsconfig.typecheck.json`, which INCLUDES `src/__tests__/`) + `typecheck:scripts` (JS script checker). Production builds embed the app config, but test-file type errors only surface through this command — run it before committing test changes.

**i18n plural convention (DOC-R5C3-07):** the i18n key-parity check requires the SAME key set in `en.json` and `ko.json`, but the VALUE shape may differ by language. English count strings use ICU plural syntax (`{count, plural, one {# photo} other {# photos}}`); Korean uses a single fixed form (`{count}장`) with no `plural` block — Korean has no grammatical plural, so an ICU `plural` wrapper would be redundant noise. This asymmetry is intentional and expected; do NOT "fix" the ko side to add a `plural` block to match en.

## Lint Gates (security-critical)

Four lint scripts enforce architectural invariants; all are blocking in CI.

- `npm run lint:api-auth --workspace=apps/web`
  - Scans every `apps/web/src/app/api/admin/**/route.{ts,tsx,js,mjs,cjs}` file.
  - Requires each HTTP-method export (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) to wrap `withAdminAuth(...)`. Function-declaration and aliased exports are rejected — use the direct variable-export form so the wrapper is explicit.
  - Fixture-based coverage lives at `apps/web/src/__tests__/check-api-auth.test.ts`.
- `npm run lint:action-origin --workspace=apps/web`
  - Scans `apps/web/src/app/actions/` recursively for server-action-capable extensions (`.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`), excluding basenames `auth` and `public`, plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
  - Requires each exported async mutating function (both `export async function` form and `export const foo = async (...) => {}` / `async function() {}` variable-export forms) to store the `requireSameOriginAdmin()` result and return early when that result is present. A bare call or ignored result is rejected. Aliased exports are rejected so the scanner can inspect the committed implementation body.
  - Read-only exports must carry an explicit leading comment containing `@action-origin-exempt: <reason>`; getter-style names are not automatically exempt because names are not proof of read-only behavior.
  - Fixture-based coverage lives at `apps/web/src/__tests__/check-action-origin.test.ts`.
- `npm run lint:public-route-rate-limit --workspace=apps/web`
  - Scans every PUBLIC API route file (`apps/web/src/app/api/**` excluding `api/admin/**`) that exports a mutating HTTP handler (POST/PUT/PATCH/DELETE).
  - Requires each such file to either call a documented rate-limit pre-increment helper from `@/lib/rate-limit` / `@/lib/auth-rate-limit` (helper names starting with `preIncrement` or `checkAndIncrement`), or carry an explicit `@public-no-rate-limit-required: <reason>` comment.
  - GET handlers are NOT scanned — expensive public GET routes (ImageResponse, file generation) must be audited separately or opt out with the same exempt tag.
  - Fixture-based coverage lives at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`.
- `npm run lint --workspace=apps/web` — standard ESLint.

**Adding a new mutating server action:** drop a new file in `apps/web/src/app/actions/` and the action-origin scanner will discover it automatically; every mutating export must return early on the `requireSameOriginAdmin()` result (or carry an explicit exempt comment). `auth.ts` is intentionally excluded by name because it owns its own same-origin handling. `public.ts` is scanned with the narrower public-rate-limit contract for intentionally unauthenticated analytics writes.

## Touch-Target Audit

**Policy: 44x44 px minimum** — all interactive elements (buttons, links, checkboxes, etc.) must present a tappable/clickable area of at least 44x44 px, per WCAG 2.5.5 Target Size (Enhanced) — Level AAA in WCAG 2.2 (44×44 px; WCAG 2.2 also adds 2.5.8 Target Size (Minimum), Level AA, 24×24 px — this repo exceeds both), Apple HIG, and Google MDN guidelines. This is enforced as a blocking unit test at `apps/web/src/__tests__/touch-target-audit.test.ts`.

The vitest fixture at that path enforces the 44 px touch-target floor as a blocking unit test (not a lint script — runs under `npm test --workspace=apps/web`). The audit walks every `.tsx`/`.jsx` file under `SCAN_ROOTS` (= `components/` + the admin route group `app/[locale]/admin/` + the public route group `app/[locale]/(public)/`) recursively.

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

1. Configure `.env.local` with production MySQL credentials
2. Generate a unique runtime `SESSION_SECRET`: `openssl rand -hex 32`
3. Copy `apps/web/src/site-config.example.json` to `apps/web/src/site-config.json` and customize it; deploy/build paths now fail fast if the real file is missing. The file is a flat JSON object with **snake_case** keys (read directly via `import siteConfig from '@/site-config.json'` — there is NO camelCase mapping layer, so the key names below are exactly what you must write):
   - `title` — displayed in nav, footer, and OG title
   - `description` — OG description fallback
   - `url` — canonical base URL (must match `BASE_URL` env var). Production deploy/build paths validate the effective base URL (`BASE_URL || siteConfig.url`) before build; OG runtime paths still fail closed rather than falling back to request-derived hosts
   - `locale` — OG/HTML locale (e.g. `en_US`)
   - `author` — Atom feed attribution
   - `nav_title` — nav-bar brand text
   - `home_link` — nav brand link target (e.g. `/`)
   - `footer_text` — footer text
   - `google_analytics_id` — optional GA measurement id (empty to disable)
   DB-backed admin settings override the editable SEO/branding fields at runtime, but `site-config.json` is the fallback for fresh installs and static build-time values.
4. Run `docker compose -f apps/web/docker-compose.yml up -d --build`
5. Initialize DB: container runs committed migrations automatically
6. Access the app through your reverse proxy; the documented host-network compose file binds the app to localhost and enables `TRUST_PROXY=true`

## Remote Deploy Helper

The repo-level deploy helper reads a gitignored root `.env.deploy` file and derives the SSH deploy command from it by default:

```bash
cp .env.deploy.example .env.deploy
npm run deploy
```

Keep real SSH keys, hostnames, and optional `DEPLOY_REMOTE_SCRIPT` / `DEPLOY_CMD` overrides in `.env.deploy`; never commit that file.
