# Debugger — Cycle 9 (2026-04-25)

**HEAD:** `35a29c5`

## Failure-mode survey

I walked the cycle-8 deltas looking for paths that could produce silent
data corruption, lost work, or operator-confusing error states.

### Sitemap build-time DB-unavailable

- Pre-cycle-8: build failure (process exit). Operator sees red CI.
- Post-cycle-8 (commit 7bb8690): warn-and-continue, homepage-only
  sitemap. Build succeeds.
- Cycle-9 verdict: **no further regression possible** — the fallback
  produces a valid sitemap.

### OG rate-limit Map memory pressure

- `OG_RATE_LIMIT_MAX_KEYS = 2000`. Each entry: ~50 bytes for the IP key
  string plus 24 bytes for the `{count, resetAt}` shape ≈ ~75 bytes
  amortized. Worst case: 150 KB of resident heap.
- `pruneOgRateLimit` enforces the cap on every increment.
- **No memory-leak risk.**

### OG ETag collision on different topics

- ETag = SHA-256(slug + label + tags + siteTitle), truncated to 128 bits.
- Two distinct topics with the same slug+label+tags+siteTitle produce
  the same ETag — but they would produce the same image too, so the
  shared 304 is correct.
- Different topics with different inputs but the same hash prefix:
  collision probability ~2^-64 per pair; for any realistic gallery this
  is effectively impossible.
- **No correctness risk.**

### Permissions-Policy ordering

- next.config.ts and nginx/default.conf both updated this cycle. If they
  drift in the future, AGG8F-14 (deferred) will surface. No drift today.

## Findings

**Status: zero new defects.**

## Summary

No latent failure modes uncovered. Cycle 8 delivered defensive coding
(try/catch on sitemap, in-memory cap on rate-limit Map) that neutralizes
the obvious failure surfaces.
