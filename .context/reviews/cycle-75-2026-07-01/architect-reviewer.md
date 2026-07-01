# Cycle 75 Architecture/Product Review

Scope: source-of-truth drift, cache validator semantics, deploy/plan ledgers, color/HDR honesty, operator contracts, and photographer-facing risk.

## Findings

### C75-02 - If-None-Match comparisons use exact string matching instead of weak comparison

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/app/feed.xml/route.ts:33`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:33`, `apps/web/src/lib/serve-upload.ts:238`, `apps/web/src/app/api/og/route.tsx:133`
- Problem: several conditional-response branches compare the incoming `If-None-Match` value to the current ETag by exact string or exact-list membership. HTTP cache validation uses weak entity-tag comparison for `If-None-Match`, so `W/"x"` and `"x"` are equivalent when their opaque tags match.
- Failure scenario: a browser, service worker, CDN, or crawler revalidates with an equivalent strong/weak validator and receives a 200 instead of a 304 for Atom feeds, upload derivatives, or the topic OG card.
- Suggested fix: add one shared ETag matcher that performs weak comparison, including comma-separated validator lists, and use it across these routes.
- Reference: RFC 9110 Section 13.1.2 requires weak comparison for `If-None-Match` (https://datatracker.ietf.org/doc/html/rfc9110#section-13.1.2).

## Notes

This main-lane review also confirmed `29f4176d` is a good signed commit on `master`/`origin/master`, matching the Cycle 75 start context.
