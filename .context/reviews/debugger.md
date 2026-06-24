# Cycle 2 Deep Review — Debugger

Date: 2026-06-24
HEAD: 95de4d11

## Summary

No new latent bugs found in cycle 2. The cycle 1 fixes were clean and didn't introduce regressions.

## New Findings (Cycle 2)

### DBG2-01 — `check-action-origin.ts` `walkForActionFiles` throws on missing root

- Severity: Low
- Confidence: High
- Type: Latent failure mode

Evidence: `apps/web/scripts/check-action-origin.ts:57-76` throws if the root directory cannot be read. In CI, this would fail the build loudly (correct). But locally, if a developer runs the script from the wrong directory, the error message might not be clear.

Failure scenario: Developer runs `npx tsx scripts/check-action-origin.ts` from apps/web/ instead of apps/web/src/ and gets an unclear error.

Suggested fix: Add a clearer error message indicating the expected working directory.

## Verified Fixed (from Cycle 1)

- AGG-08: retryFailedImage guards against restore maintenance — prevents stale failure state
- AGG-12: No rate limit refund after expensive work — prevents retry-loop DoS
- AGG-19: Similar photos state reset — component now resets on image id change (8f77189a)
- AGG-20: Similar-photo route regex validation — prevents partial numeric ids
- AGG-39: Hardcoded English error localized — prevents i18n mismatch

## Remaining Open (from Cycle 1)

- AGG-06: DB restore incomplete dumps — can destroy data
- AGG-07: Post-restore async hooks — can corrupt restored data
- AGG-09: Permanent failure state lost on restart — can leave images unprocessed
- AGG-10: Sidecar backfill races — can corrupt derivatives
- AGG-14: Embedding overwrite — can strand photos from search
- AGG-30: Legacy symlink — can expose private originals
