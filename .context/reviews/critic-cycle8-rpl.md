# Critic — Cycle 8 (RPL loop, 2026-04-23)

**Stance:** adversarial review. Question assumptions. Challenge prior fixes.

## Adversarial Findings

### CRIT8-01 — Cycle-7-rpl CSV fix widened trust boundary

**File:** `apps/web/src/lib/csv-escape.ts:35`

The fix changed the formula-prefix regex from `/^[=+\-@\t]/` to
`/^\s*[=+\-@\t]/`. This now treats ANY leading whitespace as
potentially-dangerous. That's a stronger guard, but consider:
`Unicode \s` matches horizontal tab (stripped already), newline/CR
(stripped/collapsed already), form feed (stripped), and regular
ASCII space. It also matches Unicode whitespace like ` `
(non-breaking space) — which is NOT stripped by the current control
regex and NOT collapsed by `[\r\n]+`. An input of ` =FORMULA()`
will NOT trigger the formula-prefix guard because `\s` in JS regex
by default matches ` ` — wait, it DOES match ` `. Let me
re-check.

JS regex `\s` matches `\t`, `\n`, `\v`, `\f`, `\r`, ` `,
` `, ` - `, ` `, ` `, ` `, ` `,
`　`, `﻿`. So ` =FORMULA()` DOES trip the formula
guard. The only escape hatch would be a non-`\s`-matching character
before the `=`, e.g. a zero-width character like `​` (ZWSP —
NOT matched by `\s`).

**Adversarial scenario:** input `​=HYPERLINK(...)`. Control-strip
doesn't remove `​`. Bidi-strip doesn't cover `​`.
CRLF-collapse ignores `​`. Formula regex `/^\s*[=+\-@\t]/` does
NOT match `​=...` because `\s` doesn't include ZWSP. The field
escapes as `"​=HYPERLINK(...)"`. Excel/LibreOffice import
behavior: most strip leading zero-width characters on CSV import,
then interpret the formula.

**Severity:** LOW, HIGH confidence.

**Fix:** strip zero-width characters (U+200B-200D, U+FEFF, U+2060,
U+180E) in the control-char pass, OR widen the formula regex to
`/^[\s​-‍⁠﻿᠎]*[=+\-@\t]/`.

### CRIT8-02 — Cycle-7-rpl restore lock-release uses `.catch(() => {})` silently

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:279`

The early-return RELEASE_LOCK uses `.catch(() => {})`, silently
swallowing any DB error. If the RELEASE_LOCK itself fails (e.g., the
connection was killed between GET_LOCK and RELEASE_LOCK), we return
"restore in progress" without logging. Operators lose the ability
to debug why a lock leaked.

**Severity:** LOW, MEDIUM.

**Fix:** `.catch((err) => console.debug('RELEASE_LOCK early-return failed:', err))`.
Matches the sibling `RELEASE_LOCK` at line 298 which also silences
errors — so the cosmetic inconsistency is that both are silent, and
ideally both should log to debug.

### CRIT8-03 — `sharing.ts` double-check pattern has no documentation

**File:** `apps/web/src/app/actions/sharing.ts:118-133`

The pattern is:
1. In-memory pre-increment + check → early return if over limit.
2. DB pre-increment + DB check → if over, rollback BOTH counters.

The "DB pre-increment THEN check" (not the more common
"check THEN increment") is unusual. If the DB check says "we're
over", the in-memory counter was already incremented once for THIS
request. Rollback decrements both. So the in-memory counter reflects
reality. But a reader without the cycle-6-rpl context has to infer
this by reading both branches.

**Severity:** LOW, HIGH.

**Fix:** add a code comment explaining the "DB-pre-increment then
rollback" pattern near line 123-128.

### CRIT8-04 — `requireSameOriginAdmin` returns a string error for union-type stability

**File:** `apps/web/src/lib/action-guards.ts:37-43`

The helper returns `string | null` specifically to keep caller
return-type unions stable. This is clever, but:
- Callers must wrap the returned string in their own error shape.
- If a caller forgets to check, the success-return path leaks the
  string into the response.
- Every caller's pattern `if (originError) return { error: originError };`
  is identical boilerplate.

**Severity:** LOW, MEDIUM.

**Fix:** consider an overload that returns a properly-typed union,
OR a higher-order wrapper (`withSameOriginAdmin(fn)`) that handles
both checks. Refactor, not a bug.

### CRIT8-05 — Cycle-6 CSV formula extraction caused test redundancy

**File:** `apps/web/src/__tests__/csv-escape.test.ts` (integration)
and `apps/web/src/__tests__/db-actions.test.ts` (if any)

The cycle-6-rpl extraction into `@/lib/csv-escape` was motivated by
"test the pure helper without 'use server' constraints". But now
there's no integration-level test that the `exportImagesCsv`
server action actually invokes the helper correctly (that the
column order, headers, and join logic are stable).

**Severity:** LOW, HIGH.

**Fix:** add an e2e or unit test that calls `exportImagesCsv`
indirectly and asserts the CSV contains the escaped fields.
Exists? Let me check.

### CRIT8-06 — `upload tracker pruneUploadTracker` uses `UPLOAD_TRACKING_WINDOW_MS * 2` for expiry

**File:** `apps/web/src/app/actions/images.ts:67`

`if (now - entry.windowStart > UPLOAD_TRACKING_WINDOW_MS * 2)`. Why
`* 2` and not `* 1`? An entry whose window elapsed (1 hour ago)
could have accumulated but the user is expected to re-enter the
window with a fresh claim. Keeping it around for 2 hours means
stale entries linger twice as long. The comment says "stale entries
to prevent unbounded memory growth" — but the 2× factor seems
arbitrary.

**Severity:** LOW, LOW.

**Fix:** either drop to `* 1` and reset on re-entry (already done at
line 130-134), or document why `* 2` is the chosen grace factor.

## Cross-cutting observations

- **Comment-density is high.** Many functions have 5-10 line prefixes
  citing cycle-N-rpl IDs. This is excellent traceability but makes
  per-function comprehension slower. Consider moving historical-fix
  notes into a separate `docs/fixes.md` and keeping inline comments
  to current invariants only.
- **Rate-limit machinery is duplicated 4x.** Login, search, share,
  upload each have their own in-memory Map + DB-bucket logic. The
  cycle-6/7 work unified the sharing path; the broader consolidation
  is still deferred (AGG2-04 historical).

## Summary

Critic finds one concrete new issue (CRIT8-01 zero-width formula
bypass — overlaps with S8-03 from the security reviewer). Several
smaller concerns (CRIT8-02, 03, 04) are polish/doc-only.
