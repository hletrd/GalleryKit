<p align="center">
  <img src=".github/assets/logo.svg" alt="GalleryKit" width="120" height="120">
</p>

<h1 align="center">GalleryKit</h1>

<p align="center">
  A high-performance, self-hosted photo gallery built with Next.js
</p>

<p align="center">
  <a href="https://github.com/hletrd/gallerykit"><img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16"></a>
  <a href="https://github.com/hletrd/gallerykit"><img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19"></a>
  <a href="https://github.com/hletrd/gallerykit"><img src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" alt="TypeScript 6"></a>
  <a href="https://github.com/hletrd/gallerykit"><img src="https://img.shields.io/badge/Sharp-Image_Processing-99CC00?logo=sharp&logoColor=white" alt="Sharp"></a>
  <a href="https://github.com/hletrd/gallerykit"><img src="https://img.shields.io/badge/MySQL-8.0+-4479A1?logo=mysql&logoColor=white" alt="MySQL 8.0+"></a>
  <a href="https://github.com/hletrd/gallerykit"><img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker"></a>
  <a href="https://github.com/hletrd/gallerykit/blob/master/LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue" alt="Apache 2.0"></a>
</p>

<p align="center">
  <a href="https://gallery.atik.kr">Live Demo</a> &middot;
  <a href="#getting-started">Getting Started</a> &middot;
  <a href="#docker-deployment">Docker</a>
</p>

---

## Features

- **Masonry Grid Layout** -- responsive, column-balanced photo grid with infinite scroll
- **Multi-Format Optimization** -- automatic AVIF, WebP, and JPEG conversion via Sharp pipeline
- **Topics & Albums** -- organize photos into categories with slug aliases
- **EXIF Extraction** -- camera model, lens, ISO, aperture, shutter speed, focal length, GPS
- **Tagging & Search** -- full metadata search across titles, descriptions, cameras, and tags
- **Sharing** -- per-photo and group share links with Base56 short keys
- **Admin Dashboard** -- drag-and-drop uploads, batch editing, multiple root-admin accounts (Argon2; no role separation yet)
- **Internationalization** -- English and Korean (next-intl)
- **Docker Support** -- standalone output with documented Linux host-network + reverse-proxy deployment

## Configuration

Site configuration lives in `apps/web/src/site-config.json`:

```json
{
    "title": "Site Title",
    "description": "Site Description",
    "url": "https://your-site.com",
    "parent_url": "https://parent-site.com",
    "locale": "en_US",
    "author": "Author Name",
    "nav_title": "Navigation Title",
    "home_link": "/",
    "footer_text": "Footer Text",
    "google_analytics_id": "G-XXXXXXXXXX"
}
```

## Directory Structure

```
gallerykit/
├── apps/web/                 # Next.js application
│   ├── src/
│   │   ├── app/              # App Router (pages, API routes, server actions)
│   │   ├── components/       # React components
│   │   ├── db/               # Drizzle ORM schema & connection
│   │   ├── lib/              # Utilities (image processing, data layer)
│   │   └── i18n/             # Internationalization config
│   ├── messages/             # Translation files (en.json, ko.json)
│   ├── public/uploads/       # Processed public image derivatives (persistent volume)
│   ├── scripts/              # DB init, migration, seed scripts
│   ├── Dockerfile            # Multi-stage production build
│   └── docker-compose.yml    # Docker deployment config
└── package.json              # Monorepo root (npm workspaces)
```

## Getting Started

### Prerequisites

- **Node.js** v24+
- **npm**
- **MySQL** v8.0+

### Installation

```bash
git clone https://github.com/hletrd/gallerykit.git
cd gallerykit
npm install
# Create a MySQL database/user first, then copy and edit the app environment.
cp apps/web/.env.local.example apps/web/.env.local
$EDITOR apps/web/.env.local
cp apps/web/src/site-config.example.json apps/web/src/site-config.json
$EDITOR apps/web/src/site-config.json
npm run init --workspace=apps/web
npm run dev
```

After the dev server starts, log in at `/en/admin`, upload one photo, and confirm the public homepage renders it.

### Remote Deploy Helper

To let local automation deploy without re-entering SSH details each run, keep the target SSH config in a gitignored root `.env.deploy` file:

```bash
cp .env.deploy.example .env.deploy
$EDITOR .env.deploy
npm run deploy
```

`npm run deploy` now derives the SSH deploy command from `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`, and `DEPLOY_PATH`. Use `DEPLOY_REMOTE_SCRIPT` if you only need to change the remote entrypoint while keeping the derived SSH wrapper. Keep `DEPLOY_CMD` only as an escape hatch when you need a fully custom command.

### Environment Setup

