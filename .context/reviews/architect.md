# Architect Review — Run 5 Cycle 1 (Residual Architectural / Design Risks)

Repo: GalleryKit (`/Users/hletrd/flash-shared/gallery`, app in `apps/web`)
Reviewer: architect (read-only)
Scope: RESIDUAL architecture/design risks after 20 prior review cycles. Coupling/layering, abstraction leaks, single-writer state coordination, schema/index vs query shapes, migration fragility, Docker/deploy/nginx alignment, i18n routing, config layering, dependency risks.

Method: inventoried the lib/ + app/ module graph (~80 lib modules, 14 server-action files, 8 API routes), traced every architectural seam, validated each claim against code. Most prior-cycle defenses are genuinely solid (advisory locks, migration post-condition guard, privacy compile-time guards, smart-collection allowlist, blur-data-url contract). Findings below are gaps those cycles did not close.

## Summary

No new CRIT. The codebase is unusually well-hardened for its size. Residual risk concentrates in two classes: (1) **dead / inert defense-in-depth** that CLAUDE.md documents as active but the shipped nginx topology bypasses (serve-upload settings-hash ETag); (2) **unbounded / silently-degrading state** that the single-writer + per-iteration-deploy model amplifies (analytics table growth with no retention, in-memory rate-limit reset on every deploy, geoip silent degradation, journal-monotonicity enforced only by a runbook note not a test).

---

## Findings

### ARCH-R5C1-01 — serve-upload settings-hash ETag is inert in the shipped nginx topology
- **Files:** `apps/web/nginx/default.conf:146-166`, `apps/web/src/lib/serve-upload.ts:200-201`, `apps/web/src/lib/settings-hash.ts`, `apps/web/docker-compose.yml:23-25`
- **Design risk:** The documented production deployment puts nginx in front (host-network compose), and nginx serves `/uploads/{jpeg,webp,avif}/...` *directly via sendfile from `/app/apps/web/public`* (`location ~ ^(?:/[a-z]{2})?/uploads/(jpeg|webp|avif)/...`). Requests for existing derivatives never reach Node — so `serve-upload.ts`'s `W/"v${PIPELINE}-${mtime}-${size}-${settingsHash}"` ETag (the P4-E2 settings-hash invalidation) never executes in production. nginx emits only its own default mtime/size ETag + `must-revalidate`. CLAUDE.md ("ETag / cache invalidation") frames serve-upload as the secondary path "for files missing from public," but with nginx in front it is the path for *no* normal derivative request.
- **Failure scenario:** Admin flips `wide_gamut_jpeg_chroma` / `avif_effort` / `force_srgb_derivatives` WITHOUT running a backfill. The settings-hash component that was designed to invalidate cached variants on that change is dead; nginx keeps serving the old bytes (mtime unchanged because no re-encode happened) until the 3600 s max-age lapses, and revalidation returns 304 on the unchanged file. The "flip a setting → cache busts automatically" guarantee documented in CLAUDE.md does not hold behind nginx. (Mitigation that exists: a *backfill* re-encode changes mtime, so the mtime ETag does bust — but only because backfill is mandatory, which makes the settings-hash redundant, not active.)
- **Suggested direction:** Either (a) document explicitly that settings-hash invalidation requires a backfill and is a no-op for direct-served files behind nginx (align the doc to reality), or (b) move the settings-hash into the filename/path (e.g. content-addressed or `?v=` query the SW/client appends) so the static layer participates. Lowest-effort: doc correction + a note in `serve-upload.ts` that its ETag path is dev/fallback-only.
- **Severity:** MEDIUM · **Confidence:** HIGH · **Classification:** abstraction-leak / doc-vs-reality drift

