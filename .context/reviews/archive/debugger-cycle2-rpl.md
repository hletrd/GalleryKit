# debugger — cycle 2 rpl

HEAD: `00000006e`.

## Latent bug sweep

### DBG2R-01 — `updatePassword` swallows Next.js control-flow signals in the outer catch
- **Citation:** `apps/web/src/app/actions/auth.ts:382-393`.
- **Severity / confidence:** MEDIUM / HIGH.
- **How to trigger:** if any code path inside the outer try ever throws a Next.js internal signal (e.g., `notFound()` from `getCurrentUser`, a revalidation bailout, a dynamic-rendering error), the outer catch will catch it and return the generic failure. This happens silently — the signal is never propagated.
- **Evidence:** `login` uses `unstable_rethrow(e)` as the first line of each of its two outer catches. `updatePassword` does not. Pattern exists in the codebase, just inconsistently applied.
- **Fix:** insert `unstable_rethrow(e);` as the first line of the catch at line 382.

### DBG2R-02 — `restoreDatabase` `lockRow` destructuring assumes `Object.values(lockRow)[0]` returns the GET_LOCK value
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:260-267`.
- **Severity / confidence:** LOW / MEDIUM.
- **Why it matters:** the query uses an aliased return column name (`AS \`GET_LOCK(name, timeout)\``) and the code then relies on iteration order of `Object.values(lockRow)` to pick the result. mysql2 currently returns keys in the order they appear in the SQL, but if the column alias changes or a future migration adds computed columns, the lookup silently picks the wrong field. Compare to the admin-user delete path at line 186-189 which uses a named alias (`AS acquired`) and reads `lockRows[0]?.acquired`.
- **Fix:** rename the alias to `AS acquired` and read `lockRow.acquired` explicitly. Consistency with the admin-user deletion pattern.

### DBG2R-03 — `getImageIdsForSitemap` has no tie-breaker on `created_at`
- **Citation:** `apps/web/src/lib/data.ts:834-845`.
- **Severity / confidence:** LOW / LOW.
- **Why it matters:** when two images share the same `created_at` down to the second, sitemap ordering is non-deterministic across runs. Not user-visible.
- **Fix:** append `.orderBy(desc(images.created_at), desc(images.id))` for determinism. Low priority.

### DBG2R-04 — `searchImages` `escaped` variable shadows MySQL escape sequences
- **Citation:** `apps/web/src/lib/data.ts:731`.
- **Severity / confidence:** LOW / HIGH (correct).
- **Why it matters:** the code escapes `%`, `_`, and `\` with `\\$&`, which is the right escape for MySQL LIKE patterns. This is correct. Not a bug; confirming on re-read.
- **Fix:** none.

### DBG2R-05 — `image-queue.ts` `cleanOrphanedTmpFiles` does not use `fs.opendir` streaming
- **Citation:** `apps/web/src/lib/image-queue.ts:23-37`.
- **Severity / confidence:** LOW / LOW.
- **Why it matters:** `fs.readdir` reads the whole dir list into memory. `fs.opendir` would stream. With upload directories of 10K+ files this could briefly pin memory. Not a regression; original code is acceptable.
- **Fix:** defer.

## Summary
One actionable latent bug (DBG2R-01 — missing `unstable_rethrow` in `updatePassword`) agreeing with CR2R-01/CRIT2R-02. DBG2R-02 is a small consistency nit worth picking up opportunistically.
