<p align="center">
  <img src=".github/assets/logo.svg" alt="GalleryKit" width="120" height="120">
</p>

<h1 align="center">GalleryKit</h1>

<p align="center">
  A self-hosted gallery for publishing finished photography with color-managed delivery, private originals, and operator-controlled search
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

GalleryKit is built for photographers and small teams who want to publish edited work without handing originals or AI features to a hosted SaaS. The app keeps original uploads private, serves processed public derivatives, preserves photographer-facing color decisions within browser and codec limits, and leaves heavy operator features such as semantic search behind explicit setup steps. Local view analytics are first-party and self-hosted by default; Google Analytics is optional and disabled unless you configure `google_analytics_id`.

**For:** finished-photo publishing, private original storage, self-hosted sharing, browser-managed color-faithful delivery, and operator-controlled search.  
**Not for:** editing, culling, scoring, proofing, payment, or hosted SaaS workflows.

## Features

- **Masonry Grid Layout** -- responsive, column-balanced photo grid with infinite scroll
- **Multi-Format Optimization** -- wide-gamut-aware AVIF/WebP/JPEG conversion via Sharp, with 10-bit AVIF when the deployed libheif stack supports it and explicit 8-bit fallback when it does not
- **Photographer-grade color management** -- ICC profile honored, NCLX `colr` ISOBMFF detection, ICC chromaticity-based gamut detection (Eizo / BenQ / X-Rite custom monitor profiles), Display P3 / DCI-P3 / Adobe RGB / ProPhoto / Rec.2020 sources mapped to Display P3 with 4:4:4 chroma JPEG, DCI-P3 white-point Bradford-adapted to D65. Apple HDR gain map detection (admin audit only). PQ / HLG ingest gated behind admin opt-in. See `CLAUDE.md` "Color & HDR Pipeline" for the full decision matrix
- **Categories & Sharing** -- organize photos into categories with slug aliases and publish per-photo or group share links with Base56 short keys
- **EXIF Extraction** -- camera model, lens, ISO, aperture, shutter speed, focal length, GPS, ICC name, source bit depth, color pipeline decision (admin). Review GPS stripping before the first upload; once any photo exists, the setting is locked because changing it later would not rewrite already stored originals.
- **Tagging & Search** -- keyword metadata search across titles, descriptions, cameras, and tags
- **Semantic Search (AI, self-hosted, operator-enabled)** -- natural-language photo search in **English & Korean** plus **"similar photos"** (image→image), powered by an in-process multilingual CLIP encoder (jina-clip-v2, int8 ONNX on CPU — no per-query API cost). **Disabled by default; requires operator setup** (model weight download + backfill + env opt-in). Results are served from a bounded newest-first embedding scan, not a vector index. A production deployment may enable it after the runbook checks; fresh installs do not.
- **Progressive Web App** -- installable PWA with a service worker for visited image caching and an offline HTML fallback; it is not a full offline gallery sync
- **Admin Dashboard** -- drag-and-drop uploads, batch metadata editing, PAT-authenticated upload API for external clients (no Lightroom Classic plugin is bundled), multiple root-admin accounts (Argon2; no role separation yet); color tunables for chroma subsampling, AVIF effort, force-sRGB derivatives, HDR ingest opt-in

GalleryKit is not a photo editor, culler, or scoring tool. Photos are expected to arrive after editing; admin batch operations change metadata only.
- **Internationalization** -- English and Korean (next-intl), incl. localized color metadata
- **Docker Support** -- standalone output with documented Linux host-network + reverse-proxy deployment

## Configuration

File-backed site configuration lives in `apps/web/src/site-config.json` for static links and analytics. SEO/branding fields that admins can edit in the dashboard (`title`, `description`, `nav_title`, `author`, `locale`, and OG image URL) are stored in the database and override the file defaults at runtime.

```json
{
    "title": "Site Title",
    "description": "Site Description",
    "url": "https://your-site.com",
    "locale": "en_US",
    "author": "Author Name",
    "nav_title": "Navigation Title",
    "home_link": "/",
    "footer_text": "Footer Text",
    "google_analytics_id": ""
}
```

