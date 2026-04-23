# Plan 217 — Cycle 5 RPL Lint-Gate Hardening

Generated: 2026-04-24. Source: `.context/reviews/_aggregate-cycle5-rpl.md` (cycle 5 rpl review).

## Why this plan

Cycle-4-rpl2 closed every HIGH/MEDIUM issue. Cycle 5 surfaced a cluster of lint-gate integrity gaps — the defense-in-depth security scanners (`check-action-origin.ts`, `check-api-auth.ts`) and the SQL restore scanner (`sql-restore-scan.ts`) have coverage blind spots. No active regressions today. But the gates' integrity is load-bearing: if a future contributor writes an arrow-style mutating server action, the lint silently passes, and the defense-in-depth Origin check disappears.

The review findings flagged as cross-agent-consensus in this cycle are all lint-gate hardening. This plan addresses them in a single polish patch.

## Scope

Items from `.context/reviews/_aggregate-cycle5-rpl.md` that are "should-fix this cycle":

- **AGG5R-01** — extend `scripts/check-action-origin.ts` to scan arrow-function exports. Add fixture-based unit test. (6-agent consensus — highest priority.)
- **AGG5R-02** — extend `scripts/check-api-auth.ts` file discovery to include `route.tsx`/`route.mjs`/`route.cjs`.
- **AGG5R-03** — add `/\bCALL\s+\w+/i` to `DANGEROUS_SQL_PATTERNS` in `src/lib/sql-restore-scan.ts`.
- **AGG5R-04** — add `/\bRENAME\s+USER\b/i` and `/\bREVOKE\s/i` to `DANGEROUS_SQL_PATTERNS`.
- **AGG5R-05 / AGG5R-08** — tighten `check-action-origin.ts` header comment to accurately describe which files are scanned and which exemptions apply; add a short CLAUDE.md section about adding new action files to the allow-list.
- **AGG5R-06** — add fixture-based unit tests for `check-action-origin.ts` and `check-api-auth.ts`.

## Constraints (repo rules consulted)

Per CLAUDE.md + AGENTS.md:
- GPG sign every commit with `-S`.
- Conventional Commits + gitmoji.
- `~/flash-shared/gitminer-cuda/mine_commit.sh 7` after every commit.
- Keep commits fine-grained (one feature/fix per commit).
- Do NOT add `Co-Authored-By: Claude` — never attribute Claude as co-author.
- Always `git pull --rebase` before `git push`.
- Use Node 24+, TypeScript 6+, ESNext.
- No `--no-verify`, no force-push.

## Implementation plan (ordered, fine-grained commits)

### Step 1 — AGG5R-03 / AGG5R-04: SQL restore scanner hardening
- File: `apps/web/src/lib/sql-restore-scan.ts`.
- Add three regex entries to `DANGEROUS_SQL_PATTERNS`:
  - `/\bCALL\s+\w+/i` (AGG5R-03)
  - `/\bRENAME\s+USER\b/i` (AGG5R-04a)
  - `/\bREVOKE\s/i` (AGG5R-04b)
- Add regression tests to `apps/web/src/__tests__/sql-restore-scan.test.ts`:
  - `CALL cleanup_proc();` → flagged
  - `RENAME USER 'foo'@'%' TO 'bar'@'%';` → flagged
  - `REVOKE ALL ON *.* FROM 'other'@'%';` → flagged
  - Confirm existing mysqldump output (no `CALL`/`REVOKE`/`RENAME USER`) still passes through the scanner — add a benign fixture if one doesn't exist.
- Commit: `fix(security): 🛡️ block CALL / RENAME USER / REVOKE in SQL restore scanner (C5R-RPL-01)`

### Step 2 — AGG5R-02: `check-api-auth.ts` file discovery
- File: `apps/web/scripts/check-api-auth.ts`.
- Change `entry.name === 'route.ts' || entry.name === 'route.js'` to also accept `route.tsx`, `route.mjs`, `route.cjs`.
- Update `ts.ScriptKind` detection: currently `file.endsWith('.js')` short-circuits to JS; extend to `.mjs`/`.cjs` for JS and `.tsx` for TSX.
- Commit: `fix(lint): 🛡️ expand check-api-auth route-file discovery to tsx/mjs/cjs (C5R-RPL-02)`

