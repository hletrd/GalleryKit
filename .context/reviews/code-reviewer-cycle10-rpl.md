# code-reviewer — cycle 10 rpl

HEAD: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

Scope: full repo, focus on logic, SOLID, maintainability, plus carry-forward verification of items deferred in cycle 9 rpl (plan-218).

## Findings

### C10R-RPL-01 — `createAdminUser` rate-limit ordering is the same class of bug fixed in cycle 9 for `updatePassword` [LOW / HIGH]

File: `apps/web/src/app/actions/admin-users.ts:83-125`.

Cycle 9 rpl identified this as AGG9R-RPL-02 and deferred it because "action is only reachable by already-authenticated admins, so self-DoS scope is narrow." The cycle 9 rpl fix for `updatePassword` (AGG9R-RPL-01) sets the precedent: validate form-field shape FIRST, then burn rate-limit budget. Current `createAdminUser` still increments BEFORE validating username/password length/format. Even if scope is narrow, the fix class is identical, the risk is zero, and keeping the asymmetry means future readers ask "why does this one work differently." Small consistency win.

Proposed: Move the four extract + validate blocks (rawUsername/username/password/confirmPassword extraction + regex + length bounds + password mismatch) from lines 107-125 up to just after `requireSameOriginAdmin()` and `getRestoreMaintenanceMessage()`, BEFORE the `checkUserCreateRateLimit(ip)` call at line 83.

Test: Add to `admin-users.test.ts`: invoke `createAdminUser` with too-short username 20 times; assert the user_create rate-limit entry count stays at 0.

Confidence: High. Exact same pattern as AGG9R-RPL-01.

### C10R-RPL-02 — `sharing.ts` catch blocks can swallow NEXT_REDIRECT / NEXT_NOT_FOUND signals if future refactors introduce them [LOW / MEDIUM]

File: `apps/web/src/app/actions/sharing.ts:170-181, 281-306, 373-386`.

Only `auth.ts` uses `unstable_rethrow` (4 occurrences). If a future refactor puts `redirect()`, `notFound()`, or any dynamic-rendering bailout inside `createPhotoShareLink`, `createGroupShareLink`, or the group-rename path — or inside helpers they call (e.g. `logAuditEvent`, `revalidateLocalizedPaths`, `getCurrentUser`) — the catch-all branches that return `{ error: ... }` would silently swallow the signal and the admin sees a toast instead of the intended navigation.

This matches the same defensive pattern added to `updatePassword` in `auth.ts:399` (cycle 5 rpl C2R-01). It's a "future-proofing" fix; currently no code paths trigger the signals.

Proposed: Add `unstable_rethrow(e)` as the first statement in each `catch (e)` block in `sharing.ts`, `topics.ts`, `tags.ts`, `admin-users.ts` that currently does not have it AND whose try-block calls `revalidateLocalizedPaths`, `redirect`, `notFound`, `revalidateAllAppData`, or `revalidateTag` (directly or transitively via a helper).

Confidence: Medium. Currently not reproducible; future-proofing only.

### C10R-RPL-03 — `searchImages` internal length check at data.ts:727 is defense-in-depth, not dead code [LOW / LOW]

File: `apps/web/src/lib/data.ts:727`.

Cycle 9 rpl flagged this as "dead code" (AGG9R-RPL-10). But `searchImages` is exported publicly and could be called directly by future server-action paths that skip `searchImagesAction`. The check provides a cheap defense if any future caller bypasses the 200-char slice. Recommend KEEPING this check and adding a comment explaining it's defense-in-depth.

Proposed: Keep the check, add a one-line comment: `// Defense-in-depth: caller in actions/public.ts already caps to 200, but we re-check so any future direct caller of this helper inherits the cap.`

Confidence: Low (observational only).

### C10R-RPL-04 — CLAUDE.md "Image Upload Flow" section lists JPEG conversion as step 3 without noting async timing [LOW / LOW]

File: `CLAUDE.md:109-115`.

The text says "3. Sharp processes to AVIF/WebP/JPEG (async queue)" followed by "4. EXIF extracted and stored in database." But in actual flow, EXIF extraction happens DURING Sharp processing (extracted inside the worker). Minor wording ambiguity only.

Proposed: Reorder or reword: "3. Async queue (PQueue, concurrency 1) claims the image and runs Sharp in parallel AVIF/WebP/JPEG transforms while extracting EXIF in the same worker. 4. Processed files written under `public/uploads/{avif,webp,jpeg}/` and the row is marked processed=true."

Confidence: Low. Doc-only.

### C10R-RPL-05 — `pruneShareRateLimit` has no cadence throttle (AGG9R-RPL-09 carry-forward) [LOW / MEDIUM]

File: `apps/web/src/app/actions/sharing.ts:36-50`.

Cycle 9 rpl deferred this pending a "third rate-limited action in this area." Still worth adding a 1-second cadence (matching `pruneSearchRateLimit`) given the pruning work is negligible but called on every share-link creation. No correctness impact either way.

Proposed: Add a `lastShareRateLimitPrune` module-level timestamp and short-circuit prune calls within 1 second of the last.

Confidence: Medium. Carry-forward from cycle 9.

## Summary

- 1 LOW / HIGH finding (consistency fix): C10R-RPL-01.
- 3 LOW findings observational / future-proofing: C10R-RPL-02, C10R-RPL-03, C10R-RPL-04.
- 1 carry-forward: C10R-RPL-05.
