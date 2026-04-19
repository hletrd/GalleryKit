# CLAUDE.md — AI Assistant Context for GalleryKit

## Project Overview

**GalleryKit** is a high-performance, self-hosted photo gallery application built with Next.js 16. It features a masonry grid layout, automatic image optimization, EXIF extraction, and multi-user admin authentication.

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
│   │   │   └── actions.ts    # Server actions (uploads, CRUD)
│   │   ├── components/       # React components
│   │   ├── db/               # Drizzle schema and connection
│   │   ├── lib/              # Utilities (image processing, etc.)
│   │   └── i18n/             # Internationalization config
│   ├── messages/             # Translation files (en.json, ko.json)
│   ├── public/uploads/       # Uploaded images (PERSISTENT)
│   ├── scripts/              # DB init, migration, seed scripts
│   ├── drizzle/              # Database migrations
│   ├── Dockerfile            # Multi-stage production build
│   └── docker-compose.yml    # Docker deployment config
├── test/                     # Test utilities and sample data
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
npm run lint                  # ESLint check

# Docker Deployment
docker compose -f apps/web/docker-compose.yml up -d --build
```

## Environment Variables

Create `apps/web/.env.local` from `apps/web/.env.local.example`:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=gallery
DB_PASSWORD=password
DB_NAME=gallery
ADMIN_PASSWORD=password
SESSION_SECRET=<random-64-char-hex>
```

## Key Files & Patterns

| File | Purpose |
|------|---------|
| `apps/web/src/app/actions.ts` | Server actions for uploads, image CRUD, auth, session management |
| `apps/web/src/db/schema.ts` | Drizzle ORM schema with composite indexes |
| `apps/web/src/lib/process-image.ts` | Sharp pipeline (parallel AVIF/WebP/JPEG, ICC parsing, bounds checks) |
| `apps/web/src/lib/data.ts` | Data access layer with React cache() deduplication |
| `apps/web/src/proxy.ts` | i18n routing + middleware-level admin auth guard |
| `apps/web/src/app/[locale]/admin/db-actions.ts` | DB backup/restore with security hardening |
| `apps/web/src/app/api/admin/db/download/route.ts` | Authenticated backup file download |
| `apps/web/src/site-config.json` | Site metadata (title, SEO, links) |

## Database Schema (Key Tables)

- `images` - Photo metadata, EXIF data, filenames
- `topics` - Photo albums/categories
- `tags` / `imageTags` - Tagging system
- `adminUsers` / `sessions` - Multi-user authentication
- `sharedGroups` / `sharedGroupImages` - Public sharing

## Image Upload Flow

1. Files uploaded via `uploadImages()` server action
2. Original saved to `public/uploads/original/`
3. Sharp processes to AVIF/WebP/JPEG (async queue)
4. EXIF extracted and stored in database
5. Processed files in `public/uploads/{avif,webp,jpeg}/`

## Security Architecture

### Authentication & Sessions
- Passwords hashed with **Argon2** (industry-standard memory-hard KDF)
- Session tokens: HMAC-SHA256 signed, verified with `timingSafeEqual` (constant-time)
- Cookie attributes: `httpOnly`, `secure` (in production), `sameSite: lax`, `path: /`
- Session secret: auto-generated via `crypto.randomBytes`, stored in `admin_settings` table
- Expired sessions purged automatically (hourly background job)
- Login rate limiting: 5 attempts per 15-minute window per IP, with bounded Map + LRU eviction

### Middleware Auth Guard
- `proxy.ts` checks `admin_session` cookie for all `/[locale]/admin/*` sub-routes
- Unauthenticated requests redirected to login page
- Every server action independently verifies auth via `isAdmin()` (defense in depth)
- Last admin deletion prevented to avoid lockout

### File Upload Security
- **Path traversal prevention**: `SAFE_SEGMENT` regex + `ALLOWED_UPLOAD_DIRS` whitelist + `resolvedPath.startsWith()` containment
- **Symlink rejection**: Both upload routes use `lstat()` and reject `isSymbolicLink()`
- **Filename sanitization**: UUIDs via `crypto.randomUUID()` (no user-controlled filenames on disk)
- **Decompression bomb mitigation**: Sharp `limitInputPixels` configured
- **Directory whitelist**: Only `jpeg`, `webp`, `avif` served publicly; `original/` excluded
- **Headers**: `X-Content-Type-Options: nosniff`, immutable cache-control

