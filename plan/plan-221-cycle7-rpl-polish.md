# Plan 221 — Cycle 7 RPL polish

**Source review:** `.context/reviews/_aggregate-cycle7-rpl.md`

**Scope:** address the two MEDIUM findings plus several HIGH-confidence
LOW findings from the cycle-7-rpl aggregate in a single implementation
pass.

**Repo rule alignment:** commits must be GPG-signed, use Conventional
Commits + gitmoji, no `--no-verify`, no force-push to master,
fine-grained per-fix commits, and must use `~/flash-shared/gitminer-cuda/mine_commit.sh 7`
after each commit to mine the 7-leading-hex-zero prefix.

## Tasks

### T7R-01 — Fix CSV formula-injection bypass when input starts with CR/LF [AGG7R-01, MEDIUM]

**File:** `apps/web/src/lib/csv-escape.ts:16-20`

**Problem:** CRLF-collapse runs BEFORE the formula prefix check. An
input of `\r\n=HYPERLINK("evil")` becomes `" =HYPERLINK(...)"` (leading
space), so `/^[=+\-@\t]/` does not fire. Excel trims leading
whitespace and interprets the formula.

**Fix:** either swap the order (check formula, then collapse CRLF) OR
widen the formula regex to `/^\s*[=+\-@\t]/` and prefix if it matches.

**Chosen approach:** change regex to `/^[\s]*[=+\-@\t]/` so the guard
ALSO catches inputs with any leading whitespace. This is robust to
any future pre-processing that introduces leading whitespace.

**Test:** add fixture to `csv-escape.test.ts`:
- Input `\r\n=HYPERLINK("x")` → output must start with `"'` (formula
  prefix applied after trim).
- Input ` =1+2` → output must start with `"'` (legacy bypass).
- Input ` hello` (leading space, no formula) → output unchanged.

**Status:** done (cycle 7 RPL loop).

### T7R-02 — Fix `restoreDatabase` advisory-lock leak on `beginRestoreMaintenance()` false early-return [AGG7R-02, MEDIUM]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:271-273`

**Problem:** when `beginRestoreMaintenance()` returns false, the
function returns without entering the inner try/finally that would
`RELEASE_LOCK`. The pool connection goes back to the pool with the
advisory lock still held, blocking all subsequent restore attempts.

**Fix:** explicitly `RELEASE_LOCK` on the early-return path BEFORE
returning:

```ts
if (!beginRestoreMaintenance()) {
    await conn.query("SELECT RELEASE_LOCK('gallerykit_db_restore')").catch(() => {});
    return { success: false, error: t('restoreInProgress') };
}
```

**Test:** Vitest unit test is hard (requires mocking the connection).
Add a regression note in the code comment referencing cycle-7-rpl
and `beginRestoreMaintenance` return semantics.

**Status:** done (cycle 7 RPL loop).

### T7R-03 — Symmetric rollback on generic-error return paths in `sharing.ts` [AGG7R-03, LOW]

**File:** `apps/web/src/app/actions/sharing.ts:177, 291`

**Problem:** `failedToGenerateKey` (line 177) and
`failedToCreateGroup` (line 291, 294) return without rolling back the
pre-incremented rate-limit counters.

**Fix:** before returning these error codes, call
`rollbackShareRateLimitFull(ip, scope)`.

**Test:** add unit test stub.

**Status:** done (cycle 7 RPL loop).

### T7R-04 — Check `bytesRead` in `fd.read`/`scanFd.read` in db-actions.ts [AGG7R-04, LOW]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:321-326, 340-342`

**Fix:** destructure `{ bytesRead }` and slice buffer accordingly.

```ts
const { bytesRead } = await fd.read(headerBuf, 0, 256, 0);
const headerBytes = headerBuf.subarray(0, bytesRead).toString('utf8');
```

Do the same for `scanFd.read` in the chunk loop.

**Status:** done (cycle 7 RPL loop).

### T7R-05 — Document account-scoped login rate limit in CLAUDE.md [AGG7R-07, LOW]

**File:** `CLAUDE.md` Security Architecture section

**Fix:** add a line under "Authentication & Sessions":
> Login rate limiting enforced in two buckets: per-IP (5/15min) and
> per-account (`acct:<sha256-prefix>` key, same limits) to prevent
> distributed brute-force.

**Status:** done (cycle 7 RPL loop).

### T7R-06 — Fix UPLOAD_MAX_* variable name mismatch in CLAUDE.md [AGG7R-08, LOW]

**File:** `CLAUDE.md` Important Notes section

**Problem:** CLAUDE.md says "100 files max (configurable via
`UPLOAD_MAX_TOTAL_BYTES`)". The 100-file cap is
`UPLOAD_MAX_FILES_PER_WINDOW` in `apps/web/src/app/actions/images.ts:60`.
`UPLOAD_MAX_TOTAL_BYTES` controls BYTE total, which is a separate limit
in `apps/web/src/lib/upload-limits.ts`.

**Fix:** rewrite the line to describe both caps separately.

**Status:** done (cycle 7 RPL loop).

### T7R-07 — Add unit test for `requireSameOriginAdmin` [AGG7R-09, LOW]

**File:** new `apps/web/src/__tests__/action-guards.test.ts`

**Fix:** 2-case test covering success and unauthorized returns. Mock
`next/headers` and `next-intl/server` via `vi.mock`.

**Status:** done (cycle 7 RPL loop).

### T7R-08 — Add recursion fixture test for `discoverActionFiles` [AGG7R-11, LOW]

**File:** `apps/web/src/__tests__/check-action-origin.test.ts` (extend)

**Fix:** create a temp dir with `a.ts` + `nested/b.ts`, call
`walkForTsFiles`, assert both are returned.

**Status:** done (cycle 7 RPL loop).

### T7R-09 — `cleanOrphanedTmpFiles` parallel directory scan [AGG7R-13, LOW]

**File:** `apps/web/src/lib/image-queue.ts:23-48`

**Fix:** wrap the outer for-loop in `await Promise.all(dirs.map(async
(dir) => { ... }))`.

**Status:** done (cycle 7 RPL loop).

### T7R-10 — Add `.catch()` on `purgeExpiredSessions()` fire-and-forget calls [AGG7R-18, LOW]

**File:** `apps/web/src/lib/image-queue.ts:337, 342`

**Fix:** add `.catch(err => console.debug('purgeExpiredSessions failed:', err))`
to match sibling calls.

**Status:** done (cycle 7 RPL loop).

### T7R-11 — Strip Unicode bidi override characters in CSV export [AGG7R-05, LOW]

**File:** `apps/web/src/lib/csv-escape.ts:16`

**Fix:** extend the strip regex to include U+202A-202E and U+2066-2069.

**Status:** done (cycle 7 RPL loop).

## Implementation order

1. T7R-01 (CSV bypass, security-flavored)
2. T7R-02 (restore lock leak, correctness)
3. T7R-03 (share rollback symmetry)
4. T7R-04 (bytesRead)
5. T7R-05, T7R-06 (docs)
6. T7R-07, T7R-08 (tests)
7. T7R-09, T7R-10 (polish)
8. T7R-11 (bidi strip)

One commit per task. Mine each commit with
`~/flash-shared/gitminer-cuda/mine_commit.sh 7` after signing.

## Gate policy

After all tasks land:
- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm test --workspace=apps/web`
- `npm run build --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web` (best-effort)

All must pass before `npm run deploy`.
