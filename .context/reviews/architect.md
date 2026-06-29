# Architect Review - Cycle 17/100

Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `5e054f80f646cbcd16c7aae5412aa29424e05032`
Role: architecture/design-risk reviewer
Write scope honored: this file only.

## Coverage

Read first: `AGENTS.md` and `CLAUDE.md`.

Architectural surfaces inventoried at current HEAD:

- Next app boundaries: public routes, admin route groups, protected admin layout, middleware/proxy, API route layout, Server Actions.
- Server actions/API routes: admin auth wrapper, action-origin scanner contract, public-route rate-limit scanner, public search/load-more/view actions, semantic/similar routes, Lightroom upload route.
- Auth: admin cookie/session boundary, token auth for Lightroom, same-origin enforcement, proxy exclusion for `/api/*`.
- Data layer: Drizzle query helpers, public/admin select separation, privacy guards, public map GPS guard, view-count buffer.
- Drizzle schema/migrations: schema table definitions, journal, migration reconciler/baseliner, migration integrity tests.
- Image pipeline/queue: upload enqueue sites, processing settings snapshots, Sharp/libvips tuning, MySQL advisory processing locks, bootstrap retry.
- Color/HDR pipeline: pipeline version, ICC/gain-map/color settings, settings snapshot propagation to browser and Lightroom enqueue paths.
- Service worker/PWA: generated SW, derivative cache, admin/share/map exclusions, admin-render header.
- Semantic search: admin setting gate, stub/production modes, embedding schema, backfill script, upload embedding hook, public query/similar routes.
- Deploy/Docker: Dockerfile, compose topology, entrypoint, nginx, deploy script, docs.
- Tests/lint gates/docs: package scripts, auth/rate-limit/action-origin scanners, migration tests, privacy tests, touch-target audit, documented runbooks.

I also checked prior-cycle areas that were likely to regress. Several notable risks appear closed at HEAD: smart collection AST breadth/size is bounded (`apps/web/src/lib/smart-collections.ts:142-147`, `apps/web/src/lib/smart-collections.ts:316-354`, `apps/web/src/lib/smart-collections.ts:440-501`); browser and Lightroom enqueue paths both snapshot semantic-search mode and color-impacting settings (`apps/web/src/app/actions/images.ts:491-523`, `apps/web/src/app/api/admin/lr/upload/route.ts:474-500`); migration drift is guarded by per-entry baselining and postconditions (`apps/web/scripts/migrate.js:710-807`) plus monotonic journal tests (`apps/web/src/__tests__/migration-journal.test.ts:1-110`); admin pages are protected by a server-side layout `isAdmin()` check, not just middleware token formatting (`apps/web/src/app/[locale]/admin/(protected)/layout.tsx:5-17`); service-worker admin/share/map cache exclusions are present (`apps/web/public/sw.template.js:42-63`, `apps/web/public/sw.template.js:293-314`, `apps/web/public/sw.template.js:388-390`).

## Findings

### ARCH-C17-01 - Confirmed: reverse-proxy config collapses real client identity before the app can apply trusted-hop logic

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- `apps/web/nginx/default.conf:25-29` says this nginx runs behind a TLS-terminating edge/load balancer.
- Every proxied location overwrites client headers with the direct peer address, for example `X-Real-IP $remote_addr` and `X-Forwarded-For $remote_addr` in `apps/web/nginx/default.conf:67-70`, `apps/web/nginx/default.conf:83-87`, `apps/web/nginx/default.conf:140-144`, and `apps/web/nginx/default.conf:191-196`.
- The compose topology enables app-side proxy trust with `TRUST_PROXY: "true"` (`apps/web/docker-compose.yml:19-21`).
- The application expects a preserved right-trusted `X-Forwarded-For` chain and selects the client immediately before the trusted suffix (`apps/web/src/lib/rate-limit.ts:163-185`).