### Database Security
- All queries via Drizzle ORM (parameterized, no raw SQL with user input)
- LIKE wildcards (`%`, `_`, `\`) escaped in search to prevent wildcard abuse
- DB backup dumps stored in `data/backups/` (non-public), served via authenticated API route
- DB restore validates file headers and uses `--one-database` flag
- CSV export escapes formula injection characters (`=`, `+`, `-`, `@`, `\t`, `\r`)
- `MYSQL_PWD` env var used for mysqldump/restore (not `-p` flag)

### Privacy
- GPS coordinates (`latitude`, `longitude`) excluded from public API responses
- `filename_original` excluded from public queries
- `adminSelectFields` provides full data only to authenticated admin routes

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
2. Original saved to `public/uploads/original/`
3. Enqueued to `PQueue` (concurrency: 1) for background processing
4. Queue job **claims** image (conditional `WHERE processed = false`) before processing
5. Sharp processes to **AVIF/WebP/JPEG in parallel** (`Promise.all`) at 4 sizes each
6. Single Sharp instance with `clone()` (avoids triple buffer decode)
7. Conditional UPDATE marks as processed; if image was deleted mid-processing, orphaned files are cleaned up
8. EXIF extracted with **bounds-checked ICC profile parsing** (capped tagCount, string lengths)
9. Blur placeholder generated at 16px for instant loading

## Race Condition Protections

- **Delete-while-processing**: Queue checks row exists before + conditional UPDATE after processing; orphaned files cleaned up
- **Concurrent tag creation**: `INSERT IGNORE` + slug collision detection with warnings
- **Topic slug rename**: Transaction wraps reference updates before PK rename
- **Batch delete**: Wrapped in DB transaction (imageTags + images atomic)
- **Single delete**: Also transactional, removes ID from enqueued set
- **`createTopic` TOCTOU**: Catches `ER_DUP_ENTRY` instead of check-then-insert
- **`ensureDirs`**: Promise-based singleton prevents concurrent mkdir
- **Session secret init**: `INSERT IGNORE` + re-fetch pattern for multi-process safety

## Performance Optimizations

- **React `cache()`** wraps `getImage`, `getTopicBySlug`, `getTopicsWithAliases` for SSR deduplication
- **`Promise.all`** parallelizes independent DB queries in `getImage()` (tags + prev + next)
- **ISR caching**: Photo pages (1 week), topic/home pages (1 hour), admin pages force-dynamic
- **Masonry grid**: `useMemo` for reorder, `requestAnimationFrame` debounced resize
- **ImageZoom**: Ref-based DOM manipulation (no React re-renders on mousemove)
- **Histogram**: Canvas capped at 256x256 for fast computation

## Permanently Deferred
- **2FA/WebAuthn**: Not planned. Single-user admin with Argon2id + rate limiting is sufficient for a personal gallery. Adding TOTP/WebAuthn would add complexity without proportional benefit.

## Important Notes

- **Node.js 24+** required, **TypeScript 6.0+**
- Images stored in `apps/web/public/uploads/` — **ensure persistence in Docker**
- Max upload size: 200MB per file, 10GB total per batch, 100 files max (configurable)
- Uses `output: 'standalone'` for Docker deployments
- DB backups stored in `data/backups/` (volume-mounted, not public)

## Git Workflow (from AGENTS.md)

- Always commit and push all changes
- Use gitmoji in commit messages (e.g., ✨ :sparkles:, 🐛 :bug:, 📝 :memo:)

## Testing

The repository has a formal test surface:

- `npm test --workspace=apps/web` — Vitest unit tests in `apps/web/src/__tests__/`
- `npm run test:e2e --workspace=apps/web` — Playwright end-to-end tests in `apps/web/e2e/`
- `npm run lint --workspace=apps/web` — ESLint

## Deployment Checklist

1. Configure `.env.local` with production MySQL credentials
2. Generate a unique `SESSION_SECRET`: `openssl rand -hex 32`
3. Copy `site-config.example.json` to `site-config.json`
4. Run `docker compose up -d --build`
5. Initialize DB: container runs migrations automatically
6. Push schema indexes: `npm run db:push` (from apps/web/)
7. Access at `http://localhost:3000`
