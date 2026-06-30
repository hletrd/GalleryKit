# GalleryKit — Web Application

The main Next.js application for GalleryKit.

See the [root README](../../README.md) for full documentation.

## Quick Start

Run these commands from `apps/web/` after creating a MySQL database/user:

```bash
mysql -uroot -p -e "CREATE DATABASE gallerykit CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -uroot -p -e "CREATE USER 'gallerykit'@'localhost' IDENTIFIED BY 'change-this-password';"
mysql -uroot -p -e "GRANT ALL PRIVILEGES ON gallerykit.* TO 'gallerykit'@'localhost'; FLUSH PRIVILEGES;"
npm install
cp .env.local.example .env.local
$EDITOR .env.local
cp src/site-config.example.json src/site-config.json
$EDITOR src/site-config.json
npm run init
npm run dev
```

After the dev server starts, log in at `/en/admin`, create a category, upload one photo, and confirm the public homepage renders it.

## Scripts

| Command | Description |
|---------|------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint check |
| `npm run db:push` | Local throwaway schema push only; use committed migrations for shared/prod DBs |
| `npm run db:seed` | Seed admin user |
| `npm run init` | Apply committed migrations, then seed admin |
| `npm test` | Vitest unit suite (2000+ tests) |
| `npm run typecheck` | Type gate (app + scripts) |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npx tsx scripts/download-clip-models.ts` | Seed CLIP model weights into the models volume (sidecar) |
| `npx tsx scripts/backfill-clip-embeddings.ts --production --force` | Pre-enable production CLIP backfill for existing photos (sidecar); omit `--force` only after semantic search mode is already active |
| `npx tsx scripts/backfill-color-pipeline.ts` | Re-encode derivatives at the current pipeline/settings (sidecar) |

## Environment notes

- `BASE_URL` should point at the public app origin used for sitemap/metadata URLs. Production builds reject missing or placeholder public URLs, so set a real `BASE_URL` or replace `src/site-config.json.url` before building a production image.
- File-backed `src/site-config.json` owns static links/analytics defaults. Admin-editable SEO and branding fields are stored in the database and override file defaults at runtime. Leave `google_analytics_id` empty to keep analytics fully first-party/self-hosted; setting it loads Google Analytics on public pages and is a deliberate third-party analytics opt-in.
- `IMAGE_BASE_URL` is optional. Set it to an absolute CDN origin or path prefix (for example `https://cdn.example.com` or `https://cdn.example.com/gallery`) **before** `next build` so Next.js and CSP both allow the remote asset host. Production builds reject plaintext `http://` asset origins and URLs with credentials, query strings, or hashes.
- For non-local `DB_HOST` values, backup/restore CLI calls require verified TLS with `DB_SSL_CA=/path/to/ca.pem` unless you explicitly set `DB_SSL=false` for a trusted private link.
- Leave `IMAGE_BASE_URL` unset for local/self-hosted uploads served directly from the app.
- `/api/health` is liveness-only by default and does not probe the DB; set `HEALTH_CHECK_DB=true` only for private readiness checks.
- Uploads are capped at **200 MiB per file** and **2 GiB** total per upload window by default. The shipped nginx config caps general requests at **2 MiB**, login at **64 KiB**, DB restore at **250 MiB**, dashboard uploads at **216 MiB**, and `/api/admin/lr/upload` at **216 MiB** so external PAT upload clients bypass the generic `/api/admin/` 2 MiB cap; override `UPLOAD_MAX_TOTAL_BYTES` only if every layer can safely absorb the larger multipart bodies.
- Set `TRUST_PROXY=true` when running behind the provided nginx reverse proxy or another trusted proxy chain so rate limits use real client IPs and same-origin checks use the forwarded host/protocol. The checked-in nginx template overwrites incoming `X-Forwarded-For` with `$remote_addr`, so keep `TRUSTED_PROXY_HOPS=1` for the shipped nginx-app topology. If another trusted edge sits in front of nginx and you need the outer client IP, configure nginx `real_ip` for that trusted edge before forwarding headers to the app. Ensure the proxy overwrites `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` with trusted values. Admin same-origin checks fail closed if both `Origin` and `Referer` are missing.
- The checked-in `docker-compose.yml` assumes a Linux host with `network_mode: host`, a host-managed MySQL instance, and a host-side `src/site-config.json` bind mount. Build/deploy flows now fail fast if `src/site-config.json` is missing.
- The checked-in nginx proxies `/uploads/{jpeg,webp,avif}` to the app, which is the documented host-side reverse-proxy topology. It is meant to sit behind a TLS-terminating edge; if nginx is your public edge, add a real 443 server and redirect cleartext 80 traffic. If a custom host-side nginx serves `/uploads` statically, point it at the host bind mount (`apps/web/public/uploads`) and keep originals private. Runtime topic cover resources are separately persisted at `apps/web/public/resources`.
- Admin database backups are plaintext SQL dumps in `data/backups/` until you move or encrypt them. The app keeps them non-public and authenticated, but host/storage encryption is an operator responsibility.
- If `ADMIN_PASSWORD` is stored as an Argon2 hash, set a separate plaintext `E2E_ADMIN_PASSWORD` and `E2E_ADMIN_ENABLED=true` for local Playwright admin login flows.
- Remote admin Playwright runs are blocked by default; set both `E2E_ADMIN_ENABLED=true` and `E2E_ALLOW_REMOTE_ADMIN=true` only when you intentionally want to exercise a non-local target with a dedicated `E2E_ADMIN_PASSWORD`.

