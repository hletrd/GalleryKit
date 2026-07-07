# code-reviewer review — cycle 6

## Summary

Focused, time-boxed logic/error-handling/edge-case review of the assigned non-peer-dirty
files at committed HEAD `b965e3bf` (verified identical to the briefing's stated baseline
`583277fb` for every assigned file — no diff between the two commits touches any file in
this lane's scope). Cross-checked `.context/reviews/cycle-6-2026-07-07/feature-dev-code-reviewer.md`
(a sibling lane covering an overlapping file set from a security/architecture angle) and
`.context/reviews/_aggregate.md` / `.context/plans/deferred-carry-forward.md` before writing
anything up, to avoid re-reporting known items. Found one genuinely new MEDIUM-severity
concurrency/state bug in `image-manager.tsx` (missing settle-before-close guard on the
metadata-edit dialog — a gap the project's own regression fixture cannot see because it only
scans `AlertDialogAction`, not plain `Dialog`/`Button` flows) and one LOW-severity naming
inconsistency in the bulk-edit "titlePrefix" field. Everything else examined (server actions,
sanitize/validation/upload-path helpers, `serve-upload.ts`, `smart-collections.ts`) held up
under close reading — no new logic bugs found there.

## Findings

### F1 — Edit-metadata dialog's settle-before-close gap lets a stale in-flight save force-close a different image's dialog and falsely block its Save button  [SEV: MED | CONF: High | apps/web/src/components/image-manager.tsx:274-317, 611-616, 663-664]

**Problem.** Every other async-mutation confirm flow in this file (single delete, bulk delete)
was retrofitted with a "settle-before-close" guard, per the file's own `COR-R4C16-01` comments
(`image-manager.tsx:391`, `:557`): the dialog refuses to close while its own mutation is still
in flight, keyed by the specific target id (`deletingId === image.id`) or a dedicated boolean
for the one bulk operation (`isBulkDeleting`). The metadata-edit `Dialog` (title/description)
never received the same treatment:

- `onOpenChange` for the edit dialog (`image-manager.tsx:611-616`) unconditionally sets
  `editingImage` to `null` whenever the dialog is dismissed (ESC, backdrop click, or the
  `Cancel` button at `:663`) — there is no `if (!isSavingEdit)` guard analogous to the delete
  flows.
- `isSavingEdit` (`:103`) is a single shared boolean for the *whole component*, not scoped to
  the image currently being edited, and nothing resets it when the dialog is dismissed instead
  of saved.
- `handleSaveEdit` (`:274-317`) captures `editingImage` via closure at call time (correct for
  targeting the right row), but its completion side effects are **not** guarded against the
  dialog having moved on to a different edit session: on success it unconditionally calls
  `setEditingImage(null)` (`:307`), and `finally` unconditionally calls `setIsSavingEdit(false)`
  (`:316`), regardless of what `editingImage` currently holds in state.

**Concrete failure scenario.**
1. Admin opens Edit on Image A, changes the title, clicks Save. `isSavingEdit` becomes `true`
   and `updateImageMetadata(A.id, …)` is in flight.
2. Before the response returns, the admin clicks Cancel (not disabled by `isSavingEdit`) or
   presses Escape. The dialog closes (`editingImage = null`); `isSavingEdit` stays `true`
   because nothing resets it on this path.
3. Admin clicks Edit on Image B. `startEdit(imageB)` opens the dialog with Image B's fields,
   but the Save button (`disabled={isSavingEdit}`, `:664`) is still disabled and shows
   "Saving…" — for an operation the admin never started on Image B, with no visible cause and
   no way to force it to clear.
4. When Image A's abandoned request eventually resolves (success or failure), `handleSaveEdit`
   runs its completion code with the STALE closure: on success it calls `setImages(...)`
   (harmless — keyed correctly by A's id) and then **unconditionally `setEditingImage(null)`**,
   which force-closes whatever dialog is open *right now* — Image B's — discarding any further
   edits the admin made to B's title/description in the interim, accompanied by an "Image
   updated" toast that actually refers to Image A. `isSavingEdit` also flips back to `false` at
   this point, which happens to unblock B's Save button, but only as a side effect of A's
   response landing — the dialog is already gone by then.

**Why this slipped through.** The repo has a real regression fixture for exactly this class of
bug — `apps/web/src/__tests__/alert-dialog-action-settle.test.ts` (COR-R4C16-01) — but it only
scans for the literal `<AlertDialogAction` JSX tag. The edit dialog uses a plain
`Dialog`/`DialogContent`/`Button onClick={handleSaveEdit}`, so it is structurally invisible to
that scanner even though the same hazard applies. The same gap exists for the batch-add-tag
`Dialog` (`isBatchTagDialogOpen` / `isBatchAddingTag`, `:329-336`) at lower severity — there is
only one instance of that dialog, so reopening it mid-flight can only show a false "Adding…"
state for itself rather than clobbering an unrelated session, but it is the same missing guard.

**Fix.** Either (a) scope the in-flight state to the target image id (e.g. `savingImageId:
number | null`, mirroring `deletingId`) and only let a response mutate `editingImage` when
`editingImage?.id` still matches the id the request was made for; or (b) apply the same
settle-before-close pattern already used for the delete dialogs — block `onOpenChange(false)`
and disable Cancel while `isSavingEdit` is true, so a stale response can never race a fresh
edit session. Consider also extending the `alert-dialog-action-settle.test.ts` fixture (or a
sibling) to catch plain `Dialog` async-button flows, not just `AlertDialogAction`, so this class
of gap is caught mechanically in future cycles.

### F2 — `titlePrefix` field is named/commented as a prefix throughout the bulk-edit stack but performs an exact title replacement  [SEV: LOW | CONF: Med | apps/web/src/lib/bulk-edit-types.ts:14, apps/web/src/app/actions/images.ts:1083-1120,1220, apps/web/src/components/bulk-edit-dialog.tsx:148]

`BulkUpdateImagesInput.titlePrefix` (`bulk-edit-types.ts:14`), the `titlePrefix` destructure and
comments in `bulkUpdateImages` (`images.ts:1026`, `:1081` "Validate and sanitize titlePrefix
field", `:1220` `titlePrefixMode` audit field), and the `titleField` variable feeding it in
`bulk-edit-dialog.tsx:148` all use "prefix" terminology, but the actual behavior
(`images.ts:1120`: `if (titlePrefix.mode === 'set') setClause['title'] = sanitizedTitlePrefix;`)
is a plain `SET title = value` applied identically to every selected image — not a
prepend/concatenation onto each image's existing title. The user-visible label is just "Title"
(`imageManager.bulkTitlePrefix` = "Title" / "제목" in `en.json`/`ko.json`), so there is no
current end-user-facing mismatch — an admin sees "Title: <mode> <value>" and gets exactly that
literal value written to every selected image, which matches what's displayed.

This is a naming/maintainability risk rather than a live behavior bug: a future maintainer
reading only the type/variable/log-field names (with no UI context) could reasonably assume
prefix-concatenation semantics exist here, and build on that wrong assumption (e.g., "fix" the
UI to say "Title prefix" without changing the exact-set behavior, creating a real mismatch; or
skip re-verifying behavior when refactoring because the name already "explains" it).

**Fix.** Rename `titlePrefix` → `title` (type field, destructured variable, audit log key,
comments) throughout `bulk-edit-types.ts` / `images.ts` / `bulk-edit-dialog.tsx` to match actual
behavior, or — if prefix-prepend was originally intended product behavior — implement real
string-prepend semantics and update the "Only toggled fields will be changed" dialog copy
accordingly. Either resolution is low-risk since the current UI label already agrees with the
"exact set" behavior.

## Files examined (inventory)

Server actions: `apps/web/src/app/actions/images.ts` (full, 1368 lines), `sharing.ts` (full),
`tags.ts` (full), `seo.ts` (full), `admin-users.ts` (full), `collections.ts` (full).

`lib/`: `serve-upload.ts` (full), `smart-collections.ts` (full), `csv-escape.ts` (full),
`sanitize.ts` (full), `validation.ts` (full), `upload-paths.ts` (full), `process-topic-image.ts`
(full).

Components: `image-manager.tsx` (full, 670 lines), `upload-dropzone.tsx` (full, 595 lines),
`bulk-edit-dialog.tsx` (full, 318 lines). Also read `tag-input.tsx` (partial, to confirm it is a
fully controlled/prop-driven component with no internal tag-list state — relevant to ruling out
a suspected stale-diff race in the per-row tag editor in `image-manager.tsx`; confirmed no new
bug there beyond the generic "state stays stale until `router.refresh()` completes" pattern that
is pervasive and already accepted throughout this admin UI).

Cross-referenced: `.context/reviews/cycle-6-2026-07-07/feature-dev-code-reviewer.md` (sibling
lane, overlapping file set, different angle — no overlap with F1/F2), `.context/reviews/_aggregate.md`
(cycle-10 aggregate, most recent), `.context/plans/deferred-carry-forward.md` (open carry-forward
register) — neither mentions `image-manager.tsx`'s edit dialog, `isSavingEdit`, or the
`titlePrefix` naming, so both findings above are treated as new. Also grepped historical
`.context/reviews/**` logs for `isSavingEdit` / settle-before-close language — only raw
full-file-read transcripts from other lanes' inventories turned up, no prior finding of this
specific race.

## Final sweep (commonly-missed) notes

- Verified committed HEAD (`b965e3bf7621b1fa1892f199ba79a808665457e5`) vs. the briefing's stated
  baseline (`583277fb3e46d671767036964578be4af66be2e1`): `git diff --stat` between the two
  touches zero files in this lane's assignment, so reviewing at current HEAD is equivalent to
  reviewing at the stated baseline for every file above.
- Re-checked every mutating action in this lane's scope for the standard
  `getRestoreMaintenanceMessage` → `requireSameOriginAdmin` → `acquireAdminMutationSlot` →
  `isAdmin()` ordering — present and correctly ordered everywhere (matches the sibling lane's
  finding).
- Specifically hunted for off-by-one/boundary bugs in the retry/rollback rate-limit helpers in
  `sharing.ts` and `admin-users.ts` (in-memory + DB dual counters, rollback-on-non-retryable-error
  paths) — the shallow-copy/write-back-via-`.set()` fix (R15C15 CR-15-01) is applied consistently
  in both files; no new drift found.
- Checked `smart-collections.ts`'s AST validator/compiler for a column-allowlist or
  operator-narrowing gap between `parseSmartCollectionQuery` (write-time validation) and
  `compileSmartCollection`/`compileTagPredicate` (read-time compilation) — the two stay in sync
  (`TAG_OPERATORS` mirrored on both sides); no bypass found.
- Checked `retryFailedImage` (`images.ts:1238-1368`) for a race between the failed-state clear
  UPDATE and a concurrent second retry request — both the clear and the fallback
  restore-to-failed UPDATE use conditional `WHERE` predicates that correctly no-op when another
  request already changed the row, so double-enqueue is prevented by predicate design, not just
  by luck.
- Checked `upload-paths.ts`'s `resolveOriginalCandidate` (lstat → symlink check → realpath →
  containment re-check) for TOCTOU — there is a small window between the `lstat` symlink check
  and the final `realpath` containment re-check where the file could theoretically be swapped;
  this matches the already-tracked carry-forward item `SEC4-03` ("threat model adds
  hostile-local-writer"), not a new finding.
- No missed `await`, swallowed-rejection-changing-control-flow, or silently-wrong boundary
  comparison found in `csv-escape.ts` / `sanitize.ts` / `validation.ts` — the Unicode-formatting
  regex sharing (`UNICODE_FORMAT_CHARS` vs. its `/g`-flagged derivatives) is correctly documented
  and consistently derived (`.source`-based, not hand-copied) everywhere it's used.
- Confirmed the login/password-change/`createAdminUser` pattern of `stripControlChars` (silent
  strip, no reject) for password fields — as opposed to `requireCleanInput` (reject-on-change)
  for username/topic/tag fields — is a deliberate, consistent, pre-existing design choice
  (comment: "C0 controls in passwords are almost always accidental paste artifacts"), not a new
  inconsistency worth flagging.
