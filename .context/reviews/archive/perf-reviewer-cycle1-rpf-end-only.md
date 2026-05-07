# Performance Reviewer — Cycle 1 (RPF, end-only deploy mode)

## Scope
CPU, memory, concurrency, and UI responsiveness review of gallery codebase
as of HEAD (`e090314`).

## Verified Hardening
- Image processing runs through a bounded `image-queue` (`p-queue`), preventing
  CPU exhaustion on bulk upload.
- `bounded-map.ts` provides `createWindowBoundedMap`/`createResetAtBoundedMap`
  with hard key caps for every in-memory rate limiter.
- `data.ts` listing path uses Drizzle SELECT projection that omits expensive
  fields (12+ `eslint-disable @typescript-eslint/no-unused-vars` comments
  documenting the intentional column omission for listing perf).
- Listing/search use cursor-based pagination with deep-pagination DoS cap
  (`safeOffset > 10000` rejected).
- Server-rendered pages use Next.js `cache()` for per-request dedup
  (`session.ts:94`).
- AVIF/WebP/JPEG conversion is async out-of-request via the upload queue.

## New Observations

### P-CYCLE1-01: Topic redirect path forms URL on every miss-canonical hit [Very Low]
**File:** `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:151-158`
**Description:** When the requested topic slug is non-canonical, the redirect
URL is constructed afresh on every request. This is not a perf issue per se
— the path is a redirect for a corner case — but absent a 301/308 status
hint to upstream proxies, browsers may not cache. Default Next `redirect()`
is 307 in App Router, which is permissive. Confidence: Very Low.

### Risks worth monitoring
- `entitlements` insert during Stripe webhook is in the request path; if
  the DB experiences a brief stall, Stripe will retry and the
  `onDuplicateKeyUpdate` no-op will absorb the retry. This pattern is
  correct and idempotent. No action needed.

## Conclusion
No actionable perf findings. Hot paths use bounded queues, cursor-based
pagination, and lazy DB columns. Codebase remains performant.
