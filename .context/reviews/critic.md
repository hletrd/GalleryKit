# Cycle 18 — Critic Review

Date: 2026-05-06
Scope: Full repository, post-cycle-17 fixes
Focus: Multi-perspective critique of the whole change surface

## Verified Prior Fixes

- C17-CRIT-01 (diverged producer sites): FIXED in 38077b9 — both upload and bootstrap now pass EXIF/ICC fields.
- C17-CRIT-02 (iccProfileName vs color_space duality): Addressed by 4d1f323 — icc_profile_name now persisted.
- C17-CRIT-03 (SW metadata race): Still deferred.
- C17-CRIT-04 (checkout idempotency): Addressed by 80a1956, but see C18-HIGH-01 for regression.

---

## New Findings

### HIGH SEVERITY

**C18-HIGH-01: The cure is worse than the disease — idempotency key "fix" destroys idempotency**
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:150-151`
- **Confidence:** HIGH
- **Problem:** C17-SEC-01 identified a real issue: when TRUST_PROXY is unset, all users share IP='unknown', causing checkout idempotency key collision. The fix (80a1956) added randomUUID to the key. This completely eliminated the collision risk — but also completely eliminated the deduplication benefit. The result is a feature that appears to work (keys are unique) but fails at its core purpose (preventing duplicate sessions).
- **Meta-critique:** This is a pattern worth watching. Security-focused fixes that add randomness/nondeterminism can break business-logic invariants. A better approach would have been: (1) detect the 'unknown' IP case, (2) log a warning that TRUST_PROXY should be configured, (3) accept weaker deduplication in that specific case, rather than weakening it for ALL cases.
- **Suggested fix:** Revert the randomUUID. Instead, add a deployment warning when TRUST_PROXY is not set. Use IP + session-derived hash when available.

---

### MEDIUM SEVERITY

**C18-MED-01: Service Worker cache inconsistency — metadata and reality diverge**
- **File:** `apps/web/public/sw.template.js:79-106`
- **Confidence:** MEDIUM
- **Problem:** The LRU tracker maintains a metadata Map that it believes reflects the cache contents. But because `delete(entry.url)` may not remove the actual cache entry, the Map and the cache drift apart. This is a classic cache invalidation problem: the metadata is a cache-of-a-cache, and invalidation is unreliable.
- **Suggested fix:** Either eliminate the metadata Map and use `cache.keys()` for eviction (slower but correct), or ensure key types match exactly.

**C18-MED-02: Semantic search length gate inconsistency with codebase conventions**
- **File:** `apps/web/src/app/api/search/semantic/route.ts:111`
- **Confidence:** MEDIUM
- **Problem:** Every other user-facing length check in the codebase uses `countCodePoints` (uploads, titles, descriptions, SEO fields, search). The semantic search endpoint alone uses `.length`. This inconsistency is a maintenance hazard — future developers may copy the semantic search pattern, spreading the inconsistency.
- **Suggested fix:** Use `countCodePoints` and add a comment referencing the convention.
