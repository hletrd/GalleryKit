# Run-10 Cycle 28 Designer / UI-UX Accessibility Review

Date: 2026-07-08 KST  
Reviewed HEAD: `22d6ad21`  
Role lane: designer / UI-UX accessibility reviewer

## Scope

Read `AGENTS.md`, `CLAUDE.md`, the attached `agent-browser`, `agent-browser-query`, and `agent-browser-visual` skill instructions, the latest Cycle 27/28 review artifacts, and the current frontend/admin/public source. I reviewed current HEAD only and did not edit application code.

I focused on the Cycle 27 restore-maintenance UI changes, public/admin layouts, landmark and skip-link behavior, focus/keyboard semantics, loading/empty/error states, touch targets, i18n strings, and the Cycle 26 UI coverage carry-forward. I did not duplicate already-tracked deferred items (`AGG-C27-05`, render-level coverage for prior UI fixes).

## Findings

### DES-C28-01 - Restore-maintenance pages nest a second `<main>` inside the layout-owned main landmark

Severity: Medium  
Confidence: High

Code region:

- `apps/web/src/components/public-restore-maintenance.tsx:9-13`
- `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`
- `apps/web/src/app/[locale]/admin/layout.tsx:34-35`
- `apps/web/src/app/[locale]/admin/page.tsx:16-18`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:16-18`
- Representative public usages: `apps/web/src/app/[locale]/(public)/page.tsx:157-159`, `apps/web/src/app/[locale]/(public)/map/page.tsx:35-37`

Problem:

`PublicRestoreMaintenance` renders its own `<main>`, but every current route that returns it is already nested under a layout that owns the page's single `main` landmark and the global skip-link target. Public routes are wrapped by `(public)/layout.tsx`'s `<main id="main-content">`; admin routes are wrapped by `admin/layout.tsx`'s `<main id="main-content">`. During restore maintenance, the DOM therefore becomes `main#main-content > ... > main > section[role=status]`.

That regresses the same landmark ownership pattern the repo already protects for other pages (`privacy-page-landmark.test.ts` asserts the page body must not add a nested `<main>` because the public layout owns it). It also makes the global "Skip to content" target land on the outer main while screen-reader landmark navigation exposes a second inner main for the same page content.

Concrete failure scenario:

A keyboard or screen-reader user opens `/en/admin` or `/en/map` during restore maintenance. Activating "Skip to content" focuses the outer layout main, but landmark navigation then reports another main region inside it. The page has only one maintenance message, yet assistive tech presents two main landmarks, making the page structure noisy and inconsistent with normal public/admin routes.

Suggested fix:

Make `PublicRestoreMaintenance` layout-neutral: change the outer `<main>` to a non-landmark wrapper such as `<div className="mx-auto ...">`, keeping the inner `<section role="status" aria-live="polite">` and `<h1>`. Add a regression test that composes the component with both public/admin layouts, or a source contract that `public-restore-maintenance.tsx` does not contain `<main>`, mirroring the existing privacy-page landmark test.

## Non-Findings / Not Re-Reported

- `DES-C27-01` is fixed at current HEAD: `/admin` now renders restore maintenance before probing `isAdmin()`.
- `AGG-C27-05` remains a known UI test-strength gap for Cycle 26 public fixes; I did not refile it as a current rendered defect.
- Touch-target policy still appears intact on reviewed changed surfaces; no new sub-44 px interactive target was confirmed.

## Verification

- Static source review across `apps/web/src/app/[locale]`, `apps/web/src/components`, `apps/web/messages`, and current Cycle 27/28 artifacts.
- Focused regression slice passed, showing existing tests do not catch the nested-landmark issue:

```text
npm test --workspace=apps/web -- src/__tests__/privacy-page-landmark.test.ts src/__tests__/admin-page-restore-maintenance.test.tsx src/__tests__/protected-admin-restore-maintenance-layout.test.tsx src/__tests__/cycle-28-source-contracts.test.ts

Test Files  4 passed (4)
Tests       12 passed (12)
```

I did not run browser automation against a live app because reproducing the affected DOM requires putting the app into restore-maintenance mode; doing that through the durable marker would mutate local runtime state during a read-only review. The source composition is enough to confirm the current DOM shape.
