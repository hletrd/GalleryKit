# Plan 105 — Cycle 38 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 38)
**Status:** DONE (carry-forward only)

---

## Deferred Items from Cycle 38

All previously deferred items from cycles 5-37 remain deferred with no change in status. No new items are deferred from cycle 38 — all C38 findings are scheduled for implementation in Plan 104.

### C32-03: Insertion-order eviction in Maps [LOW]
**Files:** Various rate-limit Maps in `rate-limit.ts`, `auth-rate-limit.ts`, `actions/sharing.ts`
**Original severity/confidence:** LOW / HIGH
**Reason:** Maps use insertion-order eviction under hard cap pressure. LRU would be more fair but adds complexity for a marginal improvement. Hard caps prevent unbounded growth. Also noted by critic (CRI-38-01) as a DRY concern — multiple Maps duplicate the pruning pattern.
**Exit criterion:** If eviction fairness becomes a practical concern under production load, or if the DRY violation is addressed via a shared `PrunableMap` utility.

### C32-04 / C30-08: Health endpoint DB disclosure [LOW]
**File:** `apps/web/src/app/api/health/route.ts`
**Original severity/confidence:** LOW / MEDIUM
**Reason:** Health endpoint reveals DB connectivity status. Only accessible unauthenticated, but info is minimal.
**Exit criterion:** If health endpoint is moved behind auth or if DB connectivity status is deemed sensitive.

### C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap [LOW]
**File:** `apps/web/src/lib/auth-rate-limit.ts:66`
**Original severity/confidence:** LOW / HIGH
**Reason:** Password change rate-limit Map uses the same `LOGIN_RATE_LIMIT_MAX_KEYS` (5000) cap as login. Should have its own constant but the practical impact is negligible.
**Exit criterion:** If separate rate-limit tuning is needed for password changes vs login.

### C30-03 / C36-03: `flushGroupViewCounts` re-buffers without retry limit [LOW, High Confidence]
**File:** `apps/web/src/lib/data.ts:40-46`
**Original severity/confidence:** LOW / HIGH
**Reason:** Hard cap of 1000 entries prevents memory issues. Only affects view count accuracy during extended DB outages, not stability. Also noted by code-reviewer (CR-38-01) in cycle 38.
**Exit criterion:** If view count accuracy becomes critical; implement a max-retry counter per buffered entry.

### C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion [LOW]
**File:** `apps/web/src/app/actions/sharing.ts:166`
**Original severity/confidence:** LOW / HIGH
**Reason:** Theoretical only — galleries never approach 2^53 rows. `Number.isFinite` already validates NaN/Infinity.
**Exit criterion:** If the app ever supports tables approaching 2^53 rows or mysql2 config changes BigInt handling.

### C30-06: Tag slug regex inconsistency [LOW]
**Files:** `apps/web/src/lib/validation.ts` vs `apps/web/src/app/actions/tags.ts:13`
**Original severity/confidence:** LOW / HIGH
**Reason:** `isValidSlug` allows underscores; `getTagSlug` strips them. Minor inconsistency but no data corruption risk since slug generation strips before validation. Related to C38-01 root cause but not the same fix.
**Exit criterion:** If slug generation is refactored or if tag URLs with underscores are needed.

### CR-38-05: `db-actions.ts` env passthrough is overly broad [LOW]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 121, 313
**Original severity/confidence:** LOW / MEDIUM
**Reason:** Passing `HOME` env var to mysqldump/mysql child processes could allow `~/.my.cnf` to override connection parameters. Low risk in Docker, minor risk in bare-metal development.
**Exit criterion:** If deploying outside Docker where `~/.my.cnf` might exist with conflicting settings.

### DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches [LOW]
**Files:** `CLAUDE.md`, `.nvmrc`, `apps/web/package.json`
**Original severity/confidence:** LOW / MEDIUM
**Reason:** Documentation may state different versions than what's installed. Low priority — no functional impact.
**Exit criterion:** When versions are next updated or when documentation is reviewed.

### Font subsetting [DEFERRED]
**Reason:** Requires Python brotli dependency for font subsetting. Not a code quality issue.
**Exit criterion:** If build pipeline adds Python support or an alternative subsetting tool is available.

### Docker node_modules removal [DEFERRED]
**Reason:** Native module bundling complications. Not a code quality issue.
**Exit criterion:** If standalone output properly handles all native dependencies.

### CRI-38-01: DRY violation in Map pruning (5+ copies) [LOW]
**Files:** `rate-limit.ts`, `auth-rate-limit.ts`, `actions/images.ts`, `actions/sharing.ts`, `actions/public.ts`
**Original severity/confidence:** LOW / HIGH
**Reason:** Same pruning pattern (expire + hard cap) duplicated across 5+ in-memory Maps. Refactoring into a shared utility would reduce maintenance burden but adds indirection.
**Exit criterion:** If a new Map with the same pattern is added, or if eviction strategy changes (e.g., to LRU).

### CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU [LOW]
**File:** `apps/web/src/app/actions/images.ts` lines 27-44
**Original severity/confidence:** LOW / HIGH
**Reason:** Same as C32-03. The 2000-key cap is generous and the practical impact is minimal.
**Exit criterion:** If eviction fairness becomes a practical concern.

### CR-38-06: `photo-viewer.tsx` `Histogram` null-safety [LOW]
**File:** `apps/web/src/components/photo-viewer.tsx` line 488
**Original severity/confidence:** LOW / HIGH
**Reason:** If `filename_jpeg` is null, `imageUrl(undefined)` produces an invalid URL. In practice, the DB schema requires `filename_jpeg` to be non-null, so this is a theoretical concern.
**Exit criterion:** If `filename_jpeg` ever becomes nullable in the schema.

### PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory [LOW]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 31-86
**Original severity/confidence:** LOW / HIGH
**Reason:** Admin-only feature with a hard cap. The code already releases the results array before joining. Streaming would be more memory-efficient but adds complexity.
**Exit criterion:** If CSV export causes memory issues for galleries approaching 50K images.

### ARCH-38-03: `data.ts` is a god module [LOW]
**File:** `apps/web/src/lib/data.ts` (650+ lines)
**Original severity/confidence:** LOW / MEDIUM
**Reason:** The module is cohesive (all data access) and well-organized. Refactoring would be high churn for low benefit.
**Exit criterion:** If the module grows beyond 1000 lines or if view count buffering needs to be tested independently.

### TE-38-01 through TE-38-04: Test coverage gaps [LOW]
**Files:** Various
**Original severity/confidence:** LOW / HIGH
**Reason:** Missing tests for view count buffering, ICC profile parsing, `isValidTopicAlias`, and upload pipeline. Non-critical — the code has defensive error handling.
**Exit criterion:** If the corresponding modules are modified or if test coverage policy requires it.
