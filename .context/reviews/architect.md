# Architect Review — Cycle 6 (2026-04-23)

## Scope and inventory covered
Built a repository inventory across root docs/config plus `apps/web/src` (`app`: 55 files, `components`: 44, `lib`: 42, `db`: 3, `__tests__`: 41) and reviewed the architecture-defining boundaries between routes, server actions, query/data helpers, operational state, deployment config, and the documented single-host runtime model.

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 0
- Risks Requiring Manual Validation: 1

## Confirmed Issues

### ARCH6-01 — The public photo route breaks its own ISR boundary by reading admin auth state during render
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files / regions:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:21-22`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:118-125`, `apps/web/src/app/actions/auth.ts:21-23`, `apps/web/src/app/actions/auth.ts:31-53`
- **Why it is a problem:** The photo page declares a one-week `revalidate` window, but the route also calls `isAdmin()` during render to decide whether share/admin controls should be shown. That auth path depends on `cookies()`, which makes the page request-specific. Architecturally, this mixes a public cacheable document with per-user admin personalization, so the route can no longer cleanly behave like a static/ISR page.
- **Concrete failure scenario:** A hot public photo link receives heavy anonymous traffic. Instead of serving a stable cached route shell for a week, the server must render the page per request because auth state is consulted during render, increasing TTFB and wasting DB work on `getImageCached`, `getSeoSettings`, and `getGalleryConfig` for traffic that is almost always anonymous.
- **Suggested fix:** Remove `isAdmin()` from the public page render path. Keep the page purely public/cached, and move share/admin affordances behind a separate dynamic island or admin-only endpoint/action that hydrates after the public shell loads. If request-time personalization is intentionally required, make that explicit with a dynamic route contract rather than an ISR contract.

### ARCH6-02 — `lib/data.ts` is still carrying both the read model and operational write-side lifecycle
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files / regions:** `apps/web/src/lib/data.ts:11-109`, `apps/web/src/lib/data.ts:111-889`, `apps/web/src/app/[locale]/admin/db-actions.ts:18-23`, `apps/web/src/app/[locale]/admin/db-actions.ts:273-279`, `apps/web/src/instrumentation.ts:13-22`
- **Why it is a problem:** `lib/data.ts` is not just a query/read-model module anymore. It owns mutable process state (`viewCountBuffer`, timers, flush backoff), operational lifecycle APIs (`flushBufferedSharedGroupViewCounts()`), privacy field shaping, SEO settings reads, shared-link reads, search, sitemap helpers, and gallery queries. That forces restore/shutdown orchestration to import the same module that public routes use for page data. The boundary between “read data for pages” and “operate background state” is blurred.
- **Concrete failure scenario:** A future refactor to public query code, privacy field selection, or SEO helpers unintentionally affects restore/shutdown behavior because those operational paths import `@/lib/data` just to flush buffered view counts before restore or process exit. This also makes it harder to extract background work into a worker/process later because the operational API is welded to the route-facing query surface.
- **Suggested fix:** Split the shared-group view buffering/flush lifecycle into a dedicated module (for example `lib/shared-group-views.ts` or `lib/view-count-buffer.ts`) with a narrow API such as `recordGroupView()`, `flushGroupViews()`, and `shutdownGroupViews()`. Keep `lib/data.ts` focused on query composition, field shaping, and cached read helpers.

## Likely Issues
- None identified beyond the confirmed issues above.

## Risks Requiring Manual Validation

### ARCH6-R01 — The codebase still assumes the documented single-process deployment model; scale-out would violate multiple runtime invariants
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Risk requiring manual validation
- **Files / regions:** `apps/web/docker-compose.yml:1-22`, `apps/web/src/lib/image-queue.ts:77-94`, `apps/web/src/lib/restore-maintenance.ts:1-55`, `apps/web/src/app/actions/images.ts:55-80`, `apps/web/src/app/actions/images.ts:120-172`, `apps/web/src/lib/rate-limit.ts:22-26`
- **Why it is a problem:** The documented runtime model is a single `web` service on one host, which matches the implementation: image queue state lives in `globalThis`, restore maintenance is process-local, upload throttling uses a module-local `Map`, and login/search fast paths use in-memory maps. That is acceptable for the current compose model, but the architectural constraint is implicit rather than enforced. If operations ever add a second app instance, behavior will diverge immediately.
- **Concrete failure scenario:** During a DB restore, instance A enters restore maintenance and drains its queue, while instance B keeps accepting uploads because its process-local maintenance flag is still false. Likewise, per-IP upload limits and in-memory fast-path rate limits become instance-specific, and queue bootstrap happens independently on each process.
- **Suggested fix:** Either (a) codify “single app instance only” as an explicit operational invariant in deployment/runbooks and monitoring, or (b) move these coordination points to shared infrastructure (DB-backed maintenance flag, distributed queue/lease model, shared rate-limit state) before any horizontal scaling.

## Final sweep
The codebase remains largely well-layered in the main app/actions/components split, and the local-only storage abstraction is now correctly documented as not part of the live pipeline. The two material architectural problems still present are the public photo route’s cache/personalization boundary violation and the continued mixing of read-model concerns with operational lifecycle state inside `lib/data.ts`.
