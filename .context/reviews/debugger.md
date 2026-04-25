# Debugger — Cycle 7 (review-plan-fix loop, 2026-04-25)

## Lens

Bug hunt: latent runtime errors, edge cases, ordering bugs.

## Findings

### C7L-DBG-01 — Duplicate `tagsString.split(',')` is a brittle parallel-parse hazard
- File: `apps/web/src/app/actions/images.ts:141-149`
- Severity: LOW
- Confidence: High
- Bug class: Brittle parallel parsing
- Failure scenario: A future edit that changes filter rules in line 142 (e.g. supports `;` as a separator, or relaxes a length bound) but not line 147 creates a count mismatch that erroneously aborts every upload.
- Repro path: Modify line 142 to permit semicolon. Line 147 still uses `,`. Counts diverge → `invalidTagNames` for every batch with a semicolon-separated tag.
- Fix: Single split, derive both counts from the same array.

### C7L-DBG-02 — `images.ts:147` filter is consistent with line 142
- File: `apps/web/src/app/actions/images.ts:147`
- Severity: INFO
- Confidence: Medium
- Issue: `tagsString.split(',').filter(t => t.trim().length > 0)` accepts whitespace-only tags as zero. The line-142 filter applies `.map(t => t.trim())` then checks `t.length > 0`. Both passes are consistent — same set excluded.
- Status: NOT A BUG.

### C7L-DBG-03 — `getProcessingQueueState` global symbol survives HMR
- File: `apps/web/src/lib/image-queue.ts:67,113-132`
- Severity: INFO
- Confidence: Medium
- Issue: `processingQueueKey` is `Symbol.for(...)`, persistent across module reloads. In `next dev` HMR, a code change to `image-queue.ts` keeps the running queue alive while new module imports rebuild around the old PQueue instance. PQueue instance survives and is shared. Intentional.
- Status: NOT A BUG.

### C7L-DBG-04 — `cleanOrphanedTmpFiles` swallows non-ENOENT errors at warn level
- File: `apps/web/src/lib/image-queue.ts:62`
- Severity: INFO
- Confidence: High
- Status: Already handled correctly per C8R-RPL-04 lineage in the comment block. **No bug.**

## No active runtime regressions detected.
