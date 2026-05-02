# Aggregate Review — Cycle 18

## Review method

Direct deep review of all source files by a single agent. All key modules
examined: rate-limit, image-queue, data, sanitize, validation, proxy,
session, auth, api-auth, action-guards, images actions, public actions,
sharing, admin-users, db-actions, settings, lightbox, photo-viewer,
content-security-policy, request-origin, bounded-map.

## GATE STATUS (all green)

- eslint: clean
- tsc --noEmit: clean
- build: success (after NFS stale-handle cleanup)
- vitest: 574 tests passing (84 test files)
- lint:api-auth: OK
- lint:action-origin: OK

---

## Findings (sorted by severity)

### MEDIUM severity

#### C18-MED-01: `searchImagesAction` re-throws on DB error — unhandled server action error
- **Source**: Direct code review of `apps/web/src/app/actions/public.ts:173-176`
- **Location**: `searchImagesAction()` catch block
- **Issue**: After rolling back the rate limit, the function `throw err` on DB failure. Server actions that throw produce a generic "An error occurred" toast on the client with no useful context. The `loadMoreImages` action in the same file was fixed in C2-MED-02 to return a structured error instead of throwing, but `searchImagesAction` still throws. This inconsistency means search failures are harder for users to recover from.
- **Fix**: Return `{ status: 'error', results: [] }` instead of throwing, matching the `loadMoreImages` pattern.
- **Confidence**: High

#### C18-MED-02: `permanentlyFailedIds` `notInArray` with empty spread on first bootstrap
- **Source**: Direct code review of `apps/web/src/lib/image-queue.ts:436-438`
- **Location**: `bootstrapImageProcessingQueue()` WHERE clause builder
- **Issue**: When `permanentlyFailedIds` is empty (fresh start), `notInArray(images.id, [...state.permanentlyFailedIds])` creates a `notInArray(images.id, [])`. Drizzle compiles `NOT IN ()` to `1=1` on MySQL (always true), which is correct behavior. However, if a future Drizzle version or MySQL strict mode changes this behavior, the empty-array case becomes a silent correctness issue. The existing code is technically correct but fragile — an explicit guard would be safer.
- **Fix**: Add an `if (state.permanentlyFailedIds.size > 0)` guard before pushing the `notInArray` condition (already done at line 436 — verified correct). No action needed; just flagging for awareness.
- **Confidence**: Low (already guarded, informational only)

### LOW severity

#### C18-LOW-01: `UNICODE_FORMAT_CHARS` regex contains literal Unicode characters — editor/encoding fragility
- **Source**: Direct code review of `apps/web/src/lib/validation.ts:51`
- **Location**: `UNICODE_FORMAT_CHARS` regex definition
- **Issue**: The regex `/[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/` contains literal invisible Unicode characters. If a text editor or CI system strips or normalizes these characters (e.g., ASCII-only Git configs, certain diff tools), the regex silently breaks. The `UNICODE_FORMAT_CHARS_RE` in sanitize.ts is derived from this, so both break together. While the existing fixture test catches a complete break, the fragility remains.
- **Fix**: Replace the literal characters with `\uXXXX` escape sequences so the regex is ASCII-safe and editor-portable. E.g., `/[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/`.
- **Confidence**: Medium

#### C18-LOW-02: `getImageByShareKey` runs only 1 parallel query instead of 2
- **Source**: Direct code review of `apps/web/src/lib/data.ts:857-865`
- **Location**: `getImageByShareKey()` function
- **Issue**: After fetching the image, tags are fetched in a `Promise.all` with only one element. This is a minor pattern inconsistency with `getImage()` which fetches tags + prev + next in parallel. The `Promise.all` wrapper is unnecessary for a single promise — it adds microtask overhead. However, this is a very minor perf issue and the pattern is correct.
- **Fix**: Replace `Promise.all([db.select(...)])` with just `db.select(...)` and assign directly to `imageTagsResult`.
- **Confidence**: Low

#### C18-LOW-03: `BoundedMap.prune()` deletes during Map iteration — technically safe but risky pattern
- **Source**: Direct code review of `apps/web/src/lib/bounded-map.ts:97-106`
- **Location**: `BoundedMap.prune()` method
- **Issue**: The prune method iterates over `this.map` entries and calls `this.map.delete(key)` inside the `for...of` loop. Per ES6 spec, deleting entries during `Map.prototype` iteration is safe — the iterator accounts for deletions. However, this pattern can confuse code reviewers and static analysis tools. It's also potentially slower than building a list of keys to delete and then deleting them.
- **Fix**: Collect keys to delete first, then delete them in a separate pass. This makes the intent clearer and avoids any potential issues with future spec changes.
- **Confidence**: Low

### DEFERRED / INFORMATIONAL

- C18-MED-02: `notInArray` empty array guard — already correctly implemented, informational only.
- A17-MED-01: `data.ts` god module — previously deferred, no change.
- A17-MED-02: CSP `style-src 'unsafe-inline'` — previously deferred, no change.
- A17-MED-03: `getImage` parallel DB queries — previously deferred, no change.
- A17-LOW-04: `permanentlyFailedIds` process-local — previously deferred, no change.
- A17-LOW-08: Lightbox auto-hide UX — previously deferred, no change.
- A17-LOW-09: Photo viewer sidebar layout shift — previously deferred, no change.

## Previously fixed findings (confirmed still fixed)

- A1-HIGH-01: Login rate-limit rollback — FIXED
- A1-HIGH-02: Image queue infinite re-enqueue — FIXED
- A1-MED-06: View-count buffer cap — FIXED
- A1-MED-04: sanitizeAdminString returns null — FIXED
- A17-LOW-01: image-manager.tsx catch blocks — FIXED (all have console.warn)
- A17-LOW-02: storage console.log — FIXED (changed to console.debug)
- A17-LOW-03: Claim retry timer unref — FIXED (already had .unref())
- A17-LOW-05: UNICODE_FORMAT_CHARS regex sync — FIXED (derived from import)
- A17-LOW-06: CLAUDE.md "single-user admin" — FIXED (updated to "multiple root admins")
- A17-LOW-07: CLAUDE.md missing auth-rate-limit.ts — FIXED (added to table)
