# Debugger — Cycle 44 (2026-04-20)

## Review Scope
Latent bug surface, failure modes, race conditions, and regression risks across the full codebase.

## New Findings

### D44-01: `updateTopic` does not validate `currentSlug` against `stripControlChars` [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/topics.ts` lines 98-101
**Description:** The `currentSlug` parameter is validated with `isValidSlug()` but not sanitized with `stripControlChars`. While `isValidSlug` only allows `[a-z0-9_-]` (which excludes control characters), this is inconsistent with the defense-in-depth pattern applied to all other user inputs. If the slug validation is ever relaxed, control characters in `currentSlug` would reach the DB `WHERE` clause directly.
**Fix:** Apply `stripControlChars(currentSlug)` before the `isValidSlug` check.

### D44-02: `deleteTopic` slug parameter not sanitized with `stripControlChars` [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/topics.ts` line 189
**Description:** Same pattern as D44-01 — the `slug` parameter is validated with `isValidSlug()` but not `stripControlChars`. Consistency fix only; no exploitable bug since `isValidSlug` already rejects control characters.

### D44-03: `processImageFormats` unlink-before-link .tmp cleanup may miss files on hard crash [LOW] [LOW confidence]
**File:** `apps/web/src/lib/process-image.ts` lines 380-395
**Description:** The `.tmp` file cleanup in the `finally` block (`await fs.unlink(tmpPath).catch(() => {})`) handles normal flow. The `cleanOrphanedTmpFiles` in `image-queue.ts` handles crash recovery. However, if the process crashes between `fs.link(outputPath, tmpPath)` and `fs.rename(tmpPath, basePath)`, the `.tmp` file persists but is cleaned up on next boot. This is already handled. No new issue — just confirming existing mitigation works.

## Verified as Fixed (from prior cycles)

- C43-01 (locale passthrough): Fixed.
- CR43-02 (escapeCsvField): Fixed.

## No High or Medium Latent Bugs Found

The codebase has robust error handling: transactions for atomicity, conditional WHERE for race conditions, retry loops for key collisions, and proper cleanup in catch/finally blocks. No new high-severity latent bugs identified.