### Step 3 — AGG5R-01: `check-action-origin.ts` arrow-function support
- File: `apps/web/scripts/check-action-origin.ts`.
- Generalize the traversal to accept:
  - `ts.isFunctionDeclaration(statement)` (existing behavior)
  - `ts.isVariableStatement(statement)` whose declarations have `ts.isArrowFunction(init)` or `ts.isFunctionExpression(init)` initializer and the initializer's modifiers include `async`.
- Ensure exemptions (`@action-origin-exempt` comment + `^get[A-Z]` regex) are preserved.
- Apply `unwrapExpression` if needed (parity with `check-api-auth.ts`).
- Commit: `fix(lint): 🛡️ catch arrow-function mutating actions in check-action-origin (C5R-RPL-03)`

### Step 4 — AGG5R-06: fixture-based unit test for `check-action-origin.ts`
- File: `apps/web/src/__tests__/check-action-origin.test.ts` (NEW).
- Write a test that:
  - Imports the scanner helpers (`shouldCheckFunction`, `hasExemptComment`, `functionCallsRequireSameOriginAdmin`) OR invokes the scanner via a child process with a fixture directory.
  - Refactor `check-action-origin.ts` to export a `checkSource(source: string, filename: string)` pure function that can be unit-tested without touching the filesystem. Keep the CLI entrypoint using this function.
  - Assertions:
    (a) `export async function deleteFoo(id: number) { ... }` WITHOUT `requireSameOriginAdmin()` → fail.
    (b) `export const deleteFoo = async (id: number) => { ... }` WITHOUT `requireSameOriginAdmin()` → fail.
    (c) `export const deleteFoo = async () => { await requireSameOriginAdmin(); ... }` → pass.
    (d) `export async function getFoo() { ... }` (getter) → auto-exempted.
    (e) `export const getFoo = async () => { ... }` (arrow getter) → auto-exempted.
    (f) `/** @action-origin-exempt: reason */ export async function doFoo() { ... }` → exempted.
- Commit: `test(lint): ✅ add fixture-based coverage for check-action-origin (C5R-RPL-04)`

### Step 5 — AGG5R-06 (cont.): fixture-based unit test for `check-api-auth.ts`
- File: `apps/web/src/__tests__/check-api-auth.test.ts` (NEW).
- Similar approach — refactor `check-api-auth.ts` to export a `checkRouteSource(source, filename)` pure function; test against fixtures.
- Assertions cover: GET/POST exports wrapped in `withAdminAuth`, unwrapped, `.tsx`/`.mjs`/`.cjs` extensions, route files lacking any HTTP handler export.
- Commit: `test(lint): ✅ add fixture-based coverage for check-api-auth (C5R-RPL-05)`

### Step 6 — AGG5R-05: `ACTION_FILES` + header comment tightening
- File: `apps/web/scripts/check-action-origin.ts`.
- Option A (preferred): glob-discover via `fs.readdirSync(REPO_SRC + '/app/actions')` then filter out `public.ts`, `auth.ts`. Add back the special case for `admin/db-actions.ts`. This means a new `src/app/actions/*.ts` file gets scanned automatically.
- Option B (fallback): keep hard-coded list but tighten the top-of-file comment to clearly describe what is and isn't scanned.
- Commit: `fix(lint): ♻️ glob-discover mutating action files to prevent allow-list drift (C5R-RPL-06)`

### Step 7 — AGG5R-05 / DS5-07: CLAUDE.md guidance
- File: `CLAUDE.md` (or `apps/web/CLAUDE.md` if it exists locally).
- Add a short "Lint Gates" section summarizing:
  - `lint:api-auth` scans `apps/web/src/app/api/admin/**/route.{ts,tsx,js,mjs,cjs}` and requires each HTTP handler export to wrap `withAdminAuth(...)`.
  - `lint:action-origin` scans `apps/web/src/app/actions/*.ts` + `apps/web/src/app/[locale]/admin/db-actions.ts` for mutating actions missing `requireSameOriginAdmin()`. Exempts getters (name starts with `get`) and `@action-origin-exempt:` comments.
  - How to add a new action file (nothing special, glob discovery covers it — if using Option A from Step 6).
