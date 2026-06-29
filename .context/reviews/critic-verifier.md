# Critic + Verifier Report — review-plan-fix cycle 1 prompt 1

## Scope Inventory

Reviewed repository contracts and operating docs:

- `AGENTS.md` instructions supplied in-session.
- `CLAUDE.md` project contract, especially security/privacy, migration, deployment, semantic search, color/HDR, and deferred-policy sections.
- `README.md`, `apps/web/README.md`, root/app `package.json`, Docker/compose/deploy/nginx config.

Reviewed relevant implementation surfaces:

- Public/admin route handlers under `apps/web/src/app/api/**`.
- Server actions under `apps/web/src/app/actions/**` and `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Core auth/origin/rate-limit/privacy data paths: `api-auth.ts`, `request-origin.ts`, `action-guards.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `data.ts`, `search-enrichment-fields.ts`.
- Semantic search/backfill/embedding paths: `api/search/semantic`, `api/search/similar`, `clip-*`, `gallery-config*`, `image-queue.ts`, `backfill-clip-embeddings.ts`.
- Upload serving/deployment paths: `docker-compose.yml`, `Dockerfile`, `nginx/default.conf`, `next.config.ts`, `serve-upload.ts`, deploy scripts.
- Schema/migration integrity: `schema.ts`, `drizzle/**`, `scripts/migrate.js`, migration tests.
- Product-policy scans for paid downloads, unsupported storage backends, reactions, culling/scoring/editing surfaces, stub features, and stale TODO/deferred markers.

Validation evidence:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Static route/action/privacy scans confirmed admin API routes use `withAdminAuth`, mutating admin server actions use `requireSameOriginAdmin` or explicit exemptions, and public image select shapes use `publicSelectFields`/compile-time privacy guards.

Not run:

- Full `npm test`, `npm run typecheck`, `npm run build`, and e2e gates were not run because this prompt permitted creating/overwriting only this report file; those commands can write generated type/build/cache artifacts outside `.context/reviews/critic-verifier.md`.

## Findings

### 1. Production semantic search returns empty 200s when no real embeddings exist, contradicting the documented honesty gate

- Severity: MEDIUM
- Confidence: High
- Status: Confirmed
- Files/regions:
  - `apps/web/README.md:58-60` documents production mode and says no real embeddings should return 503 rather than stub or empty results.
  - `apps/web/src/lib/gallery-config.ts:126-145` resolves `semanticSearchMode='production'` when the operator env opt-in is set.
  - `apps/web/src/app/api/search/semantic/route.ts:249-258` scans production embeddings by `PRODUCTION_MODEL_VERSION`.
  - `apps/web/src/app/api/search/semantic/route.ts:284` computes `topK` over the scanned rows.
  - `apps/web/src/app/api/search/semantic/route.ts:333-335` always returns `200 { results: enrichedResults }`, including when the scan returned zero rows.
- Failure scenario: An operator seeds weights and sets `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` plus `semantic_search_mode='production'` before a successful production backfill. The public UI no longer carries the stub disclaimer, but text search returns `200` with empty results for every query. That violates the documented honesty gate and makes "not configured yet" indistinguishable from "no semantic matches."
- Concrete fix: In production mode, after the embedding scan, return `503` with `NO_STORE_HEADERS` when `rows.length === 0`. Keep `200 []` only for the case where production rows exist but the query has no matches above threshold. Add a route test that mocks production mode with no `PRODUCTION_MODEL_VERSION` rows and asserts 503.

### 2. Checked-in nginx upload root conflicts with the documented host-side nginx deployment

- Severity: MEDIUM
- Confidence: High
- Status: Confirmed
- Files/regions:
  - `apps/web/docker-compose.yml:14-16` says nginx is a host-side reverse proxy while the container uses host networking.
  - `apps/web/docker-compose.yml:23-26` bind-mounts uploads inside the web container at `/app/apps/web/public`.
  - `apps/web/nginx/default.conf:170-173` handles `/uploads/...` in nginx with `root /app/apps/web/public`.
  - `apps/web/README.md:47-49` warns that host-side nginx must point at the host bind mount or proxy to the container because the checked-in root is container-internal.
