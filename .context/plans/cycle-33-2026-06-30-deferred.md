# Cycle 33/100 Deferred Findings

Date: 2026-06-30 KST
Source review: `.context/reviews/_aggregate.md`

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/**`, and `docs/superpowers/**`. No `.cursorrules` or `CONTRIBUTING.md` exists in this checkout.

Deferred items preserve original severity and confidence. Deferred work remains bound by repo policy: GPG-signed conventional commits with gitmoji, no `--no-verify`, no force-push, required quality gates, and deploy policy.

## Deferred Items

### AGG-C33-09 - Initial public listings still pay full grouped window counts

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/lib/data.ts:898-927`, `apps/web/src/lib/data.ts:1466-1481`
- Reason for deferral: Performance/scaling change that alters public listing data contracts and total-count UI. It is not a correctness, security, or data-loss finding, and needs a dedicated query/UI plan so counts are removed or cached without breaking pagination semantics.
- Exit criterion: Gallery size, DB timing, crawler load, or a product decision requires first-page listing count removal/caching; reopen with query benchmarks and UI copy decisions.

### AGG-C33-10 - Timeline and On This Day queries are non-sargable

- Original severity/confidence: Low / High
- Citation: `apps/web/src/lib/data-timeline.ts:97-117`, `apps/web/src/lib/data-timeline.ts:129-145`, `apps/web/src/lib/data-timeline.ts:186-207`
- Reason for deferral: Requires schema/index work and migration/reconcile updates. This is a scale optimization, not a current correctness/security/data-loss finding.
- Exit criterion: Timeline or home render DB CPU becomes measurable on production-sized imports, or a migration cycle is opened for generated date-part columns.

### AGG-C33-11 - GPS stripping reads full originals into memory

- Original severity/confidence: Low / High
- Citation: `apps/web/src/lib/process-image.ts:1737-1816`
- Reason for deferral: Requires lower-level image/container parsing changes or a privacy-mode upload cap. This is a bounded memory optimization separate from the higher-severity LR multipart pre-parse issue scheduled this cycle.
- Exit criterion: Privacy-mode uploads show memory pressure, or streaming/range-based GPS stripping is planned.

### AGG-C33-12 - Grid JPEG fallback can fetch base JPEGs for thumbnails

- Original severity/confidence: Low / Medium
- Citation: `apps/web/src/components/grid-picture.tsx:30-50`
- Reason for deferral: Low-risk browser fallback performance improvement; no correctness or privacy impact. It should be handled with visual/browser verification to avoid regressing responsive image selection.
- Exit criterion: A target browser falls back to JPEG frequently, LCP traces show base JPEG tile downloads, or a responsive-image pass is scheduled.

### AGG-C33-13 - CI does not build the production Docker image

- Original severity/confidence: Medium / High
- Citation: `.github/workflows/quality.yml:48-80`, `apps/web/Dockerfile:49-61`
- Reason for deferral: Changes CI cost/runtime and external GitHub Actions behavior. Repo rules classify CI/deployment changes as sensitive; this cycle is focused on local code/test fixes and the already-requested deploy path only.
- Exit criterion: Next/native dependency pins change, Docker build fails in deploy, or the user opens CI hardening scope.

### AGG-C33-14 - Semantic/similar search silently misses older photos beyond the scan window

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`
- Reason for deferral: Product/architecture scale boundary that needs a vector index, ANN service, or operator-visible saturation design. It is already documented in `CLAUDE.md` as a bounded request-time scan through `SEMANTIC_SCAN_LIMIT`.
- Exit criterion: Active embeddings exceed `SEMANTIC_SCAN_LIMIT`, production search recall complaints appear, or vector-index work is approved.

### AGG-C33-15 - Advisory lock names are globally scoped to a MySQL server

- Original severity/confidence: Low / High
- Citation: `apps/web/src/lib/advisory-locks.ts:8-47`
- Reason for deferral: `CLAUDE.md` explicitly documents the topology constraint: "Run one GalleryKit per MySQL server — or prefix advisory-lock names with a per-instance identifier if multi-tenant co-location is required." This deployment uses the documented single-instance topology.
- Exit criterion: Multiple GalleryKit databases are placed on one MySQL server or an instance-id configuration effort is opened.

### AGG-C33-16 - Optional DB health probe is unauthenticated and unthrottled

- Original severity/confidence: Low / Medium
- Citation: `apps/web/src/app/api/health/route.ts:7-31`
- Reason for deferral: `CLAUDE.md` documents `/api/health` as liveness-only by default and DB probing only when `HEALTH_CHECK_DB=true`. The default shipped behavior avoids DB work; changing public readiness policy needs operator/deployment context.
- Exit criterion: `HEALTH_CHECK_DB=true` is enabled on an internet-reachable deployment, or monitoring requires public DB readiness.

### AGG-C33-17 - Root-equivalent admins widen compromise blast radius

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/actions/admin-users.ts:77-204`, `apps/web/src/app/[locale]/admin/db-actions.ts:164-372`
- Reason for deferral: Security finding, deferred only because repo docs explicitly define the current product boundary: `CLAUDE.md` says "multiple root-admin accounts (authentication only; no role/capability separation yet)" and "Admin accounts are multiple root admins. The current schema has no role/capability model." Adding roles is a product/schema project, not a cycle-local fix.
- Exit criterion: The product decides to add role/capability separation, shares admin access beyond fully trusted operators, or exposes GalleryKit as multi-user SaaS.

### AGG-C33-18 - Restore accepts sensitive auth/session/token table state

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/lib/sql-restore-scan.ts:12-251`, `apps/web/src/app/[locale]/admin/db-actions.ts:570-744`
- Reason for deferral: Security/integrity finding, deferred only under the documented root-admin/host-operator trust model. `CLAUDE.md` states DB restore is an admin operation and backups are within the root admin plus host operator boundary. Changing restore provenance, signing, or session/PAT invalidation is a product recovery-policy decision.
- Exit criterion: Restore is delegated to non-root operators, backup provenance becomes untrusted, or the product adopts post-restore session/PAT invalidation.

### AGG-C33-19 - Process-local limits depend on single-instance deployment

- Original severity/confidence: Low / High
- Citation: `apps/web/src/lib/rate-limit.ts:74-375`, `apps/web/docker-compose.yml:3-22`
- Reason for deferral: `CLAUDE.md` explicitly documents the shipped Docker Compose deployment as "single web-instance / single-writer" and says not to horizontally scale until process-local states move to shared storage.
- Exit criterion: More than one web process/instance is introduced, or shared Redis/MySQL rate limiting is approved.

### AGG-C33-20 - Plaintext SQL backups rely on host/operator controls

- Original severity/confidence: Low / High
- Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:185-332`, `apps/web/src/app/api/admin/db/download/route.ts:21-90`
- Reason for deferral: Security finding, deferred under the documented host/operator boundary. `CLAUDE.md` states "Dumps are plaintext SQL at rest; host/storage encryption is the operator boundary."
- Exit criterion: Host/storage encryption is unavailable, backup files leave the trusted host boundary, or app-managed backup encryption is approved.

### AGG-C33-24 - Mobile home tag filter can consume the first viewport

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/components/home-client.tsx:257-287`, `apps/web/src/components/tag-filter.tsx:63-88`
- Reason for deferral: UI information-architecture change that needs browser screenshots across real tag counts and active-filter states. It is not a correctness/security/data-loss finding.
- Exit criterion: Mobile screenshot review confirms taxonomy displaces photography above the fold, or a mobile filter redesign is scheduled.

### AGG-C33-27 - Byte-impacting settings can leave derivative bytes mixed/stale

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/actions/settings.ts:68-134`, `apps/web/src/lib/settings-hash.ts:47-59`, `apps/web/scripts/backfill-color-pipeline.ts:332-341`
- Reason for deferral: Photographer-facing correctness risk, but `CLAUDE.md` currently documents this operational gotcha: flipping color/quality/size settings does not invalidate already-served static derivative bytes until a backfill rewrites files. Fixing it requires product design for blocking, automatic backfill, or derivative-stale state.
- Exit criterion: Admin settings UI is changed to promise immediate byte changes, a stale-derivative marker/backfill workflow is approved, or operator confusion recurs.

### AGG-C33-28 - Invalid public view-recording calls consume analytics limiter budget

- Original severity/confidence: Low / Medium
- Citation: `apps/web/src/app/actions/public.ts:341-395`, `apps/web/src/app/actions/public.ts:417-510`
- Reason for deferral: Analytics-accuracy/rate-budget policy question. Charging invalid target attempts may be intentional to protect DB reads; impact is dropped analytics events, not user-visible correctness/security/data loss.
- Exit criterion: Analytics undercount from invalid-target traffic is observed, or product policy decides invalid targets should use a separate limiter or rollback path.
