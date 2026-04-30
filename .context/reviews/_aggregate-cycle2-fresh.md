# Aggregate Review — Cycle 2 Fresh (2026-04-29)

Repo: `/Users/hletrd/flash-shared/gallery`

Reviewers completed: code-reviewer, perf-reviewer, security-reviewer, critic, verifier (5 of 5 core perspectives). Each reviewer wrote independently to `.context/reviews/<agent-name>.md`.

## Finding summary

| ID | Severity / Confidence | Source(s) | Finding | Plan disposition |
| --- | --- | --- | --- | --- |
| C2-AGG-01 | ~~Medium / High~~ | code-reviewer C2-CR-02, critic AGG1-07, verifier C2-VER-01 | ~~Shared-group view counts increment for intra-share photo navigation~~ **ALREADY FIXED** — `g/[key]/page.tsx:125` passes `{ incrementViewCount: !photoIdParam }` | N/A (already fixed) |
| C2-AGG-02 | Medium / Medium | code-reviewer C2-CR-01, perf-reviewer C2-PERF-01, critic C2-CRIT-01 | `deleteImages` processes file cleanup sequentially per image instead of bounded-parallel (`images.ts:618-636`). | Schedule |
| C2-AGG-03 | Low / Medium | security-reviewer C2-SEC-01, critic C2-CRIT-02 | OG route `tags` param not length-clamped before rendering into OG image JSX (`og/route.tsx:70`). | Schedule |
| C2-AGG-04 | Low / High | code-reviewer C2-CR-03 | `batchUpdateImageTags` string-as-tagNames guard lacks explicit test (`tags.ts:338-408`). | Schedule |
| C2-AGG-05 | Low / Low | critic C2-CRIT-03 | `restoreDatabase` has double `uploadContractLock?.release()` in nested finally blocks (`db-actions.ts:360-366`). | Defer (cosmetic, no functional impact) |

## Cross-agent agreement

- **C2-AGG-01** was a carry-over from AGG1-07 but is already fixed in the current codebase (`g/[key]/page.tsx:125` passes `{ incrementViewCount: !photoIdParam }`). No action needed.
- **C2-AGG-02** is flagged by code-reviewer, perf-reviewer, and critic. The sequential-for-of pattern in `deleteImages` is a clear inefficiency. Schedule bounded-parallel fix.

## Verified fixes from prior cycles (confirmed still present)

| AGG1 ID | Finding | Status |
|---------|---------|--------|
| AGG1-05 | Light destructive button contrast | Verified fixed |
| AGG1-07 | Shared-group view count inflation | **Verified fixed** (`g/[key]/page.tsx:125` passes `incrementViewCount: !photoIdParam`) |
| AGG1-08 | File-serving TOCTOU | Verified fixed |
| AGG1-09 | Settings Record<string,string> | Verified fixed |
| AGG1-10 | batchUpdateImageTags Array.isArray | Verified fixed |
| AGG1-12 | nginx admin mutation throttling | Verified fixed |
| AGG1-21 | Share-key page rate limiting | Verified fixed |
| AGG1-39 | Share rate limit rollback | Verified fixed |

## Agent failures / caveats

- None. All 5 core reviewers completed successfully.
- C2-AGG-01 was a false positive in this cycle — the reviewers re-identified an issue that was already fixed. This highlights the importance of verifying current code state before scheduling implementation.
