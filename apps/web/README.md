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
| `npm test` | Vitest unit suite (2000+ tests) |
| `npm run typecheck` | Type gate (app + scripts) |
| `npx tsx scripts/download-clip-models.ts` | Seed CLIP model weights into the models volume (sidecar) |
| `npx tsx scripts/backfill-clip-embeddings.ts --production` | (Re)generate CLIP embeddings for existing photos (sidecar) |
| `npx tsx scripts/backfill-color-pipeline.ts` | Re-encode derivatives at the current pipeline/settings (sidecar) |

## Environment notes

- `BASE_URL` should point at the public app origin used for sitemap/metadata URLs. Production builds reject missing or placeholder public URLs, so set a real `BASE_URL` or replace `src/site-config.json.url` before building a production image.
- File-backed `src/site-config.json` owns static links/analytics defaults. Admin-editable SEO and branding fields are stored in the database and override file defaults at runtime.
- `IMAGE_BASE_URL` is optional. Set it to an absolute CDN origin or path prefix (for example `https://cdn.example.com` or `https://cdn.example.com/gallery`) **before** `next build` so Next.js and CSP both allow the remote asset host. Production builds reject plaintext `http://` asset origins and URLs with credentials, query strings, or hashes.
- Leave `IMAGE_BASE_URL` unset for local/self-hosted uploads served directly from the app.
- `/api/health` is liveness-only by default and does not probe the DB; set `HEALTH_CHECK_DB=true` only for private readiness checks.
- Uploads are capped at **200 MiB per file** and **2 GiB** total per upload window by default. The shipped nginx config caps general requests at **2 MiB**, login at **64 KiB**, DB restore at **250 MiB**, and dashboard uploads at **216 MiB**; override `UPLOAD_MAX_TOTAL_BYTES` only if every layer can safely absorb the larger multipart bodies.
- Set `TRUST_PROXY=true` when running behind the provided nginx reverse proxy or another trusted proxy chain so rate limits use real client IPs and same-origin checks use the forwarded host/protocol. Keep `TRUSTED_PROXY_HOPS=1` for the shipped nginx-only topology; use `2` only for a known trusted CDN/LB → nginx → app chain. The app selects the client immediately before the trusted proxy suffix in `X-Forwarded-For`; ensure the proxy overwrites `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` with trusted values. Admin same-origin checks fail closed if both `Origin` and `Referer` are missing.
- The checked-in `docker-compose.yml` assumes a Linux host with `network_mode: host`, a host-managed MySQL instance, and a host-side `src/site-config.json` bind mount. Build/deploy flows now fail fast if `src/site-config.json` is missing.
- If a host-side nginx serves `/uploads` statically, point it at the host bind mount (`apps/web/public`) or proxy to the container. The checked-in nginx config's `/app/apps/web/public` root is a container-internal path and is not valid on every host.
- If `ADMIN_PASSWORD` is stored as an Argon2 hash, set a separate plaintext `E2E_ADMIN_PASSWORD` and `E2E_ADMIN_ENABLED=true` for local Playwright admin login flows.
- Remote admin Playwright runs are blocked by default; set both `E2E_ADMIN_ENABLED=true` and `E2E_ALLOW_REMOTE_ADMIN=true` only when you intentionally want to exercise a non-local target with a dedicated `E2E_ADMIN_PASSWORD`.

## Semantic search (CLIP — US-P51)

GalleryKit ships a fully self-hosted, multilingual **natural-language photo search** (English + Korean) and **"similar photos"** (image→image), powered by an in-process CLIP encoder. No per-query API cost; runs on CPU in the standalone container.

- **Model:** `jinaai/jina-clip-v2` (int8 ONNX via `@huggingface/transformers`), embeddings truncated to 512-dim (Matryoshka) and L2-normalized. Model-version tag: `jina-clip-v2-d512-q8`. Production cosine threshold `0.22`.
- **Modes** (`semantic_search_mode` admin setting): `disabled` (default — routes return 503) · `stub` (deterministic non-meaningful vectors, experimental demo, disclaimer shown) · `production` (real encoder).
- **Weights are NOT baked into the image.** They load **offline** (`allowRemoteModels=false`) from the `CLIP_MODELS_ROOT` bind-mount (under `./data/models/clip`), so seed them once on the host before going live. The `onnxruntime-node` CPU binding ships inside the npm tarball — no extra Dockerfile step.
- **Honesty gate:** `production` serves results only from rows matching the active `model_version`; if no real embeddings exist yet it returns 503 rather than serving stub or empty results under the production label.
- **Same posture as other public routes:** same-origin guard on the query endpoints + bounded per-IP rate limiting.

### Going live (operator-only, deliberate)

The resolver heals a stored `semantic_search_mode='production'` back to `disabled` **unless** the env opt-in is set — there is intentionally no one-click production toggle in the admin UI (it offers only Disabled/Stub). To activate:

1. **Seed weights** (sidecar `--rm`): `scripts/download-clip-models.ts` with `CLIP_MODELS_ROOT` set to the bind-mount path.
2. **Backfill embeddings** for existing photos: `scripts/backfill-clip-embeddings.ts --production`.
3. Set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` in `.env.local`.
4. Set the DB row `admin_settings.semantic_search_mode='production'`.

New uploads are embedded automatically (fire-and-forget, lower priority than derivative generation). See `CLAUDE.md` → **"CLIP semantic search — seeding model weights on the deploy host"** for the exact `--rm` sidecar commands (the prod runtime container has no `tsx`/source, so model ops run from a sidecar off `web-web:latest` with read-only source mounts).
