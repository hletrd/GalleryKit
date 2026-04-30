# Plan 307 — Cycle 2/100 RPF loop fixes

**Source reviews:** `.context/reviews/_aggregate.md` (cycle 2)
**HEAD baseline:** `36ae23a perf(photo-viewer): ⚡ memoize blur backgroundImage style`
**Status:** PENDING

## Findings to address (all from `_aggregate.md` cycle 2)

### A — AGG2-M01 / TE2-MED-01 / V2-MED-01 / D2-MED-01 / CR2-MED-01 — Dedicated admin-login touch-target audit is a silent no-op

**Severity:** Medium · **Confidence:** High · **Reviewer agreement:** 4/11

**File:** `apps/web/src/__tests__/touch-target-audit.test.ts:329-334`

The dedicated `it('finds no < 44 px touch targets in admin login form')` block resolves a path that does not exist (`adminDir` already terminates in `[locale]/admin`, then the test concatenates another `[locale]/admin` segment). `fs.existsSync()` returns `false` and the early `return` aborts the test before `expect()` runs.

**Tasks:**
- A1. Change the path to `path.resolve(srcRoot, 'app', '[locale]', 'admin', 'login-form.tsx')`.
- A2. Replace the silent `if (!fs.existsSync(loginForm)) return;` with `expect(fs.existsSync(loginForm)).toBe(true)` so a future move/rename hard-fails.
- A3. Update the file's intent comment alongside `KNOWN_VIOLATIONS['app/[locale]/admin/login-form.tsx']` (lines 173-175) to reflect the now-actually-running dedicated guard.

**Verification:**
- `npm test --workspace=apps/web` — touch-target-audit suite passes with the dedicated block actually running.
- Add a temporary regression: introduce a `<Button size="sm">` in `login-form.tsx`; the dedicated test must fail; revert.

### B — AGG2-L01 / CR2-LOW-01 — Silent skip masks the path bug

Rolls into A2.

### C — AGG2-L02 / D2-LOW-01 — `KNOWN_VIOLATIONS` comment overstates audit coverage

Rolls into A3.

## Out-of-scope / deferred

None. All cycle-2 findings are addressed by this single plan.

## Implementation order

1. A1 — fix the path resolution.
2. A2 — replace silent return with explicit `expect`.
3. A3 — update the in-file comment.
4. Run gates: ESLint, lint:api-auth, lint:action-origin, vitest.
5. Commit + push (single fine-grained commit) with semantic gitmoji message.
6. Deploy via `npm run deploy` (per-cycle).

## Success criteria

- The dedicated `it()` block actually runs `scanFile` and `expect`.
- A future rename of `login-form.tsx` causes a hard failure rather than a silent skip.
- All four gates green.

## Repo-rule compliance

- GPG-sign commit (-S flag).
- Conventional commit + gitmoji.
- No suppressions.
- No force-push.
