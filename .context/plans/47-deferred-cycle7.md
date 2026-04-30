# Plan 47 — Deferred Items (Cycle 7)

**Created:** 2026-04-19 (Cycle 7)
**Status:** Deferred

## Deferred Findings

### C7-07: NULL capture_date prev/next navigation uses `eq()` with null (LOW)
- **File:** `apps/web/src/lib/data.ts:295-355`
- **Original severity/confidence:** LOW / MEDIUM
- **Reason for deferral:** Legacy-only edge case. NULL capture_date images are rare (pre-EXIF-parsing era). The current behavior (NULL-date images navigate only among other NULL-date images) is actually a reasonable UX choice — mixing dated and undated images in navigation would be confusing. Fixing would require changing `eq(images.capture_date, null)` to `sql\`${images.capture_date} IS NULL\``, which needs careful testing to avoid breaking the already-complex 3-way OR conditions.
- **Exit criterion:** If users report that legacy images cannot be navigated to/from, or if the NULL-date population grows significantly, re-open.

### C7-08: Rate limit pre-increment inconsistency in safe direction (LOW)
- **File:** `apps/web/src/app/actions/auth.ts:105-115`
- **Original severity/confidence:** LOW / MEDIUM
- **Reason for deferral:** The inconsistency is in the safe direction — the in-memory counter is stricter than the DB counter, meaning legitimate users are never under-limited. This matches the design intent documented in the existing deferred carry-forward list (C5-04). Per CLAUDE.md and the project's own security architecture, rate limiting that errs on the restrictive side is acceptable.
- **Exit criterion:** If a need arises for exact in-memory/DB parity (e.g., multi-process deployment), re-open.
