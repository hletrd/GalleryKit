# Cycle 37 Code Review - code-reviewer

Date: 2026-07-08
Repository: `/Users/hletrd/flash-shared/gallery`
Mode: read-only product review; no product code edits.

## Outcome

No actionable code-quality, logic, SOLID, maintainability, data-flow, edge-case, or cross-file interaction findings were identified in this cycle.

Severity summary:

- Confirmed findings: none.
- Likely findings: none.
- Risk findings: none requiring product-code changes.

Recommendation: keep the repository as-is for this review lane.

## Validation Evidence

Commands run from the repo root:

- `npm run lint:api-auth --workspace=apps/web` - passed; both admin route exports wrapped with `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web` - passed; mutating server actions enforce same-origin/barrier guard or documented exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed; public expensive/mutating route handlers have rate-limit pre-increment coverage or documented exemptions.
- `npm run lint --workspace=apps/web` - passed.
- `npm run typecheck --workspace=apps/web` - passed, including app test files and scripts.
- `npm run build --workspace=apps/web` - passed; Next.js 16.2.10 production build completed.
- `npm test --workspace=apps/web` - passed; 361 files passed, 2 skipped; 3400 tests passed, 4 skipped.
- `npm run audit:prod` - passed; 0 vulnerabilities.
- `npm run test:e2e --workspace=apps/web` - passed; 45 passed, 2 skipped.
- `git status --short` before review was clean; after validation no product-code changes were present. An unrelated `.context/reviews/cycle37/perf-reviewer.md` addition exists and was not touched by this review.

## Inventory Built

I inventoried tracked repository files with `git ls-files`, `rg --files`, and targeted path listings before reviewing. Review-relevant inventory classes covered:

- App Router pages, layouts, route handlers, server actions, and proxy middleware under `apps/web/src/app` and `apps/web/src/proxy.ts`.
- Data access, auth, validation, rate limiting, image processing, queueing, restore locks, semantic search, OG generation helpers, config, settings hashes, and cache/revalidation modules under `apps/web/src/lib`, `apps/web/src/db`, and `apps/web/src/i18n`.
- React components under `apps/web/src/components`.
- Unit tests under `apps/web/src/__tests__` and Playwright tests under `apps/web/e2e`.
- Drizzle migrations and metadata under `apps/web/drizzle`.
- Operational scripts under `apps/web/scripts`, root `scripts`, Docker, Compose, nginx, and deploy files.
- Root and workspace package/config files, including `package.json`, `apps/web/package.json`, TypeScript, Next, Vitest, Playwright, ESLint, and audit-related config.
- Project documentation and prior review/plan history under `CLAUDE.md`, `AGENTS.md`, `.context/reviews`, and `.context/plans`.

High-level tracked-file inventory observed: 745 files under `apps/web`; 369 unit-test files under `apps/web/src/__tests__`; 115 library modules under `apps/web/src/lib`; 81 App Router files under `apps/web/src/app`; 30 SQL migrations plus Drizzle metadata.

## Files Examined

Primary instruction and context files:

- `AGENTS.md` - read first for repository rules, commit/deploy expectations, schema and quality gates.
- `CLAUDE.md` - read in full for architecture, security model, privacy guardrails, image/color/HDR pipeline, restore and race-condition contracts, deployment, and operational rules.
- `.context/reviews/run9-cycle8/_aggregate.md` - sampled recent aggregate baseline to avoid refiling already-closed or documented non-findings.

Core product/security/data-flow files examined with line regions:

