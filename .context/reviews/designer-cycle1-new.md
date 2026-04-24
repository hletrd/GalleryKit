# designer — cycle 1 (new)

Scope: UI/UX review. The repo has a web frontend (Next.js App Router), so UI/UX review is in scope.

> Model-visibility caveat: findings below rely on structural/textual evidence (selectors, component props, Tailwind classes). Screenshots under `.context/home-*.png` / `.context/photo-*.png` are retained for human reviewers.

## Findings

### UX1-01 — Unauthenticated `/admin` login page renders full authenticated chrome
- **Citation:** `apps/web/src/app/[locale]/admin/layout.tsx:4-22`; `components/admin-header.tsx`; `components/admin-nav.tsx`
- **Severity / confidence:** MEDIUM / HIGH
- **Issue:** Login page shows the full 8-link admin nav and a logout affordance. This is contradictory UX ("I haven't logged in yet, but I have a logout button") and clutters the login focus area. On mobile the 8-link nav bar overflows horizontally inside `overflow-x-auto scrollbar-hide`, producing a scrollable strip with no scrollbar cue on top of the still-visible login form.
- **Fix:** Branch the layout on auth state; render a minimal login shell when unauthenticated.

### UX1-02 — Admin nav has no visible scroll affordance on mobile
- **Citation:** `apps/web/src/components/admin-nav.tsx:27` — `overflow-x-auto scrollbar-hide`
- **Severity / confidence:** LOW / MEDIUM
- **Issue:** Users cannot tell the list is scrollable. Consider a subtle fade-gradient mask or at least removing `scrollbar-hide` on narrow breakpoints.
- **Disposition:** UX polish; deferrable.

### UX1-03 — Image title edit does not reflect server-side sanitization
- **Citation:** `apps/web/src/components/image-manager.tsx:226-243`
- **Severity / confidence:** LOW / HIGH
- **Issue:** After a successful save, the dialog displays the pre-trim user input. Users who pasted trailing whitespace see it persist in the UI until next refresh.
- **Fix:** Use the server-returned normalized value.

### UX1-04 — Admin settings GPS toggle coverage
- **Citation:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- **Severity / confidence:** MEDIUM / MEDIUM
- **Issue (revalidation):** The cycle-6 designer note called out that the GPS toggle is not exercised by tests. The fix is a non-destructive Playwright assertion that flipping the toggle reflects in the hydrated UI.

### UX1-05 — Designer's earlier "public controls inert after click" claim is stale
- **Citation:** `apps/web/e2e/public.spec.ts:19-35, 49-63`; `apps/web/e2e/nav-visual-check.spec.ts:15-23`
- **Severity / confidence:** LOW / HIGH
- **Disposition:** Invalidated/stale. Current tests prove the interactions work.

## Positive findings
- Skip link in the admin layout preserves keyboard accessibility.
- Admin nav uses `aria-current="page"` on the active link.
