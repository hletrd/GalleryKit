# GalleryKit — Architecture Review (ARCHITECT pass)

Scope: module boundaries, process-local state, deployment topology, config layering,
migration/schema-drift, dependency/build fragility, i18n routing, client/server split.
Read-only. No source modified. Repo HEAD on `master`; note that teammates were editing
`.dockerignore` concurrently during this pass (the `**/node_modules` / `**/.next` nesting
gap was fixed mid-review, so it is NOT reported below).

## Architecture inventory (context)

- **Layering:** `app/actions/*` (server actions, mutation surface) → `lib/*` (107 modules:
  data access, image pipeline, config, rate-limit, color/HDR, restore) → `db/*` (Drizzle
  schema + pooled mysql2). `data.ts` is the read layer with `React cache()` dedup;
  `gallery-config.ts` (server) wraps `gallery-config-shared.ts` (client-safe). Boundary is
  mostly clean and enforced by `server-only` + the `_PrivacySensitiveKeys` compile guard +
  four lint gates (api-auth, action-origin, public-route-rate-limit, eslint).
- **Process-local coordination state (globalThis Symbol / module `let`):** image queue
  (`image-queue.ts`), admin backfill runner status (`admin-backfill-runner.ts`),
  admin-mutation restore barrier (`admin-mutation-barrier.ts`), restore-maintenance flag
  (`restore-maintenance.ts`), upload-quota tracker (`upload-tracker-state.ts`), shared-group
  view-count buffer (`data.ts:18`), background-db-write Set (`background-db-writes.ts:3`),
  and the OG/share/feed/semantic/login/search rate-limit fast-path Maps (`rate-limit.ts`,
  `auth-rate-limit.ts`). Login/search/view have DB backing; the rest are purely per-process.
- **Deploy topology:** multi-stage Dockerfile (build-base → deps → prod-deps → builder →
  runner), `output: 'standalone'`, `network_mode: host`, single `gallerykit-web` container,
  host MySQL on 127.0.0.1, host nginx edge, bind-mounted `./data`, `./public/uploads`,
  `./public/resources`, `./src/site-config.json:ro`. `deploy.sh` git-pulls + `compose up
  --build` + auto-prune. Migrations run at container start via `migrate.js` before `exec node
  server.js`.
- **Config layering:** env vars (bounded parsers in `env.ts`) → `site-config.json`
  (build-time defaults) → DB `admin_settings` (runtime overrides for a SUBSET of fields).
- **i18n:** `next-intl` middleware, `localePrefix: 'always'`, locales en/ko, admin auth guard
  co-located in `proxy.ts`.

---

## Findings

### ARCH-01 — Correctness-critical coordination state is process-local with only docs as the scale-out guard  [HIGH / High]
`admin-mutation-barrier.ts`, `upload-tracker-state.ts`, `image-queue.ts`, `data.ts:18`,
`background-db-writes.ts:3`, `restore-maintenance.ts`.
CLAUDE.md documents "single web-instance / single-writer; do not horizontally scale," but
NOTHING in code enforces it — no replica/leader assertion, no shared store. Several of these
are *correctness*-load-bearing, not just best-effort analytics:
- The restore fence (`acquireAdminMutationSlot`/`drainAdminMutations`) only drains
  in-flight mutations **in the current process**. With 2+ replicas, replica B can commit
  writes INTO a database that replica A is concurrently restoring a dump into → silent
  post-restore corruption (the exact bug the barrier was built to close, reopened by
  scale-out).
- Upload-quota TOCTOU protection and per-window byte/file caps are per-process, so quotas
  effectively multiply by replica count.
- OG/share/semantic rate-limit fast paths are per-process (no DB backing), so distributed
  abuse defense weakens linearly with replicas.
**Failure scenario:** an operator adds `deploy: replicas: 2` (or a second compose host on the
same MySQL) with no code error, no log, no test failure — the advisory-lock-backed paths
(image claim, backfill, restore lock) still serialize, but the barrier drain and quota/rate
state silently desync. **Fix:** add a boot-time guard/warning keyed on an explicit
`GALLERYKIT_SINGLE_WRITER=1` (or an advisory-lock-based "am I the singleton" probe) that
refuses to start / logs loudly if it detects another live instance on the same MySQL server;
longer term move the barrier + quota + rate fast-paths to the DB/shared store they already
half-use. This is the single most load-bearing architectural constraint and today it lives
only in prose.

