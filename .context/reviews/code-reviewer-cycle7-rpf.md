# Deep Code Review — cycle 7 RPF

## Scope / inventory coverage

I built a file-by-file inventory and covered **266 review-relevant text files** in this repo slice:

- **55** app route/action files (`apps/web/src/app/**`)
- **48** library files (`apps/web/src/lib/**`)
- **45** components (`apps/web/src/components/**`)
- **59** unit tests (`apps/web/src/__tests__/**`)
- **6** Playwright/e2e files (`apps/web/e2e/**`)
- **14** scripts (`apps/web/scripts/**`)
- **7** Drizzle migration/meta files (`apps/web/drizzle/**`)
- **2** locale message files (`apps/web/messages/*.json`)
- **22** repo/docs/config files (`README.md`, `CLAUDE.md`, package/config/docker/nginx/workflow files, etc.)
- **3** DB files + **1** i18n file + **4** other `src/` files

Excluded from review scope: binary/image/font assets, `node_modules/`, `.context/`, `plan/`, and generated test artifacts.

### Verification / evidence

- `git diff --name-status HEAD` → no unstaged source diff under review
- `npm --prefix apps/web test` → **59/59 test files passed, 369/369 tests passed**
- `npm --prefix apps/web run typecheck` → passed
- `npm --prefix apps/web run lint` → passed
- Repo-wide sweeps run for common review misses (`console.log`, empty catches, hardcoded secrets, TODO/FIXME/HACK, origin/auth lint scripts, public-action rate-limit paths, upload contract paths)

No relevant file category was skipped; after the main sweep I did a second pass to include `apps/web/drizzle/**` and `apps/web/messages/**` explicitly.

## Findings

### 1. [MEDIUM] [confirmed] Load-more treats temporary throttling/maintenance as “end of list”, so the UI can permanently hide pagination until refresh
- **Confidence:** High
- **Files:**
  - `apps/web/src/app/actions/public.ts:67-95`
  - `apps/web/src/components/load-more.tsx:30-41, 89-98`
  - `apps/web/src/__tests__/public-actions.test.ts:95-121`

**Why this is a problem**

`loadMoreImages()` returns the same payload shape for three very different states:

- real terminal pagination (`{ images, hasMore: false }`)
- restore maintenance short-circuit (`{ images: [], hasMore: false }`)
- rate-limit rejection (`{ images: [], hasMore: false }`)

`LoadMore` then does `setHasMore(page.hasMore)` unconditionally. That means a transient operational state is interpreted as a permanent pagination fact.

**Concrete failure scenario**

A user scrolls quickly, trips the anonymous load-more limiter, and the server returns `{ images: [], hasMore: false }`. The client hides the “Load more” control because it thinks the gallery is exhausted. Even after the limiter window expires, the user cannot retry unless they manually reload the entire page.

The same happens during a restore-maintenance window: the gallery can incorrectly look complete instead of temporarily unavailable.

**Suggested fix**

Return a discriminated result instead of overloading `hasMore` for error states, e.g.

- `{ kind: 'ok', images, hasMore }`
- `{ kind: 'throttled' }`
- `{ kind: 'maintenance' }`

Then only update `hasMore` on the `'ok'` path. For transient states, keep the sentinel/button available and show a retry/toast state instead.

---

### 2. [MEDIUM] [confirmed] Search conflates rate-limit/maintenance responses with genuine “no results”, so users get a false empty-state message
- **Confidence:** High
- **Files:**
  - `apps/web/src/app/actions/public.ts:112-163`
  - `apps/web/src/components/search.tsx:53-80, 224-233, 270-273`
  - `apps/web/src/__tests__/public-actions.test.ts:135-145`

**Why this is a problem**

`searchImagesAction()` returns `[]` for:

- restore maintenance
- rate-limit exhaustion
- invalid/too-short queries
- actual zero-match searches

The client treats any resolved array as a successful search and renders `search.noResults` when the array is empty.

**Concrete failure scenario**

During a restore or after hitting the search limiter, the modal tells the user there are “no results” for a query that actually does have matches. That is misleading, masks operational state, and makes debugging/support much harder because the UI looks healthy while the server is intentionally refusing work.

**Suggested fix**

Use the same kind of discriminated result recommended above, or throw/return an explicit error object for maintenance/throttle states. The UI should reserve “no results” for successful empty searches only, and render a different message for temporary unavailability.

---

### 3. [LOW] [confirmed] Upload duplicate-replacement is a stale contract: UI and translations promise replacement, but the server never reports or performs it
- **Confidence:** High
- **Files:**
  - `apps/web/src/components/upload-dropzone.tsx:196-267`
  - `apps/web/src/app/actions/images.ts:351-356`
  - `apps/web/messages/en.json:139`
  - `apps/web/messages/ko.json:139`
  - `apps/web/src/db/schema.ts:28,65`

**Why this is a problem**

The upload UI still carries a “duplicate filenames replaced” flow:

- client accumulates `duplicateFiles`
- shows `upload.duplicateWarning`
- translations explicitly say duplicates were replaced

But `uploadImages()` always returns `replaced: []`, and the schema only has a non-unique index on `user_filename`, so there is no actual replacement/deduplication path here.

**Concrete failure scenario**

An admin re-uploads a photo with the same filename expecting either replacement or at least an explicit duplicate warning. Instead, the system silently creates another image row and the promised warning path never runs. Over time this can create confusing duplicate entries while the product copy suggests the opposite behavior.

**Suggested fix**

Pick one contract and make all layers match it:

- **If replacement is intended:** implement duplicate detection server-side (filename or, better, content hash), populate `replaced`, and add tests.
- **If replacement is not intended:** delete the dead `replaced` branch and update translations/UI copy so they no longer claim replacement behavior.

## Final sweep / missed-issue check

Final pass covered the common miss buckets again:

- same-origin/auth lint scripts
- transient state vs. UI contract mismatches
- upload/result-shape drift
- migrations/messages/config consistency
- dead/stale comments/contracts

I did **not** find additional high-severity logic defects in the current tree after the lint/typecheck/test pass. The three issues above are the ones I would carry forward from this review.

## Recommendation

**REQUEST CHANGES**

Reason: the top two issues are user-visible logic bugs caused by response-shape ambiguity across server/client boundaries, and the upload duplicate contract is currently misleading/stale.
