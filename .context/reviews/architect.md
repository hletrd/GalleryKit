# Architect — Cycle 7 (review-plan-fix loop, 2026-04-25)

## Architectural lens

Per-cycle directive instructed reviewers to look beyond Unicode bidi/invisible-character hardening. The pattern is now consolidated through `containsUnicodeFormatting` in `validation.ts:50-52`, with seven distinct call sites (topic alias, tag, label, image title/description, four SEO fields). Architecturally clean. No new architectural rework needed in this lens.

## Findings

### C7L-ARCH-01 — Tagging path duplicates parsing of `tagsString` after sanitize
- File: `apps/web/src/app/actions/images.ts:141-149`
- Severity: LOW
- Confidence: High
- Issue: `tagsString.split(',')` is called twice — once to extract names (line 142) and once to count to detect drop-outs (line 147). The second `split(',')` is on the already-sanitized string. This is benign, but the duplicated parse is a minor code-smell and adds an O(n) allocation on the hot path of every upload action.
- Suggested fix: Compute `const candidateTags = tagsString.split(',')` once, derive both arrays from the same split.

### C7L-ARCH-02 — `getSafeUserFilename` validates only basename, not extension allow-list
- File: `apps/web/src/app/actions/images.ts:41-51`
- Severity: INFO
- Confidence: Medium
- Issue: The user-visible filename can be any UTF-8 string up to 255 bytes after stripping control chars. Sharp re-validates the magic bytes downstream, but the user-facing filename is also rendered into admin tables and OG metadata. Documenting this contract (no extension allow-list, sharp-driven validation) would help future maintainers.
- Suggested fix: Add a comment noting that `user_filename` is a display value only and that disk filenames use UUIDs; no fix to behavior.

### C7L-ARCH-03 — `bootstrapImageProcessingQueue` chain depth
- File: `apps/web/src/lib/image-queue.ts:382-459`
- Severity: INFO
- Confidence: Medium
- Issue: `bootstrapImageProcessingQueue` does pagination via `bootstrapCursorId`, and at the end if not bootstrapped, schedules a continuation via `state.queue.onIdle().then(...)` (line 369-379). The continuation will re-call `bootstrapImageProcessingQueue` itself, which short-circuits if `bootstrapContinuationScheduled === true` — but the flag is reset to `false` *before* the recursive call, so the recursion is fine. Still, the four boolean state vars (`bootstrapped`, `shuttingDown`, `isRestoreMaintenanceActive()`, `bootstrapContinuationScheduled`) gating entry are subtle.
- Suggested fix: None; document the invariant.

### C7L-ARCH-04 — `restore-maintenance` is process-local across multiple files
- File: `apps/web/src/lib/restore-maintenance.ts`
- Severity: INFO
- Confidence: Medium
- Issue: `CLAUDE.md` explicitly notes this is single-instance topology. Every mutating action calls `getRestoreMaintenanceMessage` and `isRestoreMaintenanceActive`, which is correct under the single-writer constraint. No issue.
