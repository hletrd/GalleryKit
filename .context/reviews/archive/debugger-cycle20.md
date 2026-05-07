# Debugger — Cycle 20

## Review Scope
Latent bugs, failure modes, race conditions, edge cases, error handling gaps, and invariant violations across all server actions, middleware, data layer, image processing, and queue management.

## New Findings

### DBG-20-01: `uploadTracker` negative count after all-failed uploads — latent rate-limit bypass [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/actions/images.ts` lines 273-278
- **Description**: Same as CR-20-05. When `successCount === 0` and `files.length > 0`, the adjustment `currentTracker.count += (0 - files.length)` produces a negative count. This violates the invariant that tracker.count should be >= 0 (it represents "files uploaded in this window"). The negative count propagates forward and inflates the effective upload budget.
- **Concrete failure scenario**: Same as CR-20-05.
- **Fix**: Clamp to 0 after adjustment.

### DBG-20-02: `deleteAdminUser` does not check `affectedRows` — returns success on no-op deletion [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/admin-users.ts` lines 157-166
- **Description**: Same as CR-20-02. The transaction does not verify that the `adminUsers` delete actually affected any rows. If the user ID doesn't exist (concurrent deletion, stale UI), the function returns `{ success: true }` without deleting anything. This is not a data corruption bug, but it violates the principle that `success: true` should mean the requested action was actually performed.
- **Fix**: Check affected rows and return error if 0.

### DBG-20-03: `batchUpdateImageTags` add path does not validate `isValidTagName` before INSERT IGNORE — could insert tags with invalid names [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/actions/tags.ts` lines 300-308
- **Description**: In the add loop, `isValidTagName(cleanName)` is checked at line 303, and invalid names push a warning and `continue`. However, looking more carefully at lines 300-310: `cleanName = name.trim()`, then `if (!cleanName) continue`, then `if (!isValidTagName(cleanName))` pushes warning and continues, then `isValidSlug(slug)` check continues. So actually the validation IS present. Let me re-examine...
- **Re-analysis**: Lines 303-305 correctly validate with `isValidTagName` and skip invalid names with a warning. Lines 307-308 validate the slug and skip if invalid. The tag INSERT at line 310 only happens after both validations pass. This is correct.
- **Verdict**: Not an issue — validation is properly implemented.

### DBG-20-04: `processImageFormats` verification check after parallel format generation could miss partial failures [LOW] [LOW confidence]
- **File**: `apps/web/src/lib/process-image.ts` lines 407-421
- **Description**: After `Promise.all` generates all three formats, a separate `Promise.all` verifies all three base files are non-empty. If one format's `toFile` silently produced a 0-byte file but didn't throw, the verification catches it. However, `Promise.all` rejects on the first error, so if one format's `toFile` threw, the other formats might have been generated successfully. The catch handler for `Promise.all` would then be reached, and the function would throw. The already-generated files for the other formats would be left as orphans. But since the DB still shows `processed = false`, the queue will retry, and `processImageFormats` will overwrite them. So orphaned files are cleaned up by the next retry.
- **Verdict**: Not a practical issue — retries handle it.

## Previously Fixed — Confirmed

All prior cycle 1-19 findings remain resolved. The C19-01/C19-02/C19-03 fixes verified.
