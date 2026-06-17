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

## Paid downloads (Stripe — US-P54)

The gallery supports per-image paid licensing via Stripe Checkout. Until the email pipeline (US-P54 phase 2) ships, the customer-to-photographer hand-off is operator-driven.

### Required env vars

- `STRIPE_SECRET_KEY` — Stripe secret API key. Required when any image has `license_tier != 'none'`.
- `STRIPE_WEBHOOK_SECRET` — webhook signing secret from the Stripe dashboard for `checkout.session.completed` events.

The Stripe SDK is initialised lazily, so the server boots without these in dev. Rotate `STRIPE_SECRET_KEY` → restart the web container; the SDK captures the value at first call.

### Webhook URL

Register `https://<your-host>/api/stripe/webhook` in the Stripe dashboard under Developers → Webhooks. The route runs in Node.js runtime (not edge) and verifies signatures with `stripe.webhooks.constructEvent` before any DB write.

### Manual download distribution (current operational workflow)

When a customer completes checkout, the webhook generates a single-use download token, stores only its SHA-256 hash in the `entitlements` table, and surfaces a "Purchase complete!" toast on the photo page. The plaintext token is the URL parameter the customer needs in `/api/download/<imageId>?token=<token>`, but it is not yet emailed automatically.

**The emailed link is scanner-safe (R4C7).** Mail-security gateways (Microsoft SafeLinks/Defender, Mimecast, Proofpoint, webmail previewers) fetch links found in inbound email, and Next.js serves HEAD probes through the GET handler. The download URL therefore opens a localized confirmation page on GET — **no state changes** — and the single use is consumed only when the customer presses the "Download photo" button on that page (a POST back to the same URL). Automated scanners do not submit POST forms, so a prefetch or HEAD probe can no longer burn the token before the customer clicks.

To close the loop until phase 2 ships, set `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` in the environment. Each successful `checkout.session.completed` will then write a separate stdout line of the form:

```
[manual-distribution] download_token: imageId=42 tier=editorial session=cs_xxx email=customer@example.com token=dl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Operators can `docker logs <web-container> | grep manual-distribution` to retrieve the token and email it to the customer. Tokens are valid for 24 hours after entitlement creation and are single-use (the route's atomic UPDATE invalidates the hash when the customer confirms the download on the interstitial page).

The flag defaults to off so production deployments do not leak tokens into log shippers without explicit opt-in. The hashed token in the `entitlements` row is the durable record; the plaintext only ever lives in stdout under this flag.

> **Retention warning (cycle 3 RPF):** stdout in containerized environments is typically forwarded to a log shipper (Loki, Datadog, CloudWatch, etc.) with retention windows of 30–90 days. Enabling `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` means the customer email **and** the plaintext download token live in those retained records together. Confirm your log retention is short, your shippers redact the `[manual-distribution]` prefix, **or** treat this flag as a temporary scaffold and turn it off once the email pipeline (US-P54 phase 2) ships.

### Refunds

`/admin/sales` lists all entitlements with a Refund button. Refunds are confirmed via dialog (irreversible — Stripe refund + immediate token invalidation) and surface localized error messages for known Stripe error codes (`charge_already_refunded`, `resource_missing`, network errors).

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
