# CLAUDE.md — AI Assistant Context for Gallery

## Project Overview

**ATIK.KR Photo Gallery** is a high-performance, self-hosted photo gallery application built with Next.js 16. It features a masonry grid layout, automatic image optimization, EXIF extraction, and multi-user admin authentication.

**Demo:** https://gallery.atik.kr

## Tech Stack

- **Framework:** Next.js 16 (App Router, React 19, TypeScript)
- **Database:** MySQL 8.0+ with Drizzle ORM
- **Authentication:** Argon2 password hashing, session-based auth
- **Image Processing:** Sharp (AVIF, WebP, JPEG conversion)
- **Styling:** Tailwind CSS, Radix UI, shadcn/ui (new-york style)
- **i18n:** next-intl (English, Korean)
- **Deployment:** Docker with standalone output

## Repository Structure

```
gallery/
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
| `apps/web/src/app/actions.ts` | Server actions for uploads, image CRUD, auth |
| `apps/web/src/db/schema.ts` | Drizzle ORM schema (images, topics, tags, users) |
| `apps/web/src/lib/process-image.ts` | Sharp image conversion pipeline |
| `apps/web/src/site-config.json` | Site metadata (title, SEO, links) |
| `apps/web/middleware.ts` | i18n routing, auth middleware |

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

## Important Notes

- **Node.js 24+** required
- Images stored in `apps/web/public/uploads/` - **ensure persistence in Docker**
- Max upload size: 200MB per file, 250MB total (configurable)
- Uses `output: 'standalone'` for Docker deployments

## Git Workflow (from AGENTS.md)

- Always commit and push all changes
- Use gitmoji in commit messages (e.g., ✨ :sparkles:, 🐛 :bug:, 📝 :memo:)

## Testing

No formal test suite. Use the `test/` directory for import utilities and sample data.

## Deployment Checklist

1. Configure `.env.local` with production MySQL credentials
2. Copy `site-config.example.json` to `site-config.json`
3. Run `docker compose up -d --build`
4. Initialize DB: container runs migrations automatically
5. Access at `http://localhost:3000`