Leave `google_analytics_id` empty to keep analytics fully first-party/self-hosted. Set it to a valid GA measurement id only when you intentionally enable Google Analytics.

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
│   ├── data/                 # Private originals, DB backups, CLIP model weights (persistent)
│   ├── public/uploads/       # Processed public image derivatives (persistent)
│   ├── public/resources/     # Runtime topic cover resources (persistent)
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
# Create a local MySQL database/user first, then copy and edit the app environment.
mysql -uroot -p -e "CREATE DATABASE gallerykit CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -uroot -p -e "CREATE USER 'gallerykit'@'localhost' IDENTIFIED BY 'change-this-password';"
mysql -uroot -p -e "GRANT ALL PRIVILEGES ON gallerykit.* TO 'gallerykit'@'localhost'; FLUSH PRIVILEGES;"
cp apps/web/.env.local.example apps/web/.env.local
$EDITOR apps/web/.env.local
cp apps/web/src/site-config.example.json apps/web/src/site-config.json
$EDITOR apps/web/src/site-config.json
npm run init --workspace=apps/web
npm run dev
```

After the dev server starts, log in at `/en/admin`, review Settings before the first upload (especially GPS stripping and output sizes), create a category, upload one photo, and confirm the public homepage renders it.

### Remote Deploy Helper

To let local automation deploy without re-entering SSH details each run, keep the target SSH config in a gitignored root `.env.deploy` file:

```bash
cp .env.deploy.example .env.deploy
$EDITOR .env.deploy
npm run deploy
```

`npm run deploy` reads `.env.deploy` when present, otherwise it falls back to `$HOME/.gallerykit-secrets/gallery-deploy.env`; set `DEPLOY_ENV_FILE` to point somewhere else. It derives the SSH deploy command from `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`, and `DEPLOY_PATH`. Use `DEPLOY_REMOTE_SCRIPT` if you only need to change the remote entrypoint while keeping the derived SSH wrapper. Keep `DEPLOY_CMD` only as an escape hatch when you need a fully custom command.

### Environment Setup

Do this before `npm run init --workspace=apps/web`; the init script needs DB credentials plus `ADMIN_PASSWORD`. `SESSION_SECRET` is required for production runtime session signing, but it is not an init-time requirement. Edit `apps/web/.env.local` with your MySQL credentials, strong admin bootstrap secret, runtime session secret, and public URLs:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=gallerykit
DB_PASSWORD=<change-me>
DB_NAME=gallerykit
ADMIN_PASSWORD=<strong-16+-char-secret-or-argon2-hash>
SESSION_SECRET=<openssl rand -hex 32>
BASE_URL=http://localhost:3000
# Optional: serve uploaded assets from a CDN or reverse proxy prefix
# IMAGE_BASE_URL=https://cdn.example.com
# DB_SSL_CA=/etc/mysql/ca.pem  # Required for verified MySQL CLI TLS to non-local DB hosts.
# DB_SSL=false  # Disable TLS only behind a trusted private link.
# QUEUE_CONCURRENCY=1
# UPLOAD_MAX_TOTAL_BYTES=2147483648
# UPLOAD_MAX_FILES_PER_WINDOW=100
# NEXT_UPLOAD_BODY_MAX_BYTES=278921216
# TRUST_PROXY=true
# TRUSTED_PROXY_HOPS=1
```

If you ever seeded an environment from older checked-in examples, rotate both
`SESSION_SECRET` and any bootstrap/admin credentials immediately. Historical
git values must be treated as compromised and must not be reused.

Production builds require a real absolute public URL: set `BASE_URL` or replace `site-config.json.url` with a non-placeholder origin before `next build` / Docker build. The example values (`https://example.com`, localhost) are development placeholders and are rejected by the production build guard.
If you set `BASE_URL`, `IMAGE_BASE_URL`, `UPLOAD_MAX_TOTAL_BYTES`, or `NEXT_UPLOAD_BODY_MAX_BYTES`, do it **before** running `next build` / `docker compose ... --build` so Next.js can validate public origins, allow remote image hosts, bake the same upload cap into the build, and bake the Server Action request body cap through Next config. The shipped compose file forwards those values as Docker build args when they are present in the shell/Compose environment; export them before `docker compose ... --build` if you rely on non-default build-time values. Use `https://` for production asset origins; plaintext `http://` is only acceptable for local development. `IMAGE_BASE_URL` must be an absolute URL without credentials, query strings, or hashes.
`DB_SSL` defaults to TLS for non-localhost database hosts and plaintext for loopback/private local development. Backup/restore CLI calls fail closed for non-local DB hosts unless `DB_SSL_CA` points at the CA used to verify the server certificate; set `DB_SSL=false` only when the database connection is protected by a trusted private network. `QUEUE_CONCURRENCY` controls the in-process `PQueue` image conversion workers (default `1`); raise it only after confirming CPU and memory headroom alongside `SHARP_CONCURRENCY`.
If you raise `UPLOAD_MAX_TOTAL_BYTES`, make sure your reverse proxy, temp storage, and container memory can safely handle that batch size. The shipped nginx config caps general requests at **2 MiB**, login at **64 KiB**, admin DB restore at **250 MiB**, admin dashboard uploads at **216 MiB**, and `/api/admin/lr/upload` at **216 MiB** so external PAT upload clients are not caught by the generic `/api/admin/` 2 MiB cap. The app separately enforces **200 MiB per file**, **2 GiB per upload window** by default, and **100 files per window**; keep those layers aligned if you customize either side.
The shipped `apps/web/docker-compose.yml` already forces `TRUST_PROXY=true` and binds the standalone server to `127.0.0.1` when you use the documented host-network + nginx deployment. The checked-in nginx config is an internal HTTP hop behind a TLS-terminating edge; do not expose its port 80 listener directly as the public cleartext edge. It is intended as a single web-instance/single-writer deployment; restore maintenance, upload quotas, and image queue state are process-local. Keep those protections if you adapt the compose file, and do not scale the web service horizontally without moving those coordination states into shared storage.

