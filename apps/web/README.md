# GalleryKit — Web Application

The main Next.js application for GalleryKit.

See the [root README](../../README.md) for full documentation.

## Quick Start

Run these commands from `apps/web/` after creating a MySQL database/user:

```bash
npm install
cp .env.local.example .env.local
$EDITOR .env.local
cp src/site-config.example.json src/site-config.json
$EDITOR src/site-config.json
npm run init
npm run dev
```

After the dev server starts, log in at `/en/admin`, upload one photo, and confirm the public homepage renders it.

## Scripts

| Command | Description |
|---------|------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint check |
| `npm run db:push` | Push schema to MySQL |
| `npm run db:seed` | Seed admin user |
| `npm run init` | Apply committed migrations, then seed admin |

## Environment notes

- `BASE_URL` should point at the public app origin used for sitemap/metadata URLs.
- `IMAGE_BASE_URL` is optional. Set it to an absolute CDN origin or path prefix (for example `https://cdn.example.com` or `https://cdn.example.com/gallery`) **before** `next build` so Next.js and CSP both allow the remote asset host. Production builds reject plaintext `http://` asset origins.
- Leave `IMAGE_BASE_URL` unset for local/self-hosted uploads served directly from the app.
- Total batch upload size defaults to **2 GiB**. Override with `UPLOAD_MAX_TOTAL_BYTES` only if your deployment can safely absorb larger multipart bodies.
- Set `TRUST_PROXY=true` when running behind the provided nginx reverse proxy or another trusted proxy chain so rate limits use real client IPs and same-origin checks use the forwarded host/protocol. Ensure the proxy overwrites `Host` and `X-Forwarded-Proto` with trusted values.
- The checked-in `docker-compose.yml` assumes a Linux host with `network_mode: host`, a host-managed MySQL instance, and a host-side `src/site-config.json` bind mount. Build/deploy flows now fail fast if `src/site-config.json` is missing.
- If `ADMIN_PASSWORD` is stored as an Argon2 hash, set a separate plaintext `E2E_ADMIN_PASSWORD` and `E2E_ADMIN_ENABLED=true` for local Playwright admin login flows.
- Remote admin Playwright runs are blocked by default; set both `E2E_ADMIN_ENABLED=true` and `E2E_ALLOW_REMOTE_ADMIN=true` only when you intentionally want to exercise a non-local target with a dedicated `E2E_ADMIN_PASSWORD`.
