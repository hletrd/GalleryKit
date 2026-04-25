# Verifier review — cycle 7 RPF

## Inventory / coverage
I reviewed the full change set and the directly coupled rules/docs/tests instead of sampling:

- Root docs/configs: `README.md`, `CLAUDE.md`, root `package.json`, `apps/web/package.json`
- Changed execution/config files: `apps/web/playwright.config.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/e2e/admin.spec.ts`
- Changed source files: all files in the HEAD diff under `apps/web/src/app/**`, `apps/web/src/components/**`, `apps/web/src/lib/**`
- Changed tests: all files in `apps/web/src/__tests__` touched by the diff
- Exhaustive action-surface check: every `apps/web/src/app/actions/*.ts` file plus `apps/web/src/app/[locale]/admin/db-actions.ts`

Verification run:
- `npm run lint:action-origin --workspace=apps/web` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅
- `npx vitest run src/__tests__/auth-rate-limit-ordering.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/client-source-contracts.test.ts src/__tests__/content-security-policy.test.ts src/__tests__/images-actions.test.ts src/__tests__/locale-path.test.ts src/__tests__/public-actions.test.ts src/__tests__/rate-limit.test.ts src/__tests__/topics-actions.test.ts` ✅ (96 tests passed)
- `npm run typecheck --workspace=apps/web` ✅

No relevant file in the reviewed surface was skipped.

## Findings

### 1) CLAUDE still documents getter auto-exemptions that the scanner no longer honors
**Severity:** Medium  
**Confidence:** High  
**Status:** confirmed

**Evidence**
- `CLAUDE.md:241-244` still says `lint:action-origin` “Auto-exempts read-only getters (name matches ^get[A-Z])”
- `apps/web/scripts/check-action-origin.ts:28-32` now says getter-style names are **not** automatically trusted
- `apps/web/scripts/check-action-origin.ts:170-183` only exempts an export when it has a leading `@action-origin-exempt` comment
- `apps/web/src/__tests__/check-action-origin.test.ts` was updated to require explicit exemptions for `getFoo`

**Why this is a problem**
The repo’s operator docs and the actual lint gate now disagree. A maintainer following CLAUDE will assume a `get*` server action is auto-exempt, omit the comment, and then hit CI failure.

**Failure scenario**
A future contributor adds a new read-only admin action like `export async function getFoo()` under `apps/web/src/app/actions/`. The docs imply it is auto-exempt, but the scanner rejects it unless it carries `/** @action-origin-exempt: ... */`.

**Suggested fix**
Update CLAUDE’s `lint:action-origin` section to remove the auto-exempt claim and explicitly require `@action-origin-exempt` for every read-only export, or reintroduce the auto-exempt behavior in the scanner and tests if that was the intended policy.

---

### 2) Load-more throttling conflates “rate limited” with “no more images”, so the infinite scroll can die early
**Severity:** Medium  
**Confidence:** High  
**Status:** confirmed

**Evidence**
- `apps/web/src/app/actions/public.ts:85-95` returns `{ images: [], hasMore: false }` when the new `load_more` limiter trips
- `apps/web/src/components/load-more.tsx:36-42` blindly copies `page.hasMore` into component state
- `apps/web/src/components/load-more.tsx:91-97` removes the sentinel/button when `hasMore` becomes false

**Why this is a problem**
`hasMore: false` means two different things now: “there are no more results” and “the request was throttled.” The client treats both as terminal, so once the new limiter trips the UI stops offering load-more entirely, even though the gallery may still have more images and the 60-second quota will later reset.

**Failure scenario**
A user scrolls quickly through a large gallery, hits the 120-request minute cap, and receives a throttle response. The button disappears and the observer disconnects, so they cannot continue loading older photos without reloading the page.

**Suggested fix**
Return a distinct throttling signal from `loadMoreImages` (for example `rateLimited: true` or an error payload) and keep `hasMore` unchanged on throttle. The client should surface a retry toast/banner instead of interpreting the throttle as end-of-list.

---

### 3) Rate-limit rollback can target the wrong MySQL bucket across a window boundary
**Severity:** Low  
**Confidence:** Medium  
**Status:** likely

**Evidence**
- `apps/web/src/app/actions/public.ts:89-95` rolls back a throttled `load_more` attempt after the DB check fails the limit
- `apps/web/src/lib/rate-limit.ts:184-227` computes the bucket start from `Date.now()` inside `incrementRateLimit()`
- `apps/web/src/lib/rate-limit.ts:251-277` computes the bucket start again inside `decrementRateLimit()`

**Why this is a problem**
The request path does not pin the bucket start once. If a request begins near the minute boundary, increments bucket A, and the rollback runs after the boundary flips, `decrementRateLimit()` will operate on bucket B instead of bucket A. That leaves bucket A inflated and bucket B potentially decremented even though it was never incremented.

**Failure scenario**
A throttled request lands right before a minute rollover. The increment is recorded in the old bucket, but the rollback is computed in the new bucket. The old bucket keeps an extra count and the caller is blocked longer than intended.

**Suggested fix**
Capture the bucket start once per request and thread it through increment/check/rollback, or add bucket-start-aware helpers so rollback always mutates the same window that was incremented.

## Final sweep
I rechecked the changed files, the full action surface, and the updated tests/lint gates after the scan. No additional relevant file was skipped, and the remaining issues above are the ones I would keep open.