### ARCH-R5C1-02 — No retention/pruning for analytics view-event tables (unbounded growth)
- **Files:** `apps/web/src/app/actions/public.ts:360,381,397` (INSERT paths), `apps/web/src/lib/audit.ts:55-73` (the ONLY table with a retention job), `apps/web/src/db/schema.ts` (`image_views`/`topic_views`/`shared_group_views`)
- **Design risk:** `audit_log` has `purgeOldAuditLog` (90-day default, env-tunable) and a test. The three analytics event tables (`imageViews`, `topicViews`, `sharedGroupViews`) have a per-IP insert rate limit (120/min) but **no retention/pruning anywhere** — `grep` finds zero `delete(imageViews)` / cleanup job. Every legitimate page view writes a row forever.
- **Failure scenario:** On the single-instance MySQL volume, a moderately-trafficked gallery accumulates millions of rows over months. Analytics dashboard queries (`analytics-data.ts` GROUP BY/JOIN over `imageViews innerJoin images`) slow down, the data volume grows without bound, and DB backup dumps (stored on the same 124 G deploy host, see disk-hygiene runbook) balloon. There is no operator lever to cap it.
- **Suggested direction:** Add `purgeOldViewEvents(maxAgeMs)` mirroring `purgeOldAuditLog`, wire it into the same hourly background job that purges expired sessions, env-gated retention (e.g. `VIEW_EVENT_RETENTION_DAYS`, default 365). Add a `(viewed_at)` index if range-deletes are chunked.
- **Severity:** MEDIUM · **Confidence:** HIGH · **Classification:** state-growth / operability

