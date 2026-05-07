# Architect — Cycle 8 (Fresh, broad sweep)

**Scope:** structural cohesion, abstraction quality, deferred-debt posture.

## Observations

### A8F-01 — Public-route cache policy is now inconsistent across surfaces
**Where:** `revalidate = 0` on `/`, `/[topic]`, `/p/[id]`, `/s/[key]` (presumed); `Cache-Control: no-store` on `/api/og`; `force-dynamic` + dead `revalidate=3600` on `/sitemap.ts`; `Cache-Control: public, max-age=31536000, immutable` on processed image files.
**Architectural concern:** Three different "freshness" idioms coexist (`revalidate=0`, header `no-store`, `force-dynamic`). New contributors lack a consistent mental model for "how do I declare this route's cache policy."
**Recommendation:** Document a single decision matrix in CLAUDE.md or a new `apps/web/src/app/CACHE-POLICY.md`:
  - Pages that surface async-processed images → `revalidate = 0` (current — explicit, intentional)
  - Static-asset routes → header `Cache-Control: public, immutable`
  - Image-generation routes (e.g. `/api/og`) → `Cache-Control: public, max-age=...`
  - Crawler discovery routes (e.g. `/sitemap.xml`) → `revalidate = 3600`
This would prevent the `/api/og` `no-store` and the sitemap `force-dynamic` drift from happening again.

### A8F-02 — Rate-limit infrastructure has 4 separate Maps + 1 DB table
**Where:** `loginRateLimit`, `passwordChangeRateLimit`, `searchRateLimit`, `loadMoreRateLimit`, `shareRateLimit`, `userCreateRateLimit` — six in-memory Maps, each with its own prune helper, its own bucket type in the DB, its own rollback helper. The pattern is solid but at six sites of duplication, the surface area is now large enough to start drifting.
**Architectural concern:** A future fix or feature must remember six prune helpers, six rollback helpers, six TOCTOU patterns. Easy to forget one.
**Recommendation (DEFER unless touched again):** A small `createRateLimit(name, windowMs, maxRequests, maxKeys)` factory that returns `{check, rollback, prune, reset}` would compress the duplication. This is an aesthetic refactor, not a security fix — defer until a 7th rate-limit type is added or a bug arises in one of the six.

### A8F-03 — `app/api/og/route.tsx` lives under `/api/` but is not behind `withAdminAuth` or rate-limit
**Where:** `apps/web/src/app/api/og/route.tsx`
**Architectural concern:** The repo's invariant is "anything under `/api/admin/` requires `withAdminAuth`." Public `/api/*` is fine, but the `/api/og` route is the only public `/api/*` and it is also the only one with no rate-limit. There is no design pattern that anchors this distinction.
**Recommendation:** Either add a `lint:api-rate-limit` companion to `lint:api-auth` that requires public `/api/*` routes to call a designated rate-limit helper, or add an explicit comment annotation `@api-public-rate-limited: <bucket-name>` similar to `@action-origin-exempt`.

### A8F-04 — `.env` knobs are sprawled across docs
**Where:** `CLAUDE.md`, `.env.local.example`, individual lib files reading `process.env.X`.
**Knobs identified this cycle:** `SESSION_SECRET`, `TRUST_PROXY`, `TRUSTED_PROXY_HOPS`, `IMAGE_BASE_URL`, `BASE_URL`, `UPLOAD_ROOT`, `UPLOAD_ORIGINAL_ROOT`, `UPLOAD_MAX_TOTAL_BYTES`, `UPLOAD_MAX_FILES_PER_WINDOW`, `IMAGE_MAX_INPUT_PIXELS`, `IMAGE_MAX_INPUT_PIXELS_TOPIC`, `SHARP_CONCURRENCY`, `QUEUE_CONCURRENCY`, `AUDIT_LOG_RETENTION_DAYS`, `DB_HOST/PORT/USER/PASSWORD/NAME/SSL`, `MYSQL_PWD`, `NODE_ENV`, `NEXT_TELEMETRY_DISABLED`, `PORT`, `HOSTNAME`.
**Architectural concern:** `.env.local.example` is the canonical document, but several of these knobs (`AUDIT_LOG_RETENTION_DAYS`, `IMAGE_MAX_INPUT_PIXELS_TOPIC`, `SHARP_CONCURRENCY`, `QUEUE_CONCURRENCY`) are not in `.env.local.example` and not documented in CLAUDE.md.
**Recommendation:** Audit `.env.local.example` against the runtime knobs and add the missing ones with sane defaults + comments. Low risk, high docs value.

### A8F-05 — Single-process runtime invariant remains undocumented at the code level
**Where:** Only documented in CLAUDE.md ("Runtime topology") section.
**Architectural concern:** The web service relies on process-local state for `getProcessingQueueState`, `loginRateLimit` Map, `searchRateLimit` Map, `viewCountBuffer`, `uploadTracker`, `restoreMaintenance` flag, `acquireUploadProcessingContractLock`. A future developer reading code only (not docs) could miss the topology constraint.
**Recommendation:** Add a runtime assertion at instrumentation startup that warns if `process.env.NODE_APP_INSTANCE` or `pm_id` (PM2) or similar process-multiplier indicators are set. Cheap defense against horizontal-scaling misconfiguration. Defer if not deemed worthwhile.

## Severity assessment

- All architect-lens findings are LOW severity. They are about ergonomics and drift prevention, not correctness or security.
- The cycle's MEDIUM-severity finding (`/api/og` DoS amplifier) is a tactical fix, not an architectural change.

## Net stance

The architecture is sound. The remaining work is mostly documentation hygiene and lint-rule scope expansion to prevent future drift. Strongly aligned with the critic's "let convergence land" stance.
