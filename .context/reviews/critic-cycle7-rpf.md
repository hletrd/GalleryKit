# Critic Review — Cycle 7 RPF

Date: 2026-04-25
Reviewer: critic
Scope: runtime/config/test/doc change surface from `git diff 5d774b1..HEAD` plus directly coupled files needed to validate the new behavior.

## Verdict

**REQUEST CHANGES**

I reviewed the full current-head change surface for the latest implementation commits (`5d774b1..ff0d2f9`) and the associated planning/history docs. I found **3 actionable issues**: one confirmed security-gate bypass in the action-origin scanner, one confirmed UX/runtime regression in the new load-more rate limiting flow, and one docs/runtime contract mismatch in SEO locale validation.

---

## Inventory / coverage

### Rules / docs / history examined
- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/_aggregate.md`
- `plan/done/plan-237-cycle6-rpf-fixes.md`
- `plan/plan-238-cycle6-rpf-deferred.md`
- `apps/web/.env.local.example`

### Config / e2e / i18n examined
- `apps/web/package.json`
- `apps/web/playwright.config.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

### Runtime source examined
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`

### Tests examined
- `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/client-source-contracts.test.ts`
- `apps/web/src/__tests__/content-security-policy.test.ts`
- `apps/web/src/__tests__/images-actions.test.ts`
- `apps/web/src/__tests__/locale-path.test.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/__tests__/rate-limit.test.ts`
- `apps/web/src/__tests__/topics-actions.test.ts`

### Verification steps performed
- Inspected the full runtime/config/test diff for `5d774b1..HEAD`.
- Confirmed the action-origin scanner loophole by executing:
  - `cd apps/web && npx tsx -e "import { checkActionSource } from './scripts/check-action-origin.ts'; ..."`
  - Result: `{"passed":["OK: fixture.ts::deleteFoo"],"failed":[],"skipped":[]}` for a function that calls `requireSameOriginAdmin()` but never checks its return value.
- Cross-checked the load-more server action against the client consumer to verify the returned shape is interpreted as terminal pagination.
- Cross-checked SEO locale validation, locale helper behavior, and user-facing copy.

### Representative task simulations performed
1. **Server-action security gate simulation:** add a new mutating action with `const originError = await requireSameOriginAdmin();` but no `if (originError) return ...`; current scanner still returns OK.
2. **Anonymous gallery pagination simulation:** repeatedly trigger `loadMoreImages()` until rate-limited; action returns `{ images: [], hasMore: false }`, client sets `hasMore` false and permanently removes the sentinel/button until a full refresh.
3. **SEO admin simulation:** save `seo_locale=fr_FR`; validation accepts it, metadata emits `fr_FR`, while the UI/error copy implies only the shipped `en_US` / `ko_KR` values are valid.

---

## Findings

### 1) Action-origin lint still passes actions that ignore the guard result
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** confirmed
- **Files:**
  - `apps/web/scripts/check-action-origin.ts:107-139`
  - `apps/web/scripts/check-action-origin.ts:169-187`
  - `apps/web/src/lib/action-guards.ts:19-43`
  - `apps/web/src/__tests__/check-action-origin.test.ts:29-39,103-111`
- **Why this is a problem:**
  `requireSameOriginAdmin()` is not an enforcing throw; it returns `string | null` and callers must branch on the result. The scanner now only checks for the presence of a top-level call expression/initializer, not whether the action actually **uses** that result to abort execution. That means the security gate can still be bypassed by code like:
  ```ts
  const originError = await requireSameOriginAdmin();
  // forgotten if (originError) return ...
  mutate();
  ```
  I verified this with `checkActionSource()` directly: the scanner reports `OK` for that unsafe pattern.
- **Concrete failure scenario:**
  A future refactor adds a new admin mutation, keeps the `requireSameOriginAdmin()` call for lint appeasement, but accidentally drops the early return. CI passes, and the mutation still runs on a cross-origin request if the framework-level protection regresses or a proxy misconfiguration reintroduces the original risk this lint gate is supposed to catch.
- **Suggested fix:**
  Tighten the scanner to require an **effective guard pattern**, not just a call site. For example, only accept a top-level sequence equivalent to:
  - `const originError = await requireSameOriginAdmin();`
  - followed by `if (originError) return ...;`
  Also add a regression test for the “call result ignored” shape.

### 2) Load-more throttling is surfaced to the client as “no more results”, which dead-ends pagination
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** confirmed
- **Files:**
  - `apps/web/src/app/actions/public.ts:67-109`
  - `apps/web/src/components/load-more.tsx:30-42`
  - `apps/web/src/__tests__/public-actions.test.ts:114-121`
- **Why this is a problem:**
  On rate limit, `loadMoreImages()` returns the exact same shape used for genuine end-of-list states: `{ images: [], hasMore: false }`. The client then unconditionally does `setHasMore(page.hasMore)`, so a temporary throttle is interpreted as a permanent end-of-pagination condition.
- **Concrete failure scenario:**
  A user rapidly scrolls a large gallery, hits the new per-IP load-more throttle, and the UI removes the sentinel/button because `hasMore` becomes `false`. Even after the one-minute window resets, there is no way to continue loading without a full page refresh or changing the query.
- **Suggested fix:**
  Return a distinct shape for throttling, e.g. `{ images: [], hasMore: true, rateLimited: true }` or an explicit `{ error: 'rateLimited' }`, and make `LoadMore` keep pagination alive while showing a toast/backoff message. Add a client-level test for the temporary-throttle path; the current test only locks in the server return shape, which is the source of the bug.

### 3) SEO locale validation accepts values the UI/error copy implies are invalid
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** confirmed
- **Files:**
  - `apps/web/src/app/actions/seo.ts:93-98`
  - `apps/web/src/lib/locale-path.ts:45-66`
  - `apps/web/messages/en.json:328-329,450`
  - `apps/web/messages/ko.json:328-329,450`
- **Why this is a problem:**
  The new validator only checks the regex `/^[a-z]{2}_[A-Z]{2}$/`, so arbitrary values like `fr_FR` or `zz_ZZ` are accepted. But the UI copy and the new error text strongly imply the supported values are the shipped Open Graph locales (`en_US`, `ko_KR`). Runtime behavior and product copy now disagree.
- **Concrete failure scenario:**
  An admin enters `fr_FR`; the save succeeds, and every English/Korean page emits `og:locale=fr_FR`, even though the product has no French locale and the alternates still come from the fixed `en_US`/`ko_KR` map. Operators following the UI copy would reasonably expect that value to be rejected.
- **Suggested fix:**
  Pick one contract and make every layer match it:
  - **Either** restrict overrides to `Object.values(OPEN_GRAPH_LOCALE_BY_LOCALE)` and keep the current copy,
  - **or** keep regex-based acceptance but rewrite the hint/error text to say “must match the pattern `ll_RR`” instead of implying a closed enum.

---

## Final sweep / commonly missed issues

- Re-checked the main cross-file seams touched this cycle: action-origin lint ↔ action-guards, load-more server action ↔ client consumer, SEO admin validation ↔ locale helpers ↔ metadata generation.
- Re-checked the newest tests added for these areas; none of them currently catch the three issues above.
- No additional confirmed issues were found in the remaining reviewed files (`auth.ts`, `images.ts`, `topics.ts`, `content-security-policy.ts`, password metadata, info bottom sheet, upload dropzone, messages, and the touched public metadata routes) beyond the findings listed here.
- Within the scoped change surface described above, **no relevant runtime/config/test/doc files were skipped**.
