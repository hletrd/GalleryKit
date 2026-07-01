# Cycle 97 Security / API Review

Scope: deployed `master` at `061c1c81af234469641f75a53e5bbc61fa63114a`.

## Findings

### C97-06 - Public per-topic feed misses are exempt from rate limiting but hit DB

- Severity/confidence: Medium / High.
- Evidence: `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:37` carried `@public-no-rate-limit-required`; `:70`-`74` called `getTopicBySlug(topicSlug)` before returning 404; `apps/web/src/lib/data.ts:1393`-`1425` performs direct-topic and alias DB lookups for attacker-controlled path segments.
- Failure scenario: unauthenticated clients spray `/en/<random>/feed.xml` and force variable DB lookups outside any public limiter. This is not SQL injection, but it is DB pressure and enumeration surface area.
- Suggested fix: charge supported-locale, non-maintenance per-topic feed requests through a lightweight public feed limiter before `getTopicBySlug()`, while keeping successful feed responses cacheable.

### C97-07 - Atom feed routes bypass restore-maintenance behavior and can cache restore-window data

- Severity/confidence: Medium / High.
- Evidence: prior cycle aggregate recorded C96-04 against `apps/web/src/app/feed.xml/route.ts:36` and `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:36`; at cycle start those routes entered DB-backed feed rendering without checking `isRestoreMaintenanceActive()`, and success responses used public cache headers.
- Failure scenario: during DB restore, feed readers or caches can receive partial restore-window data as a cacheable 200/304 feed rather than a no-store maintenance response.
- Suggested fix: add early restore-maintenance 503/no-store guards to root and topic feeds before feed-shaping DB work, with route-level tests.

## Reviewed With No Confirmed Issue

Admin API auth/origin wrappers, PAT hashing/scope checks, upload path containment, backup download containment, and OG internal fetch origin pinning had no new confirmed issues in this cycle.
