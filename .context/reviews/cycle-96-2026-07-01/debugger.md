# Cycle 96 Debugger Review

Review-only source audit at `2f22620c361304ba0408053f546f45e3c74ddfdb`. No files modified.

## Bug-prone inventory reviewed

- Restore/import fencing: `restore-maintenance*`, admin DB restore, foreground admin mutations.
- Upload/processing: browser upload action, Lightroom PAT route, queue, GPS/HDR/color metadata.
- Semantic search: `image_embeddings` schema, queue/backfill upserts, semantic/similar routes.
- Public listings: `data.ts`, load-more/home count behavior, smart collections.
- Admin credentials: LR token actions, token storage, token admin client.
- Viewer/client UX: zoom/lightbox keyboard handling.
- Operational ledgers/deploy evidence under `.context`.

Validation note: guard lint could not run in this sandbox. `npm run lint:api-auth --workspace=apps/web` failed before repo logic with `tsx` IPC `listen EPERM .../tsx-501/*.pipe` on Node `v24.14.0`.

---

## Confirmed findings

### 1. Token list DB failures are silently rendered as “no tokens”
- **Severity:** Medium
- **Confidence:** High
- **Files/lines:**
  - `apps/web/src/lib/admin-tokens.ts:178-190` catches any SELECT failure and returns `[]`.
  - `apps/web/src/app/actions/lr-tokens.ts:131-140` returns that array directly.
  - `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:37-47`, `146-163` clears load errors for arrays and shows the empty state.
- **Failure scenario:** if `admin_tokens` is missing, the DB connection fails, permissions regress, or SELECT times out, admins see “No tokens yet” instead of a retryable error. They may make revoke/create decisions from false state.
- **Suggested fix:** only map a known missing-table/migration condition to an explicit “feature unavailable/migration pending” error. For other DB failures, throw or return `{ error }`; keep the client’s existing retry alert path and add a regression test.

### 2. Restore maintenance does not fence already in-flight foreground mutations
- **Severity:** High
- **Confidence:** High
- **Files/lines:**
  - Process flag is only a boolean check: `apps/web/src/lib/restore-maintenance.ts:21-31`.
  - Durable marker starts restore but has no active-writer drain: `apps/web/src/lib/restore-maintenance-durable.ts:96-114`.
  - Restore enters maintenance and drains background work: `apps/web/src/app/[locale]/admin/db-actions.ts:365-452`, `492-503`.
  - Foreground writes check only at entry, then write later: settings `apps/web/src/app/actions/settings.ts:41-48`, `163-175`; images `apps/web/src/app/actions/images.ts:648-712`, `906-978`, `984-1204`; tags `apps/web/src/app/actions/tags.ts:42-98`, `113-160`, `163-231`; sharing `apps/web/src/app/actions/sharing.ts:91-156`.
- **Failure scenario:** an admin mutation passes the maintenance check, then restore begins and imports data; the in-flight action commits after or during the import, producing mixed restored/current state or lost writes.
- **Suggested fix:** add a foreground admin-write barrier/lease. Restore should close the barrier, reject new leases, wait for active leases to drain, then import. Alternatively use a shared DB advisory lock family acquired by every app-table mutating action, with a post-lock maintenance recheck.

### 3. `image_embeddings` cannot stage multiple model versions per image
- **Severity:** Medium
- **Confidence:** High
- **Files/lines:**
  - Schema primary key is only `image_id`: `apps/web/src/db/schema.ts:284-299`; migration: `apps/web/drizzle/0012_image_embeddings.sql:5-12`.
  - Model-version index is non-unique and does not change row identity: `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql:1-9`.
  - Upload/backfill upserts overwrite the row’s `modelVersion`: `apps/web/src/lib/image-queue.ts:352-390`, `apps/web/src/app/actions/embeddings.ts:120-179`, `apps/web/scripts/backfill-clip-embeddings.ts:161-223`.
  - Routes filter by active/production model: `apps/web/src/app/api/search/semantic/route.ts:263-289`, `apps/web/src/app/api/search/similar/[id]/route.ts:132-179`.
- **Failure scenario:** during stub→production or production model upgrades, backfill overwrites the previous model row per image. Rollback or partial rollout then yields empty/incomplete search results because routes only accept the active model.
- **Suggested fix:** migrate to composite identity `(image_id, model_version)`, update Drizzle/reconcile/migrations, upsert by both columns, and add old-model GC only after confirmed cutover.

