# Critic Review — critic (Cycle 16)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- One medium finding: contradictory comment in image-queue.ts that could cause future regression.
- One low finding: console.log in instrumentation.ts.

## Verified fixes from prior cycles

All prior critic findings confirmed addressed:

1. C15-CRIT-01 / C15-AGG-01 (deleteTopic redundant guard): FIXED.
2. C14-AGG-01 (audit.ts metadata truncation): FIXED.
3. C14-AGG-02 (deleteAdminUser raw SQL rationale): FIXED.

## New Findings

### C16-CT-01 (Medium / Medium). `image-queue.ts` comment contradicts code — directive to NOT reset bootstrapped is immediately violated by the next 3 lines

- Location: `apps/web/src/lib/image-queue.ts:346-352`
- Cross-agent agreement: same finding as C16-CR-01, C16-V-01.
- The comment block at lines 346-349 explicitly says "Do NOT reset bootstrapped / scheduleBootstrapRetry here — that was the old pattern that caused infinite re-enqueue." Yet lines 350-352 do exactly that. This is not just a stale comment — it's an active directive that contradicts the code.
- From a critic's perspective, this is a maintainability risk: a developer reading the comment may trust it and remove lines 350-352, which would prevent the bootstrap from discovering OTHER pending images after a permanent failure. Or a developer may "fix" the code to match the comment, reintroducing the old infinite-loop behavior.
- The root cause appears to be a partial fix: commit ec24cc1 added the `permanentlyFailedIds` exclusion and the comment, but didn't remove the existing `state.bootstrapped = false` + `scheduleBootstrapRetry` lines that were already there from an earlier commit.
- Suggested fix: Update the comment to explain that the bootstrap retry IS correct because `permanentlyFailedIds` prevents the specific failed job from being re-enqueued, and the rescan is needed to discover other pending images.

### C16-CT-02 (Low / Low). `instrumentation.ts` uses `console.log` instead of `console.debug`

- Location: `apps/web/src/instrumentation.ts:9,26`
- Same finding as C16-CR-02.
- Minor inconsistency with the rest of the codebase which uses `console.debug` for operational messages.

## Carry-forward (unchanged — existing deferred backlog)

- AGG6R-06: Restore lock complexity is correct but hard to simplify.
- AGG6R-07: OG tag clamping is cosmetic.
- AGG6R-09: Preamble repetition is intentional defense-in-depth.
