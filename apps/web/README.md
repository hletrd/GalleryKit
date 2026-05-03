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

To close the loop until phase 2 ships, set `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` in the environment. Each successful `checkout.session.completed` will then write a separate stdout line of the form:

```
[manual-distribution] download_token: imageId=42 tier=editorial session=cs_xxx email=customer@example.com token=dl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Operators can `docker logs <web-container> | grep manual-distribution` to retrieve the token and email it to the customer. Tokens are valid for 24 hours after entitlement creation and are single-use (the route's atomic UPDATE invalidates the hash on first download).

The flag defaults to off so production deployments do not leak tokens into log shippers without explicit opt-in. The hashed token in the `entitlements` row is the durable record; the plaintext only ever lives in stdout under this flag.

> **Retention warning (cycle 3 RPF):** stdout in containerized environments is typically forwarded to a log shipper (Loki, Datadog, CloudWatch, etc.) with retention windows of 30–90 days. Enabling `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` means the customer email **and** the plaintext download token live in those retained records together. Confirm your log retention is short, your shippers redact the `[manual-distribution]` prefix, **or** treat this flag as a temporary scaffold and turn it off once the email pipeline (US-P54 phase 2) ships.

### Refunds

`/admin/sales` lists all entitlements with a Refund button. Refunds are confirmed via dialog (irreversible — Stripe refund + immediate token invalidation) and surface localized error messages for known Stripe error codes (`charge_already_refunded`, `resource_missing`, network errors).
