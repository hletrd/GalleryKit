# Cycle 12 Architect + Document-Specialist Review

Scope: architecture, module boundaries, data model/migration design, coupling/layering, operational/deployment design, docs-code mismatches, and authoritative-source mismatches in `/Users/hletrd/flash-shared/gallery`.

Constraints honored: review-only; no implementation changes; no destructive git/filesystem operations; no services or containers stopped, killed, removed, or modified.

## Inventory Reviewed

- Repository control docs: `AGENTS.md`, `CLAUDE.md`, `README.md`.
- Context docs and plans: `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`, `.context/plans/cycle-10-2026-07-07-deferred.md`, `.context/plan/plan-c12.md`, `.context/plan/plan-cycle21.md`, prior `.context/reviews/*` architect/document-specialist review files.
- Product/reference docs: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`.
- Package and quality scripts: root `package.json`, `apps/web/package.json`.
- Deployment/runtime files: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`.
- Data model and migration files: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/drizzle.config.ts`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/scripts/mysql-connection-options.js`.
- Architecture hotspots: config/settings, image processing, upload serving, semantic search APIs, storage abstraction, public shared-group data access, single-writer guard, instrumentation, and related tests.

## Findings

### ARCH-DOC-C12-01: Byte-affecting image settings can advertise new policy before static derivatives are regenerated

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Evidence:
  - `apps/web/src/app/actions/settings.ts:168-239` persists settings, computes `requiresBackfill`, commits the transaction, invalidates config cache, and returns a backfill flag.
  - `apps/web/next.config.ts:56-72` serves `/uploads` and `/resources` as immutable static assets with one-year cache headers.
  - `apps/web/src/lib/serve-upload.ts:240-258` adds settings-aware ETags only on the route-handler fallback path, not for static public files that exist on disk.
  - `CLAUDE.md:338-340` documents that static public files win before route handlers, so existing derivatives need operational re-encoding after byte-affecting setting changes.
- Concrete failure scenario: An admin changes AVIF/WebP quality, chroma subsampling, target gamut, forced sRGB behavior, or encode effort after a gallery already has generated derivatives. The settings UI and runtime config now imply the new policy, but visitors can continue receiving old derivative bytes directly from static `/uploads` paths until a separate re-encode completes. Color/quality behavior becomes split by asset age and cache state.
- Suggested fix: Model these settings as a generation workflow rather than an immediately active global policy. Options include a durable `pending` vs `active` generation version, content/settings-versioned derivative paths, or an admin-visible migration state that prevents publishing the new byte policy until re-encoding has completed. Keep the existing warning, but make the operational state machine authoritative.

### ARCH-DOC-C12-02: Single-writer correctness still depends on a warn-only runtime guard while key state is process-local

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Evidence:
  - `apps/web/src/lib/single-writer-guard.ts:6-16` states the guard is intentionally warn-only and cannot reliably enforce single-writer topology.
  - `apps/web/src/lib/single-writer-guard.ts:218-235` emits loud topology errors but explicitly continues startup.
  - `apps/web/src/instrumentation.ts:22-31` invokes the topology check asynchronously and treats failures as non-fatal warnings.
  - `CLAUDE.md:244-249` documents the single-process assumption and lists process-local restore/upload/rate-limit/backfill/shared-view-count state.
- Concrete failure scenario: A future rolling deploy, manual `docker compose` launch, or recovery operation temporarily leaves two web processes attached to the same DB and uploads tree. Both keep serving traffic because the guard only logs. Upload quotas, in-memory rate-limit fast paths, restore/backfill status, and buffered shared-group counters diverge or race while operators see a healthy service.
- Suggested fix: Either make production single-writer enforcement part of readiness/startup after persistent lock contention, or move the listed correctness-sensitive state into DB/advisory-lock-backed coordination. At minimum, expose the guard state through health/metrics so deployment automation can fail closed instead of relying on log review.

### ARCH-DOC-C12-03: Public dynamic-page protection is an operational contract outside deploy automation

- Severity: Medium
- Confidence: Medium-High
- Status: Likely risk
- Evidence:
  - `apps/web/nginx/default.conf:1-29` defines shared-memory rate-limit zones and warns that `real_ip_header` is intentionally not configured unless a trusted upstream proxy exists.
  - `apps/web/deploy.sh:51-55` rebuilds and starts Docker Compose services, but does not apply or verify host nginx config.
  - `CLAUDE.md:247` states page-level public route limiting is currently edge-only, not app-layer.
  - `CLAUDE.md:506-518` documents that deploys do not touch host nginx and the operator must copy, validate, reload, and probe nginx config manually.
- Concrete failure scenario: The repository config is updated, but host nginx is stale, missing the intended zones, or missing trusted real-IP configuration behind a proxy. Public dynamic pages can then hit Next/MySQL without the documented edge protection, or unrelated visitors can collapse into a shared upstream IP bucket and receive unexpected 429s.
- Suggested fix: Add a non-destructive deployment posture check that compares the deployed host nginx config hash or exposes an operator-maintained config version. Longer term, add a lightweight app-layer fallback limiter for the most expensive public page paths so protection does not depend exclusively on out-of-band host state.

### ARCH-DOC-C12-04: Shared-group data reads own denormalized view-count mutation