### ARCH-R5C1-03 — `geoip-lite` not declared as an external/traced package; silently degrades + stale data
- **Files:** `apps/web/src/lib/analytics.ts:33-50` (dynamic `require('geoip-lite')` in try/catch → `() => null` on failure), `apps/web/next.config.ts:45` (`serverExternalPackages: ['drizzle-orm', 'sharp']` — geoip absent), `apps/web/package.json:49` (`geoip-lite ^2.0.1`)
- **Design risk:** Two coupled issues. (1) The package is loaded via runtime `require()` and is NOT in `serverExternalPackages` nor `outputFileTracingIncludes`. Next standalone output traces imports statically; a runtime-only `require` of a package whose large `data/*.dat` files are loaded by side-effect is exactly the class Next's tracer can miss. (2) `geoip-lite` bundles its MaxMind GeoLite2 snapshot at npm-install time and is never refreshed; with per-iteration Docker rebuilds the data is whatever was current at image build, and silently drifts.
- **Failure scenario:** If standalone tracing drops geoip's data files, the `require` throws, the catch sets `geoLookup = () => null`, and *every* `country_code` becomes `'XX'` with no error surfaced (only a `console.debug`). Admins see empty/garbage country analytics and assume "no international traffic." Even when it loads, IP→country mappings are months stale. The graceful-degradation design hides the failure entirely.
- **Suggested direction:** Add `geoip-lite` to `serverExternalPackages` (so it's resolved from node_modules at runtime, not bundled) AND `outputFileTracingIncludes` for its `data/` dir, OR add a startup probe that logs WARN (not debug) when geo lookup is unavailable so the silent-XX state is observable. Document the stale-data limitation. If geo accuracy matters, switch to a maxmind reader with a mounted, updatable DB file.
- **Severity:** MEDIUM · **Confidence:** MEDIUM (tracing-drop is environment-dependent; the stale-data + silent-degradation halves are certain) · **Classification:** dependency / observability gap

### ARCH-R5C1-04 — Migration journal monotonicity enforced only by a runbook note, not a test
- **Files:** `apps/web/drizzle/meta/_journal.json` (idx 6 `when=1778304060000` > idx 7 `when=1746144000000` — confirmed inversion), `apps/web/scripts/migrate.js:697-708` (runtime post-condition guard), CLAUDE.md "Adding a new migration" step 2
- **Design risk:** The repo's journal is already non-monotonic (verified: a ~1-month backward jump at idx 6→7). The robust runtime defense (`migrate.js` throws "Drizzle silently skipped N migration(s)" if any journal hash is missing post-migrate) catches drift only *at deploy time, on the deploy host, after the bad migration is already committed and pushed*. The "use `Date.now()` and strictly advance `when`" rule lives only in CLAUDE.md prose. Nothing in CI fails a PR that adds a migration with a `when` below the current max.
- **Failure scenario:** A future contributor (or an agent in a /review-plan-fix loop) hand-writes a journal entry copying an old timestamp pattern, or uses a wall clock skewed earlier. The post-condition assertion fires — but only on the production deploy host, turning a deploy into a hard failure with no staging to catch it (CLAUDE.md: "There is no staging environment" + "per-iteration deploy"). The boulder-loop self-deploys broken migrations.
- **Suggested direction:** Add a vitest fixture (sibling to the existing migration tests) asserting `_journal.json` entries have strictly increasing `when`, and asserting every `tag` has a matching `drizzle/NNNN_*.sql` file with a hash. This moves the check left into `npm test` (already a commit gate) instead of the production deploy. Cheap, high-leverage given the burned-once history.
- **Severity:** MEDIUM · **Confidence:** HIGH · **Classification:** migration-architecture fragility / CI gap

### ARCH-R5C1-05 — In-memory rate limits reset every deploy; only login is DB-backed
- **Files:** `apps/web/src/lib/rate-limit.ts:79-119` (`ogRateLimit`, `checkoutRateLimit`, `shareRateLimit`, `searchRateLimit`, `semanticRateLimit` all `createResetAtBoundedMap` — pure in-memory), `:400-447` (only login uses `rateLimitBuckets` DB table), `apps/web/docker-compose.yml:11` (`restart: always`), CLAUDE.md per-iteration deploy policy
- **Design risk:** Login rate limiting is DB-backed (survives restart). Every *other* public rate limit (OG image generation, Stripe checkout creation, share creation, search, semantic search) is process-memory only. The project policy is to deploy on **every commit** — and each deploy rebuilds + restarts the container, wiping all in-memory buckets.
- **Failure scenario:** During an active /review-plan-fix loop (which can commit+deploy many times per hour), every deploy hands every IP a fresh budget for OG/checkout/share/search/semantic. An actor scripting against `/api/og/photo/[id]` (an expensive ImageResponse render) or `/api/checkout` (Stripe API calls cost money + rate against Stripe) gets their counter zeroed on each deploy. The expensive-GET routes (OG) are explicitly NOT covered by the `lint:public-route-rate-limit` gate either (GET handlers excluded). Abuse cost is bounded only by the deploy cadence, which is high.
- **Suggested direction:** For the cost-bearing surfaces (OG render, Stripe checkout), promote to the same `rateLimitBuckets` DB-backed pattern login already uses (the infra exists). At minimum, document that these limits are best-effort and reset per deploy, and ensure Stripe-side idempotency/limits are the real backstop for checkout.
- **Severity:** LOW · **Confidence:** HIGH · **Classification:** single-writer-state-coordination / deploy-coupling

### ARCH-R5C1-06 — `storage/` abstraction is fully dead code (only a test imports it)
- **Files:** `apps/web/src/lib/storage/index.ts` (`getStorage`/`switchStorageBackend`/`getStorageBackendStatus` — full singleton + rollback logic), `:local.ts`, `:types.ts`; sole consumer is `apps/web/src/__tests__/storage-local.test.ts:10`
- **Design risk:** Confirmed via grep: NO production code imports `@/lib/storage` — only its own test. The module carries a `switchStorageBackend` API, rollback-on-failure logic, and a `StorageBackendType` union (currently only `'local'`). It is a half-built abstraction maintained (and reviewed, and kept passing) but wired to nothing. CLAUDE.md already flags "Not Yet Integrated," so this is acknowledged — but it is a standing maintenance/confusion tax and an attractive-nuisance: a future contributor may wire `switchStorageBackend('s3')` believing an S3 path exists (it does not; `switchStorageBackend` always news a `LocalStorageBackend` regardless of `type`).
- **Failure scenario:** An agent tasked with "add S3 support" reads `storage/index.ts`, sees a backend-switching API + a `StorageBackendType`, and assumes integration is partial — wiring an admin toggle to `switchStorageBackend('s3')` which silently constructs a local backend (line: `new LocalStorageBackend()` is the only branch). Uploads appear to "switch to S3" but write locally. The misleading API shape invites exactly the half-integration CLAUDE.md warns against.
- **Suggested direction:** Either delete the module + its test until S3 is actually planned (deletion-first), or collapse `switchStorageBackend` to throw `NotImplemented` for any non-`'local'` type so the dead branch can't masquerade as functional. Keep `LocalStorageBackend` only if a near-term caller is committed.
- **Severity:** LOW · **Confidence:** HIGH · **Classification:** abstraction-leak / dead-code

### ARCH-R5C1-07 — `revalidate = 0` on every public page + 10-connection pool = no buffer against traffic/crawl spikes
- **Files:** every `apps/web/src/app/[locale]/(public)/**/page.tsx` sets `export const revalidate = 0` (home, topic, photo, timeline, map, year, c/[slug], g/[key], s/[key]); `apps/web/src/db/index.ts:19-21` (`connectionLimit: 10`, `queueLimit: 20`)
- **Design risk:** Public rendering is fully dynamic (no ISR, no CDN page cache documented). Each page render runs its DB queries fresh on every request. The pool is 10 connections + 20 queued; beyond that, `getConnection` rejects. Single instance, no horizontal scale (topology constraint). This is a deliberate freshness trade-off (documented), but the *combination* with a tiny pool and no caching layer is an unguarded scalability cliff.
- **Failure scenario:** A crawler or a small traffic burst (e.g. a link shared widely) drives concurrent renders > 30 in-flight DB ops. Connection acquisition rejects, pages 500/503, and because each public page also fires a fire-and-forget analytics INSERT (another pooled op), the pool saturates faster. There is no `revalidate`-based shedding to absorb the spike.
- **Suggested direction:** Reintroduce a short ISR window (`revalidate = 30–60`) on the *list* pages (home/topic/year) where staleness is tolerable, keeping `revalidate = 0` only on photo/admin-sensitive routes; OR put a CDN micro-cache (nginx `proxy_cache` with a few-second TTL) in front of public GETs. CLAUDE.md explicitly says "Reintroduce ISR only with an explicit invalidation/freshness plan" — this finding is that prompt.
- **Severity:** LOW · **Confidence:** MEDIUM · **Classification:** scalability ceiling / schema-vs-load

---

## Cross-cutting observations (not findings)

- **Well-defended seams (validated, no action):** advisory-lock coordination set is comprehensive and the server-vs-database scope caveat is documented; migration post-condition guard is genuinely robust; `_PrivacySensitiveKeys` / `publicSelectFields` compile-time guard is sound; smart-collection compiler uses a strict column allowlist + Drizzle binding (no SQL injection surface); blur-data-url and tag-names-agg contracts are fixture-locked; SIGTERM graceful shutdown drains the queue AND flushes view counts (instrumentation.ts) — the view-count timer uses `unref()` but the explicit shutdown flush covers the gap.
- **Client/server layering is clean:** the only client→data.ts imports (`home-client.tsx`, `load-more.tsx`) are `import type` (erased at compile), so no server module leaks into the client bundle. `server-only` markers present on the client-adjacent color modules.
- **nginx body caps align** with the documented app limits (2M default, 64K login, 250M /admin/db, 216M dashboard).
- **`drizzle-kit` is pinned to a beta** (`1.0.0-beta.9-e89174b`) but it is dev-only (`db:push`); production migration runs through the hand-rolled `migrate.js`, so the beta pin does not reach the prod migration path. Low concern, noted only.

## Consensus Addendum
N/A — this is a fresh review pass, not a ralplan consensus review.

## References
- `apps/web/nginx/default.conf:146-166` — direct sendfile of derivatives bypasses serve-upload (ARCH-R5C1-01)
- `apps/web/src/lib/serve-upload.ts:200-201` — settings-hash ETag, inert behind nginx (ARCH-R5C1-01)
- `apps/web/src/app/actions/public.ts:360,381,397` — view-event INSERTs with no retention (ARCH-R5C1-02)
- `apps/web/src/lib/audit.ts:55-73` — the only retention job (contrast, ARCH-R5C1-02)
- `apps/web/src/lib/analytics.ts:33-50` — geoip runtime require + silent fallback (ARCH-R5C1-03)
- `apps/web/next.config.ts:45` — serverExternalPackages omits geoip-lite (ARCH-R5C1-03)
- `apps/web/drizzle/meta/_journal.json` idx 6→7 — confirmed `when` inversion (ARCH-R5C1-04)
- `apps/web/scripts/migrate.js:697-708` — runtime-only monotonicity guard (ARCH-R5C1-04)
- `apps/web/src/lib/rate-limit.ts:79-119,400-447` — in-memory limits vs DB-backed login (ARCH-R5C1-05)
- `apps/web/src/lib/storage/index.ts` — dead abstraction, only test imports it (ARCH-R5C1-06)
- `apps/web/src/app/[locale]/(public)/**/page.tsx` `revalidate = 0` + `apps/web/src/db/index.ts:19-21` pool (ARCH-R5C1-07)