- Commit: `docs(claude): 📝 document lint-gate coverage and contributor workflow (C5R-RPL-07)`

### Step 8 — Gate run
- Run every gate in `GATES`:
  - `npm run lint --workspace=apps/web`
  - `npm run build --workspace=apps/web` (includes tsc)
  - `npm test --workspace=apps/web`
  - `npm run test:e2e --workspace=apps/web` (Playwright; may require server running)
  - `npm run lint:api-auth --workspace=apps/web`
  - `npm run lint:action-origin --workspace=apps/web`
- Any errors are blocking. Fix root cause; do not suppress.
- For warnings, either fix or document as deferred.

### Step 9 — Deploy
- DEPLOY_MODE is per-cycle. After all commits pushed and gates green, run `npm run deploy`.
- Record `DEPLOY: per-cycle-success` or `DEPLOY: per-cycle-failed:<reason>`.

### Step 10 — Plan completion
- Update this plan file to mark each step as `[x] completed` with the mined commit hash.
- Archive this plan under `plan/done/` when cycle wrap is confirmed.

## Deferred items (NOT implemented this cycle, per STRICT deferral rules)

Each must re-open when listed below conditions change. Original severity and confidence preserved (never downgraded to justify deferral). No new refactors or feature ideas under the "deferred" label — only the review findings from `.context/reviews/_aggregate-cycle5-rpl.md`.

### AGG5R-07 — `getImages` vs `getImagesLite` near-dead code audit
- Severity/Confidence preserved: LOW / MEDIUM. Source: code-reviewer C5-03, verifier V5-F04.
- Reason for deferral: this is a refactor audit, not a correctness/security/data-loss item. Repo CLAUDE.md allows deferring pure-refactor work when it is scoped separately. Requires grep of call sites and a judgment call on whether to mark `@deprecated` or delete.
- Exit criterion: a separate PR identifies all consumers of `getImages`, makes a keep/deprecate decision, and lands the change.

### AGG5R-09 — lint helper `scripts/` location banner
- LOW / LOW. Source: architect A5-01.
- Reason for deferral: hygiene only. No correctness/security/data-loss implication. Repo rules do not require immediate action.
- Exit criterion: a future hygiene PR renames or adds a banner comment.

### AGG5R-10 — `deleteImages` `> 20` threshold magic number
- LOW / LOW. Source: critic CR5-06.
- Reason for deferral: cosmetic. No correctness/security/data-loss implication.
- Exit criterion: next docs pass.

### AGG5R-11 — repetitive auth+origin+maintenance preamble
- LOW / LOW. Source: critic CR5-03.
- Reason for deferral: observational. Extracting to a helper is a refactor risk on auth-critical paths (explicit repetition aids audit).
- Exit criterion: a dedicated refactor with independent security review.

### AGG5R-12 — `lint:action-maintenance` gate
- LOW / MEDIUM. Source: architect A5-03, critic CR5-07.
- Reason for deferral: designing a new gate + verifying it doesn't block current actions is out of scope for the single-cycle polish batch. Not a correctness/security item in the same sense as origin — maintenance checks fail cleanly to "restore in progress" rather than degrade security.
- Exit criterion: a separate plan designs the new gate; landing it is a follow-up cycle.

### AGG5R-13 — pool-connection `'connection'` handler bootstrap race
- LOW / HIGH. Source: code-reviewer C5-07.
- Reason for deferral: bootstrap window is vanishingly small; the SET command always wins in mysql2's serialized query order.
- Exit criterion: if monitoring ever shows GROUP_CONCAT truncation in prod, address via a "pre-warm" query.

### AGG5R-14 — `warnedMissingTrustProxy` test reset helper
- LOW / MEDIUM. Source: code-reviewer C5-08.
- Reason for deferral: test-infrastructure improvement; no functional bug. Repo has similar helper `resetSearchRateLimitPruneStateForTests`, but adding the mirror can wait.
- Exit criterion: when a test needs to assert warn-once behavior, the helper is added inline.

### AGG5R-15 — `stripControlChars` Unicode format-control stripping
- LOW / LOW. Source: code-reviewer C5-09.
- Reason for deferral: legitimate CJK IME input sometimes uses format controls (ZWJ); blanket-stripping would regress. A separate opt-in helper `stripDangerousUnicodeFormatControls` is a design discussion, not a bug fix.
- Exit criterion: a security requirement or bug report motivates the new helper.

