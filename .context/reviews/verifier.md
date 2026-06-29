# Verifier Review - review-plan-fix Cycle 2

**Date:** 2026-06-29
**HEAD:** `3d138704` (`master`, in sync with `origin/master`)
**Role:** verifier
**Scope:** read-only repository verification review; no application code edited.

## Inventory

Built inventory before findings:

- Instructions and behavior docs: `AGENTS.md`, `CLAUDE.md`.
- Package and CI metadata: root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/workflows/quality.yml`.
- Current HEAD/worktree: `git status --short --branch`, `git log -1 --stat --oneline --decorate`.
- Source surface: 240 tracked app/package/config source-relevant files across `apps/web/src/app`, `components`, `lib`, `db`, `proxy.ts`, `instrumentation.ts`, `i18n`, messages, configs, package metadata, and workflow metadata; 226 tracked non-test TS/TSX files under `apps/web/src`.
- Test surface: 245 Vitest files under `apps/web/src/__tests__`; 5 Playwright spec files plus helpers/fixtures under `apps/web/e2e`.
- Operational/schema surface: 27 scripts under `apps/web/scripts`; 25 SQL migrations plus 3 Drizzle metadata files.
- Review/plan history: 1663 tracked files under `.context/reviews`; 59 tracked `.context/plans` files; 169 root `plan/` files.

## Fresh Verification Evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| ESLint | PASS | `npm run lint --workspace=apps/web` exit 0 |
| API auth lint | PASS | `npm run lint:api-auth` exit 0; 2 admin API routes OK |
| Action-origin lint | PASS | `npm run lint:action-origin` exit 0; 42 exports checked/skip-exempted |
| Public-route rate-limit lint | PASS | `npm run lint:public-route-rate-limit` exit 0; 6 public route files checked |
| Typecheck | PASS | `npm run typecheck --workspace=apps/web` exit 0; app + scripts clean |
| Vitest | PASS | `npm test --workspace=apps/web` exit 0; 243 files passed, 2 skipped; 2236 tests passed, 4 skipped |

`npm run build --workspace=apps/web` was not run in this verification lane because this repo's `prebuild` rewrites `apps/web/public/sw.js`; I avoided dirtying generated application assets during a no-app-code review.

## Findings

### V-C2-01 - AGENTS.md incorrectly says `.context/plans/` is gitignored

Status: Confirmed
Severity: Low
Confidence: High

Evidence:
- `AGENTS.md:41` states: `.context/plans/` is gitignored and local-only.
- `git ls-files '.context/plans/*'` returned 59 tracked files, including `.context/plans/README.md` and many `.context/plans/done/*.md` entries.

Failure scenario: an agent or contributor following `AGENTS.md` may treat `.context/plans/` artifacts as disposable local state, skip reviewing committed plan history there, or place sensitive/local-only material in a tracked directory under the false assumption that git ignores it.

Suggested fix: update `AGENTS.md:41` to describe the actual split: `.context/reviews/` and existing `.context/plans/` contain committed history, while local-only plan-management artifacts belong in the configured ignored location, or add the missing `.gitignore` rule only if the project truly wants `.context/plans/` to become local-only.

## Risks / Gaps

### V-C2-R1 - Build gate was not re-run in this lane

Status: Risk / verification gap
Severity: Low
Confidence: High

Evidence:
- `AGENTS.md:36` lists `npm run build --workspace=apps/web` as a blocking quality gate.
- `apps/web/package.json:11` runs `prebuild`, which executes `tsx scripts/build-sw.ts`; current project practice treats `public/sw.js` as generated-but-committed.

Failure scenario: a build-only error could exist despite lint/typecheck/Vitest passing. I did not observe one; this is a verification gap caused by avoiding a generated app-asset rewrite during a no-application-code review.

Suggested fix: run build in a controlled lane that either expects and commits the service-worker stamp or first verifies whether `build-sw.ts` is a no-op for the current HEAD. A future verifier helper could perform a dry-run/stamp check without mutating `sw.js`.

## Non-Findings Verified

- Public route rate-limit lint is now wired at root and CI: root `package.json:21` and `.github/workflows/quality.yml:64` both invoke it.
- Vitest now discovers `.test.tsx`: `apps/web/vitest.config.ts:17` includes `src/__tests__/**/*.test.{ts,tsx}`.
- Valid `/s/[key]` e2e coverage is no longer skipped: `apps/web/scripts/seed-e2e.ts:43` fixes `E2E_SHARE_KEY = 'Abc234Def6'`, `seed-e2e.ts:231` assigns it to the first image, and `apps/web/e2e/public.spec.ts:82-90` exercises the valid route.
- The old inert caption mock is fixed: `apps/web/src/__tests__/image-queue-settings-wiring.test.ts:87` mocks `@/lib/caption-generator`, matching the real import at `apps/web/src/lib/image-queue.ts:21`.
- Touch-target audit now covers app-level error/not-found/layout/loading files outside `SCAN_ROOTS`: `apps/web/src/__tests__/touch-target-audit.test.ts:59-65` and `:739-744`.

## Final Sweep

Checked for focused tests (`.only`), skipped tests, screenshot-only visual tests, stale source-contract tests, root/CI script drift, migration/test inventory, and prior current review/plan docs. No critical/high correctness blockers were found. Remaining actionable issues are one confirmed documentation mismatch and the test-engineer coverage gaps recorded separately in `test-engineer.md`.