### 4. First-page listings still force exact window counts through grouped tag joins
- **Severity:** Medium
- **Confidence:** High
- **Files/lines:**
  - Gallery listing uses `COUNT(*) OVER()` with tag joins/grouping: `apps/web/src/lib/data.ts:898-927`.
  - Smart collection initial/offset path does the same: `apps/web/src/lib/data.ts:1495-1510`; cursor path intentionally skips it at `1476-1492`.
  - UI displays the count: `apps/web/src/components/home-client.tsx:267-269`.
- **Failure scenario:** large galleries or tag-heavy collections require MySQL to group joined rows and compute a full window count before returning the first page, increasing TTFB/DB CPU under crawlers or reload bursts.
- **Suggested fix:** return `limit + 1` rows for `hasMore` and defer exact counts to a lean separate count, cached count, or approximate count. Update tests that currently lock `COUNT(*) OVER()`.

### 5. Zoomed images are toggleable by keyboard but not keyboard-pannable
- **Severity:** Medium
- **Confidence:** High
- **Files/lines:**
  - Keyboard handler only toggles zoom on Enter/Space: `apps/web/src/components/image-zoom.tsx:197-208`, `362-365`.
  - Pan handlers are mouse/touch only: `apps/web/src/components/image-zoom.tsx:232-303`.
  - Escape reset exists, but no arrow-key pan: `apps/web/src/components/image-zoom.tsx:328-337`.
  - Lightbox arrow keys navigate photos: `apps/web/src/components/lightbox.tsx:328-343`.
- **Failure scenario:** keyboard-only users can zoom into a photo but cannot inspect off-center regions; arrow keys navigate away instead of panning.
- **Suggested fix:** when zoomed and focus is on the zoom container, use arrow keys/Home/End or similar for pan/reset, stop lightbox navigation for handled pan keys, and add keyboard/a11y tests.

### 6. LR token label length contract differs between server and browser
- **Severity:** Low
- **Confidence:** High
- **Files/lines:**
  - Server validates by Unicode code points and allows 128 emoji: `apps/web/src/app/actions/lr-tokens.ts:60-69`; test confirms 128 emoji accepted at `apps/web/src/__tests__/lr-tokens-action.test.ts:136-143`.
  - Browser input uses `maxLength={128}` UTF-16 code units: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:209-223`.
- **Failure scenario:** a label valid server-side, e.g. 128 emoji / 256 UTF-16 units, cannot be entered in the UI. The comment saying UI aligns with server bound is false.
- **Suggested fix:** remove `maxLength` and enforce code-point validation in React, or set a conservative HTML cap plus explicit code-point counter/error.

### 7. Release/deploy ledger points at an older commit than current HEAD
- **Severity:** Medium operational risk
- **Confidence:** High
- **Files/lines:**
  - Current HEAD is `2f22620c361304ba0408053f546f45e3c74ddfdb`.
  - Plan index says Cycle 95 closed at `217804...`: `.context/plans/README.md:7`.
  - Cycle plan deploy evidence also records `217804...`: `.context/plans/cycle-95-2026-07-01-plan.md:50-56`.
  - Aggregate repeats `217804...`: `.context/reviews/_aggregate.md:27-29`.
- **Failure scenario:** future agents or release checks may treat the older commit as the deployed terminal state and skip deploy/smoke verification for `2f22620`.
- **Suggested fix:** update the ledger after the current head is confirmed pushed/deployed, or explicitly mark `2f22620` as review/docs-only and deployed/not-deployed with evidence.

---

## Likely/manual-validation risks

- **LR PAT upload route remains high-risk despite source-contract tests.** The route has many cleanup/rate-limit/restore branches (`apps/web/src/app/api/admin/lr/upload/route.ts:84-128`, `178-199`, `396-440`, `500-509`, `583-590`), while the HDR/GPS tests are source-text contracts rather than route execution (`apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-67`). Add multipart route tests for success, HDR reject cleanup, GPS-strip failure cleanup, restore-race reject, and DB insert failure cleanup.
- **Single-instance assumptions are operationally fragile.** `CLAUDE.md:234-237` explicitly says restore state, queue state, and several rate-limit fast paths are process-local. Any horizontal scaling needs shared coordination first.
- **Quality gates were not locally proven.** The repo requires auth/action/rate-limit lint plus typecheck/build/tests (`AGENTS.md:29-38`), but the sandbox blocked `tsx` guard execution before script logic.

---

## Final sweep

Checked common missed areas: restore races, upload cleanup windows, token/admin error handling, semantic model rollover, public listing query shape, keyboard-only viewer behavior, and release evidence. No confirmed missing `withAdminAuth`/same-origin/rate-limit issue was established because the guard scripts could not run here. Full build, Vitest, Playwright, live DB restore, production smoke, npm audit, and MySQL `EXPLAIN` remain unvalidated in this review lane.