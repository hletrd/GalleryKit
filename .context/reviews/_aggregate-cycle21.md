# Aggregate Review — Cycle 21 (2026-04-19)

**Source reviews:** code-reviewer, security-reviewer, perf-reviewer, debugger, architect, verifier, test-engineer, critic, tracer, designer, document-specialist (11 reviewers).

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

### C21-01: `uploadImages` does not clean up original file when DB insert fails or returns invalid insertId [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/actions/images.ts` lines 183-188 (invalid insertId path), lines 255-259 (exception catch)
- **Flagged by**: debugger (DBG-21-01), verifier (VER-21-03), critic (CRI-21-01), tracer (TRACE-21-01)
- **Cross-agent agreement**: 4 agents flagged this — strong signal
- **Description**: When `saveOriginalAndGetMetadata()` succeeds (file saved to disk) but the subsequent `db.insert()` either returns an invalid `insertId` or throws an exception, the original file remains on disk but no DB record references it. These orphaned files accumulate over time and are never cleaned up by any other code path.
- **Concrete failure scenario**: DB connection pool is exhausted. Admin uploads 50 files. All originals are saved to disk but all DB inserts fail. 50 orphaned files (up to 200MB each = 10GB) remain on disk with no cleanup mechanism.
- **Fix**: In both the invalid-insertId branch (after `failedFiles.push`) and the catch block, delete the saved original file:
  ```typescript
  // In the invalid insertId branch (line ~188):
  await fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal)).catch(() => {});
  
  // In the catch block (line ~258): data may not be defined if saveOriginalAndGetMetadata failed,
  // so the cleanup should be scoped to after the DB insert attempt.
  ```

### C21-02: Missing unit tests for recent correctness fixes (C20-01, C20-02, C19-01) [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/__tests__/` — no test files for server actions
- **Flagged by**: test-engineer (TE-21-01, TE-21-02, TE-21-03)
- **Description**: Three correctness-critical fixes from recent cycles have no regression tests:
  1. Upload tracker clamping (C20-01) — no test that count/bytes don't go negative
  2. `deleteAdminUser` no-op guard (C20-02) — no test that deleting a non-existent user returns error
  3. `revokePhotoShareLink` conditional WHERE (C19-01) — no test for the share-key race guard
- **Fix**: Add unit tests for each fix. Server actions are harder to unit test due to DB dependencies, but the core logic (tracker math, affectedRows checks, conditional WHERE behavior) can be tested with mocks.

### C21-03: Session cookie `Secure` flag depends on `x-forwarded-proto` which can be spoofed without a trusted proxy [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/actions/auth.ts` lines 172-174
- **Flagged by**: security-reviewer (SEC-21-02)
- **Cross-agent agreement**: 1 agent
- **Description**: The `requireSecureCookie` logic checks `x-forwarded-proto` header. In a deployment without a trusted reverse proxy that strips/overwrites this header, an attacker could send `x-forwarded-proto: https` over plain HTTP, causing the session cookie to be set with `Secure: true` but transmitted over an unencrypted connection. This is deployment-dependent — the Docker deployment uses nginx which sets this header correctly.
- **Concrete failure scenario**: App deployed behind a misconfigured reverse proxy that doesn't strip incoming `x-forwarded-proto`. Attacker sends request with `x-forwarded-proto: https` over HTTP. Cookie is set with `Secure` flag but sent over plaintext. Session token is intercepted.
- **Fix**: Document that the reverse proxy MUST strip/overwrite `x-forwarded-proto`. Consider adding a `TRUST_PROXY` env var that must be explicitly set to trust forwarded headers.
- **Status**: DEFERRED — deployment-dependent, not a code bug.

### C21-04: `deleteImage` audit log records event even when transaction deletes 0 rows [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/images.ts` lines 343-350
- **Flagged by**: debugger (DBG-21-02)
- **Cross-agent agreement**: 1 agent
- **Description**: The audit log fires after the transaction without checking `affectedRows`. If two admins delete the same image concurrently, both transactions succeed but one deletes 0 rows. Both log audit events, creating a duplicate.
- **Fix**: Check `affectedRows` inside the transaction. If 0, skip the audit log or log with a different action.

### C21-05: `searchImages` runs two sequential DB queries instead of parallel or UNION [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/lib/data.ts` lines 612-652
- **Flagged by**: perf-reviewer (PERF-21-01)
- **Cross-agent agreement**: 1 agent
- **Description**: `searchImages` queries images first, then tags if results are insufficient. These are sequential round trips. A `Promise.all` or `UNION ALL` approach would reduce latency.
- **Fix**: Use `Promise.all` for parallel execution when the search term is likely to need tag results. Low priority since search is admin-only.

### C21-06: Mobile `info-bottom-sheet.tsx` EXIF section may require excessive scrolling with 14 fields [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/components/info-bottom-sheet.tsx`
- **Flagged by**: designer (DES-21-02)
- **Cross-agent agreement**: 1 agent
- **Description**: With 6 new EXIF fields added in C19-03, the expanded EXIF grid has 14 fields. On small screens, this may require significant scrolling within the bottom sheet.
- **Fix**: Consider a "Show more" toggle or two-column grid on wider mobile screens. Low priority.

### C21-07: `deleteAdminUser` doc comment doesn't mention `USER_NOT_FOUND` guard [LOW] [LOW confidence]
- **File**: `apps/web/src/app/actions/admin-users.ts` lines 156-157
- **Flagged by**: document-specialist (DOC-21-03)
- **Cross-agent agreement**: 1 agent
- **Description**: The comment says "Atomically check last-admin and delete inside a transaction" but doesn't mention the `USER_NOT_FOUND` guard added in cycle 20.
- **Fix**: Update comment to include the no-op-success prevention purpose.

---

## PREVIOUSLY FIXED — Confirmed Resolved

All cycle 1-20 findings remain resolved. The following cycle 20 findings are confirmed resolved in the current codebase:

- C20-01 (upload tracker negative count): **RESOLVED** — `Math.max(0, ...)` at images.ts lines 278-279.
- C20-02 (deleteAdminUser no-op success): **RESOLVED** — User existence check in transaction at admin-users.ts lines 163-167.
- C20-03 (misleading tracker comment): **RESOLVED** — Updated comment at images.ts lines 266-275.

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain unchanged. See the deferred items in `.omc/plans/` and `.context/plans/` for the full list:

- C21-03: `x-forwarded-proto` spoofing risk (deployment-dependent)
- C32-03: Insertion-order eviction in Maps (also CRI-38-01 DRY concern)
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: `db-actions.ts` env passthrough is overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps

---

## AGENT FAILURES

None — all 11 review agents completed successfully.

---

## TOTALS

- **0 CRITICAL** findings
- **2 MEDIUM** findings (C21-01: orphaned files, C21-02: missing tests)
- **5 LOW** findings (C21-03 deferred, C21-04 duplicate audit, C21-05 sequential search, C21-06 mobile scrolling, C21-07 doc comment)
- **7 total** new findings
