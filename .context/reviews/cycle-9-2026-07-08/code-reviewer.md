# Code Reviewer — Cycle 9

Date: 2026-07-08
Reviewed HEAD: `6efd737b3ad5791c662fded4801701992684e54d`
Scope: `apps/web/src` — server actions, lib, API routes, components (full inventory sweep with parallel sub-reviews)

Method: read the cycle-18 fix commit's diff in full first (it is the newest code and most likely to carry a fresh regression), then read every file under `apps/web/src/app/actions/`, a broad cross-section of `apps/web/src/lib/` not already covered by prior aggregates, `apps/web/src/db/`, `apps/web/src/proxy.ts`, and a broad cross-section of `apps/web/src/components/`. Findings below are evidence-backed against the current source, not against comments/tests describing intended behavior.

---

## CR9-01 — PAT `last_used_at` is still marked "used" for most Lightroom-upload rejection paths, not just admission gates

- Severity: Medium
- Confidence: High (confirmed by reading the route + its own regression test)
- Files: `apps/web/src/app/api/admin/lr/upload/route.ts:84-165`, `apps/web/src/lib/api-auth.ts:17-24`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:286,313`

The previously-tracked finding (`AGG-C18-10` / architect.md / tracer.md, closed by cycle-18 per `.context/plans/cycle-18-2026-07-08-plan.md:52-60`) was "PAT `last_used_at` is updated before Lightroom upload route admission gates," with acceptance criteria: *"A valid Lightroom PAT request blocked by restore maintenance does not update `last_used_at`"* and *"An admitted Lightroom PAT request still updates `last_used_at`."* The cycle-18 fix (`git show 6efd737b -- apps/web/src/lib/api-auth.ts apps/web/src/app/api/admin/lr/upload/route.ts`) moved the token-usage side effect out of `withAdminAuth` and introduced an explicit `markAdminAuthTokenUsed(request)` call in the route body at line 160 — *after* the entry-guard `isRestoreMaintenanceActive()` check (line 94), the chunked-transfer-encoding check, the `Content-Length`/size checks, the per-user/IP upload-tracker rate-limit checks, and the multipart-parse concurrency-slot acquisition.

That satisfies the two acceptance-criteria scenarios literally, but the mark still runs **before** `request.formData()` is even parsed (line 182) and before essentially every piece of request-content validation that follows: invalid multipart body, missing `file` field, oversized file, invalid/sanitized-away filename (`getSafeUserFilename`), invalid or unknown topic slug (a 404 "Topic not found" at line 298-301 — the single most common real-world Lightroom-publish misconfiguration, e.g. a stale/renamed topic in a saved publish profile), title/description too long, a restore beginning mid-request (the second `isRestoreMaintenanceActive()` check at line 259), the upload-processing-contract lock being unavailable (line 274), insufficient disk space, a RAW-file rejection, an HDR-ingest rejection, a GPS-strip failure, or any thrown error during EXIF extraction/insert (the broad `catch` at line 513). In every one of these cases the response is a 4xx/5xx failure and no image is created, yet `admin_tokens.last_used_at` is already touched by the time any of them run.

This is a genuinely new angle beyond the fix's own acceptance tests: `apps/web/src/__tests__/lr-upload-route-behavior.test.ts` only asserts `markAdminAuthTokenUsedMock` is *not* called for the restore-entry-guard case (line 313) and *is* called once for the full-success case (line 286) — it does not exercise any of the many rejection branches in between, so the gap is untested as well as unfixed. The architect's original suggested fix ("let each token-backed route mark usage after its route-specific gates pass") is still only partially implemented — "gates" here effectively means only the four checks that run before multipart parsing, not the request-content validation that follows.

**Failure scenario:** a photographer's Lightroom publish profile points at a topic slug that was later renamed or deleted. Every publish attempt authenticates fine, gets a fresh `last_used_at` bump, and then fails with `404 Topic not found` — no photo is ever uploaded. An admin checking the Tokens admin page sees "last used: 2 minutes ago" and reasonably concludes the integration is working, when in fact 100% of recent attempts have failed. The same masking applies to a full disk, an oversized export preset, or a title that exceeds the 255-char cap.

**Suggested fix:** move the `markAdminAuthTokenUsed(request)` call to immediately before the final success `return NextResponse.json({ success: true, id: imageId }, ...)` (i.e., treat "used" as "the route accepted and committed an upload"), or at minimum move it to after `formData()` parsing and all `4xx` validation branches so only genuinely-admitted requests bump the timestamp. If distinguishing "authenticated but rejected" attempts is itself useful operator signal, model it as a separate audit/attempt counter rather than overloading `last_used_at` (this was the architect's original recommendation and still applies).

---

## CR9-02 — `TagFilter` mounts every tag-chip button twice in the DOM for the mobile/desktop responsive split

- Severity: Low
- Confidence: High (confirmed by reading the file; functional impact is limited because CSS `display:none` excludes hidden copies from the accessibility tree and tab order)
- File: `apps/web/src/components/tag-filter.tsx:62-145`

The cycle-18 mobile-collapsible redesign extracts the tag chips into a `chips` JSX fragment (all `<Badge asChild><button onClick=.../></Badge>` elements, lines 62-123) and then renders that *same* fragment twice: once inside `<details className="group sm:hidden">` for the mobile disclosure (line 127-139), and once inside `<div className="hidden flex-wrap gap-2 sm:flex">` for desktop (line 140-142). Both subtrees are always mounted; only Tailwind's `hidden`/`sm:hidden`/`sm:flex` utility classes toggle which one is visible per breakpoint. Since both copies share the same click handlers (which read `canonicalTags`/`searchParams` from the shared component closure, not local state), there's no state-desync risk, and elements under `display:none` are excluded from the accessibility tree and tab order, so this is not a functional or a11y regression today.

It does mean: (1) every tag chip's interactive `<button>` and its `role="group"` wrapper exist twice in the raw HTML for every page load, doubling the DOM node count for this component and the bytes shipped for galleries with many tags; and (2) any future test that queries `getByRole('group', { name: ... })` or `getByRole('button', { name: ... })` for a specific tag chip (there are none today — confirmed via `grep -rn "TagFilter" apps/web/src --include="*.tsx" --include="*.ts"`, which shows only a source-string contract test) will get "found multiple elements" ambiguity, since Testing-Library queries do not filter out `display:none` elements by default.

**Suggested fix:** if the intent is genuinely two different layouts (disclosure vs. inline row), consider a single set of chip elements and CSS-only reposition them (e.g., moving the wrapping element only, not duplicating the buttons), or accept the duplication but document it so a future test author doesn't add an ambiguous query. Not urgent — flagging as a cleanup opportunity, not a bug to hotfix.

---

## CR9-03 — Bulk edit silently lets "add tag X" and "remove tag X" cancel out with removal winning, for every selected image

- Severity: Medium
- Confidence: High (confirmed both client-side, via `TagInput`'s self-scoped dedup, and server-side, via unconditional add-then-remove execution order)
- Files: `apps/web/src/components/bulk-edit-dialog.tsx:88-89,264-287`, `apps/web/src/components/tag-input.tsx:31-33,67-68,109-110`, `apps/web/src/app/actions/images.ts:1040-1053,1183-1206`

`BulkEditDialog` renders two independent `<TagInput>` instances — one bound to `addTagNames` (line 266-273), one bound to `removeTagNames` (line 279-286) — each with its own `selectedTags` array. `TagInput`'s only duplicate guard is `hasSelectedTag(selectedTags, candidate)` (`tag-input.tsx:31-33`), which checks the tag against *that instance's own* `selectedTags` prop; neither instance has any awareness of the other's selections. Nothing prevents an admin from adding the same tag name to both the "Add tags" and "Remove tags" fields in one bulk-edit submission (e.g., picking the same autocomplete suggestion twice, or a mis-click while editing a large batch).

Server-side, `bulkUpdateImages` (`app/actions/images.ts`) validates `addTagNames`/`removeTagNames` shape and length (lines 1040-1053) but never checks for overlap between the two normalized lists. Inside the transaction, the tag-addition loop runs first and inserts `imageTags` rows for every id in `normalizedAddTagNames` (lines 1183-1191: "Tag additions: ensure tag record exists, then batch-insert imageTags rows"), and the tag-removal loop runs immediately after and deletes `imageTags` rows for every id in `normalizedRemoveTagNames` against the *same* `existingImageIds` batch (lines 1193-1204: "Tag removals: ... delete only rows matching both the imageId batch AND the specific tagId"). If a tag name appears in both lists, the insert from the add loop is unconditionally undone by the delete in the remove loop for every image in the batch — the net, silent effect is "remove", even though the admin's UI state shows that tag under "Add tags".

**Failure scenario:** an admin runs a 50-photo bulk edit intending to add the tag `portrait` to the batch and remove an unrelated tag `draft`. If autocomplete or a copy-paste mistake also lands `portrait` in the Remove-tags field (easy to do with two visually similar, adjacent multi-select inputs and no cross-field validation or preview), all 50 photos silently keep (or lose, if some already had it) `portrait` with zero indication anything unusual happened — the action reports `{ success: true, count: 50 }` exactly as it would for the intended edit. The audit log entry (`images_bulk_update`) even records `addTagNames` containing `portrait`, which would mislead someone reviewing the audit trail into believing it was added.

**Suggested fix:** reject the submission (client-side and/or server-side) when `addTagNames` and `removeTagNames` share any normalized tag, with a clear validation error (mirrors the existing `topicMode === 'set' && !topicValue` pattern already in `handleSubmit`), or at minimum de-duplicate by removing any tag present in both from the remove list before execution and surface that adjustment to the admin.

---

## Areas reviewed with no new findings

Read in full during this pass with no confirmed new issues beyond the above: `apps/web/src/lib/action-guards.ts`, `request-origin.ts`, `gallery-config-shared.ts`, `settings-normalization.ts`, `settings-submit-payload.ts`, `settings-backfill-warning.ts`, `tag-records.ts`, `upload-filenames.ts`, `on-this-day-date.ts`, `image-zoom-math.ts`, `pagination.ts`, `download-filename.ts`, `base56.ts`, `mysql-datetime.ts`, `password-hashing.ts`, `photo-title.ts`, `sql-like.ts`, `revalidation.ts`, `editable-target.ts`, `ime.ts`, `env.ts`, `use-restore-focus-after-pending.ts`; `apps/web/src/db/index.ts` (the pooled-connection init-race/timeout wrapper), `apps/web/src/db/schema.ts`; `apps/web/src/proxy.ts` (admin-route cookie guard + i18n middleware); `apps/web/src/components/search.tsx`, `load-more.tsx`, `similar-photos.tsx`, `photo-navigation.tsx`, `optimistic-image.tsx`, `register-service-worker.tsx`, `info-bottom-sheet.tsx`, `masonry-card.tsx`, `nav-client.tsx`. These are heavily hardened from 18+ prior review cycles and no new logic/correctness defect was found in them during this pass.

Additional coverage (server actions in full; a further cross-section of `lib/`, API routes, and components) was run via parallel sub-reviews scoped to avoid overlap with the above; see below for their integrated findings.

---

## Sub-sweep findings (reconstructed)

NOTE: the sub-sweep section was truncated when this file originally landed; the results were
relayed by the orchestrator and each was independently re-verified against HEAD `6efd737b`
source by the aggregating lane before being recorded here. Full write-ups with citations
live in `_aggregate.md` (AGG9B-21..28).

- CR9-S1 (Medium/High) — `beginDurableRestoreMaintenance` rolls back a maintenance flag it
  does not own when the durable-marker write fails under `allowExisting: true`
  (`restore-maintenance-durable.ts:97-108`, `restore-maintenance.ts:48-55`, `db-actions.ts:511`).
- CR9-S2 (Medium/Med-High) — `getClientIp` XFF hop selection (`length - hops - 1`) is
  off-by-one for standard append-mode proxy chains; documented CDN topology either collapses
  all users into one bucket or selects an attacker-prepended entry (`rate-limit.ts:184-194`).
- CR9-S3 (High/High) — lightbox slideshow Pause button defeated on touch devices: the
  container-level touchend stops the slideshow, then the button's click toggles it back on
  (`lightbox.tsx:247-263,489-490,627-631`).
- CR9-S4 (Medium/Medium) — image-zoom double-tap races native browser double-tap zoom while
  un-zoomed because `touchAction` is `'auto'` (`image-zoom.tsx:380,216-236`).
- CR9-S5 (Low-Medium/Low) — "inert Toaster" relay could NOT be confirmed from source;
  recorded as a manual-validation risk only (`app/[locale]/layout.tsx:149`, `ui/sonner.tsx`).
- CR9-S6 (Medium/High) — the ICC-description HDR/gamma heuristic branch is dead: the only
  `inferTransferFunction` call site passes `null` for `iccDescription`
  (`color-detection.ts:364` vs `:80-102`).
- CR9-S7 (Medium/High) — image-manager per-row TagInput chips render stale tags until the
  `router.refresh()` round-trip completes; no optimistic state or in-flight disable
  (`image-manager.tsx:504-533`).
- CR9-S8 (Low-Medium/High) — Cmd/Ctrl+K cannot CLOSE the search dialog: the toggle
  early-returns for input targets, and the open dialog focuses its own input
  (`search.tsx:327-331`).
