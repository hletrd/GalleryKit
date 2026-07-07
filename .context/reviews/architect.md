# Cycle 11 - Architect Review

Date: 2026-07-07
Reviewer: architect
HEAD reviewed: `163b9dd053bd6fb2d9570bda4fd4337b7b81bfc8`

Scope: read-only architecture/design review across repository boundaries, coupling, layering, data ownership, operational topology, and maintainability. I edited only this review artifact. I did not modify source, plans, migrations, runtime config, services, production data, or deploy state.

## Inventory

I read `AGENTS.md` from the prompt and `CLAUDE.md`, then inventoried the current repository before inspecting cross-file interactions.

- Docs and operations: `CLAUDE.md`, `AGENTS.md`, root/package workspace files, `apps/web/README.md`, deploy/nginx/Docker assets, migration runbook, CLIP semantic-search notes, color/HDR notes, and `.context/{plans,reviews}` history.
- Source surface counted this pass: 605 TypeScript/TSX files under `apps/web/src`; 80 App Router files; 111 `src/lib` files; 61 component files; 346 unit/source-contract tests; 10 Playwright e2e files; 33 migration/journal files.
- Boundaries inspected: public/admin data selectors, auth/action/API guards, upload/image queue, image processing and static serving, restore fences, maintenance scheduler, semantic search/backfills, storage abstraction, Drizzle schema/migrations/reconcile, DB TLS config, deploy helper, nginx edge limits, and process-local runtime state.
- Final sweep: searched for stale prior findings, TODO/FIXME/deferred/experimental markers, process-local state, manual operational contracts, public `revalidate = 0` pages, direct filesystem writes, privacy selector aliases, migration drift, and docs/source mismatches.

Validation performed: static architecture review with source/doc cross-checks. I did not run lint, typecheck, unit tests, build, e2e, or production probes because this lane is review-only and no application behavior was changed.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 3
- Low: 3

## Findings

### ARCH-C11-01 - Byte-impacting settings commit before static derivatives are regenerated

Severity: Medium
Confidence: High
Validation: Confirmed by static source/docs inspection

File/line region:
- `apps/web/src/app/actions/settings.ts:168-239`
- `apps/web/next.config.ts:56-72`
- `apps/web/src/lib/serve-upload.ts:240-258`
- `apps/web/src/lib/revalidation.ts:59-64`
- `CLAUDE.md:315-317`

Issue:
Changing quality, gamut, chroma, effort, or related byte-impacting settings writes the new settings immediately and revalidates app data, but existing derivatives under `public/uploads` still resolve through Next static serving. The route-handler ETag includes the settings hash only for fallback paths; static files keep old bytes and only change when a re-encode rewrites mtime/size.

Failure scenario:
An admin changes `force_srgb_derivatives`, JPEG quality, AVIF effort, or chroma policy after photos exist. Public pages and admin UI now imply the new policy, but most visitors keep receiving derivative bytes encoded under the old policy until a separate backfill or sidecar rewrite completes. Photographer-facing delivery correctness and operational state diverge.

Concrete fix:
Make byte-impacting settings a generation workflow, not just a settings write. Options: move derivatives behind a version/settings-aware route handler; use content-addressed or settings-versioned derivative paths; or record a pending derivative generation version and block/mark the setting as not fully applied until a queued backfill has rewritten current-version files. The admin UI should expose "settings saved, derivatives pending" as durable state rather than a transient return flag.

### ARCH-C11-02 - Single-writer topology is still only warn-only

Severity: Medium
Confidence: High
Validation: Confirmed by static source/docs inspection

File/line region:
- `apps/web/src/lib/single-writer-guard.ts:6-16`
- `apps/web/src/lib/single-writer-guard.ts:218-235`
- `apps/web/src/instrumentation.ts:22-31`
- `apps/web/src/lib/upload-tracker-state.ts:7-20`
- `apps/web/src/lib/rate-limit.ts:393-415`
- `CLAUDE.md:236-237`

