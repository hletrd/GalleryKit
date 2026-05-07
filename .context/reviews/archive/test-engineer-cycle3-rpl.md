# Test Engineer Review — Cycle 3 (RPL loop)

**Date:** 2026-04-23
**Scope:** Test surface audit — vitest unit coverage, e2e Playwright coverage, TDD opportunities.

## Current state

- **Unit tests (Vitest):** 43 files, 221 tests.
- **E2E tests (Playwright):** 4 suites (`nav-visual-check.spec.ts`, `public.spec.ts`, `test-fixes.spec.ts`, `admin.spec.ts`) + `helpers.ts`.
- **Custom lints:** `check-api-auth.ts`, `check-action-origin.ts` (both structural, not runtime tests).

## Coverage gaps observed this cycle

### TE3-01 — No test asserts `<h1>` presence on photo page [MEDIUM]
Connected to C3R-UX-01. No existing test catches that `/p/[id]` renders zero headings. Would have caught the regression if CardTitle had ever been a real heading.
**Fix path:** add a Playwright test: `await expect(page.locator('h1')).toHaveCount(1)` on `/en/p/{id}` and `/ko/p/{id}`.

### TE3-02 — No test asserts locale-switch button has aria-label [LOW]
Connected to C3R-UX-02. Simple add.
**Fix path:** `await expect(page.locator('button[aria-label*="locale"], button[aria-label*="언어"]')).toBeVisible()`.

### TE3-03 — No touch-target size assertion [LOW]
WCAG 2.5.8 regressions would not be caught. Could be part of a dedicated a11y spec.
**Fix path:** enumerate interactive elements at mobile viewport; assert `boundingBox.width >= 24 && height >= 24` for each with known exemption list (sr-only skip link, icon-in-link when part of a 44×44 tappable parent).

### TE3-04 — No heading hierarchy test [LOW]
Connected to C3R-UX-04. Could assert heading levels are monotonic (no skip by more than 1).
**Fix path:** Playwright eval on `document.querySelectorAll('h1,h2,h3,h4,h5,h6')`; assert no skip > 1 between consecutive.

## Healthy observations

- `auth-rate-limit.test.ts`, `rate-limit.test.ts`, `auth-rethrow.test.ts` — robust rate-limit and rollback coverage.
- `tags-actions.test.ts`, `topics-actions.test.ts`, `admin-users.test.ts`, `images-actions.test.ts`, `seo-actions.test.ts` — action-level coverage.
- `action-guards.test.ts` — new-ish test covering `requireSameOriginAdmin`.
- `privacy-fields.test.ts` — compile-time + runtime coverage of GPS/filename exclusion.
- `sql-restore-scan.test.ts`, `db-restore.test.ts`, `restore-maintenance.test.ts` — robust restore flow coverage.
- `sanitize.test.ts`, `validation.test.ts` — input hardening tests.

## Totals

- **0 CRITICAL / HIGH**
- **1 MEDIUM** (TE3-01)
- **3 LOW** (TE3-02/03/04)
- Overall test health: good.
