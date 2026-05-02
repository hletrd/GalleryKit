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
│   │   │   │   └── s/[key]/  # Shared link pages
│   │   │   └── actions/      # Server actions (uploads, CRUD, topics, settings)
│   │   ├── components/       # React components
│   │   ├── db/               # Drizzle schema and connection
│   │   ├── lib/              # Utilities (image processing, etc.)
│   │   └── i18n/             # Internationalization config
│   ├── messages/             # Translation files (en.json, ko.json)
│   ├── public/uploads/       # Processed public image derivatives (PERSISTENT)
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

## Key Files & Patterns

| File | Purpose |
|------|---------|
| `apps/web/src/app/actions/` | Server actions for uploads, image CRUD, topics, settings, and admin mutations |
| `apps/web/src/db/schema.ts` | Drizzle ORM schema with composite indexes |
| `apps/web/src/lib/process-image.ts` | Sharp pipeline (parallel AVIF/WebP/JPEG, ICC parsing, bounds checks) |
| `apps/web/src/lib/data.ts` | Data access layer with React cache() deduplication |
| `apps/web/src/proxy.ts` | i18n routing + middleware-level admin auth guard |
| `apps/web/src/lib/auth-rate-limit.ts` | Account-scoped and password-change rate limiting (in-memory Maps with DB backup for login) |
| `apps/web/src/app/[locale]/admin/db-actions.ts` | DB backup/restore with security hardening |
| `apps/web/src/app/api/admin/db/download/route.ts` | Authenticated backup file download |
| `apps/web/src/site-config.json` | File-backed site defaults and static links; DB-backed admin settings override editable SEO/branding fields |

- **Storage Backend (Not Yet Integrated):** The `@/lib/storage` module still exists as an internal abstraction, but the product currently supports local filesystem storage only. Do not document or expose S3/MinIO switching as a supported admin feature until the upload/processing/serving pipeline is wired end-to-end.

## Database Schema (Key Tables)

- `images` - Photo metadata, EXIF data, filenames
- `topics` - Photo albums/categories
- `tags` / `imageTags` - Tagging system
- `adminUsers` / `sessions` - Multi-user authentication
- `sharedGroups` / `sharedGroupImages` - Public sharing

## Image Upload Flow

1. Files uploaded via `uploadImages()` server action
2. Original saved to the private upload store under `data/uploads/original/`
3. Sharp processes to AVIF/WebP/JPEG (async queue)
4. EXIF extracted and stored in database
5. Processed files in `public/uploads/{avif,webp,jpeg}/`

## Security Architecture

### Authentication & Sessions
- Passwords hashed with **Argon2** (industry-standard memory-hard KDF)
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
- **Headers**: `X-Content-Type-Options: nosniff`, immutable cache-control