Why this is risky:
The app has a nuanced trusted-hop parser, but nginx destroys the original chain by replacing it with `$remote_addr`. In the documented "behind TLS edge" topology, `$remote_addr` is the edge/load-balancer address, not the browser. The result is a cross-layer mismatch: app code thinks it is rate-limiting by client IP, while nginx has already collapsed many users into the edge IP.

Concrete failure scenario:
If the deployment sits behind Cloudflare, a home router reverse proxy, or another TLS edge, all visitors arriving through the same edge address share public semantic-search/share/OG/login/admin buckets and audit/location attribution. One abusive client can throttle unrelated users, and rate-limit telemetry points to the edge rather than the browser.

Suggested fix:
Make one layer own client-IP normalization. In nginx, either configure `real_ip_header X-Forwarded-For` plus explicit `set_real_ip_from` trusted edge ranges and then pass the normalized address, or preserve the chain with `$proxy_add_x_forwarded_for` and set `TRUSTED_PROXY_HOPS` to the real suffix length. Add a deployment test/health diagnostic that sends a multi-hop `X-Forwarded-For` through nginx and asserts `getClientIp()` resolves the intended client. If this stack is only supported with nginx as the first public hop, remove the "behind TLS edge" claim and document that topology as unsupported.

### ARCH-C17-02 - Confirmed: tag relation mutations and parent image freshness are not atomic

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- `addTagToImage` inserts the `image_tags` row, then updates `images.updated_at` in a separate statement (`apps/web/src/app/actions/tags.ts:175-199`).
- `removeTagFromImage` deletes from `image_tags`, then updates `images.updated_at` separately (`apps/web/src/app/actions/tags.ts:238-262`).
- `batchAddTags` inserts tag links, then updates image timestamps separately (`apps/web/src/app/actions/tags.ts:323-339`).
- `batchUpdateImageTags` correctly wraps add/remove link changes in `db.transaction(...)`, but the `images.updated_at` update still happens after that transaction commits (`apps/web/src/app/actions/tags.ts:396-460`, `apps/web/src/app/actions/tags.ts:477-483`).

Why this is risky:
The architecture treats `images.updated_at` as a parent freshness signal for revalidation-sensitive public surfaces, feeds, admin views, and cache invalidation. Tag membership is user-visible image metadata. Committing the relation change without the parent freshness update breaks that invariant.

Concrete failure scenario:
An admin adds or removes a tag and the `image_tags` write commits, but the subsequent `images.updated_at` update fails because the DB connection drops, a deadlock victim is chosen, or the process exits. The photo now renders with changed tags, but downstream consumers that rely on `updated_at` for freshness, sitemap/feed last-modified ordering, or stale-cache decisions do not observe the metadata change.

Suggested fix:
Move each link mutation and the corresponding `images.updated_at = CURRENT_TIMESTAMP` write into the same transaction. For `batchUpdateImageTags`, include the parent timestamp update inside the existing transaction when `added > 0 || removed > 0`, or return the counters from the transaction and perform all writes before commit. Add a regression test that forces the timestamp update path to fail and asserts the tag relation rolls back.

### ARCH-C17-03 - Risk: semantic embeddings are keyed one-row-per-image, making model transitions destructive and hard to roll back

Severity: Medium
Confidence: High
Status: Risk

Evidence:
- `image_embeddings.image_id` is the table primary key; `model_version` is only an indexed attribute (`apps/web/src/db/schema.ts:280-295`).
- The backfill selects images missing a row for the target model version, but writes through `onDuplicateKeyUpdate`, replacing the existing row for the image with the target version (`apps/web/scripts/backfill-clip-embeddings.ts:80-83`, `apps/web/scripts/backfill-clip-embeddings.ts:123-147`, `apps/web/scripts/backfill-clip-embeddings.ts:172-183`).
- Public semantic search only scans rows for the active model version (`apps/web/src/app/api/search/semantic/route.ts:261-273`).

Why this is risky:
The schema cannot hold two model versions for the same image. That is simple for today's stub/production switch, but it turns every future embedding model upgrade into an overwrite migration. The read path already filters by version, so during a rolling backfill the active model sees only the subset already overwritten. After overwrite, the old model corpus is gone unless the operator re-embeds everything.

