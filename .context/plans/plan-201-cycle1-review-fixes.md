# Plan 201 — Cycle 1 Review Fixes

**Status:** DONE
**Source review:** `.context/reviews/_aggregate.md`
**Scope:** Implement every new finding from AGG-01 through AGG-05 in this cycle; no review finding is deferred.

## Findings covered

| ID | Title | Severity | Confidence | Source citation |
| --- | --- | --- | --- | --- |
| AGG-01 | Forwarded-header trust bypasses login same-origin validation when `TRUST_PROXY` is off | HIGH | HIGH | `apps/web/src/lib/request-origin.ts:28-41`, `apps/web/src/app/actions/auth.ts:92-95`, `apps/web/src/lib/rate-limit.ts:58-75` |
| AGG-02 | Desktop photo-nav buttons remain visually hidden for keyboard users | MEDIUM | HIGH | `apps/web/src/components/photo-navigation.tsx:208-233` |
| AGG-03 | Playwright E2E starts the app with `next start` despite standalone output | LOW | HIGH | `apps/web/playwright.config.ts:54-61`, `apps/web/next.config.ts:53` |
| AGG-04 | Missing regression test for spoofed forwarded headers | MEDIUM | HIGH | `apps/web/src/__tests__/request-origin.test.ts:1-58` |
| AGG-05 | No automated coverage for keyboard-only reveal of photo-nav controls | LOW | MEDIUM | `apps/web/src/components/photo-navigation.tsx:208-233`, `apps/web/e2e/*` |

## Implementation tasks

### Task 1 — Align request-origin proxy trust with `TRUST_PROXY` [AGG-01]
**Files:**
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/__tests__/request-origin.test.ts`

**Changes:**
1. Add the same trust gate already used by `getClientIp()` so `x-forwarded-host` and `x-forwarded-proto` are ignored unless `process.env.TRUST_PROXY === 'true'`.
2. Preserve existing valid behavior for trusted-proxy deployments, including default-port normalization.
3. Add regression coverage for:
   - spoofed forwarded headers rejected when `TRUST_PROXY` is unset
   - forwarded headers accepted when `TRUST_PROXY=true`
   - existing host/origin behavior unchanged in local dev

**Exit criterion:** Auth same-origin validation can no longer be bypassed with attacker-controlled forwarded headers in untrusted-proxy deployments.

### Task 2 — Reveal photo-nav controls on keyboard focus [AGG-02, AGG-05]
**Files:**
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/__tests__/lightbox.test.ts` or another focused UI test file if a unit-level assertion is more practical than Playwright

**Changes:**
1. Add focus-driven visibility (`group-focus-within` or equivalent) to the desktop prev/next button wrappers.
2. Add a regression test that proves the intended focus-state classes/behavior remain present.
3. Keep mobile behavior unchanged.

**Exit criterion:** Desktop keyboard users can visually discover the prev/next controls when focus enters the navigation area.

### Task 3 — Make Playwright boot the standalone artifact cleanly [AGG-03]
**Files:**
- `apps/web/playwright.config.ts`

**Changes:**
1. Replace `npm run start -- --hostname ... --port ...` with a standalone-server launch path after `npm run build`.
2. Pass `HOSTNAME` and `PORT` explicitly so the server matches the configured base URL.
3. Keep remote E2E behavior unchanged.

**Exit criterion:** `npm run test:e2e --workspace=apps/web` runs without the current `next start` + standalone warning and still passes.

## Deferred items
- None. All findings from this cycle's aggregate review are scheduled for implementation in this plan.

## Progress
- [x] Task 1 — Align request-origin proxy trust with `TRUST_PROXY`
- [x] Task 2 — Reveal photo-nav controls on keyboard focus
- [x] Task 3 — Make Playwright boot the standalone artifact cleanly


## Verification evidence
- `npm run lint --workspace=apps/web` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅
- `npm test --workspace=apps/web` ✅ (171 tests)
- `npm run test:e2e --workspace=apps/web` ✅ (12 passed / 3 skipped)
- `npm run build` ✅

## Warning follow-up
- Remaining non-blocking warnings were recorded in `.context/plans/202-deferred-cycle1-gate-warnings.md`.