Do this before `npm run init --workspace=apps/web`; the init script needs DB credentials plus `ADMIN_PASSWORD`. `SESSION_SECRET` is required for production runtime session signing, but it is not an init-time requirement. Edit `apps/web/.env.local` with your MySQL credentials, strong admin bootstrap secret, runtime session secret, and public URLs:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=your_user
DB_PASSWORD=<change-me>
DB_NAME=gallery
ADMIN_PASSWORD=<strong-16+-char-secret-or-argon2-hash>
SESSION_SECRET=<openssl rand -hex 32>
BASE_URL=http://localhost:3000
# Optional: serve uploaded assets from a CDN or reverse proxy prefix
# IMAGE_BASE_URL=https://cdn.example.com
# DB_SSL=false  # TLS is enabled automatically for non-localhost DB_HOST values; set false only behind a trusted private link.
# QUEUE_CONCURRENCY=2
# UPLOAD_MAX_TOTAL_BYTES=2147483648
# UPLOAD_MAX_FILES_PER_WINDOW=100
# TRUST_PROXY=true
```

If you ever seeded an environment from older checked-in examples, rotate both
`SESSION_SECRET` and any bootstrap/admin credentials immediately. Historical
git values must be treated as compromised and must not be reused.

If you set `IMAGE_BASE_URL`, do it **before** running `next build` / `docker compose ... --build` so Next.js can allow that remote host for optimized images and CSP. The shipped compose file forwards `IMAGE_BASE_URL` and `UPLOAD_MAX_TOTAL_BYTES` as Docker build args when they are present in the shell/Compose environment; export them before `docker compose ... --build` if you rely on non-default build-time values. Use `https://` for production asset origins; plaintext `http://` is only acceptable for local development.
`DB_SSL` defaults to TLS for non-localhost database hosts and plaintext for loopback/private local development; set `DB_SSL=false` only when the database connection is protected by a trusted private network. `QUEUE_CONCURRENCY` controls the in-process `PQueue` image conversion workers (default `2`); raise it only after confirming CPU and memory headroom.
If you raise `UPLOAD_MAX_TOTAL_BYTES`, make sure your reverse proxy, temp storage, and container memory can safely handle that batch size. The shipped nginx config now caps general requests at **2 GiB** and `/admin/db` restore requests at **250 MB** to match the app-side limits; keep those layers aligned if you customize either side.
The shipped `apps/web/docker-compose.yml` already forces `TRUST_PROXY=true` and binds the standalone server to `127.0.0.1` when you use the documented host-network + nginx deployment. It is intended as a single web-instance/single-writer deployment; restore maintenance, upload quotas, and image queue state are process-local. Keep those protections if you adapt the compose file, and do not scale the web service horizontally without moving those coordination states into shared storage.

**`TRUST_PROXY=true` is required for rate limiting to work correctly behind a reverse proxy** (nginx, Caddy, Cloudflare, load balancers, etc.). The server reads `X-Forwarded-For` / `X-Real-IP` only when this flag is set; without it, `getClientIp()` returns `"unknown"` and every request collapses into a single shared rate-limit bucket, which both (a) lets abusive clients exhaust the login / search / share budgets shared with legitimate users, and (b) lets spoofed `X-Forwarded-For` headers be ignored (since they are never trusted at all). The same trusted-proxy setting also affects same-origin validation for mutating admin actions, login cookie security, and DB backup downloads, so the proxy must overwrite `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` with values from the trusted edge hop. Only enable when the incoming headers are actually set by a trusted proxy hop.
For bootstrap auth, prefer a generated secret or a precomputed Argon2 hash; do not deploy with placeholder passwords such as `password`.

### Development

```bash
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000).

### Building

```bash
npm run build
```

## Docker Deployment

1. Configure `apps/web/.env.local`
2. Ensure you are on a Linux host that supports `network_mode: host`, or adapt `apps/web/docker-compose.yml` for your container network.
3. Provide a real `apps/web/src/site-config.json` on the host before starting the compose stack; production/deploy builds now fail fast when that file is missing instead of silently copying the example template.
4. Run:

```bash
docker compose -f apps/web/docker-compose.yml up -d --build
```

The application listens on port 3000 on localhost; publish it through your reverse proxy rather than exposing the host-network process directly. New original uploads are kept in the private data volume, while processed JPEG/WebP/AVIF derivatives remain under `public/uploads/`.

Legacy originals must not remain under `public/uploads/original/`. The startup path now fails closed in production if that legacy public-original directory still contains files.
The container liveness probe now uses `/api/live`, while `/api/health` remains the DB-aware readiness signal for diagnostics and external monitoring.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS, Radix UI, shadcn/ui |
| Database | MySQL 8.0+, Drizzle ORM |
| Auth | Argon2, HMAC-SHA256 sessions |
| Images | Sharp (parallel AVIF/WebP/JPEG pipeline) |
| i18n | next-intl (en, ko) |
| Deploy | Docker (standalone output) |

## License

Licensed under the [Apache License 2.0](LICENSE).