Concrete failure scenario:
An operator tests a new production CLIP model by running the backfill with a new `PRODUCTION_MODEL_VERSION`. Halfway through, search quality regresses or the process is interrupted. Rows already rewritten disappear from the old model's result set, rows not yet rewritten disappear from the new model's result set, and rollback requires a full old-model re-embed from originals. On larger galleries this creates a partial-corpus outage rather than a reversible cutover.

Suggested fix:
Model embeddings as `(image_id, model_version)` with a composite primary or unique key, and make "active semantic model" a separate setting/cutover. Backfill into a new version alongside the old one, verify coverage for the candidate model, then flip the active model. Add cleanup tooling to retire old versions after a successful cutover. If storage cost is the blocker, document that semantic upgrades are destructive maintenance windows and gate production mode until coverage for the active version is above an explicit threshold.

### ARCH-C17-04 - Risk: several correctness helpers are process-local, so the deployment is architecturally single-instance even where DB locks exist

Severity: Medium
Confidence: High
Status: Risk

Evidence:
- The shipped compose file defines one named web container on host networking (`apps/web/docker-compose.yml:3-21`).
- The processing queue state is a `globalThis` singleton with process-local `enqueued`, retry, permanent-failure, bootstrap, and side-effect state (`apps/web/src/lib/image-queue.ts:76-90`, `apps/web/src/lib/image-queue.ts:275-325`). Processing itself has a DB advisory lock (`apps/web/src/lib/image-queue.ts:446-473`), but the surrounding scheduler state remains local.
- Shared-group view counts are buffered in module-level maps and timers (`apps/web/src/lib/data.ts:13-35`, `apps/web/src/lib/data.ts:75-125`, `apps/web/src/lib/data.ts:235-249`).
- CLAUDE documents host-network, bind-mount, single-stack deployment assumptions rather than a multi-instance architecture (`CLAUDE.md:632-649`, `CLAUDE.md:456-464`).

Why this is risky:
The code has some distributed-safety pieces, especially MySQL advisory locks around image processing, but the surrounding architecture still assumes one Node process owns queues, rate windows, buffered counters, and bootstrap state. That boundary is easy to miss because the DB lock can make the queue look horizontally safe.

Concrete failure scenario:
An operator scales the web service to two processes for uptime or CPU. Uploads can be enqueued independently in each process; failed/permanently-failed tracking, bootstrap cursors, and side effects diverge. View-count increments are buffered per process and may be lost on a crash/restart of either instance. In-memory public/admin throttles are divided per process unless every relevant limiter uses a DB-backed helper. The system may mostly work, but invariants become probabilistic and hard to debug.

Suggested fix:
Make the topology contract executable. Either add a startup guard/documented env such as `GALLERYKIT_SINGLE_INSTANCE_ACK=true` and explicitly reject multi-process/serverless deployments, or externalize the process-local pieces to a durable coordinator: DB/Redis queue claims, DB-backed rate limits for all security-relevant public/admin surfaces, and direct atomic view-count increments or a durable event table. Keep the existing MySQL advisory lock, but do not present it as sufficient for horizontal scaling.

### ARCH-C17-05 - Likely: container startup can recursively walk all persistent photo data on deploy/restart

Severity: Low
Confidence: Medium
Status: Likely

Evidence:
- The entrypoint recursively `chown -R`s `/app/data`, `/app/apps/web/public/uploads`, and `/app/apps/web/public/resources` whenever each top-level directory owner is not `node` (`apps/web/scripts/entrypoint.sh:4-13`).
- The deployment model restarts/rebuilds on every iteration and bind-mounts persistent originals, derivatives, resources, and site config (`AGENTS.md:15-20`, `apps/web/docker-compose.yml:23-27`, `CLAUDE.md:456-464`).

Why this is risky:
Ownership repair belongs to provisioning or migration, but the runtime entrypoint performs it synchronously before starting the app. The guard checks only the top-level owner, so any restore, rsync, or host-side copy that changes root ownership can make every deploy traverse the full original and derivative corpus.