Issue:
The repository correctly documents a single web-instance/single-writer topology, but enforcement is log-only. Startup continues after persistent lock contention, while correctness-relevant coordination remains process-local: upload quota tracking, restore mutation barriers, queue state, status surfaces, and some rate-limit fast paths.

Failure scenario:
A deploy, manual Docker command, or future blue/green rollout starts two `gallerykit-web` processes against the same writable DB. Both continue serving. Upload quotas split across processes, restore fences and maintenance state can be process-skewed, public expensive-route limits weaken, and operators may miss the warning until user-visible inconsistency appears.

Concrete fix:
Add an enforceable production mode such as `GALLERYKIT_ENFORCE_SINGLE_WRITER=true` that fails readiness or exits after persistent advisory-lock contention. Longer term, move correctness state to DB/advisory-lock-backed coordination and leave only explicitly lossy counters in memory.

### ARCH-C11-03 - Public dynamic-page protection depends on out-of-band nginx state

Severity: Medium
Confidence: Medium
Validation: Manual validation required for production host state; static repo contract confirmed

File/line region:
- `apps/web/src/app/[locale]/(public)/page.tsx:19`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:42`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:24`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:14`
- `apps/web/nginx/default.conf:4-10`
- `apps/web/nginx/default.conf:20-29`
- `apps/web/deploy.sh:51-56`
- `CLAUDE.md:238`
- `CLAUDE.md:485-493`

Issue:
Public pages are dynamic (`revalidate = 0`) and multi-query, but page-level rate limiting lives only in the committed nginx template. The normal deploy script rebuilds/restarts Docker and does not apply or reload host nginx. The template also notes real-IP caveats under load-balancer topologies. That makes a core availability/performance boundary operationally manual.

Failure scenario:
A host is missing the latest nginx template, an operator forgets to reload after config changes, or a future deployment runs behind a different proxy/CDN. Public page floods hit Next/MySQL directly because app-layer page routes have no equivalent limiter; conversely an LB-fronted host without realip config can collapse all visitors into one nginx bucket and return broad 429s.

Concrete fix:
Either bring edge config under the deploy topology with an explicit, tested nginx apply/reload step and live verification, or add a lightweight app-layer fallback limiter for public dynamic pages. If keeping edge-only protection, add a deploy-time or health endpoint assertion that records active nginx limiter/realip posture so reviewers can validate it without SSH-only manual procedure.

### ARCH-C11-04 - Shared-group read helper owns view-count mutation

Severity: Low
Confidence: High
Validation: Confirmed by static source inspection

File/line region:
- `apps/web/src/lib/data.ts:1318-1407`
- `apps/web/src/lib/data.ts:1803-1805`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`

Issue:
`getSharedGroup()` is a data retrieval helper, but it can buffer a denormalized `view_count` increment after reading group/images/tags. The public page then separately records durable analytics. This couples a reusable read path to analytics/counter writes and makes cache/dedup semantics part of the counting model.

Failure scenario:
A future metadata route, admin preview, or background validation imports `getSharedGroupCached()` for convenience and increments `view_count` without a real public gallery view. Another render path calling the cached helper with different `incrementViewCount` intent can also make counter behavior depend on call order within the request.

Concrete fix:
Make shared-group reads pure. Move denormalized counter buffering into an explicit `recordSharedGroupView` service beside durable analytics, and have the public page decide once whether the request counts. Cache only the pure read helper.

### ARCH-C11-05 - Experimental storage abstraction is weaker than the live file-pipeline contract

Severity: Low
Confidence: Medium
Validation: Likely future-integration risk from static source inspection

File/line region:
- `apps/web/src/lib/storage/index.ts:1-18`
- `apps/web/src/lib/storage/types.ts:44-100`
- `apps/web/src/lib/storage/local.ts:76-108`
- `apps/web/src/lib/storage/local.ts:142-156`
- `apps/web/src/lib/process-image.ts:1164-1224`
- `apps/web/src/lib/process-image.ts:1433-1477`

