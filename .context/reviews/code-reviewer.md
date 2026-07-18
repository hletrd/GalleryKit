# Cycle 1 Group A — Code Reviewer

Date: 2026-07-18 KST
Review HEAD: `64f6ac63`
Role: code quality, correctness, maintainability, cross-file logic
Mode: review-only; no application source was changed.

## Inventory and coverage

I read `AGENTS.md` and all of `CLAUDE.md` before reviewing. The repository inventory contains 709 implementation/test/migration/script files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, and `apps/web/e2e` (112,147 lines across TypeScript/JavaScript sources). I inventoried every App Router page/route/layout, every server-action module, every top-level `src/lib` module, all 31 SQL migrations plus the journal/reconcile runner, deploy/container/proxy configuration, and the full test/e2e surface.

The line-level review prioritized the high-risk cross-file clusters rather than binary fixtures or historical review archives: auth/session/PAT boundaries; same-origin/admin-mutation gates; public rate limiting; restore/import drains and advisory locks; upload/process/delete cleanup; image queue and backfills; semantic/CLIP writers and readers; public/admin projections; migration/reconcile behavior; standalone/Docker packaging; map/timeline/search queries; and the changes since the last deep review (`54083a2c..64f6ac63`). I also ran the three security scanners, ESLint, TypeScript checks, translation key parity, and targeted analytics/config tests. All passed. Generated output, dependencies, binary image/ICC fixtures, runtime uploads, and live production state were excluded.

## Findings

### CR-A-01 — GeoIP failure is silently converted into valid-looking `XX` analytics

- Severity: Medium
- Confidence: High
- Classification: confirmed diagnostic/correctness weakness; new in this review
- Citations: `apps/web/src/instrumentation.ts:12-20`; `apps/web/src/lib/analytics.ts:29-61`; `apps/web/next.config.ts:54-59`; `apps/web/src/app/actions/public.ts:415-425`
- Problem: `geoip-lite` is a required production dependency and country analytics are an advertised feature, but startup swallows an import/data-file failure without a log. The lookup module independently catches module/data errors, permanently memoizes a null lookup, and returns `XX`. The recent externalization change documents that bundling previously made every lookup fail, proving this is not merely theoretical.
- Failure scenario: a Next packaging change, lockfile layout change, or missing `geoip-lite/data` directory breaks the runtime module. `/api/live`, build, and startup all remain green; every subsequent view event is durably recorded as country `XX`, with no operator-visible cause until someone notices the analytics distribution.
- Concrete fix: make production startup validate both module load and a known database lookup, emit a clear error/health diagnostic on failure, and add a standalone-build contract that verifies `geoip-lite` remains external and its data files are present. Development can retain the graceful fallback.

### CR-A-02 — Independent background concurrency proofs over-subscribe the same DB pool

