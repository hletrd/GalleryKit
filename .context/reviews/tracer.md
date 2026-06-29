# Tracer Review - Review-Plan-Fix Cycle 3

**Date:** 2026-06-29  
**HEAD:** `9b4a3a57d58cf33383cdb1041e5e1d5d6e393d1b` (`docs(reviews): 📝 preserve cycle 3 test findings`)  
**Role:** tracer specialist. Current HEAD source only; application source tree is clean and unrelated `.context/reviews/*` edits from other lanes were not reverted.  
**Output boundary:** review artifact only.

## Inventory Coverage

I read `AGENTS.md` and `CLAUDE.md` first, then traced all requested flow classes without sampling:

- Upload/process/delete: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`.
- Sharing: `apps/web/src/app/actions/sharing.ts`, public shared photo/group pages, share-key rate limiting.
- Admin mutations: all `apps/web/src/app/actions/*.ts`, admin DB actions, token actions, settings/SEO/topics/tags/collections/users.
- DB restore/backup: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/scripts/migrate.js`, backup/download route.
- CLIP semantic search: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`, config gates.
- OG generation: global and photo OG routes plus `apps/web/src/lib/og-photo-fetch.ts`.
- Public analytics/view count: public action recorders, photo/shared pages, `bufferGroupViewCount`, view-retention path.
- i18n routing: `apps/web/src/proxy.ts`, `apps/web/src/lib/locale-path.ts`, locale-prefixed public/admin routes.
- Service-worker freshness: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/scripts/build-sw.ts`, `apps/web/src/components/register-service-worker.tsx`, Docker/public bind mount behavior.

## History Check

I checked `.context` for stale claims before filing findings. The old run-3 LR restore finding was specifically about the Lightroom upload route and was fixed in `apps/web/src/app/api/admin/lr/upload/route.ts`; it does not cover the separate LR token-management actions. The run-9 analytics trace confirmed validation/rate-limit/GC behavior but did not evaluate restore-maintenance gating for the analytics inserts. Known process-local restore-maintenance scale-out risk remains documented/deferred and is not re-filed here because the current single-instance topology is unchanged.

## Findings

### TRC-C3-01 - `bulkUpdateImages` can mutate images and tags during DB restore maintenance

**Status:** Confirmed  
**Severity:** High  
**Confidence:** High

**Evidence:**

- `apps/web/src/app/actions/images.ts:928-933` starts `bulkUpdateImages` with origin/admin checks but no `getRestoreMaintenanceMessage(...)` guard.
- The same file guards sibling mutating image actions: upload at `apps/web/src/app/actions/images.ts:109`, delete at `:597`, batch delete at `:693`, metadata update at `:852`, retry at `:1128`.
- `bulkUpdateImages` then mutates `images` and `imageTags` inside a transaction at `apps/web/src/app/actions/images.ts:1008-1102` and invalidates broad app data at `:1116`.

**Failure scenario:** An admin opens the bulk-edit UI, starts a DB restore in another tab, then submits bulk edits while the restore window is active. The action can write topic/title/description/tag changes against a table being dropped/reloaded, or against IDs that belonged to the pre-restore selection but are reused differently after import. The user sees success and broad revalidation can expose a state the restore was supposed to isolate.

**Concrete fix:** Add the same restore-maintenance guard used by the sibling image actions immediately after translations are loaded and before origin/admin work:

```ts
const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
if (maintenanceError) return { error: maintenanceError };
```

Then add a source-contract or unit test that every mutating export in `images.ts` has the restore guard before its first DB write.

### TRC-C3-02 - LR token create/revoke actions can race DB restore and mislead credential state

**Status:** Confirmed  
**Severity:** Medium  
**Confidence:** High

**Evidence:**

- `apps/web/src/app/actions/lr-tokens.ts:27-99` creates LR tokens after origin/admin/user checks but has no restore-maintenance guard.
- `apps/web/src/app/actions/lr-tokens.ts:102-118` revokes LR tokens with the same gap.
- The underlying writes are real credential mutations: insert at `apps/web/src/lib/admin-tokens.ts:216-219`, delete at `apps/web/src/lib/admin-tokens.ts:227-231`, plus audit writes in `apps/web/src/app/actions/lr-tokens.ts:89-92` and `:114-115`.
- The old `.context/plans/run3-cycle4/_plan.md` fix covered `apps/web/src/app/api/admin/lr/upload/route.ts`; current token-management actions are a separate path.

**Failure scenario:** During restore, an admin creates a token, receives plaintext, and gives it to Lightroom; the restore then reloads `admin_tokens` from backup and the new token disappears. Conversely, an admin revokes a token during restore and sees success, but the restored backup can reintroduce that token hash. The second case is especially misleading for incident response.

**Concrete fix:** Import `getRestoreMaintenanceMessage` from `@/lib/restore-maintenance` and add the standard early return to both `createLrToken` and `revokeLrToken` before mutation. Keep `listLrTokens` read-only. Add a focused `lr-tokens-action` regression that toggles restore maintenance and asserts create/revoke reject without calling `createToken`/`revokeToken`.

### TRC-C3-03 - Public analytics inserts bypass the restore-maintenance barrier

**Status:** Likely risk / manual-validation  
**Severity:** Low  
**Confidence:** Medium

**Evidence:**

- `apps/web/src/app/actions/public.ts:357-371`, `:374-392`, and `:395-408` record photo/topic/shared-group view events without checking `isRestoreMaintenanceActive()`.
- Public page callsites fire these actions after rendering data, for example photo pages at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:163-165` and shared-group pages at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:110-117`.
- The older denormalized shared-group counter path already skips restore maintenance in `apps/web/src/lib/data.ts:48-51`, so the durable event-table path is inconsistent.

**Failure scenario:** A public page reads an image/group before restore maintenance starts, then the fire-and-forget analytics insert runs while restore is dropping or reloading the analytics tables. Most failures are swallowed as intended, but a narrow timing window can write a view event against a stale pre-restore ID after the table exists again. This is analytics-only, so severity is low, but it violates the restore quiescence pattern.

**Concrete fix:** Add `if (isRestoreMaintenanceActive()) return;` at the top of all three analytics recorders, before `headers()` and rate-limit work, matching `bufferGroupViewCount`. Add a source-contract check for the three public recorders so future analytics writers consciously choose restore behavior.

## Confirmed-Correct Flow Notes

- Browser upload and LR upload both guard restore entry and late post-save cleanup (`images.ts:109`, `:351`; `api/admin/lr/upload/route.ts:143-148`, `:305-346`), claim upload quota before disk writes, and enqueue processing with config snapshots.
- Image processing rejects enqueue during shutdown/restore (`image-queue.ts:281-286`), uses per-image processing claims, conditionally marks rows processed, and cleans variants if the row disappears.
- Delete paths remove DB rows transactionally and clean queued/processed file state (`images.ts:641-677`, `:752-823`).
- Sharing actions have restore guards on create/revoke/delete (`sharing.ts:84-88`, `:185-188`, `:306-309`, `:346-349`) plus rate-limited public share lookup.
- Backup/restore core flow combines origin/admin checks, DB advisory restore lock, upload-processing contract lock, maintenance mode, queue quiesce/resume, and finally cleanup (`db-actions.ts:119-130`, `:266-354`).
- CLIP search routes are same-origin gated, restore-gated, mode-gated, bounded, and return only public processed image fields (`api/search/semantic/route.ts:101-333`, `api/search/similar/[id]/route.ts:64-236`).
- OG generation validates/rate-limits inputs, sanitizes public text, pins photo image fetches to configured same-origin URLs, and has bounded fetches (`api/og/route.tsx`, `api/og/photo/[id]/route.tsx`, `lib/og-photo-fetch.ts`).
- i18n routing uses always-prefixed locale middleware and excludes API routes from proxy auth assumptions (`proxy.ts:7-12`, `:76-140`).
- Service-worker template and generated file carry the bounded HEAD freshness probe. `sw.js` is stamped `2051bb87-p7`; since the last stamp commit, current HEAD only changes review docs, and `IMAGE_PIPELINE_VERSION` remains `7`, so I did not file a freshness bug.

## Final Missed-Issues Sweep

I ran final greps for mutating action writes versus restore guards and for restore-gated API/lib paths. That sweep produced the two confirmed restore-gating misses above and the low-risk analytics inconsistency; no additional confirmed issues surfaced in sharing, core restore/backup, CLIP search, OG generation, i18n routing, upload queueing, or service-worker freshness.

**Disposition:** 2 confirmed findings, 1 likely/manual-validation risk, no application-code edits.
