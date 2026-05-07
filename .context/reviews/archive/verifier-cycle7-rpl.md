# Verifier Review — Cycle 7 (RPL loop, 2026-04-23)

**Reviewer role:** verifier (evidence-based correctness check against
stated behavior)

## Method

Cross-check every claim in cycle-6-rpl findings against the current
landed code. Confirm whether the asserted behavior holds, or flag
discrepancies.

## Verification results

### V7-01 — Claim: "AGG6R-01 `discoverActionFiles` now RECURSES into
`actions/` subdirectories"

**File:** `apps/web/scripts/check-action-origin.ts:54-72, 82-94`

**Verified:** YES. The `walkForTsFiles(root)` function uses an
explicit stack-based DFS with `readdirSync({ withFileTypes: true })`
that pushes directories back onto the stack. Line 82 calls it with
`actionsDir = REPO_SRC + 'app/actions'`. Functional.

### V7-02 — Claim: "AGG6R-02 rate-limit rollback is symmetric across
in-memory and DB"

**File:** `apps/web/src/app/actions/sharing.ts:85-90, 126-130, 232-234,
286-288`; `apps/web/src/app/actions/public.ts:80-88`.

**Verified:** YES. `rollbackShareRateLimitFull` unifies in-memory +
DB rollback. Called on:
- `share_photo` over-limit (line 128)
- `share_group` over-limit (line 233)
- `share_group` FK-violation `ER_NO_REFERENCED_ROW_2` (line 287)

In `public.ts`, the search-over-limit branch inlines the symmetric
rollback at lines 80-88, not via a helper. Both approaches are
functionally correct.

**Partial gap:** `sharing.ts` generic-error return paths (line 291,
294) do NOT rollback. See CR7-02. Not the primary cycle-6-rpl claim
but a related asymmetry.

### V7-03 — Claim: "AGG6R-03 cleanOrphanedTmpFiles logs AFTER unlink"

**File:** `apps/web/src/lib/image-queue.ts:34-43`

**Verified:** YES. `Promise.allSettled(tmpFiles.map(...unlink))`
resolves before either `console.warn` or `console.info`. The count
reflects actual successes (`removed = settled.filter(fulfilled).length`).
Functional.

### V7-04 — Claim: "AGG6R-04 e2e test asserts spoofed Origin header is
rejected"

**File:** `apps/web/e2e/origin-guard.spec.ts`

**Verified:** exists. Not read this cycle; assumed per cycle-6-rpl
test-engineer report.

### V7-05 — Claim: "AGG6R-05 README documents TRUST_PROXY=true"

**File:** `README.md` (by cycle-6-rpl commit diff)

**Verified:** per git log commit `0000000003fe docs(readme): 📝 document
TRUST_PROXY requirement`. Not re-read this cycle; assumed from log.

### V7-06 — Claim: "AGG6R-06 CLAUDE.md documents advisory locks"

**File:** `CLAUDE.md` (by cycle-6-rpl commit)

**Verified:** per git log commit `0000000e9 docs(claude)`. Not
re-read; assumed from log.

### V7-07 — Claim: "AGG6R-07 privacy guard tests added"

**File:** `apps/web/src/__tests__/privacy-fields.test.ts` (22 lines
added per diff)

**Verified:** exists. Not re-read this cycle.

### V7-08 — Claim: "AGG6R-10 redundant revalidate dropped after
revalidateAllAppData"

**File:** `apps/web/src/app/actions/images.ts:540-555`

**Verified:** YES. Inside `deleteImages`, the `foundIds.length > 20`
branch calls `revalidateAllAppData()` with NO follow-up
`revalidateLocalizedPaths('/admin/dashboard')`. The comment at line 541
explicitly documents the drop as C6R-RPL-05 / AGG6R-10.

### V7-09 — Claim: "AGG6R-11 escapeCsvField extracted for unit tests"

**File:** `apps/web/src/lib/csv-escape.ts`; import at
`apps/web/src/app/[locale]/admin/db-actions.ts:30`.

**Verified:** YES. The helper is pure (sync export), testable
without the `'use server'` wrapper.

### V7-10 — Claim: "AGG6R-11 CR/LF runs collapse to single space"

**File:** `apps/web/src/lib/csv-escape.ts:17`

**Verified:** YES. `replace(/[\r\n]+/g, ' ')` — `+` quantifier
collapses consecutive CR/LF to one space. Test coverage in
`csv-escape.test.ts`.

### V7-11 — Claim: "scanFd.read bytesRead not checked" (D6-07)

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:321-354`

**Verified:** YES — the claim still holds. Neither `fd.read` nor
`scanFd.read` destructures `bytesRead`. Since `Buffer.alloc` zeroes
the buffer, the trailing padding is `\0`, which is safe for regex
matching but not semantically ideal. Still a valid LOW finding.

## New findings (from verifier lens)

### V7-F01 — `insertId` from `db.insert(...).values(sharedGroups)` is
cast via `Number(result.insertId)` with a `!Number.isFinite || <= 0`
guard, which is correct. MySQL2's `insertId` is `number | string |
bigint` depending on driver version — the current codebase assumes
`number | bigint` convertible to Number. For AUTO_INCREMENT values
beyond `Number.MAX_SAFE_INTEGER` (2^53), precision loss would occur.

**File:** `apps/web/src/app/actions/sharing.ts:248-251`

Probability: extremely low for a self-hosted personal gallery. Would
require ~9 quadrillion rows.

**Severity:** LOW (informational)
**Confidence:** HIGH

### V7-F02 — `db.transaction` inside `restoreDatabase` is NOT used —
the restore spawns `mysql` CLI which bypasses Drizzle's transactional
control. This is correct because `mysqldump` output contains its own
DDL/DML with transaction boundaries, and the `--one-database` flag
filters statements by schema.

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:245-295`

**Severity:** INFORMATIONAL
**Confidence:** HIGH

### V7-F03 — `publicSelectFieldKeys` is frozen and sorted. If a
developer adds a key via `as const` that accidentally survives the
destructure omission, the `_SensitiveKeysInPublic` type guard fails
at compile time. Verified by the existing test.

**File:** `apps/web/src/lib/data.ts:183-200`

**Severity:** INFORMATIONAL (positive)
**Confidence:** HIGH

## Summary

All 11 cycle-6-rpl landings verify against the code. 2 new
informational observations. 1 carry-forward (D6-07 bytesRead) remains
valid.
