# Debugger Review - Cycle 5

Role: `debugger`
Scope: current `HEAD` production bug and incident-path review
HEAD: `20e0d1f3` (`docs(review): 📝 record cycle 5 critic review`)
Timestamp: 2026-06-29 KST
Status: review artifact only; no source edits

## Inventory And Method

Required context loaded first:
- `AGENTS.md`
- `CLAUDE.md`
- `~/.agents/skills/code-review/SKILL.md`
- Current `.context/reviews/critic.md`

Repository inventory:
- Current route/action surface under `apps/web/src/app`: public pages, admin pages, 8 API route files, and 12 server-action files.
- Runtime/startup/shutdown paths: `apps/web/scripts/migrate.js`, `apps/web/src/instrumentation.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`.
- Cleanup/race paths: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`.
- Public incident paths: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, semantic/share/SW tests.
- Guard coverage checked with `rg` across startup, signal, cleanup, delete, advisory-lock, restore, service-worker, and semantic-rate-limit surfaces.

Validation evidence:
- Source-confirmed all findings against current `HEAD`.
- Confirmed no source files were edited before writing this report.
- Did not run full lint/typecheck/build/test because this lane is report-only and changed only a markdown review artifact.

## Findings

### DBG-C5-01 - Startup migration can delete the only valid original on private-path conflict

- Severity: High
- Confidence: High
- Status: Confirmed
- Type: startup data-loss edge case / cleanup race
- Location/region:
  - `apps/web/scripts/migrate.js:46-55` resolves the legacy public original root and the private original root.
  - `apps/web/scripts/migrate.js:58-95` migrates legacy originals during startup.
  - `apps/web/scripts/migrate.js:74-76` unlinks the legacy public source whenever the private target already exists.
  - `apps/web/scripts/migrate.js:79-84` uses rename or `EXDEV` copy+unlink when the target does not exist.
  - `apps/web/scripts/migrate.js:97-110` then refuses production startup only if public originals remain.
- Failure scenario: A previous interrupted migration, manual recovery, or cross-device copy leaves `data/uploads/original/foo.jpg` present but truncated or corrupt while the original valid bytes remain at `public/uploads/original/foo.jpg`. On the next startup, the target-exists branch deletes the valid public source without comparing bytes. The follow-up production assertion passes because the public source is gone, leaving only the bad private copy.
- Concrete fix: In the `fs.existsSync(target)` branch, compare source and target before unlinking. At minimum compare size and a SHA-256 hash. Only unlink when the bytes match. If they differ, fail startup with an actionable conflict error or quarantine the legacy source under the private data root with a unique suffix. Add tests for identical conflict, divergent conflict, and `EXDEV` copy conflict behavior.

### DBG-C5-02 - Service-worker HTML fallback can serve revoked share pages offline

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Type: stale authorization state / privacy expectation regression
- Location/region:
  - `apps/web/public/sw.template.js:271-293` caches any successful HTML response unless `x-gk-admin-render` is `1`.
  - `apps/web/public/sw.template.js:294-310` serves cached HTML on network failure for up to `HTML_MAX_AGE_MS`.
  - `apps/web/public/sw.template.js:366-369` routes all HTML GETs through `networkFirstHtml`.
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:14-26` marks single-photo share pages dynamic/no-cache/noindex.
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:79-96` returns `notFound()` when a share key is invalid.
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:17-29` marks shared-group pages dynamic/no-cache/noindex.
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:82-108` returns `notFound()` when a group key is invalid.
- Failure scenario: A visitor opens `/s/<key>` or `/g/<key>` while online, so the service worker stores the rendered HTML. The admin later revokes the single-photo share, deletes the group, or the group expires. Online requests correctly return 404, but the same browser can still see the cached shared page while offline for the 24-hour HTML fallback window. Server-side revalidation cannot evict already-installed client Cache Storage entries.
- Concrete fix: Treat secret-bearing public share routes as permissioned for offline-cache purposes. Either bypass `networkFirstHtml` for `/s/` and `/g/` paths, including locale-prefixed forms, or emit a response header such as `x-gk-no-offline-cache: 1` from share pages and have the service worker honor it before `htmlCache.put(...)`. Add `sw-template-contract` coverage proving share HTML is not cached.

### DBG-C5-03 - Disabled semantic search still performs unmetered body parse and config work

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Type: public API abuse path / disabled-feature incident path
- Location/region:
  - `apps/web/src/app/api/search/semantic/route.ts:100-156` performs same-origin, maintenance, content-type, transfer-encoding, and optional `Content-Length` gates.
  - `apps/web/src/app/api/search/semantic/route.ts:158-169` increments the semantic rate-limit bucket.
  - `apps/web/src/app/api/search/semantic/route.ts:171-207` reads the request body, checks byte length, parses JSON, trims the query, and validates code-point length.
  - `apps/web/src/app/api/search/semantic/route.ts:209-225` loads config, then rolls back the limiter and returns 503 when semantic mode is disabled.
  - `apps/web/src/__tests__/semantic-search-route.test.ts:208-218` pins the current increment-then-rollback disabled-mode behavior.
- Failure scenario: Semantic search is disabled by default or temporarily disabled during an operation. A same-origin-looking client can repeatedly send valid small JSON bodies. Each request still consumes body materialization, JSON parse, validation, and config lookup, then refunds the only semantic limiter token. Sustained traffic never accumulates local rate-limit pressure while still creating avoidable CPU and DB/config load.
- Concrete fix: Check semantic mode before reading the body and before charging the semantic limiter, immediately after the cheap header gates. If the config read is considered expensive enough to protect, add a small disabled-mode limiter that is not rolled back. Update tests to assert disabled mode does not call `request.text()` or to explicitly assert disabled attempts remain charged.

## Non-Findings / Residual Risk

- Startup/shutdown signal handling in `apps/web/src/instrumentation.ts:18-88` is guarded against repeat signals, drains the image queue and buffered shared-group view counts, and exits deliberately after success or timeout. I did not find a stronger current defect than the startup migration conflict above.
- Queue cleanup and delete-mid-processing paths have focused test coverage for permanent failures, restore quiesce, deleted-mid-reencode cleanup, and variant directory scans. I did not refile those as active findings.
- Process-local rate limits, process-local restore flags, and best-effort shared-group view buffering remain documented single-writer assumptions in `CLAUDE.md`; I treated them as accepted topology constraints rather than new bugs.

## Final Missed-Issues Sweep

- Re-ran targeted source searches for `process.on`, `SIGTERM`, `setInterval`, `unlink`, `rm`, `DELETE`, `cleanup`, `quiesce`, `restore`, advisory locks, service-worker HTML caching, and semantic rollback paths.
- Checked that no existing SW contract test mentions `/s/`, `/g/`, or a no-offline-cache header.
- Checked that semantic disabled-mode tests explicitly expect limiter rollback after body/config work.
- Checked that legacy-original migration has no byte-equality guard or tests around divergent source/target conflicts.
- The three findings above are the concrete current-HEAD debugger issues I would schedule for fixes. No additional high-confidence startup/shutdown crash or cleanup-race finding survived the final sweep.

Finding count: 3 total - 1 High, 2 Medium.