## Semantic search (CLIP — US-P51)

GalleryKit ships a fully self-hosted, multilingual **natural-language photo search** (English + Korean) and **"similar photos"** (image→image), powered by an in-process CLIP encoder. No per-query API cost; runs on CPU in the standalone container. The current retrieval path is a bounded newest-first scan over embeddings, so very large galleries need operational tuning or a future vector index for complete recall.

- **Model:** `jinaai/jina-clip-v2` (int8 ONNX via `@huggingface/transformers`), embeddings truncated to 512-dim (Matryoshka) and L2-normalized. Model-version tag: `jina-clip-v2-d512-q8`. Production cosine threshold `0.22`.
- **Modes** (`semantic_search_mode` admin setting): `disabled` (default — routes return 503) · `stub` (deterministic non-meaningful vectors, experimental demo, disclaimer shown) · `production` (real encoder).
- **Weights are NOT baked into the image.** They load **offline** (`allowRemoteModels=false`) from the `CLIP_MODELS_ROOT` bind-mount (under `./data/models/clip`), so seed them once on the host before going live. The `onnxruntime-node` CPU binding ships inside the npm tarball — no extra Dockerfile step.
- **Concurrency:** `CLIP_INFERENCE_CONCURRENCY` defaults to `1` and is capped in code. Raise it only after measuring CPU/RSS headroom because each concurrent request runs an ONNX forward pass.
- **Honesty gate:** `production` serves results only from rows matching the active `model_version`; if no real embeddings exist yet it returns 503 rather than serving stub or empty results under the production label.
- **Scan scope:** searches the newest embeddings first (bounded scan); large galleries may not surface relevant older photos unless they are re-uploaded or re-embedded after a backfill.
- **Same posture as other public routes:** same-origin guard on the query endpoints + bounded per-IP rate limiting.

### Going live (operator-only, deliberate)

The resolver heals a stored `semantic_search_mode='production'` back to `disabled` **unless** the env opt-in is set — there is intentionally no one-click production toggle in the admin UI (it offers only Disabled/Stub). To activate:

1. **Seed weights** (sidecar `--rm`): `scripts/download-clip-models.ts` with `CLIP_MODELS_ROOT` set to the bind-mount path.
2. **Backfill embeddings** for existing photos: `scripts/backfill-clip-embeddings.ts --production --force` (the `--force` flag skips the mode gate so you can pre-populate embeddings before flipping the admin setting). If the script logs that it reached `SEMANTIC_SCAN_LIMIT`, repeat the same command until it completes without that message.
3. Set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` in `.env.local`.
4. Set the DB row `admin_settings.semantic_search_mode='production'`.

New uploads are embedded automatically (fire-and-forget, lower priority than derivative generation). See `CLAUDE.md` → **"CLIP semantic search — seeding model weights on the deploy host"** for the exact `--rm` sidecar commands (the prod runtime container has no `tsx`/source, so model ops run from a sidecar off `web-web:latest` with read-only source mounts).

## Upload API contract

- Endpoint: `POST /api/admin/lr/upload`
- Auth header: `X-GalleryKit-Token: gk_...`
- Required token scope: `lr:upload`
- Body: `multipart/form-data` with `file`, `topic`, and optional metadata fields matching the dashboard upload form.
- Limits: 200 MiB per file, 2 GiB per upload window, 100 files per window by default; the shipped nginx route cap is 216 MiB.
- Response: JSON describing the created image and generated filenames, or JSON error payloads with the matching HTTP status.

The route is compatible with external publish clients that can send multipart form data and the PAT header. GalleryKit does not bundle a Lightroom Classic plugin.