### Database Security
- Most application queries use Drizzle ORM parameterization; audited raw-SQL surfaces are confined to schema/admin maintenance helpers and must not concatenate untrusted input
- LIKE wildcards (`%`, `_`, `\`) escaped in search to prevent wildcard abuse
- DB backup dumps stored in `data/backups/` (non-public), served via authenticated API route
- DB restore validates file headers and uses `--one-database` flag
- CSV export escapes formula injection characters (`=`, `+`, `-`, `@`) with leading-whitespace tolerance (C7R-RPL-01), strips C0/C1 control characters, strips Unicode bidi override and isolate chars (U+202A-202E, U+2066-2069) against Trojan-Source-style visual reordering (C7R-RPL-11), and strips zero-width / invisible formatting chars (U+200B-200F ZWSP/ZWNJ/ZWJ/LRM/RLM, U+2060 WJ, U+FEFF BOM, U+180E MVS, U+FFF9-FFFB interlinear anchors) against invisible-character formula-injection bypasses (C8R-RPL-01). See `apps/web/src/lib/csv-escape.ts`
- Admin-controlled persistent string fields (`topic.alias`, `tag.name`, `topic.label`, `image.title`, `image.description`, `seo_title`, `seo_description`, `seo_nav_title`, `seo_author`) reject Unicode bidi overrides (U+202A-202E LRE/RLE/PDF/LRO/RLO, U+2066-2069 LRI/RLI/FSI/PDI) and zero-width / invisible formatting characters (U+200B-200F, U+2060, U+FEFF, U+180E, U+FFF9-FFFB) at the validation layer (`UNICODE_FORMAT_CHARS` / `containsUnicodeFormatting` in `apps/web/src/lib/validation.ts`). Closes Trojan-Source-style spoofing on every admin string surface that is rendered back to admins or end users (admin tables, public navigation, photo viewer, lightbox, OG images, SEO `<title>` / `<meta description>` / `<meta og:*>`). Lineage: C7R-RPL-11 / C8R-RPL-01 (CSV) → C3L-SEC-01 (topic alias) → C4L-SEC-01 (tag name) → C5L-SEC-01 (topic.label / image.title / image.description) → C6L-SEC-01 (SEO settings)
- `MYSQL_PWD` env var used for mysqldump/restore (not `-p` flag)

### Privacy
- GPS coordinates (`latitude`, `longitude`) excluded from public API responses
- `filename_original` and `user_filename` excluded from public queries
- `adminSelectFields` includes all fields (including PII) for authenticated admin routes
- `publicSelectFields` derived from `adminSelectFields` by omitting PII fields — separate object reference prevents accidental leakage
- Compile-time guard (`_SensitiveKeysInPublic`) enforces no sensitive keys in `publicSelectFields`


### Runtime topology
- The shipped Docker Compose deployment is a **single web-instance / single-writer** topology. Restore maintenance flags, upload quota tracking, and image queue state are process-local; do not horizontally scale the web service unless those coordination states are moved to a shared store.
- Admin accounts are multiple root admins. The current schema has no role/capability model, so any admin can upload, edit, export/restore DB backups, change settings, and manage other admins.
- Shared-group `view_count` is best-effort approximate analytics: increments are buffered in process memory and flushed asynchronously, so a crash, process kill, or extended DB outage can undercount delivered views. Do not treat it as billing/audit-grade state unless it is moved to durable storage. View counts are only incremented on the initial shared-group page load (when no per-photo query param is present), not on intra-share photo navigation within the same session.

## Database Indexes

The `images` table has composite indexes optimized for query patterns:
- `(processed, capture_date, created_at)` — homepage and gallery listing sort
- `(processed, created_at)` — prev/next navigation
- `(topic, processed, capture_date, created_at)` — topic-filtered listings
- `(user_filename)` — upload deduplication
- `image_tags(tag_id)` — tag JOIN performance

Connection pool: 10 connections, queue limit 20, keepalive enabled.

## Image Processing Pipeline

1. Files uploaded via `uploadImages()` server action
2. Original saved to the private upload store under `data/uploads/original/`
3. Enqueued to `PQueue` (default concurrency: 1; override with `QUEUE_CONCURRENCY`) for background processing
4. Queue job **claims** image (conditional `WHERE processed = false`) before processing
5. Sharp processes to **AVIF/WebP/JPEG in parallel** (`Promise.all`) at configurable sizes each (default: 640, 1536, 2048, 4096; admin-configurable up to 8 sizes)
6. Single Sharp instance with `clone()` (avoids triple buffer decode)
7. Conditional UPDATE marks as processed; if image was deleted mid-processing, orphaned files are cleaned up
8. EXIF extracted with **bounds-checked ICC profile parsing** (capped tagCount, string lengths)
9. Blur placeholder generated at 16px for instant loading. The `blur_data_url` is rendered by `apps/web/src/components/photo-viewer.tsx` as the inner `motion.div` background-image preview during AVIF/WebP/JPEG decode. Values flow through `apps/web/src/lib/blur-data-url.ts` (`isSafeBlurDataUrl` / `assertBlurDataUrl`) at producer (`lib/process-image.ts` blur builder), write time (`uploadImages` in `apps/web/src/app/actions/images.ts`), and read time (photo viewer) so a `data:image/{jpeg,png,webp};base64,…` contract is enforced and the payload is capped at 4 KB. The producer-side wrap (cycle 4 RPF loop AGG4-L01) closes the symmetric defense — a future MIME drift in the producer is caught at the source rather than masked by the consumer-side validation. Locked by fixture tests `__tests__/process-image-blur-wiring.test.ts` and `__tests__/images-action-blur-wiring.test.ts`

## Race Condition Protections

- **Delete-while-processing**: Queue checks row exists before + conditional UPDATE after processing; orphaned files cleaned up
- **Concurrent tag creation**: `INSERT IGNORE` + slug collision detection with warnings
- **Topic slug rename**: Transaction wraps reference updates before PK rename
- **Batch delete**: Wrapped in DB transaction (imageTags + images atomic)
- **Single delete**: Also transactional, removes ID from enqueued set
- **`createTopic` TOCTOU**: Catches `ER_DUP_ENTRY` instead of check-then-insert
- **`ensureDirs`**: Promise-based singleton prevents concurrent mkdir
- **Session secret init**: `INSERT IGNORE` + re-fetch pattern for multi-process safety
- **Concurrent DB restore prevention**: MySQL advisory lock `gallerykit_db_restore` acquired on a dedicated pool connection for the entire restore window. Concurrent restore requests fail fast with `restoreInProgress` instead of racing the 250 MB upload path. The lock is released automatically on connection close, so a crashed restore never wedges the next attempt
- **Upload-processing contract changes**: MySQL advisory lock `gallerykit_upload_processing_contract` serializes uploads with `image_sizes` / `strip_gps_on_upload` changes so the first committed image cannot race a setting that is intended to lock once photos exist
- **Per-image-processing claim**: MySQL advisory lock `gallerykit:image-processing:{jobId}` acquired before processing so two queue workers (e.g. across a restart boundary or a multi-process deployment) cannot both convert the same upload. Paired with a `WHERE processed = false` conditional UPDATE so the losing worker detects the already-processed state and cleans up its leftover variant files
- **Advisory-lock scope note** (C8R-RPL-06 / AGG8R-05): MySQL advisory lock names (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit:image-processing:{jobId}`) are scoped to the MySQL SERVER, not to an individual database. Two GalleryKit instances pointed at the same MySQL server share the same lock namespace and will serialize each other's restores, upload-contract changes, topic renames, admin-user deletes, and image-processing claims across tenants. Run one GalleryKit per MySQL server — or prefix advisory-lock names with a per-instance identifier if multi-tenant co-location is required

