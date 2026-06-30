# Cycle 29 Debugger Review

Repo: `/Users/hletrd/flash-shared/gallery`  
HEAD reviewed: `b4fa1f64` (`fix(cycle-28): 🐛 harden restore and privacy flows`)  
Mode: Prompt 1 only, static latent-bug/failure-mode review. No product code modified.

## Process

- Read `AGENTS.md` and `CLAUDE.md` first.
- Inventoried relevant files with `rg --files`, `find .context/reviews`, and focused `rg` sweeps for TODO/FIXME, timers, abort handling, rate-limit/origin gates, cache/revalidation, and embedding/backfill paths.
- Reviewed cross-file interactions across public routes, admin actions, upload/queue/backfill flows, semantic search, share/view counters, restore maintenance, and client stale-state surfaces.
- Did not run the full quality gate suite; this is a review artifact only.

## Confirmed Issues

### DBG29-01 — Similar-photos panel permanently caches transient fetch failures

- Severity: Low
- Confidence: High
- File/region: `apps/web/src/components/similar-photos.tsx:78-108`, render feedback at `apps/web/src/components/similar-photos.tsx:137-147`.
- Failure scenario: In production semantic mode, the photographer expands "Similar photos" and `/api/search/similar/:id` returns a transient non-OK response: 429 rate limit, 503 setup/backfill hiccup, 404 temporarily missing embedding during backfill, or a network error. `handleToggle()` sets `fetchedRef.current = true` before the request. On any non-abort failure it sets `results` to `'error'`, but never resets `fetchedRef.current`. Closing and reopening the disclosure cannot retry; the inline error is pinned until the whole photo viewer remounts or the page reloads.
- Why confirmed: The only reset to `fetchedRef.current = false` is in the abort branch (`apps/web/src/components/similar-photos.tsx:96-99`). The non-OK branch (`:89-92`) and non-abort catch branch (`:101-102`) leave the fetched guard true.
- Fix: Reset `fetchedRef.current = false` on retryable failures, or add an explicit retry control that clears the guard and refetches. Keep successful empty/result responses cached.
- Suggested regression test: A component test that mocks first fetch as 503 or rejected, toggles closed/open, and asserts a second fetch occurs. Existing source-contract tests only assert the error UI exists; they do not pin retryability.

## Likely Issues

None promoted. The strongest likely candidates from prior cycles were rechecked and appear closed or intentionally constrained in the current tree:

- `scripts/backfill-clip-embeddings.ts` now rejects `--production` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (`apps/web/scripts/backfill-clip-embeddings.ts:101-103`).
- `OptimisticImage` now remounts on primary `src` changes (`apps/web/src/components/optimistic-image.tsx:13-16`), which addresses the stale retry/fallback state pattern noted previously.
- Shared-group metadata no longer performs an unthrottled share lookup; the body enforces the rate limit before `getSharedGroupCached()` (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:43-56`, `:100-108`).

## Risks Needing Manual Validation

### DBG29-R1 — Lightroom upload still materializes the multipart body before exact file-size rejection

- Severity: Medium if the route is exposed to untrusted PAT clients; Low if only trusted local Lightroom clients use it.
- Confidence: Medium
- File/region: `apps/web/src/app/api/admin/lr/upload/route.ts:85-112`, `:153-172`.
- Failure scenario: The route rejects missing/chunked/oversized `Content-Length` before parsing and caps declared upload bytes at `MAX_UPLOAD_FILE_BYTES + SERVER_ACTION_BODY_OVERHEAD_BYTES`. However, the exact file-size check happens only after `await request.formData()`. A request with a file slightly over `MAX_UPLOAD_FILE_BYTES` but total body under the overhead allowance is fully materialized before the 413 response. On the disk-constrained/low-memory deploy host, repeated authenticated or PAT-backed oversized uploads can spike memory/temp storage before being rejected.
- Validation needed: Confirm Next/Node multipart buffering behavior and any upstream reverse-proxy/body-size cap in production. Also confirm the real Lightroom multipart overhead required for a legitimate 200 MiB file.
- Fix: Prefer streaming multipart parsing with a hard per-file byte cap, or enforce a tighter upstream cap for this single-file endpoint with a measured small metadata overhead. Add a route-level test around declared length near the cap and a deployment note for proxy `client_max_body_size`.

### DBG29-R2 — Unwired CLIP backfill server action reports per-row production failures as successful skips

- Severity: Low while unwired; Medium if surfaced in the admin UI.
- Confidence: Medium
- File/region: `apps/web/src/app/actions/embeddings.ts:53-55`, `:145-188`; no UI call sites found by `rg "backfillClipEmbeddings\\("`.
- Failure scenario: `backfillClipEmbeddings()` is exported and admin-gated, but it is currently unwired. If a future UI or script starts using it, production embedding failures from missing originals, model load errors, path resolution misses, or DB upsert exceptions are counted as `skipped` and the action still returns `{ status: 'ok', processed, skipped }`. The inner catch at `:181-183` also drops the actual error. An operator could see a successful backfill with skipped rows and no failed IDs, then enable semantic search with partial embeddings.
- Validation needed: Confirm this action is intentionally dead code and not reachable through generated server-action manifests or future settings UI work.
- Fix: Remove the unwired action if the sidecar is canonical, or mirror the sidecar's failure semantics: log failed image IDs, return a non-OK status when failures occur, and distinguish missing-original skips from actual encoder/upsert failures.

## Covered Surface Summary

- Project instructions and operational context: `AGENTS.md`, `CLAUDE.md`.
- Upload and processing: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/advisory-locks.ts`.
- Restore and DB maintenance: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/db/schema.ts`.
- Public data and counters: `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`.
- Semantic/CLIP paths: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/gallery-config.ts`.
- Backfill runner: `apps/web/src/app/actions/admin-backfill.ts`, `apps/web/src/lib/admin-backfill-runner.ts`.
- Public/admin route guards: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/rate-limit.ts`, public/admin route exports under `apps/web/src/app/api`.
- Client stale-state/timer surfaces: `apps/web/src/components/similar-photos.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/optimistic-image.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox-color-pip.tsx`.

## Final Missed-Issues Sweep

- Re-ran targeted searches for stale refs, timers/listeners, abort controllers, fire-and-forget promises, route rate-limit/origin gates, restore-maintenance guards, and previous-cycle finding identifiers.
- Checked existing tests around similar route, semantic route, backfill runner, privacy fields, queue quiescence, and source contracts to avoid duplicating pinned behavior as a finding.
- No destructive operations performed. Only this review file was updated.
