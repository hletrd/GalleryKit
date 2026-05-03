# Code Reviewer — Cycle 1 (RPF, end-only deploy mode)

## Scope
Full code-quality, logic, SOLID, and maintainability review of the gallery
codebase as of HEAD (`e090314`). Focused on reviewing the post-cycle-46
state since the tree has been hardened across 46+ prior cycles.

## Inventory
- `apps/web/src/app/actions/*.ts` (server actions: 14 files)
- `apps/web/src/app/api/**/*.ts(x)` (route handlers)
- `apps/web/src/lib/*.ts` (50+ utility modules)
- `apps/web/src/components/**/*.tsx`
- `apps/web/src/proxy.ts`
- `apps/web/src/__tests__/*.test.ts`

## Findings

### Confirmed FIXED from cycle 46
- C46-01: `tagsString` length check now precedes after `requireCleanInput`
  (sanitized) — `apps/web/src/app/actions/images.ts:137-149`. Verified.
- C46-02: `searchImagesAction` now sanitizes `query` before length check —
  `apps/web/src/app/actions/public.ts:159-160`. Verified.

### New observations
None of the patterns reviewed in this cycle revealed defects that constitute a
true logic, SOLID, or maintainability regression. The codebase consistently
uses:
- `requireCleanInput` for sanitize-before-validate, applied uniformly
- structured `{ status: ... }` returns from server actions (no thrown errors
  to client)
- centralized `requireSameOriginAdmin` action guard
- pre-increment-then-rollback rate-limit pattern documented in
  `lib/rate-limit.ts`

### Risks worth keeping on the radar (Low)
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:154-157` —
  `tagsParam` is a raw search param value that flows directly into a
  redirect URL via `URLSearchParams.set('tags', tagsParam)`. This is safe
  because `URLSearchParams` performs URL-encoding, but adding a length cap
  (e.g. `if (tagsParam && tagsParam.length > 1024) tagsParam = undefined`)
  would harden against accidental URL bloat from malformed referrers.
  Confidence: Low.

- `apps/web/src/app/api/checkout/[imageId]/route.ts:121` — `image.title`
  is concatenated into `product_data.name` without truncation. Stripe
  enforces a 1500-char product name limit. While `images.title` is admin
  controlled and should normally be short, defensive truncation
  (`.slice(0, 200)`) would prevent a silent Stripe API rejection on a
  corner-case title.
  Confidence: Low.

## Conclusion
No High/Medium findings. Two Low-severity defense-in-depth items recorded
above. Codebase quality remains high.