- Severity: Low
- Confidence: High
- Status: Confirmed
- Evidence:
  - `apps/web/src/lib/data.ts:13-63` defines module-level shared-group view-count buffering in the data module.
  - `apps/web/src/lib/data.ts:1318-1407` makes `getSharedGroup` both read the public shared group and optionally buffer an increment.
  - `apps/web/src/lib/data.ts:1805-1809` warns that the cached wrapper must not be called with differing increment semantics.
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142` separately records durable shared-group view analytics from the public page.
- Concrete failure scenario: A future admin preview, metadata loader, API handler, or refactor reuses `getSharedGroup` for a read-only path and accidentally increments denormalized counters. Conversely, caching or call-order changes can suppress a desired increment because the mutation is coupled to a cached read helper rather than an explicit command.
- Suggested fix: Make `getSharedGroup` pure and move the denormalized counter update into an explicit `recordSharedGroupViewCount` service called only from the public view path, next to the durable analytics write. Cache only the pure read helper.

### ARCH-DOC-C12-05: Experimental storage abstraction advertises live-pipeline use without matching live-pipeline invariants

- Severity: Low
- Confidence: Medium-High
- Status: Risk
- Evidence:
  - `apps/web/src/lib/storage/index.ts:1-18` says the storage module is not wired into the live app but describes future usage for upload, serving, and Sharp processing.
  - `apps/web/src/lib/storage/types.ts:44-100` defines broad write, stream, copy, and URL methods that look suitable for the live media pipeline.
  - `apps/web/src/lib/storage/local.ts:76-108` writes directly to the final destination path.
  - `apps/web/src/lib/storage/local.ts:142-156` copies or hardlinks directly to the destination path.
  - `apps/web/src/lib/process-image.ts:1164-1224` uses temp files, backups, atomic rename, and rollback when replacing original assets.
  - `apps/web/src/lib/process-image.ts:1433-1477` waits for all derivative writes and restores previous paths on failure.
  - `apps/web/src/__tests__/storage-quarantine.test.ts:1-27` and `apps/web/src/__tests__/storage-quarantine.test.ts:111-143` quarantine the abstraction from production imports.
  - `CLAUDE.md:159` states local filesystem is the only supported product storage path and the storage backend abstraction is not integrated.
- Concrete failure scenario: A future maintainer sees the abstraction and wires it into upload or image processing because the interface names match the intended pipeline. Direct-to-final writes or hardlinks then bypass the existing atomic replace, rollback, partial-write visibility, and path-safety assumptions embedded in the live filesystem code.
- Suggested fix: Keep the quarantine and either delete the unused abstraction until a real backend is selected, or expand the contract before integration with explicit production primitives such as `atomicReplace`, temp namespaces, rollback hooks, no-follow path checks, and parity tests against the current image-processing invariants.

### ARCH-DOC-C12-06: Active carry-forward backlog duplicates the runtime site-config decision after docs were clarified

- Severity: Low
- Confidence: Medium
- Status: Confirmed documentation/backlog mismatch
- Evidence:
  - `.context/plans/deferred-carry-forward.md:24-29` says the remaining C80-06 item is now only a product/operator decision, not a docs/code mismatch.
  - `.context/plans/deferred-carry-forward.md:60` still tracks C80-06 as a runtime-editable file configuration decision.
  - `.context/plans/deferred-carry-forward.md:76` separately tracks C2-24b for runtime site-config edits despite documented build-time import semantics.
  - `README.md:56-58`, `apps/web/README.md:49-57`, `apps/web/docker-compose.yml:28-32`, and `CLAUDE.md:157` now consistently describe build-time/import-time `site-config.json` behavior rather than runtime mutability.
- Concrete failure scenario: Future review cycles treat C80-06 and C2-24b as separate architecture risks, re-review the same site-config question, or incorrectly report that current docs still conflict with code. That inflates the active backlog and obscures the actual unresolved question: whether runtime-editable config is a desired product feature.
- Suggested fix: Consolidate C80-06 and C2-24b into one carry-forward row with a single owner and decision prompt. Keep the current README/CLAUDE/code statements as authoritative until the product decision changes.

## Positive Confirmations / Closed Prior Risks

- Migration sequencing and drift handling now appear stronger than older review notes implied. `apps/web/scripts/migrate.js` separates pending migration application from drift reporting, asserts journal hashes after migration, rejects DML during structural baselines, and mirrors current schema in `reconcileLegacySchema`.
- Drizzle Kit TLS configuration is no longer a separate obvious docs/runtime mismatch. `apps/web/drizzle.config.ts:1-17` imports the shared MySQL connection option helper and requires `DB_SSL_CA` for non-local DB hosts, matching the stricter migration/runtime posture.
- Current root and app README files no longer overclaim that semantic search is generally live. They describe semantic search as operator-gated and experimental, which matches the guarded API/runtime design.
- The tracked `docs/superpowers/*` CLIP files are clearly marked historical and point readers to the current runbook rather than claiming to be live product state.
- Build-time/import-time `site-config.json` behavior is now consistently stated across README, app README, Docker Compose comments, and CLAUDE; the remaining question is product policy, not a current docs-code contradiction.

## Final Sweep

- README/CLAUDE/script alignment: quality gates, deploy helper, deploy env-file handling, and current semantic-search gating are broadly aligned with package scripts and deployment files reviewed.
- Data model/migration design: no new blocking data-model mismatch found beyond operational state modeling for image derivative regeneration. Journal `when` values include historical non-monotonic entries, but the current migrator's post-condition and drift checks reduce the practical risk called out in older docs.
- Module boundaries: the main boundary smells remain the impure shared-group read helper and the quarantined storage abstraction that could be misused if later integrated without stronger invariants.
- Operational design: the highest residual architecture risk is still correctness depending on out-of-band single-writer and nginx deployment discipline. Both are documented, but documentation alone is weaker than automated readiness/config checks.
- Documentation hygiene: current authoritative docs are mostly aligned with code. The active carry-forward backlog has one duplicate/stale site-config tracking shape that should be consolidated to prevent future review churn.