Concrete failure scenario:
A host restore or manual copy leaves `public/uploads` owned by root. The next per-iteration deploy runs `chown -R` across tens or hundreds of GB of derivatives before the server starts. On the documented single-instance, no-staging deployment, that turns a normal restart into extended downtime and may hit disk/IO pressure on the already disk-constrained host.

Suggested fix:
Move ownership normalization to deploy/provisioning with an explicit operator-visible step, or make startup repair bounded: ensure only required directories exist, repair missing/current-run directories, and fail fast with a diagnostic when persistent roots have unexpected ownership. If recursive repair remains necessary, put it behind an explicit one-shot env flag and log progress/estimated scope.

### ARCH-C17-06 - Risk: reusable deployment artifacts still carry the live demo/domain as a default topology

Severity: Low
Confidence: High
Status: Risk

Evidence:
- The checked-in site config uses `https://gallery.atik.kr` as the canonical URL (`apps/web/src/site-config.json:1-10`).
- The nginx server block hardcodes `server_name gallery.atik.kr` (`apps/web/nginx/default.conf:21-29`).
- Docs tell operators to customize `site-config.json` and describe `BASE_URL` as the deploy-time canonical override (`README.md:148-149`, `CLAUDE.md:632-646`), but the checked-in default is a real production/demo URL rather than an obviously invalid placeholder.

Why this is risky:
The product is documented as self-hostable, but core deployment artifacts are biased toward the current live domain. A production build will reject `example.com` and localhost placeholders, but `gallery.atik.kr` is a valid absolute URL, so a fork or new install can accidentally publish sitemaps, OG URLs, analytics same-site decisions, and nginx virtual-host behavior for the demo domain.

Concrete failure scenario:
A self-hosting operator follows the Docker path, forgets to override `BASE_URL`, and leaves the checked-in config mounted. The app boots successfully because the URL is valid, but generated metadata and feeds point to `gallery.atik.kr`; nginx also only matches that server name unless edited. Search engines and share cards now reference the wrong origin, and the misconfiguration is not fail-fast.

Suggested fix:
Treat the live demo URL like a placeholder for non-demo builds. Either move `apps/web/src/site-config.json` out of the reusable default path and require local generation, or make `ensure-site-config.mjs` reject `gallery.atik.kr` unless an explicit `GALLERYKIT_ALLOW_DEMO_URL=true` or deployment profile is set. Parameterize nginx `server_name` through generated config/env templating, or ship `_`/`localhost` as the example with clear production override instructions.

## Final Sweep Notes

- Next boundaries: admin page data is protected by the `(protected)` layout `isAdmin()` check, while API routes are excluded from middleware and rely on `withAdminAuth`. That split is documented in source and linted; no new architecture finding beyond the proxy/IP topology.
- Server actions/API routes: action-origin and public-route rate-limit gates are present. I specifically rechecked the current public-route scanner and tests; the older "local helper hides missing rate limit" shape is not present at HEAD because helper bodies are inspected and ignored helper calls are rejected (`apps/web/scripts/check-public-route-rate-limit.ts:129-244`, `apps/web/scripts/check-public-route-rate-limit.ts:271-276`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:326-361`).
- Data privacy: public/admin select separation and GPS map guard are explicit; no confirmed PII leakage found in the reviewed surfaces.
- Schema/migrations: the historical non-monotonic journal is acknowledged and guarded. I did not find schema/migration drift that should block deploy at HEAD.
- Image/color/HDR pipeline: enqueue sites now carry the full settings snapshot, and the pipeline version is centralized. No new mismatch found.
- Service worker/PWA: admin-render and revocable-share/map exclusions are present; no cache-leak finding at HEAD.
- Semantic search: activation gates and body/rate-limit controls are present. The remaining design risk is model-version storage/cutover, not an immediate auth or public API defect.
- Deploy/Docker/docs: the largest risks are topology configuration: client IP handling, single-instance assumptions, recursive startup repair, and live-domain defaults.

No fixes were implemented as part of this review.
