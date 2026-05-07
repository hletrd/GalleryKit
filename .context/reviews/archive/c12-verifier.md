# Cycle 12 Verifier Review

## Review Scope
Evidence-based correctness verification against stated behavior. Verify prior fixes are correct and complete.

## Findings

### C12-VF-01 (Medium/High): `restoreDatabase` `endRestoreMaintenance()` missing on error paths — verification of bug

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:293-329`
- **Issue**: Verified by code inspection that `beginRestoreMaintenance()` sets a module-level boolean (`restoreMaintenanceActive` in `restore-maintenance.ts`) to `true`, and `endRestoreMaintenance()` sets it to `false`. The two error paths identified by other reviewers do NOT call `endRestoreMaintenance()`. I traced the `isRestoreMaintenanceActive()` function to confirm it reads the same boolean. The bug is confirmed: two error paths leave the maintenance flag permanently set.
- **Fix**: Add `endRestoreMaintenance()` before both early returns.
- **Confidence**: High — verified by tracing the boolean lifecycle.

### C12-VF-02 (Low/Medium): Verified C11-MED-01 fix (topic existence check) is correctly implemented

- **File+line**: `apps/web/src/app/actions/images.ts:239-250`
- **Issue**: The cycle 11 fix adds a `SELECT 1 FROM topics WHERE slug = ?` check before the file processing loop. The query uses `eq(topics.slug, topic)` which is correct. The error key `topicNotFound` is returned when the topic is not found. The check is placed AFTER the upload contract lock acquisition but BEFORE the tracker pre-increment, which is the correct ordering (the lock prevents concurrent setting changes, and the check prevents wasting tracker quota on invalid topics). Fix verified as correct.
- **Fix**: No fix needed — confirming prior fix is correct.
- **Confidence**: High.

### C12-VF-03 (Low/Medium): Verified C11-MED-02 fix (permanentlyFailedIds check in enqueueImageProcessing) is correctly implemented

- **File+line**: `apps/web/src/lib/image-queue.ts:216-221`
- **Issue**: The cycle 11 fix adds `if (state.permanentlyFailedIds.has(job.id))` check at the top of `enqueueImageProcessing`, after the `shuttingDown` check but before the `enqueued.has` check. This is the correct placement — it prevents re-enqueue from claim-retry timers. The `console.debug` log is appropriate for debugging. Fix verified as correct.
- **Fix**: No fix needed — confirming prior fix is correct.
- **Confidence**: High.

### C12-VF-04 (Low/Low): `lightbox.tsx` `alt` fallback uses internal filename

- **File+line**: `apps/web/src/components/lightbox.tsx:309`
- **Issue**: Same as C12-DC-03. The `alt` attribute on the lightbox `<img>` uses `image.title ?? image.filename_jpeg ?? ''`. When title is null, the UUID-based filename is not a meaningful alt text. The photo viewer component uses `getConcisePhotoAltText()` which provides a better fallback. Confirming this is a valid accessibility gap.
- **Fix**: Use `getConcisePhotoAltText` or pass the computed alt text from the parent.
- **Confidence**: Medium.

## Summary
- Total findings: 4
- Medium severity: 1 (C12-VF-01, overlaps with other agents)
- Low severity: 3
