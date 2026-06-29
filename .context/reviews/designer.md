# Designer Review - Cycle 18

Role: designer for cycle 18. Scope: UI/UX review of the Next.js React app,
including public/admin routes, shared components, styles, i18n, accessibility,
keyboard/focus behavior, responsive states, loading/empty/error states, forms,
dark/light mode, and perceived performance. No implementation changes were made.

## Inventory

Reviewed source surfaces:

- Public routes: `/[locale]`, `/[locale]/[topic]`, `/[locale]/p/[id]`,
  `/[locale]/g/[key]`, `/[locale]/s/[key]`, `/[locale]/c/[slug]`,
  `/[locale]/map`, `/[locale]/timeline`, `/[locale]/year/[year]`,
  `/[locale]/privacy`, localized loading/error/not-found shells.
- Admin routes: `/[locale]/admin`, dashboard, categories, tags, SEO, settings,
  password, users, tokens, DB, analytics, protected loading/error.
- Components: nav, search, footer, masonry grid, load-more, photo viewer,
  lightbox, color pip, info sheet, histogram, map, upload dropzone, image
  manager, tag input, bulk edit, admin header/nav, Radix/shadcn primitives.
- Contracts/docs: `AGENTS.md`, `CLAUDE.md`, `messages/en.json`,
  `messages/ko.json`, `globals.css`, `tailwind.config.ts`, Playwright specs,
  touch-target and accessibility-related tests.

Browser validation used Playwright against `http://127.0.0.1:3100`.
Port 3000 was already occupied by a different Next server returning
`/auth/device-login`, so I started this repo with:

```text
npm run dev -- --hostname 127.0.0.1 --port 3100
```

Local MySQL was unavailable (`connect ECONNREFUSED 127.0.0.1:3306`), so the
project E2E wrapper could not seed/init the DB and protected admin/data-heavy
routes could not be fully exercised. Browser checks still covered localized
public error state, unauthenticated admin redirect/login, mobile viewport,
keyboard focus, password visibility toggle, DOM focusability, ARIA snapshots,
computed horizontal overflow, and console/page errors.

Browser evidence:

- `/en` and `/ko` rendered localized route error boundaries. ARIA snapshot for
  `/en`: link "Skip to content", main region "Error", h1 "Error", paragraph
  "Something went wrong loading this page.", buttons "Try again" and
  "Return to Gallery".
- `/admin/dashboard` redirected to `/en/admin`.
- `/en/admin` rendered h1 "Admin", visible Username/Password labels, focused
  the username input, exposed the password visibility button, and toggled
  `#login-password` from `type=password` to `type=text`.
- Mobile 390 px snapshots for reachable states had
  `documentElement.scrollWidth === clientWidth`; no horizontal overflow was
  observed in those DB-limited states.
- Console showed DB-read failures on public route render; no client hydration
  error UI beyond the intended route error boundary was observed.

## Findings

### DES18-01 - Public DB failures still collapse recovery into a self-looping generic error page

Severity: High
Confidence: High
Routes/selectors: `/en`, `/ko`, `main`, ARIA `region "Error"`, link
`"Return to Gallery"`
Files: `apps/web/src/app/[locale]/(public)/page.tsx:151-166`,
`apps/web/src/app/[locale]/(public)/page.tsx:221-223`,
`apps/web/src/app/[locale]/error.tsx:22-53`,
`apps/web/messages/en.json:691-697`,
`apps/web/messages/ko.json:691-697`

Problem:

The home page awaits `getSeoSettings`, `getGalleryConfig`, `getTagsCached`, and
`getTopicsCached` in one `Promise.all`, then awaits `getImagesLitePage`.
When local DB reads failed, the whole public route rendered the generic localized
error boundary. That boundary offers "Return to Gallery", but the target is the
same locale home route via `localizePath(locale, '/')`, so the recovery action
loops back into the same failing render. The error page also omits public nav,
footer, search, locale switching, topic links, or a maintenance explanation.

User failure scenario:

During a DB restart or transient MySQL outage, a visitor opening the gallery
gets a generic "Something went wrong" page. Pressing "Return to Gallery" reloads
the same failing URL, and the user has no way to browse cached/static public
surfaces, switch locale, or understand whether this is maintenance, an empty
gallery, or a broken site.

Suggested fix:

Keep public recovery chrome available in data-failure states. Catch non-critical
home data reads into safe defaults where possible, and render a localized
maintenance/unavailable state for truly blocking failures. If the route error
boundary remains the fallback, include public navigation/footer and make the
secondary action point to a stable recovery route or explanatory status surface
instead of the same route that just failed.

### DES18-02 - First-run Categories has no empty state even though uploads require a category

Severity: Medium
Confidence: High
Routes/selectors: `/en/admin/categories`, categories table body
Files: `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx:10-16`,
`apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:218-264`,
`apps/web/src/components/upload-dropzone.tsx:352-363`,
`apps/web/messages/en.json:154-156`,
`apps/web/messages/ko.json:154-156`

Problem:

`CategoriesPage` passes the fetched topic list directly into `TopicManager`.
`TopicManager` renders table headers and maps `initialTopics`, but unlike
Tags/Users/ImageManager it has no `initialTopics.length === 0` row or empty
panel. This conflicts with the dashboard upload state, which explicitly tells
first-run admins "Create a category before uploading" and links them back to
Categories.

