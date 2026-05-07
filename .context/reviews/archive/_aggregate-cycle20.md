# Aggregate Review — Cycle 20 (2026-04-19)

**Source reviews:** code-reviewer, security-reviewer, perf-reviewer, debugger, architect, verifier, test-engineer, designer, critic, tracer, document-specialist (11 reviewers).

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

### C20-01: `uploadTracker` count can go negative after all-failed uploads, bypassing rate limit [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/actions/images.ts` lines 273-278
- **Flagged by**: code-reviewer (CR-20-05), security-reviewer (SEC-20-01), perf-reviewer (PERF-20-01), debugger (DBG-20-01), architect (ARCH-20-01), verifier (VER-20-01), critic (CRI-20-01), tracer (H1), test-engineer (TE-20-01)
- **Cross-agent agreement**: 9 agents flagged this — strongest signal of the cycle
- **Description**: The post-upload tracker adjustment uses `currentTracker.count += (successCount - files.length)`. When all uploads fail (`successCount === 0`), this subtracts `files.length` from the count, producing a negative value. A negative count violates the tracker's invariant (count >= 0) and inflates the effective upload rate-limit budget. The byte tracker (`currentTracker.bytes += (uploadedBytes - totalSize)`) has the same pattern but happens to be self-correcting when `uploadedBytes` is 0 and `totalSize` was pre-incremented — it correctly returns to 0. However, in a partial-failure scenario where some files succeed and others fail, the bytes tracker could also drift negative.
- **Concrete failure scenario**: Admin uploads 100 intentionally corrupt files (all fail). Tracker count becomes -100. Next upload: `-100 + 50 = -50` — still under the 100-file limit, allowing 150 files total before the limit kicks in.
- **Fix**: Clamp both `count` and `bytes` to >= 0 after adjustment:
  ```typescript
  const currentTracker = uploadTracker.get(uploadIp);
  if (currentTracker) {
      currentTracker.count = Math.max(0, currentTracker.count + (successCount - files.length));
      currentTracker.bytes = Math.max(0, currentTracker.bytes + (uploadedBytes - totalSize));
      uploadTracker.set(uploadIp, currentTracker);
  }
  ```

### C20-02: `deleteAdminUser` returns `{ success: true }` when no user was actually deleted [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/admin-users.ts` lines 157-166
- **Flagged by**: code-reviewer (CR-20-02), debugger (DBG-20-02), verifier (VER-20-02), critic (CRI-20-02), tracer (H3)
- **Cross-agent agreement**: 5 agents flagged this
- **Description**: The function's transaction counts admins to prevent deleting the last one, then deletes sessions and the user by ID. It never checks `affectedRows` on the `adminUsers` delete. If the user was already deleted by a concurrent request, the transaction completes with 0 rows affected but returns `{ success: true }`.
- **Concrete failure scenario**: Two admins delete the same user simultaneously. Both succeed. One actually deleted the user; the other's transaction is a no-op but reports success.
- **Fix**: After the transaction, verify the `adminUsers` delete affected at least 1 row. If 0, return an error like "user not found".

### C20-03: `uploadTracker` adjustment comment is slightly misleading [LOW] [LOW confidence]
- **File**: `apps/web/src/app/actions/images.ts` line 267
- **Flagged by**: document-specialist (DOC-20-03)
- **Cross-agent agreement**: 1 agent
- **Description**: The comment says "Update cumulative upload tracker with actual (not pre-incremented) values" but the code applies a differential adjustment, not an absolute assignment. A more accurate comment would describe the additive adjustment pattern.
- **Fix**: Update comment to: "Adjust cumulative upload tracker by the difference between actual and pre-incremented values. Clamped to >= 0 to prevent negative drift on total failure."

---

## PREVIOUSLY FIXED — Confirmed Resolved

All cycle 1-19 findings remain resolved. The following cycle 19 findings are confirmed resolved in the current codebase:

- C19-01 (`revokePhotoShareLink` race condition): **RESOLVED** — Conditional WHERE clause at sharing.ts line 261, affectedRows check at line 263.
- C19-02 (`updateGallerySettings` DB/live inconsistency): **RESOLVED** — Roll-back logic at settings.ts lines 86-97.
- C19-03 (Mobile EXIF fields missing): **RESOLVED** — All 6 fields present in info-bottom-sheet.tsx lines 291-326.

Cycle 39 findings also remain resolved (batchUpdateImageTags slug lookup, GPS annotation, form labels, locale cookie, SQL restore pattern, password confirmation, atomic rename).

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain unchanged. See the deferred items in `.omc/plans/` and `.context/plans/` for the full list:

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

None — all review agents completed successfully.

---

## TOTALS

- **0 CRITICAL** findings
- **1 MEDIUM** finding (C20-01: uploadTracker negative count)
- **2 LOW** findings (C20-02: deleteAdminUser no-op success, C20-03: misleading comment)
- **3 total** new findings
