# critic — cycle 10 rpl

HEAD: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

Multi-perspective critique.

## Findings

### C10R-RPL-CR01 — Inconsistent rate-limit ordering across mutating actions [LOW / HIGH]

After cycle 9 rpl fixed `updatePassword`, the actions with rate-limit gates have this inconsistency:

| Action | Validate before increment? | Reference |
|---|---|---|
| `login` | YES | `auth.ts:83-89` |
| `updatePassword` | YES (fixed cycle 9) | `auth.ts:288-306` |
| `createAdminUser` | NO | `admin-users.ts:83-125` |
| `searchImagesAction` | N/A (no extract-validate) | `public.ts:36-37` |
| `createPhotoShareLink` | YES | `sharing.ts:100-115` |
| `createGroupShareLink` | YES | `sharing.ts:200-231` |

`createAdminUser` is the odd one out. AGG9R-RPL-01's fix established the pattern; completing the fleet would remove a reader's "why is this one different?" moment and close the cycle 9 AGG9R-RPL-02 deferral naturally.

Confidence: High.

### C10R-RPL-CR02 — Deferred items list is growing without periodic reaping [LOW / MEDIUM]

`plan-218-deferred-cycle9-rpl.md` lists 19 deferred items. Several are "convenience cleanup" observational findings that could be batched into a single "janitor" cycle (e.g. dead code removal, comment improvements). The deferred queue should not grow monotonically; periodic reaping keeps future reviewers from re-flagging the same items each cycle.

Proposed: In this cycle (10), explicitly close 2-3 of the easiest deferred items with one commit each. Candidates:
- AGG9R-RPL-02 (createAdminUser ordering — now C10R-RPL-01)
- AGG9R-RPL-04 (docs) — VERIFIED ALREADY DONE in CLAUDE.md:125.
- AGG9R-RPL-05 (docs) — VERIFIED ALREADY DONE in CLAUDE.md:190-191.

For AGG9R-RPL-04 and AGG9R-RPL-05, the plan-218 deferral notes are now stale and should be removed. This also demonstrates the carry-forward discipline.

Confidence: Medium.

### C10R-RPL-CR03 — Naming: `passwordChangeRateLimit` vs `shareRateLimit` vs `loginRateLimit` vs `searchRateLimit` — no shared abstraction [LOW / LOW]

Each rate-limit Map has its own prune function, own reset function, own rollback function, own key-eviction logic. Slight duplication but each has its own key shape and scope, so a shared abstraction would be non-trivial. Not actionable this cycle — but worth flagging as a potential refactor vector once a fifth rate-limit bucket is added.

Confidence: Low.

## Summary

- 3 findings, all LOW.
- Primary ask: close the createAdminUser ordering deferral this cycle (consistency win).
- Secondary: clean up stale deferral notes in plan-218 that are in fact already satisfied.