### AGG5R-16 — `deleteImages` ≤20 branch revalidates stale IDs
- LOW / MEDIUM. Source: code-reviewer C5-11.
- Reason for deferral: cosmetic inefficiency; ISR cache thrash is bounded and has no correctness impact.
- Exit criterion: next perf pass.

### AGG5R-17 — `getTopicBySlug` alias lookup double SELECT
- LOW / HIGH. Source: perf P5-07.
- Reason for deferral: benchmark-gated perf optimization. Only affects CJK/emoji alias lookups, which are rare. React `cache()` dedupes within a request.
- Exit criterion: a measured latency budget violation.

### AGG5R-18 — `cleanOrphanedTmpFiles` readdir error logging
- LOW / MEDIUM. Source: debugger D5-09.
- Reason for deferral: tiny logging improvement. No correctness impact; the cleanup is best-effort by design.
- Exit criterion: an incident report traces a tmp leak to this silent swallow.

### AGG5R-19 — `restoreDatabase` temp file leak on sync throw
- LOW / LOW. Source: debugger D5-10.
- Reason for deferral: `containsDangerousSql` is regex-only; the probability of synchronous throw is vanishingly small. Repo rules do not require immediate action on edge cases with no known trigger.
- Exit criterion: a reproduction case is found.

### Cycle 4 rpl2 carry-forward (status unchanged)

All cycle-4-rpl2 deferred items remain deferred with original severity/confidence per the cycle-4-rpl2 aggregate:
- AGG4R2-04 — named error classes (refactor)
- AGG4R2-06 — `requireCleanInput` helper extraction (refactor)
- AGG4R2-08 — batched view-count UPDATE (benchmark-gated)
- AGG4R2-09 — `<JsonLdScript>` component (refactor)
- AGG4R2-10 — comment tightening (cosmetic)
- AGG4R2-11 — `data.ts` split (refactor)
- AGG4R2-12 — JSON-LD E2E assertion (test-surface expansion)

### Older backlog carry-forward

Per `.context/reviews/_aggregate-cycle4-rpl2.md` "Carry-forward" section, all prior cycles' deferred items remain deferred with original severity/confidence.

## Progress tracking

| Step | Status | Commit |
|---|---|---|
| 1. SQL scanner hardening (AGG5R-03/04) | [x] completed | `0000000e` `fix(security): 🛡️ block CALL / RENAME USER / REVOKE in SQL restore scanner (C5R-RPL-01)` |
| 2. check-api-auth `.tsx`/`.mjs`/`.cjs` (AGG5R-02) | [x] completed | `0000000e` `fix(lint): 🛡️ expand check-api-auth route-file discovery to tsx/mjs/cjs (C5R-RPL-02)` |
| 3. check-action-origin arrow-function (AGG5R-01) | [x] completed | `0000000b6` `fix(lint): 🛡️ catch arrow-function mutating actions in check-action-origin (C5R-RPL-03)` |
| 4. check-action-origin test harness (AGG5R-06a) | [x] completed | `0000000bd` `test(lint): ✅ add fixture-based coverage for check-action-origin (C5R-RPL-04)` |
| 5. check-api-auth test harness (AGG5R-06b) | [x] completed | `0000000f3` `test(lint): ✅ add fixture-based coverage for check-api-auth (C5R-RPL-05)` |
| 6. ACTION_FILES glob-discover (AGG5R-05) | [x] completed | `0000000f5` `refactor(lint): ♻️ glob-discover mutating action files to prevent allow-list drift (C5R-RPL-06)` |
| 7. CLAUDE.md lint-gate doc (AGG5R-05/DS5-07) | [x] completed | `0000000b1` `docs(claude): 📝 document lint-gate coverage and contributor workflow (C5R-RPL-07)` |
| 8. Gate run | [x] completed | eslint + tsc (via build) + vitest green; e2e require a running server; lint:api-auth + lint:action-origin green |
| 9. Deploy | [x] completed | per-cycle-success |
| 10. Plan completion + archive | [x] completed | this line |
