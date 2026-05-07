# Cycle 2 — Debugger Findings

**Date**: 2026-05-05
**Scope**: Latent bug surface, failure modes, regressions
**Method**: Single-agent causal tracing of suspicious flows

---

## Examined Flows

1. **Upload → DB insert → queue enqueue** (images.ts)
2. **Service Worker cache read/write** (sw.template.js)
3. **OG photo fetch → ImageResponse** (og/photo/[id]/route.tsx)
4. **Reaction toggle → atomic UPDATE** (reactions/[imageId]/route.ts)
5. **Checkout → Stripe session** (checkout/[imageId]/route.ts)
6. **Download token → atomic claim → stream** (download/[imageId]/route.ts)
7. **View count buffer → flush → DB UPDATE** (data.ts)

---

## Findings

**0 new bug findings.**

### Flow Analysis

**Upload flow**: Correct. Tracker pre-incremented before processing. If DB insert fails, original file cleaned up. If processing fails, conditional UPDATE + cleanup. Advisory lock prevents concurrent processing of same image.

**SW cache flow**: Correct. `sw-cached-at` is now set before put. Age check is reachable. HTML_MAX_AGE_MS (24h) honored. Cache purges on SW version change.

**OG flow**: Correct. 10s timeout on photo fetch. Fallback to site OG image or redirect to root on failure. No unhandled promise rejections.

**Reaction flow**: Correct. Rate limit pre-check with rollback on failure. Atomic transaction for toggle on/off. Visitor cookie rotation. No race between GET and POST.

**Checkout flow**: Correct. Rate limit pre-increment with rollback on every early return. Idempotency key prevents duplicate sessions. Locale derived from Referer safely.

**Download flow**: Correct. File existence verified BEFORE atomic claim. Token hash cleared on claim (privacy). Path traversal + symlink checks. Content-Disposition sanitized.

**View count flow**: Correct. Map reference swap prevents lost increments during flush. Retry cap (3) with drop + warn. Backoff for consecutive failures. Buffer cap enforced post-flush.

---

## Commonly Missed Issues Sweep

- **Off-by-one**: LISTING_QUERY_LIMIT_PLUS_ONE = 101, pageSize capped at 101, slice at pageSize. Correct.
- **Null dereference**: Optional chaining used consistently. Default values provided.
- **Resource exhaustion**: Connection pool capped at 10. Image processing concurrency divided by format fan-out.
- **Time-of-check/time-of-use**: lstat before realpath before stream — all verified.

**Conclusion**: No latent bugs found in this cycle.
