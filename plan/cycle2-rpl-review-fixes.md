# Cycle 2 rpl — review fixes plan

Source aggregate: `.context/reviews/_aggregate-cycle2-rpl.md`.

## Repo-policy inputs consulted
- `CLAUDE.md` (project instructions + security architecture section)
- `AGENTS.md` ("keep diffs small, reviewable, and reversible"; gitmoji + conventional commit; GPG sign; commit+push after every enhancement)
- `.cursorrules` *(missing)*
- `CONTRIBUTING.md` *(missing)*
- `docs/` policy/style files *(not present)*
- Existing `plan/cycle1-rpl-review-fixes.md`, `plan/cycle1-rpl-deferred.md`

## Planned implementation tasks

### C2R-01 — Rethrow Next.js control-flow signals in `updatePassword`
- **Source findings:** AGG2R-01 (CR2R-01, CRIT2R-02, V2R-06, DBG2R-01, Trace 2).
- **Files:** `apps/web/src/app/actions/auth.ts`.
- **Severity / confidence:** MEDIUM / HIGH.
- **Goal:** make `updatePassword`'s outer catch consistent with `login`: rethrow framework signals before running the generic-failure fallback, so future refactors that add `redirect`/`notFound`/`revalidatePath` inside the transaction don't silently break.
- **Plan:**
  1. Add `unstable_rethrow(e);` as the first line of the outer `catch (e)` at the existing line ~382 in `auth.ts`.
  2. No other code change required — the rollback path already runs after the rethrow would propagate, so framework signals now propagate cleanly while real errors still hit the rollback.
  3. Add a regression test in `apps/web/src/__tests__/` that asserts the `updatePassword` function file source contains the `unstable_rethrow` pattern (static check, avoids complex mocking of Next.js internals).
- **Progress:** [ ] to implement.

### C2R-02 — Factor `requireSameOriginAdmin` helper + apply to every mutating server action + add `lint:action-origin` gate
- **Source findings:** AGG2R-02 (CR2R-02, SEC2R-01, CRIT2R-01, ARCH2R-01, Trace 1, TE2R-01). Closes the multi-cycle-deferred D1-02.
- **Files:**
  - `apps/web/src/lib/api-auth.ts` or new `apps/web/src/lib/action-guards.ts`
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/app/actions/tags.ts`
  - `apps/web/src/app/actions/topics.ts`
  - `apps/web/src/app/actions/sharing.ts`
  - `apps/web/src/app/actions/admin-users.ts`
  - `apps/web/src/app/actions/seo.ts`
  - `apps/web/src/app/actions/settings.ts`
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/scripts/check-action-origin.ts` (new)
  - `apps/web/package.json` (add `lint:action-origin` script)
  - `apps/web/src/__tests__/action-origin.test.ts` (new, unit coverage for helper)
- **Severity / confidence:** MEDIUM / MEDIUM.
- **Goal:** enforce defense-in-depth same-origin provenance on every mutating server action, matching the asymmetric hardening already applied to `auth.ts`. Add a static gate so future additions can't silently regress.
- **Plan:**
  1. Create helper `requireSameOriginAdmin(t)` that: (a) reads `headers()`; (b) calls `hasTrustedSameOrigin(headers)`; (c) on failure returns `{ error: t('unauthorized') }`; on success returns `null`.
  2. Call helper at the entry of every mutating server action. Order: after `isAdmin()` and `restoreMaintenance` checks (so the existing unauthorized short-circuit still wins).
  3. Add unit test for the helper + a test that mocks `headers()` to return a cross-origin `Origin` header and asserts each action returns the unauthorized error.
  4. Write `apps/web/scripts/check-action-origin.ts` that AST-scans `apps/web/src/app/actions/*.ts` + `apps/web/src/app/[locale]/admin/db-actions.ts` for exported async functions and verifies each either: (a) calls `requireSameOriginAdmin(`, OR (b) has an `// @action-origin-exempt: <reason>` comment. Read-only getters (`getAdminUsers`, `getAdminTags`, `getGallerySettingsAdmin`, `getSeoSettingsAdmin`) remain exempt via the comment; `exportImagesCsv` + `dumpDatabase` should enforce the check. Add as `npm run lint:action-origin --workspace=apps/web`.
  5. Pair the gate change with a note in `CLAUDE.md` "Key Files & Patterns" referencing the new helper.
- **Progress:** [ ] to implement.

### C2R-03 — Use named column alias `AS acquired` in `restoreDatabase` GET_LOCK query
- **Source findings:** AGG2R-03 (DBG2R-02).
- **Files:** `apps/web/src/app/[locale]/admin/db-actions.ts`.
- **Severity / confidence:** LOW / MEDIUM.
- **Goal:** consistency with `admin-users.ts:186-189` pattern; remove reliance on mysql2 column ordering for safety.
- **Plan:**
  1. Rename the alias from `` AS `GET_LOCK(name, timeout)` `` to `AS acquired`.
  2. Replace `Object.values(lockRow)[0]` with `lockRow.acquired`.
  3. Update the TypeScript row type to `(RowDataPacket & { acquired: number | bigint | null })[]`.
  4. Verify the value-comparison still handles both `1` and `BigInt(1)` (mysql2 returns bigint for GET_LOCK under some driver versions).
- **Progress:** [ ] to implement.

## Deferred items

Any review finding not scheduled above is explicitly recorded as deferred in `plan/cycle2-rpl-deferred.md` with severity/confidence preserved, concrete reason, and exit criterion.