- `apps/web/src/app/actions/images.ts` lines 87-620: browser upload flow, maintenance gate, same-origin guard, mutation slot, quota claim/settle, disk precheck, original save, GPS/HDR checks, DB insert, queue enqueue, revalidation, and audit.
- `apps/web/src/app/api/admin/lr/upload/route.ts` lines 85-647: token-authenticated Lightroom upload flow, multipart/body limits, token scope, upload contract lock, quota settlement, DB insert, queue enqueue, token marking, and lock release.
- `apps/web/src/lib/image-queue.ts` lines 250-1260: queue state, timers, restore quiescence, advisory per-image locks, retry accounting, config snapshots, derivative cleanup, conditional DB updates, captions, embeddings, and permanent failure handling.
- `apps/web/src/lib/process-image.ts` lines 620-1040: derivative deletion, metadata stripping, original persistence, safe filenames, Sharp metadata validation, blur data URL generation, and color-signal handling.
- `apps/web/src/lib/data.ts` lines 240-520 and 760-1840: public/admin select shapes, privacy-sensitive field guard, feed/search/map/shared-group/smart-collection accessors, and public map opt-in.
- `apps/web/src/lib/search-enrichment-fields.ts` lines 1-47: public semantic/similar result enrichment with compile-time privacy guard.
- `apps/web/src/app/actions/public.ts` lines 181-245: public smart-collection load-more gate for slug validation, rate limit, public-only collection fetch, query parsing, and compiled criteria.
- `apps/web/src/app/actions/collections.ts` lines 1-158: admin-only smart-collection mutations and removed unauthenticated getter note.
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx` lines 19-165 and `layout.tsx` lines 1-30: public smart-collection page/layout metadata and 404 gating for missing/private collections.
- `apps/web/src/lib/smart-collections.ts` lines 1-320: query validation and allowlisted predicate compiler.
- `apps/web/src/app/[locale]/admin/db-actions.ts` lines 1-680: CSV export, DB dump, restore maintenance, advisory locks, drain checklist, and restore lock release strategy.
- `apps/web/src/lib/db-restore.ts` lines 1-64: restore size/header/trailer validation helpers.
- `apps/web/scripts/migrate.js` lines 1-620: migration journal safeguards, legacy schema reconciliation, and fresh-DB baseline handling.
- `apps/web/src/lib/api-auth.ts` lines 1-154: admin API wrapper, PAT scope path, rate limit ordering, cookie auth path, and response hardening.
- `apps/web/src/app/actions/auth.ts` lines 1-500: login/logout/password update origin checks, rate limits, Argon2 dummy hash, session rotation, and revocation.
- `apps/web/src/lib/rate-limit.ts` lines 1-360: client-IP derivation, trusted-proxy hop handling, bounded in-memory counters, and pre-increment helpers.
- `apps/web/src/proxy.ts` lines 1-135: CSP nonce, admin route cookie-shape guard, locale middleware, and API exclusion.
- `apps/web/src/app/api/search/semantic/route.ts` lines 107-369: same-origin gate, maintenance, body limits, rate charging, mode gating, embedding scan, enrichment, and no-store response.
- `apps/web/src/app/api/search/similar/[id]/route.ts` lines 68-286: same-origin gate, maintenance, ID validation, rate charging, production-only mode, target/scanned embeddings, enrichment, and public result stripping.
- `apps/web/src/app/api/og/route.tsx` lines 71-275: topic/tag validation, rate limit, topic lookup, sanitization, ETag, cache policy, and error hardening.
- `apps/web/src/app/api/og/photo/[id]/route.tsx` lines 87-375: per-photo OG rate limit, image lookup fallback policy, canonical-origin internal fetch, ETag, JPEG post-processing, and same-origin fallback redirect.
- `apps/web/src/lib/og-photo-fetch.ts` lines 64-118: bounded internal photo derivative fetch and total-budget fallback chain.
- `apps/web/src/lib/safe-json-ld.ts` lines 14-20: JSON-LD escaping.
- `apps/web/src/app/api/health/route.ts` lines 1-81 and `apps/web/src/app/api/live/route.ts` lines 1-10: liveness/readiness behavior and DB probe coalescing.
- `apps/web/deploy.sh` lines 15-108, `apps/web/Dockerfile` lines 1-198, `apps/web/docker-compose.yml` lines 1-32, `apps/web/nginx/default.conf` lines 1-313, and `scripts/deploy-remote.sh` lines 1-93: deployment, runtime dependency packaging, persistence mounts, edge limits, proxy headers, health checks, env-file permission checks, and Docker prune guarantees.

## Review Notes And Failure Scenarios Checked

### Confirmed Findings

None.

### Likely Findings

None.

### Risk Findings

None requiring product-code changes.

### Non-Finding: Browser and Lightroom Upload Paths Stay Aligned

Failure scenario checked: an image uploaded through Lightroom or the browser persists successfully but is queued with different color, EXIF/GPS, sharpening, size, or semantic settings, producing divergent derivatives or leaking GPS metadata.

Evidence: browser upload snapshots settings and forwards them to `enqueueImageJob` in `apps/web/src/app/actions/images.ts` lines 394-516; Lightroom upload performs the same late maintenance/contract checks and forwards the corresponding queue inputs in `apps/web/src/app/api/admin/lr/upload/route.ts` lines 480-610. Both paths claim and settle upload quota, save the original before DB insert, strip GPS when configured, and revalidate after commit. No drift found.

### Non-Finding: Queue/Delete/Restore Interactions Are Guarded

Failure scenario checked: restore begins while background processing is active, a deleted image is resurrected by a late queue write, or failed processing leaves derivative files inconsistent with DB state.

Evidence: image processing checks restore quiescence and advisory locks in `apps/web/src/lib/image-queue.ts` lines 683-760, performs conditional processed-row updates and delete-during-processing cleanup in lines 885-958, and persists retry/permanent-failure state in lines 1105-1260. Restore obtains maintenance/contract/advisory locks and drains queue/background writers before destructive import work in `apps/web/src/app/[locale]/admin/db-actions.ts` lines 421-680. No race path was confirmed.

### Non-Finding: Public Privacy Selects Are Compile- and Test-Guarded

Failure scenario checked: adding an admin-only image column later accidentally leaks it through public gallery, map, semantic, similar-photo, shared-link, or smart-collection reads.

Evidence: `apps/web/src/lib/data.ts` defines explicit admin/public select shapes and privacy-sensitive key guards at lines 251-520, then public accessors use those shapes across feed/search/map/shared/smart-collection paths in lines 760-1840. Semantic/similar enrichment uses a separate compile-time guard in `apps/web/src/lib/search-enrichment-fields.ts` lines 29-47. The full `typecheck` and privacy/unit suites passed. No privacy leak found.

### Non-Finding: Private Smart Collections Do Not Render Publicly

Failure scenario checked: a draft/private smart collection is hidden in normal navigation but reachable through direct route, metadata generation, layout streaming, or load-more server action.

Evidence: page metadata and page body reject `!collection || !collection.is_public` in `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx` lines 19-40 and 84-108; the layout blocks missing/private collections before children render in `layout.tsx` lines 24-28; load-more repeats the public-only gate in `apps/web/src/app/actions/public.ts` lines 181-245. No bypass found.

### Non-Finding: Public Expensive API Routes Charge Work Before Shared Cost

Failure scenario checked: invalid or disabled semantic/OG requests avoid rate-limit accounting while still consuming DB, embedding, Satori, Sharp, or internal-fetch work.

Evidence: semantic search validates cheap request properties before charging, then charges before DB-backed semantic-mode lookup in `apps/web/src/app/api/search/semantic/route.ts` lines 107-201 and keeps charges through embedding/scan failures in lines 247-369. Similar-photo search charges before config/embedding lookup in `apps/web/src/app/api/search/similar/[id]/route.ts` lines 98-131 and strips scores before response in lines 237-286. OG routes charge before expensive generation and keep post-work failures charged in `apps/web/src/app/api/og/route.tsx` lines 91-155 and `apps/web/src/app/api/og/photo/[id]/route.tsx` lines 100-134 and 311-320. The public-route rate-limit lint passed. No free expensive-work path found.

### Non-Finding: Deployment Path Preserves Runtime Invariants

Failure scenario checked: deploy uses unsafe env files, fails to package runtime-native dependencies, prunes live data, or applies edge body/rate limits inconsistent with app-level upload/restore limits.

Evidence: env-file ownership/permission checks are in `apps/web/deploy.sh` lines 15-43 and `scripts/deploy-remote.sh` lines 55-85. Runtime native packages and migration scripts are copied into the production image in `apps/web/Dockerfile` lines 68-85 and 150-170. Persistence is bind-mounted in `apps/web/docker-compose.yml` lines 24-32, and deploy pruning runs only after health success with no `volume prune -a` in `apps/web/deploy.sh` lines 57-104. nginx restore/upload/API limits and public limiter exceptions are explicit in `apps/web/nginx/default.conf` lines 115-204 and 246-313. No deploy invariant break found.

## Final Sweep

No relevant file class was intentionally skipped. The sweep covered product source, App Router routes/actions, DB schema/migrations, queue/image-processing paths, auth/rate-limit/privacy boundaries, public API surfaces, admin operations, tests, scripts, Docker/nginx/deploy files, root/workspace configs, and project documentation.

Files not line-by-line reviewed as product logic: generated or historical review artifacts under `.context/reviews`, prior plans under `.context/plans`, static/binary media fixtures, build/test output directories, and dependency folders. Those classes were inventoried; they do not define runtime product behavior for this review unless referenced by source, tests, or operational scripts. The full lint/type/build/unit/e2e/audit gate set above provides additional coverage over files not manually cited line-by-line.