### ARCH-02 — 10-connection pool + `revalidate = 0` on every public surface = hard throughput ceiling  [MED / Medium]
`db/index.ts:23,31,33` (connectionLimit 10, queueLimit 20, connectTimeout 5s); 9 public
pages export `revalidate = 0` (home, topic, photo, s/, g/, c/, timeline, year, map);
`data.ts:1129` (`getImage` runs a 3-way `Promise.all` = 3 concurrent connections per photo
render). No ISR, no read replica, no result cache beyond per-request `cache()`. Background
work (image queue, hourly view-GC, in-app backfill) reserves ~half the pool by design
(`IMAGE_QUEUE_RESERVED_LIVE_CONNECTIONS`, `resolveBackfillConcurrency`).
**Failure scenario:** a crawler or social-unfurl burst hitting many `/p/[id]` pages
concurrently multiplies into 3× connections each; with a backfill running the effective live
budget is ~5, so ~2 simultaneous photo renders saturate it and further requests queue up to
the 5s `connectTimeout` / queueLimit-20 wall, surfacing as latency spikes / 500s under
modest load. **Fix:** reintroduce short-TTL ISR (or `unstable_cache`) on the read-heavy
gallery/photo surfaces with an explicit invalidation hook on upload/settings change; raise
the pool or document the concurrency envelope. At minimum, treat the current all-dynamic
policy as a known ceiling, not a default to keep silently.

### ARCH-03 — `site-config.json` is build-time-inlined; the read-only bind mount is inert, and config precedence is split  [MED / High]
15 modules `import siteConfig from '@/site-config.json'`; **zero** read it via `fs` at
runtime (`proxy.ts`, `footer.tsx`, `nav-client.tsx`, `analytics.ts`, layout, OG routes, …).
Next inlines JSON imports at build. But `docker-compose.yml` mounts
`./src/site-config.json:ro` over the container path, implying live runtime configurability.
Because every consumer imports (not reads) the file, editing the mounted JSON in production
has **no effect** until a full image rebuild. Precedence is also inconsistent: `title`,
`description`, `nav_title`, `author` ARE DB-overridable via `getSeoSettings()`
(`data.ts:1801-1803`), but `footer_text` (`footer.tsx:36`), `home_link`
(`nav-client.tsx:72`), `locale`, `url`, and `google_analytics_id` are file-only + inlined.
**Failure scenario:** operator edits mounted `site-config.json` to fix the footer or GA id
and restarts (not rebuilds) → no change, no error; worse, the middleware CSP allow-list is
built from the build-time-inlined `siteConfig.google_analytics_id` (`proxy.ts:47`), so a
changed GA id would be CSP-blocked even after the analytics loader reads the new value.
**Fix:** either read `site-config.json` at runtime via `fs` (making the mount real) or drop
the mount and document site-config as build-time-only; unify which fields are DB-overridable
vs file-only so operators have one mental model.