- Failure scenario: An operator deploys the included nginx config on the host, which is the topology described by Compose. The regex upload location wins for `/uploads/jpeg/...`, but `/app/apps/web/public` does not exist on the host, so uploaded derivatives 404 at nginx instead of reaching Next or the actual host bind mount. The rest of the app can be healthy while all photos break.
- Concrete fix: Make the checked-in nginx config match the shipped topology. Either template the upload root to the host path used by `DEPLOY_PATH/apps/web/public`, change the upload location to proxy to Next by default, or split `nginx/default.conf` into explicit `host` and `container` variants. Add a source test that asserts the documented topology and nginx upload root cannot drift silently.

### 3. Per-photo OG fallback redirects still trust the inbound request origin after the route explicitly rejects it for internal fetches

- Severity: LOW
- Confidence: Medium
- Status: Risk
- Files/regions:
  - `apps/web/src/app/api/og/photo/[id]/route.tsx:101-118` documents why the internal fetch must use trusted `siteConfig.url` and fail closed instead of `new URL(req.url).origin`.
  - `apps/web/src/app/api/og/photo/[id]/route.tsx:251-285` builds fallback redirects.
  - `apps/web/src/app/api/og/photo/[id]/route.tsx:261-268` accepts an admin OG image URL only when it matches `new URL(req.url).origin`.
  - `apps/web/src/app/api/og/photo/[id]/route.tsx:278-283` redirects to `${new URL(req.url).origin}/` when no fallback image is usable.
  - `apps/web/nginx/default.conf:196-200` forwards the inbound `Host`/forwarded proto to Next in the general proxy location.
- Failure scenario: Under a proxy/CDN misconfiguration that preserves a hostile `Host` or `X-Forwarded-Host`, malformed IDs or missing derivatives can produce a `302 Location` on the attacker-controlled origin. The internal fetch SSRF/cache-poison lever is closed, but the fallback redirect path still uses the request-derived origin that the same route comments identify as untrusted.
- Concrete fix: Reuse a canonical origin helper based on `siteConfig.url` or `getSeoSettings().url` for fallback validation and root redirects. If the canonical URL is invalid, return a non-redirect fallback response (`404`/`no-store`) rather than deriving from `req.url`. Add a unit/source test with a hostile request URL and assert no `Location: https://evil.example/`.

## Cross-Agent Agreement Signals

None included. I did not rely on another agent's current-cycle findings. The semantic-search and nginx-root issues are likely to overlap with verifier/deployment or product-policy reviewers, but the evidence above was found independently.

## Final Sweep

- Auth/admin API: No new finding. `withAdminAuth` wraps all `/api/admin/**` handlers discovered by the scanner; successful admin API responses get no-store/nosniff defaults.
- Server actions: No new finding. The action-origin scanner passed; public actions are intentionally exempt and carry their own validation/rate-limit posture.
- Public rate limits: No new finding beyond the OG fallback redirect hardening. Mutating public API routes are covered by the scanner; expensive public GET routes `/api/og` and `/api/og/photo/[id]` have in-memory rate limits.
- Privacy/PII: No new finding. Public listing/feed/share/search/map field sets omit sensitive fields or explicitly gate GPS to map-visible topics. Semantic/similar enrichment uses a shared compile-time privacy guard.
- Migration/schema: No new finding. The non-monotonic historical journal block is documented and test-allowlisted; new entries after the recovery point are guarded. Reconcile coverage tests pin current columns, indexes, and dropped paid/reaction schema.
- Product-policy removals: No reintroduced Stripe/payment/entitlement route found in live source. Remaining paid/reaction references are migrations, tests, old plans, or removal guards.
- Unsupported storage backend: No live exposure found. `@/lib/storage` remains an internal/deferred abstraction, consistent with `CLAUDE.md`.
- Auto alt-text stub: Not a finding. Code and UI both disclose the EXIF-derived stub behavior.
- Skipped/irrelevant areas: Historical plans and old review artifacts were scanned for policy drift but not treated as live behavior unless current source/docs referenced them. Binary fixtures/images/fonts were not content-reviewed.
