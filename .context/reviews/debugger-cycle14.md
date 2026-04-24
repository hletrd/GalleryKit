# Debugger — Cycle 14 (current run)

**Reviewer:** debugger (latent bug surface, failure modes, regressions)
**Scope:** Edge-case branches, error-handling code paths, swallow-vs-rethrow patterns.

## Methodology

Combed the catch / `.catch(() => {})` / `if (err) ...` branches for swallowed signals. Looked specifically at:
- Every `console.debug(...)`-only catch.
- Every `await ... .catch(() => {})` swallow.
- Every "best-effort cleanup" branch (image variants, .tmp files, audit log).
- Every `unstable_rethrow` site to confirm Next.js control-flow signals are still rethrown.

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| (none new) | Earlier hardening (narrowing `cleanOrphanedTmpFiles` catch, logging RELEASE_LOCK failures, capturing bytesRead, decoding only the actually-read prefix) is all still in place. | — | — | — |

### Re-evaluation of historical 2026-04-19 findings

| Historical ID | Status against current code |
|---------------|------------------------------|
| DBG-14-01 (queue verify-fail stuck state) | Current code returns without throw. Bootstrap on restart re-enqueues. DEFER (C14-DEFER-01). |
| DBG-14-02 (queue cleanup misses original) | NOT a finding — `deleteImage` already cleaned the original before queue notices. |
| DBG-14-03 (`processImageFormats` no `ensureDirs`) | Re-checked: `bootstrapImageProcessingQueue` does NOT call `ensureDirs`, but the queue's `processImageFormats` would crash on ENOENT and the retry loop would fire. On a fresh container, the entrypoint chowns the upload directories, but does not create them. However, `saveOriginalAndGetMetadata` creates them on first upload (line 50-53 of `process-image.ts`). The narrow window is "container starts with pre-existing DB rows but no on-disk dirs" — typically only after a DB restore that includes images whose files are missing. DEFER (very narrow window; bootstrap retry covers it). |
| DBG-14-04 (queue cleanup uses default sizes) | DEFER (C14-DEFER-02). |
| DBG-14-05 (updatePassword validation order) | ALREADY FIXED in current code (auth.ts:288-306). |
| DBG-14-06 (createAdminUser validation order) | ALREADY FIXED in current code (admin-users.ts:97-104). |
| DBG-14-07 (storage_backend DB/runtime inconsistency) | NOT APPLICABLE — no `storage_backend` admin setting exists. |
| DBG-14-08 (`batchAddTags` missing per-image revalidation) | Re-checked `apps/web/src/app/actions/tags.ts:315-317`. Still uses layout-level `revalidateAllAppData()` only. The other batch operations (deleteImages line 557 for >20) use the same pattern. Not a regression — consistent with the documented "batch operations use layout-level revalidation" pattern in CLAUDE.md. NOT a finding. |
| DBG-14-09 (hardcoded `_640`) | ALREADY FIXED — search.tsx uses `sizedImageUrl(...)`. |
| DBG-14-10 (missing `imageUrl()` wrapper) | ALREADY FIXED. |
| DBG-14-11 (queueConcurrency setting not applied) | NOT APPLICABLE — no `queueConcurrency` admin setting. |
| DBG-14-12 (shutdown exits 0 on timeout) | DEFER (C14-DEFER-03). |
| DBG-14-13 (OptimisticImage retry stale closure) | DEFER (C14-DEFER-04). |
| DBG-14-14 (InfoBottomSheet shouldClose side effect) | DEFER (C14-DEFER-05). |
| DBG-14-15 (LoginForm error toast re-fires) | DEFER (C14-DEFER-06). |
| DBG-14-16 (S3 GC) | NOT APPLICABLE — no S3 backend. |
| DBG-14-17 (S3 CopySource encoding) | NOT APPLICABLE. |
| DBG-14-18 (LocalStorageBackend.resolve allows root) | DEFER (C14-DEFER-07). |
| DBG-14-19 (seed.ts unhandled rejection) | DEFER (C14-DEFER-08). |

### Specific re-checks

- **`cleanOrphanedTmpFiles` ENOENT-only swallow.** `apps/web/src/lib/image-queue.ts:48-62` — narrows the catch to `code === 'ENOENT'`.
- **`releaseImageProcessingClaim` failures.** `apps/web/src/lib/image-queue.ts:296-298` logs at `console.debug`. Acceptable.
- **`unstable_rethrow` in auth.** Both `login` and `updatePassword` call `unstable_rethrow(e)` before the generic-failure fallback.
- **Restore stdin error filter.** `apps/web/src/lib/db-restore.ts` filters out the expected stdin EPIPE.
- **Backup writeStream flush.** `apps/web/src/app/[locale]/admin/db-actions.ts:165-209` waits for `writableFinished`.

## Verdict

No latent bugs to file as must-fix. All previously-flagged HIGH-severity items are either already fixed or do not apply to current code; remaining LOW items are deferred with exit criteria.