Issue:
The storage module is explicitly not wired into the live pipeline, but its interface advertises upload/Sharp/serve operations without the invariants the live filesystem path depends on: atomic replace, rollback, no partial final-file visibility, symlink-safe writes, and temp/backup cleanup. The local backend writes streams/buffers directly to final paths and copies directly to destination paths.

Failure scenario:
A future storage migration replaces `process-image.ts` final writes with `StorageBackend.writeBuffer()` or `copy()`. During backfill, encode failure, process crash, or disk pressure, readers can observe partial or stale derivative files that the current temp-file + rename + rollback design would avoid.

Concrete fix:
Keep the abstraction quarantined as experimental until its contract matches production needs, or extend it first with `atomicReplace`, temp namespace cleanup, rollback semantics, symlink-safe open/write behavior, and parity tests against `process-image.ts` and `serve-upload.ts` assumptions.

### ARCH-C11-06 - Drizzle Kit DB TLS config is separate from runtime/script DB TLS config

Severity: Low
Confidence: High
Validation: Confirmed by static source inspection

File/line region:
- `apps/web/drizzle.config.ts:1-22`
- `apps/web/src/db/index.ts:7-19`
- `apps/web/scripts/mysql-connection-options.js:13-29`

Issue:
Runtime DB access and operational scripts require `DB_SSL_CA` for non-local MySQL unless `DB_SSL=false`, then load that CA into `ssl.ca`. Drizzle Kit has a separate config path that enables TLS for non-local hosts with only `{ rejectUnauthorized: true }` and never reads `DB_SSL_CA`.

Failure scenario:
An operator or maintainer runs a Drizzle Kit command against a non-local MySQL endpoint using a private CA. Runtime and backup/restore scripts work, but Drizzle Kit fails certificate verification or tempts disabling TLS verification for tooling. The database access invariant becomes tool-dependent.

Concrete fix:
Centralize the DB connection option builder for Drizzle Kit as well, or make Drizzle Kit explicitly local-only unless it can load the same CA path. Keep production schema changes on the committed migration runner and make ad hoc Drizzle Kit access fail closed for non-local DBs without supported TLS.

## Closed Prior Architect Items Rechecked

- Embedding cardinality/docs drift: closed. `CLAUDE.md:160`, `apps/web/README.md:75`, schema, migrations, and `semantic-embedding-storage-contract.test.ts` now agree that `image_embeddings` stores one active row per `image_id` and model changes overwrite the row.
- Public select alias bypass: materially improved. `privacy-fields.test.ts:182-235` now checks public projection blocks for sensitive `images.*` aliases, and `publicSelectFields` is pinned to an explicit safe allowlist.

## Final Sweep

I found no Critical or High architecture issues in this pass. Remaining risks are mostly topology and contract-strength issues: settings-byte freshness, warn-only single-writer enforcement, manual edge-limiter deployment, side-effecting reads, future storage integration, and duplicated DB TLS config.

Commonly missed areas checked:

- Auth/action/API boundaries: admin API wrappers, server-action same-origin gates, PAT upload auth, public expensive API rate-limit linting, restore fences, and session handling. No new architect-level issue beyond process-local single-writer enforcement.
- Data ownership: public/admin selectors, map GPS exceptions, shared links, smart collections, semantic-search enrichment, timeline/year pages, and privacy-field tests. Prior alias-bypass risk is now tested.
- Migrations/schema: Drizzle journal monotonicity, reconcile coverage, DML-baseline guard, `image_embeddings` storage contract, and admin-only column checklist. No new migration drift found.
- Storage/media: upload paths, original privacy, derivative generation, atomic replacement, static serving precedence, service-worker cache notes, and experimental storage module. Main risks are derivative freshness and future abstraction integration.
- Operations: deploy script, Docker persistence, nginx limiter template, host-nginx manual apply, single-writer boot guard, DB TLS, CLIP activation runbook, and process-local state. Main unresolved operational boundary is that some correctness/availability controls remain social/manual rather than enforced by deploy/runtime.