User failure scenario:

A first-run admin follows the dashboard CTA to create the first category. They
land on Categories and see a bordered table with headers and no body content,
plus a small Add button. The product has already told them category creation is
required, but the destination page does not confirm the empty state, explain the
next step, or provide a prominent first-category action.

Suggested fix:

Add a localized empty row or empty-state panel to `TopicManager` when
`initialTopics.length === 0`. Reuse the dashboard language: state that uploads
need a category, explain what category name/slug/order do, and present the Add
dialog trigger as the primary first action. Add `categories.noCategories` keys
for English/Korean and keep the table accessible with either a `colSpan` row or
an out-of-table first-run panel labelled by the page heading.

### DES18-03 - One-time upload token can be dismissed before copying with no recovery path

Severity: High
Confidence: High
Routes/selectors: `/en/admin/tokens`, token plaintext dialog
Files: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:57-69`,
`apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:184-210`,
`apps/web/src/components/ui/dialog.tsx:50-88`,
`apps/web/messages/en.json:823-825`,
`apps/web/messages/ko.json:873-875`

Problem:

After token creation, `setCreatedPlaintext(result.plaintext)` opens a normal
Radix `Dialog`. Any dialog close event runs `setCreatedPlaintext(null)`, and
`DialogContent` renders the default close button plus default outside-click/Esc
close behavior. The copy warns that the bearer token "will not be shown again",
but the UI allows accidental dismissal before the admin copies it.

User failure scenario:

An admin generates a Lightroom/upload token, then presses Esc out of habit,
clicks the backdrop, or hits the close icon before copying. The plaintext token
is erased from client state and cannot be retrieved. They must revoke or ignore
the orphan token, create another one, and may not understand which token is safe
to keep.

Suggested fix:

Make the one-time secret dialog explicitly non-accidental. Disable outside-click
and Esc close until the admin clicks "I have copied the token", or require a
copy action before enabling Done. Consider hiding the default close icon for
this dialog (`showCloseButton={false}`) and adding a destructive-style "Discard
without copying" secondary action if early dismissal is still needed.

### DES18-04 - Token revoke confirmation uses a generic dialog and can hide in-flight feedback

Severity: Medium
Confidence: High
Routes/selectors: `/en/admin/tokens`, revoke confirmation dialog
Files: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:73-83`,
`apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:213-234`,
contrast with
`apps/web/src/components/admin-user-manager.tsx:179-204` and
`apps/web/src/components/image-manager.tsx:384-416`

Problem:

Revoking a token is destructive, but the tokens page uses generic `Dialog`
instead of `AlertDialog`. Its `onOpenChange` always clears `confirmRevokeId`,
even while `isPending` is true. Other destructive admin flows use the stronger
settle-before-close `AlertDialog` pattern so Esc/overlay/cancel are inert during
the async mutation and the in-flight "Deleting..." state remains visible.

User failure scenario:

An admin revokes an upload token, then the dialog closes from Esc/backdrop or a
focus mistake while the server action is pending. The page no longer shows which
token is being revoked or whether the action is still running. For upload API
credentials, that ambiguity is costly: an external client may keep failing while
the admin is unsure whether the token was actually revoked.

Suggested fix:

Convert revoke confirmation to `AlertDialog` and copy the settle-before-close
pattern used by user/image/category deletion. Keep the dialog open while
`isPending`, disable Cancel/overlay/Esc during the request, show a spinner plus
localized "Revoking..." label, then close only after the action settles.

## Positive Observations

- Login is accessible in the reachable browser state: visible labels,
  autofocus, required fields, password reveal with changing accessible name, and
  `role="alert"` error placement in source.
- Core Button sizes preserve the 44 px floor in
  `components/ui/button.tsx:23-30`; many prior-cycle touch-target fixes are now
  encoded directly in components.
- Search and lightbox have explicit focus traps, focus restoration, keyboard
  shortcuts, IME guards, and live-region updates in source.
- Admin destructive flows outside Tokens mostly follow a consistent
  settle-before-close pattern.
- English/Korean strings are broad and mostly parallel; current shipped locales
  are both LTR, matching `getLocaleDirection` behavior.

## Missed-Issues Sweep

- Checked for small touch targets, missing focus-visible affordances, unlabeled
  icon buttons, hidden-but-focusable controls, modal close-label localization,
  table overflow wrappers, toast-only validation, empty/loading/error states,
  public/admin i18n strings, theme toggles, and responsive nav behavior.
- Did not re-report prior-cycle items that now have clear fixes in code, such as
  login labels/password reveal, admin delete in-flight dialogs, dashboard failed
  image retry announcements, 44 px button primitives, and localized dialog close
  labels.
- Browser validation limitations: DB-dependent public gallery content, protected
  admin pages, uploads, authenticated settings/tokens actions, real search
  results, lightbox/photo flows, map data, and analytics tables could not be
  fully exercised because local MySQL was unavailable and no admin session could
  be created. Those surfaces were reviewed statically with exact file evidence.

## Summary

Findings: 4 total: 2 High, 2 Medium, 0 Low.
No code changes, commits, pushes, or deploys were performed.