## Performance Optimizations

- **React `cache()`** wraps `getImage`, `getTopicBySlug`, `getTopicsWithAliases` for SSR deduplication
- **`Promise.all`** parallelizes independent DB queries in `getImage()` (tags + prev + next)
- **Public route freshness**: public photo, topic, shared, and home pages currently set `revalidate = 0` so asynchronous image processing and metadata updates are visible immediately; admin pages remain dynamic. Reintroduce ISR only with an explicit invalidation/freshness plan
- **Masonry grid**: `useMemo` for reorder, `requestAnimationFrame` debounced resize
- **ImageZoom**: Ref-based DOM manipulation (no React re-renders on mousemove)
- **Histogram**: Canvas capped at 256x256 for fast computation
- **`tag_names` aggregation**: the masonry-list queries (`getImagesLite`, `getImagesLitePage`, `getAdminImagesLite`, plus the full `getImages`) all use a shared `tagNamesAgg` constant in `apps/web/src/lib/data.ts` that compiles to `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` over a `LEFT JOIN imageTags … LEFT JOIN tags … GROUP BY images.id`. A scalar correlated subquery shape using raw SQL aliases (`it`, `t`) previously returned NULL in production, breaking the gallery aria-labels (cycle 1 RPF v3 NF-3, commit aca754c). The fixture-style test at `apps/web/src/__tests__/data-tag-names-sql.test.ts` locks this contract: do not migrate the queries away from `tagNamesAgg` without updating the test.

## Permanently Deferred
- **2FA/WebAuthn**: Not planned. Multiple root admins with Argon2id + rate limiting is sufficient for a personal gallery. Adding TOTP/WebAuthn would add complexity without proportional benefit.

## Important Notes

- **Node.js 24+** required, **TypeScript 6.0+**
- Processed images are stored in `apps/web/public/uploads/`; original uploads are stored privately under the data volume — **ensure both are persisted in Docker**
- Max upload size: 200 MB per file; batch byte cap (`UPLOAD_MAX_TOTAL_BYTES`, default 2 GiB) and batch file-count cap (`UPLOAD_MAX_FILES_PER_WINDOW`, default 100) are separate limits that both apply to every upload
- Keep the reverse proxy body caps aligned with the app limits: the shipped nginx config uses **2 MiB** by default, **64 KiB** for login, **250 MiB** for `/admin/db` restore requests, and **216 MiB** for admin dashboard uploads. The app enforces **200 MiB per file**, a default **2 GiB** cumulative upload window, and **100 files per window**.
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