**`TRUST_PROXY=true` is required for rate limiting to work correctly behind a reverse proxy** (nginx, Caddy, Cloudflare, load balancers, etc.). The server reads `X-Forwarded-For` / `X-Real-IP` only when this flag is set; without it, `getClientIp()` returns `"unknown"` and every request collapses into a single shared rate-limit bucket, which both (a) lets abusive clients exhaust the login / search / share budgets shared with legitimate users, and (b) lets spoofed `X-Forwarded-For` headers be ignored (since they are never trusted at all). The checked-in nginx template overwrites incoming `X-Forwarded-For` with `$remote_addr`, so keep `TRUSTED_PROXY_HOPS=1` for the shipped nginx-app topology. If another trusted edge sits in front of nginx and you need the outer client IP, configure nginx `real_ip` for that trusted edge before forwarding headers to the app. The same trusted-proxy setting also affects same-origin validation for mutating admin actions, login cookie security, and DB backup downloads, so the proxy must overwrite `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` with values from the trusted edge hop. Admin same-origin checks intentionally fail closed when both `Origin` and `Referer` are absent. Only enable proxy trust when the incoming headers are actually set by a trusted proxy hop.
For bootstrap auth, prefer a generated secret or a precomputed Argon2 hash; do not deploy with placeholder passwords such as `password`.

Database backups are SQL dumps stored under `data/backups/`. They are authenticated and non-public, but they are plaintext at rest; put the host directory on encrypted storage or move downloaded dumps into your own encrypted backup system. These dumps cover database rows only; back up private originals, public derivatives, and resource files from the host filesystem for a complete rollback.

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
docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build
```

The application listens on port 3000 on localhost; publish it through your reverse proxy rather than exposing the host-network process directly. New original uploads are kept in the private data volume, processed JPEG/WebP/AVIF derivatives remain under `public/uploads/`, and runtime topic cover resources remain under `public/resources/`.

`npm run deploy` (which runs `apps/web/deploy.sh` on the host) **auto-prunes stale Docker images, build cache, and dangling volumes after every deploy**, so a disk-constrained host stays clean without manual cleanup. The prune runs after the stack is back up, and bind-mounted data (`./data`, `./public/uploads`, `./public/resources`) plus the live container/image are never touched.

Legacy originals must not remain under `public/uploads/original/`. The startup path now fails closed in production if that legacy public-original directory still contains files.
The container liveness probe now uses `/api/live`. `/api/health` is liveness-only by default; set `HEALTH_CHECK_DB=true` only on private monitoring paths that intentionally need a DB readiness probe.

The checked-in `apps/web/nginx/default.conf` proxies `/uploads/{jpeg,webp,avif}` back to Next by default, which matches the host-side nginx + app-container deployment. If you intentionally serve `/uploads/*` statically from a custom host nginx, point it at the host bind mount (`apps/web/public/uploads`) and preserve the private-originals 404 rule; do not copy container-internal paths into host nginx configs unchanged.

## Upload API

GalleryKit exposes a PAT-authenticated upload route for external publish clients. It is an API contract, not a bundled Lightroom Classic plugin.

- Endpoint: `POST /api/admin/lr/upload`
- Auth header: `X-GalleryKit-Token: gk_...`
- Required token scope: `lr:upload`
- Body: `multipart/form-data`
- File field: `file`
- Metadata fields: `topic` plus optional `title` and `description`. Camera/lens/date/exposure values are extracted from the uploaded file metadata; submitted metadata override fields such as `tags`, `camera_model`, `lens_model`, `capture_date`, and exposure values are not currently consumed by this route.
- Limits: 200 MiB per file, 2 GiB per upload window, 100 files per window by default; the shipped nginx route cap is 216 MiB.
- Response: `{ "success": true, "id": 123 }` on success, or an error JSON response with the matching HTTP status. Generated filenames are not returned by this route.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS, Radix UI, shadcn/ui |
| Database | MySQL 8.0+, Drizzle ORM |
| Auth | Argon2, HMAC-SHA256 sessions |
| Images | Sharp (parallel AVIF/WebP/JPEG pipeline) |
| Semantic search | jina-clip-v2 (int8 ONNX) via Transformers.js — in-process, CPU |
| i18n | next-intl (en, ko) |
| Deploy | Docker (standalone output, self-pruning deploy) |

## License

Licensed under the [Apache License 2.0](LICENSE).
