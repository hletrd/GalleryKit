# Cycle 7 Critic Review

## Review inventory
- Reviewed repo-level docs/config/process files: `README.md`, `apps/web/README.md`, root/app `package.json`, Docker/compose, deploy script, middleware/config files, migrations, env examples.
- Reviewed application source under `apps/web/src/` across app routes, server actions, data/auth/storage/upload utilities, shared config, components, i18n, and tests.
- Reviewed test surface under `apps/web/src/__tests__/` and `apps/web/e2e/`.
- Final sweep included targeted searches for oversized media usage, share-link generation, fallback branding paths, rate-limit sequencing, storage/backfill notes, and process-local state.
- Verification run during review: `npm test --workspace=apps/web`, `npm run lint --workspace=apps/web`, `npm run lint:api-auth --workspace=apps/web`, `npm run build --workspace=apps/web`.

## Confirmed Issues

### C7-01 — Thumbnail surfaces still fetch the largest JPEG derivative instead of a thumbnail-sized asset
- **Confidence:** High
- **Citations:** `apps/web/src/components/search.tsx:198-216`, `apps/web/src/components/image-manager.tsx:342-349`, `apps/web/src/lib/process-image.ts:393-406`
- **Why this is a problem:** The image pipeline explicitly makes the unsuffixed base filename point at the largest configured JPEG derivative. Both the global search overlay and the admin table preview request that base filename for 48px/128px slots. That means every cold thumbnail render forces the server/image optimizer to open and decode the biggest variant instead of reusing an already-generated small derivative.
- **Concrete failure scenario:** A library with 4096px base JPEGs and 20 search results causes the search overlay to trigger 20 large source decodes for 48px thumbnails. On slower disks or small VPS instances, opening search or the admin dashboard becomes visibly sluggish and CPU-spiky even though appropriately sized `_640.jpg` derivatives already exist.
- **Suggested fix:** Introduce a shared thumbnail URL helper (for example, pick the nearest configured size for 48–128px surfaces) and switch both `Search` and `ImageManager` previews to the suffixed derivative paths rather than `filename_jpeg` base paths.

### C7-02 — Shared-link copy uses the browser’s current origin instead of the configured public origin
- **Confidence:** High
- **Citations:** `apps/web/src/components/photo-viewer.tsx:253-266`, `apps/web/src/components/image-manager.tsx:158-167`, `apps/web/src/lib/data.ts:783-790`
- **Why this is a problem:** The app already has a canonical public base URL (`seo.url` / `BASE_URL`), but both share-copy entry points ignore it and build URLs from `window.location.origin`. That couples copied links to whichever hostname the admin happened to use, not the hostname recipients are supposed to visit.
- **Concrete failure scenario:** An admin accesses the dashboard through `http://127.0.0.1:3000`, an internal VPN hostname, or a staging proxy while `BASE_URL` points at the real public site. The copied `/s/...` or `/g/...` link pastes an internal/non-public origin, so recipients cannot open it.
- **Suggested fix:** Return a canonical absolute share URL from the server (or expose the resolved public origin to the client) and copy that value instead of composing from `window.location.origin`.

## Likely Issues

### C7-03 — The fatal error shell still falls back to static branding after the app has switched to DB-backed SEO branding
- **Confidence:** High
- **Citations:** `apps/web/src/app/global-error.tsx:37-43`, `apps/web/src/app/[locale]/layout.tsx:73-82`, `apps/web/src/lib/data.ts:770-790`
- **Why this is a problem:** The healthy path reads live branding from `admin_settings` and exposes it on the root layout dataset, but the fatal shell still falls back to `site-config.json` whenever that live document metadata is unavailable. That leaves the app with two branding sources exactly on the path users see during incidents.
- **Concrete failure scenario:** An admin updates the site title/navigation title in SEO settings, then a hard render failure happens before the normal layout metadata is available. The error shell shows the old `site-config.json` brand while the rest of the app and shared metadata use the new branding, creating a confusing “wrong site” impression during outages.
- **Suggested fix:** Persist the live brand into a shared server-safe source that the fatal shell can consume directly, or pass the already-resolved SEO brand into the error boundary path instead of relying on a static fallback file.

## Risks Requiring Manual Validation

### C7-04 — Shared-group view counts are best-effort, process-local state and will undercount across crashes or scale-out
- **Confidence:** Medium
- **Citations:** `apps/web/src/lib/data.ts:10-107`, `apps/web/src/lib/data.ts:600-604`
- **Why this is a problem:** View increments are buffered in a module-local `Map` and flushed on a timer. That design is cheap, but it makes counts non-durable between flushes and non-coordinated across processes. The code also explicitly drops increments when the in-memory buffer is full.
- **Concrete failure scenario:** A deployment restart, container crash, or DB outage during a burst of `/g/[key]` traffic loses the buffered increments that have not flushed yet. If the app is ever run with multiple replicas, each replica keeps its own counter buffer, so aggregate view counts drift depending on which instance served the request.
- **Suggested fix:** Move share-view accounting to a durable mechanism (direct atomic DB increment, append-only event table, or shared external store/queue) and keep in-memory buffering only as an optional optimization layer.