- Severity: High
- Confidence: High
- Classification: confirmed architecture/correctness risk; unresolved carry-forward
- Citations: `apps/web/src/db/index.ts:21-42`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:97-142`; `apps/web/src/lib/background-db-writes.ts:3-75`
- Problem: the queue and in-app backfill each independently reserve half of the same ten-connection pool and each permits two workers. The backfill also pins its global advisory-lock connection; queue/backfill workers can each hold claim plus transient DB connections; analytics permits two more DB writes. The reservation is therefore counted twice.
- Failure scenario: uploads process while an admin re-encodes old photos and visitor analytics flushes. The two locally valid budgets compose to roughly nine or more connections before public/admin reads, so foreground `Promise.all` queries queue behind encode-duration holds and can exhaust `queueLimit: 20`.
- Concrete fix: admit every long-running in-process DB/CPU lane through one weighted background-capacity coordinator that accounts for advisory-lock connections and reserves a measurable foreground budget. Add an overlap test that runs queue, backfill, and analytics together at pool size ten.

### CR-A-03 — `/map` can serialize and render two separate 10,000-item UI trees

- Severity: Medium
- Confidence: High
- Classification: confirmed scalability/maintainability risk; unresolved carry-forward
- Citations: `apps/web/src/lib/data.ts:1766-1816`; `apps/web/src/app/[locale]/(public)/map/page.tsx:42-111`; `apps/web/src/components/map/map-client.tsx:78-143`
- Problem: the query cap prevents an unbounded DB result but still returns 10,000 full marker records. The server then serializes them into the client map and separately renders up to 10,000 fallback links; Leaflet creates one `Marker`/`Popup` subtree per photo, and `FitBounds` allocates two additional 10,000-element arrays.
- Failure scenario: a gallery near the documented cap opens `/map` on a mid-range phone. Hydration, React/Leaflet object creation, DOM fallback rendering, and `Math.min(...lats)`/`Math.max(...lngs)` create long tasks or a tab crash even though the SQL query itself is bounded.
- Concrete fix: paginate the accessible list, cluster/virtualize markers, and fetch viewport/bbox pages instead of hydrating the entire collection. Keep a smaller initial cap until that architecture exists.

### CR-A-04 — The browser upload action advertises a multi-file/2 GiB call shape that the framework rejects first

- Severity: Low-Medium
- Confidence: Medium-High
- Classification: latent interface mismatch; unresolved carry-forward
- Citations: `apps/web/src/app/actions/images.ts:106-143`; `apps/web/src/app/actions/images.ts:197-207`; `apps/web/src/lib/upload-limits.ts:1-35`; `apps/web/next.config.ts:111-119`
- Problem: `uploadImages()` accepts `getAll('files')`, permits up to 100 files, and validates a 2 GiB per-call total. The configured Server Action body cap is only 266 MiB by default. The current UI safely sends one file per invocation, but the exported action's plural contract cannot actually admit many values it claims to validate.
- Failure scenario: a future same-origin admin client batches two 150 MiB photos. Next rejects the multipart body before the action runs, bypassing the localized cumulative/file-count errors and quota settlement path.
- Concrete fix: make the server action explicitly one-file-per-call and simplify its contract/tests, or move true batch uploads to a streaming route with pre-parse admission checks. Do not raise the action body cap to 2 GiB without a memory/DoS design.

### CR-A-05 — GPS stripping reads every near-limit original wholly into the Node heap

- Severity: Medium
- Confidence: Medium
- Classification: likely resource-exhaustion bug; unresolved carry-forward
- Citations: `apps/web/src/lib/upload-limits.ts:1-6`; `apps/web/src/app/actions/images.ts:350-381`; `apps/web/src/lib/process-image.ts:1725-1761`
- Problem: a 200 MiB upload is first materialized by the framework and saved to disk, then `stripGpsFromOriginal()` executes `fs.readFile(filePath)` before selecting a lossless scrubber or Sharp fallback. That adds a full-file Buffer and may overlap with Sharp/libvips, queue, or CLIP memory.
- Failure scenario: GPS stripping is enabled and an admin uploads a near-cap TIFF/AVIF/JPEG while image processing is active. RSS spikes by hundreds of MiB and the production container can be OOM-killed even though the file is within the documented limit.
- Concrete fix: convert container scrubbers to bounded fd/range processing or isolate stripping in a memory-limited worker; until then, enforce a conservative process memory budget/lower effective cap for GPS-stripped uploads and measure peak RSS with near-limit fixtures.

### CR-A-06 — Public projection ownership remains duplicated despite privacy guards

- Severity: Medium
- Confidence: High
- Classification: maintainability/privacy drift risk; unresolved carry-forward
- Citations: `apps/web/src/lib/data.ts:251-488`; `apps/web/src/lib/data-timeline.ts:17-80`; `apps/web/src/lib/search-enrichment-fields.ts:1-46`
- Problem: compile-time sensitive-key guards prevent known admin-only keys from leaking, but public listing, map, timeline, and search still hand-maintain different positive field shapes and aggregation expressions. The timeline module explicitly records that it previously drifted.
- Failure scenario: a public-safe display field or a newly sensitive column is added to one projection but not siblings. Type checks remain green if the key is not yet in `PrivacySensitiveKeys`, producing inconsistent responses or a delayed privacy review.
- Concrete fix: define canonical composable public projection modules (base public image, map GPS extension, search enrichment extension) and derive consumers from them; retain symmetric denylist/allowlist tests at the boundary.

## Cleared competing hypotheses

- The recent `geoip-lite` externalization does currently place `node_modules/geoip-lite/data/*` in `.next/standalone`; the packaging fix itself is correct at this HEAD. The finding is the silent future-failure path, not a claim that current lookups are still broken.
- Translation key sets are exactly equal (882 leaf keys each), and removed navigation hint keys have no remaining call sites.
- Admin API auth, server-action origin/mutation-barrier, and public route rate-limit scanners all pass at current HEAD.
- Restore/import drains queue side effects, background writes, maintenance work, view buffers, and admin mutations before SQL import; no new unfenced application writer was found.
- Upload/delete processing still records pending file deletions before DB row deletion and cleans deleted-mid-processing/re-encode variants.

## Final missed-issue sweep

The final sweep rechecked error-swallowing catches, unbounded collections, timer/queue drains, DB lock release paths, raw SQL interpolation, path traversal/symlink handling, privacy projections, server/client module boundaries, Next standalone externals, deploy failure branches, migration cursor behavior, and the recent i18n/settings edits. No additional confirmed code defect was found beyond the items above.
