# code-reviewer — cycle 9 rpl

HEAD: `00000002ad51a67c0503f50c3f79c7b878c7e93f` (master clean).

Inventory scanned:
- `apps/web/src/app/actions/*.ts` (images, public, auth, admin-users, tags, topics, sharing, settings, seo)
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/**`
- `apps/web/src/app/api/**`
- `apps/web/scripts/check-action-origin.ts`, `check-api-auth.ts`
- `apps/web/src/components/search.tsx`, `photo-viewer.tsx`, `info-bottom-sheet.tsx`

## New findings

### C9R-RPL-01 — `updatePassword` validation errors bypass rate-limit rollback [MEDIUM / HIGH]
- `apps/web/src/app/actions/auth.ts:297-326`.
- The pre-increment of both in-memory and DB `password_change` buckets happens at lines 298-301. The early-return validation errors that follow (empty field at 312-314, mismatch at 316-318, too short at 320-322, too long at 324-326) return before the `try` block starts at 328, so the pre-incremented counter is not rolled back on these paths.
- Concrete failure scenario: an authenticated admin mistypes the confirm-password ten times within the 15-minute window and is then locked out with `tooManyAttempts` even though no Argon2 verify ever ran and no infrastructure error occurred. The lockout is purely self-inflicted by a client-side typo.
- Compare `login` at lines 83-89: empty-field validation runs BEFORE the rate-limit increment so a client that forgets a field does not pay a rate-limit attempt.
- Fix: Move the three form extractions (currentPassword / newPassword / confirmPassword) plus their four validations above the rate-limit pre-increment block, matching the `login` ordering. Alternatively, wrap each validation-error return with `rollbackPasswordChangeRateLimit(ip)`.

### C9R-RPL-02 — `checkShareRateLimit` always calls `pruneShareRateLimit` on every request [LOW / MEDIUM]
- `apps/web/src/app/actions/sharing.ts:54-67` (pruneShareRateLimit called unconditionally at line 55).
- `pruneShareRateLimit` at lines 36-50 does O(n) scan of the share rate-limit map on every share-link create. `search` and `login` throttle their prune cadence (lastSearchRateLimitPruneAt in rate-limit.ts), but `share_photo` / `share_group` do not. With 500 active entries a burst of share-link creates stacks 500-iteration prunes per call.
- Fix: Add a lastShareRateLimitPruneAt cadence (1s) identical to `pruneSearchRateLimit`. LOW impact because ceiling is 500 entries but the pattern is inconsistent with the rest of the codebase.

### C9R-RPL-03 — `searchImages` internal `query.length > 200` check operates on unsanitized input [LOW / LOW]
- `apps/web/src/lib/data.ts:727`.
- `searchImagesAction` already sanitizes and slices the query to 200 chars before calling `searchImages`, so the internal check is dead code for the normal call path. For any direct internal call site the length check runs on pre-sanitization input, which duplicates the C46-02 class. Currently there are no direct callers outside `searchImagesAction`, so exploitable impact is zero.
- Fix: Drop the redundant check, or comment it as defense-in-depth with a justification. Cosmetic.

### C9R-RPL-04 — `PhotoViewer` declares render branches for fields the public query never returns [LOW / HIGH]
- `apps/web/src/components/photo-viewer.tsx:463-475`.
- `hasExifData(image.original_format)` and `image.original_file_size` render blocks are reachable only when those keys are present. `publicSelectFields` intentionally omits both keys (see data.ts:169-174 privacy comment). `PhotoViewer` is rendered from `/p/[id]`, `/s/[key]`, and `/g/[key]` — all public routes. Net effect: these UI branches are permanently dead on every route that actually mounts `PhotoViewer`.
- Impact: not a bug — the conditional gracefully hides the section. But the code fails to communicate that dead-branch intent, and a reviewer refactoring `publicSelectFields` later will not know these rows are expected to be undefined.
- Fix: either a) add `original_format` / `original_file_size` to the admin-only preview viewer (currently not a feature) and remove from `PhotoViewer`; b) add a comment to the photo-viewer block explaining the public/admin split.

### C9R-RPL-05 — `flushGroupViewCounts` logs wrong failure count on partial failure [LOW / MEDIUM]
- `apps/web/src/lib/data.ts:82-89`.
- `consecutiveFlushFailures++` runs only if `succeeded === 0 && batch.size > 0`. In a partial-failure scenario (e.g., 15/20 succeed, 5 failed and were re-buffered), the counter resets to zero — even though some work genuinely couldn't be flushed. On the next flush attempt the backoff interval is fully reset.
- Observable impact: under sustained partial flush failure the backoff never kicks in, so the DB keeps getting hammered at base interval (5s). This is not common but would turn into an un-bounded retry if, say, one specific shared group row is deadlocked.
- Fix: bump `consecutiveFlushFailures` whenever any entry was re-buffered, not only on total-failure. Or: track per-group retry counts and drop after N attempts.

## Previously flagged items — confirmed still present / status

- AGG5R-07 (`getImages` heavy JOIN+GROUP BY is dead code for all callers): CONFIRMED DEAD at `data.ts:398`. `rg '\bgetImages\s*\('` yields only the definition. Status: still deferred per plan `plan-149-cycle4-rpl-fixes.md`.
- AGG5R-17 (`getTopicBySlug` alias lookup uses 2 SELECTs): unchanged at `data.ts:672-705`. Still deferred.
- C46-01, C46-02: FIXED. `images.ts:103` and `public.ts:36` now apply `stripControlChars` before the length check.

## Confidence calibration
- C9R-RPL-01: HIGH confidence — trivially reproducible by reading the code path.
- C9R-RPL-02: MEDIUM — pattern inconsistency; real but small impact.
- C9R-RPL-03, C9R-RPL-04: LOW — cosmetic / defense-in-depth.
- C9R-RPL-05: MEDIUM — depends on failure-mode assumptions.