### ARCH-04 — Migration journal is non-monotonic by design; only a custom post-condition saves it  [MED / High]
`drizzle/meta/_journal.json`: `when` timestamps jump backward across entries (e.g. `0006`
= 1778304060000 ≈ 2026-05 → `0007` = 1746144000000 ≈ 2025-05, a full year backward; several
more inversions through 0017). Stock drizzle's cursor (`MAX(created_at)` vs `folderMillis`)
silently skips any entry below the max — which already burned production once (per CLAUDE.md).
The only thing preventing silent skips is `migrate.js`'s bespoke per-hash reconcile +
post-condition assertion. Anyone using standard tooling instead (`drizzle-kit migrate`, or
the documented `npm run db:push`) operates on a poisoned cursor. The authoring rule ("new
`when` strictly greater than max") has **no author-time guard** — it only fails at the next
deploy's post-condition, after the bad journal is committed. **Fix:** add a repo test that
asserts journal `when` values are strictly ascending by `idx` (fail authoring, not deploy),
and document that only `migrate.js` — never raw drizzle-kit — may apply migrations here.

### ARCH-05 — `reconcileLegacySchema` is a hand-maintained parallel schema that can silently drift from `schema.ts`  [MED / Medium]
`scripts/migrate.js` (`reconcileLegacySchema`) duplicates every table/column as idempotent
CREATE/ALTER guards, and the runbook requires updating it by hand for each new column. It is
a second source of truth for the schema with no automated cross-check against
`src/db/schema.ts`. **Failure scenario:** a new column is added to `schema.ts` + a migration
SQL file but `reconcileLegacySchema` is not updated; a fresh DB that lacks
`__drizzle_migrations` rows (or a legacy DB being reconciled) baselines an incomplete schema,
and the drift only surfaces as a runtime "unknown column" much later. **Fix:** add a test
that reflects `schema.ts` columns and asserts each appears in `reconcileLegacySchema` (mirror
of the existing `_PrivacySensitiveKeys`/`SENSITIVE_KEYS` guard pattern already used for
privacy fields).

### ARCH-06 — `@/lib/storage` is an unwired S3-shaped abstraction (dead code that lies)  [MED / High]
`src/lib/storage/{index,local,types}.ts` exposes `switchStorageBackend`,
`getStorageBackendStatus`, `PresignedUrlOptions`, and a `StorageBackend` interface — an
S3/MinIO-shaped API — but **only** `LocalStorageBackend` exists and the module is imported by
nobody in the live pipeline (only its own `index.ts` re-export + two tests). Uploads,
processing, and serving all use direct `fs`. `switchStorageBackend('local')` just constructs
another local backend. CLAUDE.md itself warns "do not document/expose S3/MinIO switching."
**Risk:** ~14 KB of aspirational abstraction that implies a capability that does not exist,
misleads contributors, and rots (its rollback/dispose logic is untested against any real
second backend). **Fix:** delete the multi-backend surface (keep only what the pipeline would
actually call if/when integrated) or mark it clearly `@internal not-wired` and stop exporting
the switch/status API until a real backend lands.

### ARCH-07 — Dockerfile prod-deps stage copies only root `/app/node_modules`; a future workspace-nested prod dep would MODULE_NOT_FOUND at runtime  [LOW-MED / Medium, needs-validation]
Dockerfile: `COPY --from=prod-deps /app/node_modules ./node_modules` (and the builder's
`COPY --from=deps /app/node_modules ./node_modules`) copy only the hoisted root tree.
`serverExternalPackages: ['drizzle-orm','sharp','@huggingface/transformers','onnxruntime-node']`
are excluded from the standalone bundle and MUST resolve from that copied `node_modules` at
runtime. Today all prod deps hoist to root (verified), so it works; but the local
`apps/web/node_modules` proves npm DOES nest packages under the workspace (drizzle-kit,
esbuild, `@aws-sdk`, `@vitejs` are nested there — all devDeps today). **Failure scenario:** a
future dependency bump introduces a version conflict that forces a *production* or
*externalized* package (e.g. a `sharp`/`onnxruntime-node`/`mysql2` transitive) to nest under
`apps/web/node_modules`; the root-only COPY drops it, and because externalized packages are
resolved at *runtime* (not traced at build), the build passes and the container crashes with
`MODULE_NOT_FOUND` only on deploy. This is the same class as the drizzle-kit hoisting fix
already in flight. **Fix:** also `COPY --from=prod-deps /app/apps/web/node_modules
./apps/web/node_modules` (guarded to no-op when empty), or run prod install with
`--install-strategy=hoisted` / verify hoisting in CI, or add a runner-stage
`node -e "require('sharp');require('onnxruntime-node');require('mysql2')"` smoke (already done
for sharp in prod-deps) covering every externalized package.

### ARCH-08 — Production `/api/*` responses ship without a Content-Security-Policy  [LOW / High]
`proxy.ts:129` middleware matcher excludes `/api`, and the middleware is the only place CSP
is set in production (`next.config.ts headers()` sets CSP only when `isDev`). So the OG image
routes and all JSON API responses have no CSP in prod, contradicting the "CSP for proxied
responses is set by Next.js (single source of truth)" comment in `nginx/default.conf`.
Impact is low (image/JSON payloads), but it's an inconsistency worth closing. **Fix:** add
the CSP (or at least a minimal `default-src 'none'` for API/image routes) to the global
`headers()` block for non-dev, or extend the middleware matcher intentionally.

### ARCH-09 — `getSeoSettings()` catch-fallback is partial and mislabels the field  [LOW / High]
`nav.tsx:11`: `getSeoSettings().catch(() => ({ nav_title: siteConfig.title }))` — on a DB
error the fallback (a) uses `siteConfig.title` where `siteConfig.nav_title` is the correct
default, and (b) returns an object missing every other `SeoSettings` field, so any consumer
that reads `seo.title`/`seo.description` during a DB blip gets `undefined`. Nav only reads
`nav_title` so the blast radius is small today, but the fallback is a latent inconsistency if
reused. **Fix:** return a complete defaulted `SeoSettings` object (all fields from
`siteConfig`) from a single shared fallback builder.

---

## Also examined, no material finding
- **API design consistency:** admin routes uniformly wrap `withAdminAuth` (lint-enforced);
  public search/OG routes uniformly set `runtime='nodejs'` + `dynamic='force-dynamic'` +
  `preIncrement*` rate-limit (lint-enforced). `health` (readiness, exempt-commented) vs
  `live` (liveness) split is deliberate and correct. Shapes are consistent.
- **Client/server split:** `server-only` + shared client-safe modules (`*-shared.ts`,
  `color-primaries.ts`, `color-pipeline-decisions.ts`) keep the boundary clean;
  `use-display-capability.ts` snapshot-memoization hazard is documented.
- **Signals/shutdown:** `NEXT_MANUAL_SIG_HANDLE=true` + `exec` PID-1 ownership +
  `instrumentation.ts` drain is correct and well-reasoned.
- **Route-handler duplication:** `uploads/[...path]` exists as locale + non-locale twins, and
  `feed.xml` as root + topic twins; both must be kept in sync by hand (minor maintainability
  drift risk, not a defect).

## Final sweep
Covered: layering/coupling, process-local inventory, deploy (Dockerfile/compose/nginx/deploy.sh/
entrypoint), config precedence, migration drift, dependency/native/hoisting risk, i18n +
middleware auth, client/server split, API design, connection-pool/scaling. The `.dockerignore`
nested-workspace gap was being fixed live by a teammate and is excluded. Highest-value items:
ARCH-01 (scale-out has no code guard) and ARCH-02 (pool + all-dynamic ceiling); ARCH-03/04/06
are concrete correctness/maintainability traps worth scheduling.
