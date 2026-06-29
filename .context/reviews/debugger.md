# Cycle 15 Debugger Review

Reviewed HEAD: `d401dd68` (`master`) on 2026-06-30 KST.

Scope: latent-bug/failure-mode/regression review of current HEAD. I followed `AGENTS.md`, `CLAUDE.md`, and the code-review skill. This is a source-only review artifact; no production source code was changed.

## Inventory

Relevant runtime inventory covered:

- Admin actions: `apps/web/src/app/actions/{auth,images,sharing,public,settings,topics,tags,collections,admin-users,admin-backfill,embeddings,lr-tokens,seo}.ts`
- Public/API routes: `apps/web/src/app/api/{admin/db/download,admin/lr/upload,search/semantic,search/similar/[id],og,health}/**`, plus public pages under `apps/web/src/app/[locale]/(public)/**`
- Upload and processing pipeline: `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/lib/{process-image,image-queue,upload-processing-contract-lock,upload-tracker,serve-upload,upload-paths,upload-limits}.ts`
- Restore/migrations: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/{db-restore,restore-maintenance,sql-restore-scan}.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/**`
- Search/share/data/frontend state: `apps/web/src/lib/{data,rate-limit,search-enrichment-fields,clip-embeddings}.ts`, `apps/web/src/components/{search,photo-viewer,home-client,similar-photos}.tsx`, share pages `/s/[key]` and `/g/[key]`
- Tests inspected for behavioral contracts: restore/upload lock, image queue quiesce/bootstrap, semantic/similar search routes, search stale responses, upload-dropzone topic wiring, sharing/share route source contracts, migration reconcile coverage, privacy fields, public actions, image action/upload tests.

## Findings

### DBG-C15-01: Semantic search toggle issues duplicate searches and burns rate-limit budget

- Severity: Medium
- Confidence: High
- Status: confirmed
- Location: `apps/web/src/components/search.tsx:264-277`, `apps/web/src/components/search.tsx:472-479`

The search effect debounces and runs `performSearch(query, useSemanticSearch)` whenever `useSemanticSearch` changes. The semantic toggle handler also calls `performSearch(query, checked)` immediately after `setUseSemanticSearch(checked)`. A user with a non-empty query who toggles semantic mode therefore sends an immediate request and a second debounced request for the same query/mode.

Failure scenario: a visitor searches for `mountain`, toggles semantic search on, and the client sends two `/api/search/semantic` POSTs. The first request is not aborted until the second semantic request starts, so both can hit `preIncrementSemanticAttempt`; the same duplication happens on the keyword server-action path when toggling off. Repeated toggling can exhaust the per-IP search budget and doubles expensive embedding scans for no user-visible benefit.

Fix: make one code path responsible for mode-change searches. Prefer removing the direct `performSearch(query, checked)` call from the toggle handler and letting the existing `[query, useSemanticSearch]` effect run, or add an explicit immediate-search path that cancels/suppresses the next debounce. Add a source or component test asserting one request per semantic toggle with a non-empty query.

### DBG-C15-02: Upload latest-wins topic/tag correction contract is unreachable during upload

- Severity: Medium
- Confidence: High
- Status: confirmed
- Location: `apps/web/src/components/upload-dropzone.tsx:76-82`, `apps/web/src/components/upload-dropzone.tsx:224-236`, `apps/web/src/components/upload-dropzone.tsx:373-399`, `apps/web/src/__tests__/upload-dropzone-topic-wiring.test.ts:8-18`

The upload loop is explicitly written to support latest-wins metadata edits during a batch: comments say the topic select stays interactive during upload, `topicRef.current` is kept in sync, and each file appends the current topic/tag state at upload time. The rendered controls contradict that contract: the topic `<select>` and global `TagInput` are disabled while `uploading` is true.

Failure scenario: an admin starts a long sequential batch with the wrong category or global tags. The server/client loop is built to let the admin correct metadata before later files upload, but the UI prevents the correction, so every remaining file keeps the stale click-time metadata. The existing source-contract test only checks `topicRef` wiring and does not assert that the controls remain enabled, so this regression can persist while tests pass.

Fix: either honor the latest-wins contract by keeping the topic select and global tag input enabled during upload, or remove the ref/latest-wins behavior and update tests/docs to state metadata is locked for the batch. Given the existing comments and test intent, the likely fix is to drop `disabled={uploading}` for the metadata controls while leaving file removal/dropzone/start buttons locked.

## Areas Rechecked Without Findings

- Admin action origin/auth/maintenance ordering: mutating admin actions consistently use `requireSameOriginAdmin()` and/or `withAdminAuth()`, with restore maintenance guards on write paths.
- Browser and Lightroom uploads: quota claims, disk checks, topic validation rollback, contract locks, late restore cleanup, DB insert failure cleanup, and enqueue settlement paths are present.
- Image queue and restore: queue quiesce uses pause/clear/onIdle, drains tracked side effects, resets retry/bootstrap state, and restore holds DB/upload/backfill advisory locks.
- Search/share routes: share pages validate keys before lookup throttling and avoid metadata double-lookups; current similar route now filters both target and scanned embeddings by `images.processed = true`; semantic/similar enrichment uses shared guarded fields and logs enrichment failures.
- Migrations/reconcile: current schema additions are mirrored in `scripts/migrate.js` and covered by reconcile/journal tests; restore SQL scanner blocks dangerous statement classes with app-table DROP masking.

## Final Missed-Issues Sweep

Final sweeps covered route exports and public mutating handlers, auth/origin/rate-limit helper placement, restore lock lifecycle, queue quiescence, upload cleanup, semantic/similar search error paths, share lookup rate limits, migration journal/reconcile references, broad `catch`/cleanup regions, and frontend state effects. No additional current confirmed findings survived the sweep.

Finding count: 2 confirmed.
