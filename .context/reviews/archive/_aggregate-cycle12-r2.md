# Aggregate Review — Cycle 12 Round 2 (2026-04-19)

**Source reviews:** comprehensive-review-cycle12-r2 (single reviewer, multi-angle)

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed. All findings are from the comprehensive review.

---

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C12R2-01 | Hardcoded image sizes in client components diverge from admin-configured sizes — broken images if admin changes image_sizes setting | MEDIUM | HIGH | IMPLEMENT |
| C12R2-02 | Shared group photoId validation — not a bug, correct fallback | — | — | NOT A BUG |
| C12R2-03 | dumpDatabase/dumpRestore stderr logging may leak DB credentials | LOW | MEDIUM | DEFER |
| C12R2-04 | checkShareRateLimit TOCTOU — no DB-backed pre-increment (same pattern fixed for login A-01) | MEDIUM | HIGH | IMPLEMENT |
| C12R2-05 | searchRateLimit DB-failure rollback — safe direction | — | — | NOT A BUG |
| C12R2-06 | shareRateLimit has no DB persistence — resets on restart | LOW | LOW | DEFER |

### C12R2-01: Hardcoded image sizes in client components [MEDIUM]

6 client-facing locations reference hardcoded image sizes (`[640, 1536, 2048, 4096]` or `_1536.jpg`) while the server-side processing pipeline uses admin-configurable sizes. If an admin changes the `image_sizes` setting, all client components will request non-existent image variants, resulting in site-wide broken images.

**Affected files:**
- `photo-viewer.tsx:186,191` — hardcoded srcSet sizes
- `lightbox.tsx:149,155` — hardcoded srcSet sizes
- `home-client.tsx:252,257` — hardcoded `_640` and `_1536` sizes
- `g/[key]/page.tsx:30,56,142` — hardcoded `_1536` OG and display
- `s/[key]/page.tsx:28,53` — hardcoded `_1536` OG
- `p/[id]/page.tsx:62` — hardcoded `_1536` OG
- `page.tsx` (home):41 — hardcoded `_1536` OG

**Fix:** Pass configured `imageSizes` to client components via page props. Use dynamic sizes for srcSet generation. For server-side OG metadata, read from `getGalleryConfig()`.

### C12R2-04: Share rate limit TOCTOU [MEDIUM]

`checkShareRateLimit` in `sharing.ts` uses an in-memory-only rate limit with no DB-backed persistence. The check-and-increment happens in the same function call, but concurrent requests from the same IP can both pass the check before either increments the in-memory Map. This is the same TOCTOU pattern fixed for login (A-01) and `createAdminUser` (C11R2-02).

**Fix:** Add DB-backed rate limiting using `incrementRateLimit`/`checkRateLimit` with pre-increment pattern, matching the login flow.

### C12R2-03: DB credential leak in stderr logs [LOW] — DEFERRED

mysqldump/mysql stderr may contain credential info in error messages. While admin-authenticated, logs may be accessible to other processes. Low risk since it requires a MySQL misconfiguration to trigger.

### C12R2-06: Share rate limit no DB persistence [LOW] — DEFERRED

Share rate limits are in-memory only, lost on restart. Low risk since share creation requires admin auth and is not security-critical.

---

## PREVIOUSLY FIXED — Confirmed Resolved Since Last Review

All previously fixed items (S-01 through C11R2-02) remain confirmed fixed.

---

## DEFERRED CARRY-FORWARD

All previously deferred items from cycles 5-39 remain deferred with no change in status (see plan README for full list).

---

## AGENT FAILURES

None — single reviewer completed successfully.

---

## TOTALS

- **2 MEDIUM** findings requiring implementation
- **2 LOW** findings deferred
- **0 CRITICAL/HIGH** findings
- **4 total** new findings (2M + 2L)
