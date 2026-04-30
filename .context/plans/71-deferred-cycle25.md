# Plan 71-Deferred — Deferred Items (Cycle 25)

**Created:** 2026-04-19 (Cycle 25)
**Status:** Deferred

## Deferred Findings

### C25-06: uploadTracker uses "unknown" IP when TRUST_PROXY is not set — intentional
- **File+Line:** `apps/web/src/app/actions/images.ts`, line 75; `apps/web/src/lib/rate-limit.ts`, lines 60-67
- **Severity/Confidence:** LOW / HIGH
- **Reason for deferral:** Not a bug — this is intentional behavior. When `TRUST_PROXY` is not set, `getClientIp` returns "unknown" and the code explicitly warns about this in production. All unproxied uploads sharing the same rate limit bucket is the expected trade-off documented in the code.
- **Exit criterion:** N/A — no action needed.

### C25-07: searchImagesAction double-trims/limits the query — defensive, not a bug
- **File+Line:** `apps/web/src/app/actions/public.ts`, line 86; `apps/web/src/lib/data.ts`, line 541
- **Severity/Confidence:** LOW / HIGH
- **Reason for deferral:** Not a bug — the double-processing in `searchImagesAction` (trim + slice to 200) and `searchImages` (trim + escape LIKE wildcards) is defensive in depth. The server action is the public-facing boundary that enforces length limits; the data layer handles SQL safety. Neither is redundant with the other.
- **Exit criterion:** N/A — no action needed.

### C25-08: bootstrapImageProcessingQueue called with void at module import — intentional
- **File+Line:** `apps/web/src/lib/image-queue.ts`, line 293
- **Severity/Confidence:** LOW / HIGH
- **Reason for deferral:** Not a bug — `void bootstrapImageProcessingQueue()` is intentional auto-initialization at module import time. The `bootstrapped` flag prevents double initialization. The `void` operator explicitly discards the promise to signal fire-and-forget intent.
- **Exit criterion:** N/A — no action needed.

### C25-12: In-memory uploadTracker not shared across processes
- **File+Line:** `apps/web/src/app/actions/images.ts`, line 24
- **Severity/Confidence:** LOW / HIGH
- **Reason for deferral:** Acceptable for single-admin personal gallery. Per-call limits and disk-space checks provide fallback protection.
- **Exit criterion:** If multi-process deployment is needed, add DB-backed upload tracker.

### C25-13: No CSP header on uploaded file serve
- **File+Line:** `apps/web/src/lib/serve-upload.ts`, lines 76-81
- **Severity/Confidence:** LOW / MEDIUM
- **Reason for deferral:** Adding `Content-Security-Policy: default-src 'none'` would break legitimate `<img>` embedding from other sites. The `X-Content-Type-Options: nosniff` and proper content types provide sufficient protection.
- **Exit criterion:** Not actionable — would break legitimate use.

### C25-14: Prev/next navigation queries could be slow at scale
- **File+Line:** `apps/web/src/lib/data.ts`, lines 344-405
- **Severity/Confidence:** LOW / MEDIUM
- **Reason for deferral:** Existing composite index covers the query pattern. Performance is adequate for personal gallery scale (<100K images).
- **Exit criterion:** If gallery grows past 100K images, consider cursor-based navigation.

## Carry-Forward from Previous Cycles

All 17+2+2+3 previously deferred items from cycles 5-24 remain deferred with no change in status.
