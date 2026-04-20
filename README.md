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
- **Admin Dashboard** -- drag-and-drop uploads, batch editing, multi-user auth (Argon2)
- **Internationalization** -- English and Korean (next-intl)
- **Docker Ready** -- standalone output, single-command deployment

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
│   ├── public/uploads/       # Uploaded images (persistent volume)
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
```

### Environment Setup

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

Edit `apps/web/.env.local` with your MySQL credentials, strong admin bootstrap secret, and public URLs:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=your_user
DB_PASSWORD=your_password
DB_NAME=gallery
ADMIN_PASSWORD=<strong-16+-char-secret-or-argon2-hash>
SESSION_SECRET=<openssl rand -hex 32>
BASE_URL=http://localhost:3000
# Optional: serve uploaded assets from a CDN or reverse proxy prefix
# IMAGE_BASE_URL=https://cdn.example.com
# UPLOAD_MAX_TOTAL_BYTES=2147483648
# TRUST_PROXY=true
```

If you set `IMAGE_BASE_URL`, do it **before** running `next build` / `docker compose ... --build` so Next.js can allow that remote host for optimized images and CSP.
If you raise `UPLOAD_MAX_TOTAL_BYTES`, make sure your reverse proxy, temp storage, and container memory can safely handle that batch size.
The shipped `apps/web/docker-compose.yml` already forces `TRUST_PROXY=true` and binds the standalone server to `127.0.0.1` when you use the documented host-network + nginx deployment. Keep those protections if you adapt the compose file.
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
3. Provide a real `apps/web/src/site-config.json` on the host before starting the compose stack; the checked-in example file is only a template.
4. Run:

```bash
docker compose -f apps/web/docker-compose.yml up -d --build
```

The application listens on port 3000 on localhost; publish it through your reverse proxy rather than exposing the host-network process directly.

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
