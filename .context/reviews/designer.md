# Cycle 6 — Designer UI/UX Review

Reviewed live surfaces in the running Next.js app:
- Public home: `/en`
- Public photo detail: `/en/p/57`
- Admin login shell: `/en/admin`
- Admin settings: `/en/admin/settings`

Cross-checked source files:
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`

## Confirmed Issues

### 1) Primary public gallery controls are visible but inert
**Files / code regions**
- `apps/web/src/components/nav-client.tsx:65-154`
- `apps/web/src/components/search.tsx:20-205`
- `apps/web/src/components/tag-filter.tsx:9-87`
- `apps/web/src/components/photo-viewer.tsx:248-321`

**What I observed**
- On `/en`, the body renders the tag chips and photo grid as expected, but clicking the `landscape` tag does not change the URL or body text.
- Clicking the `Search photos` button does not open the dialog; the dialog count stays at `0`.
- On a 390px-wide viewport, the mobile expand button remains `aria-expanded="false"` after click, so the hidden search/theme/locale controls never become reachable.
- On `/en/p/57`, clicking the visible `Info` control does not change the body text or reveal the info sidebar.

**Why this is a UX problem**
These are the site’s core discovery and photo-inspection affordances. They are present in the UI, but they do not respond, so the gallery feels broken rather than just “a little rough.” On mobile this is especially damaging because search is hidden behind the failed expand control.

**Failure scenario**
A visitor arrives on mobile, cannot open the nav controls, cannot search, cannot filter by tag, and cannot open the photo info panel. The page looks interactive but behaves like a static poster.

**Suggested fix**
- Treat the main discovery actions as progressive enhancement targets, not only client-state buttons.
- Make tag filters real links whenever possible so they still work without client hydration.
- Verify the `Search`, nav expand, and photo-viewer buttons are actually hydrating and dispatching state changes in the browser build.
- Add e2e checks that assert the URL/dialog/ARIA state changes after interaction.

**Confidence**: High

---

### 2) The unauthenticated admin page shows the full protected shell before login
**Files / code regions**
- `apps/web/src/app/[locale]/admin/layout.tsx:4-19`
- `apps/web/src/components/admin-header.tsx:9-26`
- `apps/web/src/components/admin-nav.tsx:10-45`
- `apps/web/src/app/[locale]/admin/page.tsx:8-15`

**What I observed**
- On `/en/admin`, the body text includes `Dashboard`, `Categories`, `Tags`, `SEO`, `Settings`, `Password`, `Users`, `Database`, and `Log out` before the sign-in form.
- Clicking `Dashboard` on the login page leaves the URL at `/en/admin` because the protected route redirects back.

**Why this is a UX problem**
The login screen is visually crowded with controls that cannot help an unauthenticated visitor. It creates dead-end affordances, makes the page feel already half-authenticated, and adds a needless redirect loop to the first thing a new admin might try.

**Failure scenario**
A first-time admin lands on the login page, clicks a protected tab, gets bounced back, and has to infer that the nav is not actually available yet. The page feels inconsistent and less trustworthy than a minimal auth shell.

**Suggested fix**
- Render a stripped-down admin login shell for the unauthenticated route.
- Only show the protected nav and logout affordances after auth is confirmed.
- Keep the login route visually separate from the operational admin chrome.

**Confidence**: High

---

### 3) Admin settings controls do not provide visible state change on click
**Files / code regions**
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:22-172`

**What I observed**
- After signing in and opening `/en/admin/settings`, the GPS switch reports `aria-checked="false"` before and after clicking it.

**Why this is a UX problem**
A settings panel has to reassure the operator that a toggle actually changed. When a control looks interactive but stays visually and semantically unchanged, users lose confidence in whether the setting was applied.

**Failure scenario**
An admin tries to change a privacy setting, clicks the switch, sees no state change, and cannot tell whether the site is accepting edits at all.

**Suggested fix**
- Confirm the switch handler is wired correctly in the hydrated UI.
- Show immediate visual feedback when settings are toggled or saved.
- Re-test the other admin controls in the same client shell, since they likely share the same interaction path.

**Confidence**: Medium

## Likely Issues

- I did not exhaustively exercise every admin dialog, drop zone, and bulk-action flow in `ImageManager` / `UploadDropzone`, but the tested client controls already behave as no-ops. Those flows should be re-checked before release.

## Risks Requiring Manual Validation

- Loading, empty-state, and error-state components exist in source, but I did not force every possible failure mode through the live app during this pass.
- The interaction failures above suggest broader hydration or event-handling problems; if the build is promoted, I would manually re-test every client-side control path in both the public gallery and admin panel.