## Lint Gates (security-critical)

Three lint scripts enforce architectural invariants; all are blocking in CI.

- `npm run lint:api-auth --workspace=apps/web`
  - Scans every `apps/web/src/app/api/admin/**/route.{ts,tsx,js,mjs,cjs}` file.
  - Requires each HTTP-method export (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) to wrap `withAdminAuth(...)`. Function-declaration and aliased exports are rejected — use the direct variable-export form so the wrapper is explicit.
  - Fixture-based coverage lives at `apps/web/src/__tests__/check-api-auth.test.ts`.
- `npm run lint:action-origin --workspace=apps/web`
  - Scans `apps/web/src/app/actions/` recursively for server-action-capable extensions (`.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`), excluding basenames `auth` and `public`, plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
  - Requires each exported async mutating function (both `export async function` form and `export const foo = async (...) => {}` / `async function() {}` variable-export forms) to store the `requireSameOriginAdmin()` result and return early when that result is present. A bare call or ignored result is rejected. Aliased exports are rejected so the scanner can inspect the committed implementation body.
  - Read-only exports must carry an explicit leading comment containing `@action-origin-exempt: <reason>`; getter-style names are not automatically exempt because names are not proof of read-only behavior.
  - Fixture-based coverage lives at `apps/web/src/__tests__/check-action-origin.test.ts`.
- `npm run lint --workspace=apps/web` — standard ESLint.

**Adding a new mutating server action:** drop a new file in `apps/web/src/app/actions/` and the action-origin scanner will discover it automatically; every mutating export must return early on the `requireSameOriginAdmin()` result (or carry an explicit exempt comment). `auth.ts` and `public.ts` are intentionally excluded by name because they own their own same-origin/unauthenticated-surface handling.

## Touch-Target Audit

**Policy: 44x44 px minimum** — all interactive elements (buttons, links, checkboxes, etc.) must present a tappable/clickable area of at least 44x44 px, per WCAG 2.5.5 (Level AAA), Apple HIG, and Google MDN guidelines. This is enforced as a blocking unit test at `apps/web/src/__tests__/touch-target-audit.test.ts`.

The vitest fixture at that path enforces the 44 px touch-target floor as a blocking unit test (not a lint script — runs under `npm test --workspace=apps/web`). The audit walks every `.tsx`/`.jsx` file under `SCAN_ROOTS` (= `components/` + the admin route group `app/[locale]/admin/`) recursively.

**Pattern coverage** — the FORBIDDEN regex set catches:
- shadcn `<Button size="sm">` without an `h-11` / `h-12` / `min-h-11` / `size-11` / `size-12` override (default 32 px);
- shadcn `<Button size="icon">` without an `h-11` / `size-11` override (default 36 px);
- `<Button className="...h-8...">` / `...h-9...` literals and `cn()` composites;
- HTML `<button className="...h-8/h-9...">` literals.

**Multi-line tags** — the scanner normalizes multi-line `<Button>` / `<button>` JSX openings into a single logical line (Prettier-default formatting writes any 3+ prop tag across multiple lines). The normalizer balances strings/braces/comments and rewrites `=>` to `=ARROW` so the `[^>]*` lookahead in FORBIDDEN does not stop at arrow operators inside event handlers. See `normalizeMultilineButtonTags` and `scanSource` in the test file. Cycle 3 RPF loop AGG3-M01 added this normalization after the cycle-2 audit was found to silently miss every multi-line Button.

**Adding a documented exemption** — raise the `KNOWN_VIOLATIONS[<rel-path>]` count in the test file by the appropriate delta and add a comment block above the entry that:
1. Explains why each violation is acceptable (typically: keyboard-primary admin surface, decorative spinner, or larger pointer-events hit-zone wrapping a smaller visible icon).
2. Provides a concrete re-open criterion (e.g. "when admin becomes mobile-priority OR a fresh violation lands").

Files NOT listed default to 0 violations. Adding a new violation in a file with N existing violations is a hard failure with the offending lines.

## Deployment Checklist

1. Configure `.env.local` with production MySQL credentials
2. Generate a unique runtime `SESSION_SECRET`: `openssl rand -hex 32`
3. Copy `site-config.example.json` to `site-config.json` and customize it; deploy/build paths now fail fast if the real file is missing
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
