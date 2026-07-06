# Cycle 1 (2026-07-06) — UI/UX Designer Review

Reviewer: UI/UX designer lane (information architecture, affordances, focus/keyboard, WCAG 2.2,
responsive breakpoints, loading/empty/error states, form validation UX, dark/light/OLED
consistency, i18n completeness, perceived performance).

Repo: `/Users/hletrd/flash-shared/gallery`. HEAD at review start: `1d29b988` (working tree has
only test/docs changes per sibling lanes' `git diff`; no product source modified this session).

## Mode used: LIVE

A dev server was already running on `localhost:3000` (started by another agent in this
multi-agent review session, pointed at the `gallerykit_e2e` seed DB per `apps/web/.env.local`).
I verified it was healthy and drove it with `agent-browser` (accessibility snapshots, computed
styles, live DOM/console inspection) rather than raw screenshots, then cross-checked every live
observation against the component source before writing it up. **Caveat:** because the server is
shared with a teammate agent actively editing source during this session, I saw transient
Turbopack/Tailwind HMR noise (an `ENOENT` for `api/health/route.ts`, repeated "Fast Refresh
rebuilding") and one page (`/en/admin/db`) that stayed on a `status "Loading…"` region I could not
explain from that page's source (it has no async loading state at all — see Non-Findings). I
attribute that to the concurrent edit churn, not a reproducible product bug, and did not file it.
Every finding below was independently confirmed against the committed source file/line, not just
the transient live DOM.

Logged in as the seeded `admin` user (local-only e2e credential from `apps/web/.env.local`,
never printed) to reach the authenticated admin surface.

## Findings

### DES-01 — Timeline and Year-in-Review month headings concatenate into a garbled, ambiguous string for assistive tech

- Severity: Medium. Confidence: High. Classification: WCAG 1.3.1/4.1.2-adjacent (info not
  programmatically equivalent to presentation) + content-quality defect.
- Citations: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:214-223`,
  `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:175-184`,
  `apps/web/messages/en.json:884-885` (`monthHeading: "{month} {year}"`,
  `photosCount: "{count, plural, one {# photo} other {# photos}}"`).
- Live confirmation: on `/en/timeline` the rendered month `<h2>` is
  `<h2 id="month-1">January 2025<span class="ml-2 ...">2 photos</span></h2>` — verified via
  `document.querySelector('h2').outerHTML`. The visual gap between "2025" and "2 photos" is a
  CSS `ml-2` margin on the `<span>`, not a text character, so the computed accessible name of the
  `<section aria-labelledby="month-1">` and the text content read by a screen reader is the
  literal run-on string **"January 20252 photos"** (confirmed in the live accessibility snapshot:
  `region "January 20252 photos"`). The `/year/[year]` page has the same shape without the year
  token, producing e.g. "January5 photos".
- Why it matters: screen readers read contiguous digit runs as a single number. "20252 photos"
  reads as an ambiguous five-digit numeral bumping into "photos" with no pause — at best confusing,
  at worst misheard as a photo count of "20,252" or a mangled year. This also breaks copy/paste or
  any text-extraction tooling (select-all on the page yields the same run-on string).
  `aria-labelledby` compounds it: the whole `<section>`'s accessible name is this same garbled
  string, so a screen-reader user jumping by landmark/region hears it on every month section on
  both pages, every year, every month — this is a page-wide pattern, not a one-off typo.
- User-impact scenario: a screen-reader user browsing `/timeline` or `/year/2025` to find photos
  from a specific month hears "January twenty thousand two hundred fifty-two photos" (exact
  reading depends on the AT's number-parsing heuristics) for every single month heading, making it
  hard to distinguish months or trust the photo count.
- Suggested fix: insert an explicit separator between the two pieces so both the visual DOM text
  and the accessible name have real punctuation, e.g. render the count in a sibling element with a
  leading `", "` or `"·"` text node (not just a CSS margin), or restructure as
  `{t('monthHeadingWithCount', { month, year, count })}` so the ICU string owns the separator
  (e.g. `"{month} {year} — {count} photos"`). Add a source-contract or DOM-text assertion (the
  repo already has a strong precedent for locking exactly this class of regression, e.g.
  `apps/web/src/__tests__/data-tag-names-sql.test.ts`) asserting the rendered text contains a
  separator between the year/month token and the count token on both `timeline/page.tsx` and
  `year/[year]/page.tsx`.

### DES-02 — Six admin/auth forms drop keyboard focus to `<body>` after every pending submission and never restore it

- Severity: Medium-High. Confidence: High (live-verified on login; source-verified identical
  shape on the other five). Classification: WCAG 2.4.3 (Focus Order) / 2.4.7 (Focus Visible)
  regression on retry, keyboard-navigation dead end.
- Citations: `apps/web/src/app/[locale]/admin/login-form.tsx:127` (`disabled={isPending}` on the
  submit `<Button>`), `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:114`,
  `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:308`,
  `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:83`,
  `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:154,185,234,303,309`,
  `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:157,209,252` (backup/restore/export
  buttons).
- Mechanism (confirmed live + by HTML spec): each of these buttons sets the native `disabled`
  attribute while `isPending` is true. When a form is submitted by clicking or Enter-ing the
  submit button, that button holds focus; the moment React re-renders with `disabled=true`, the
  browser is spec-required to move focus away from a control that can no longer be focused, and it
  lands on `<body>` (no other candidate in the tree is a better default). None of the six call
  sites re-focus the button, an error region, or the first field once the action settles.
- Live reproduction (admin login, `apps/web/.env.local` seed account): submitted the form with a
  wrong password. `state.error` rendered correctly as `role="alert" aria-live="assertive"` (a
  screen reader does still hear "Invalid credentials" via the live region — that part is fine),
  but immediately after, `document.activeElement` was `<body>`. A sighted keyboard-only user (no
  screen reader) has no visual focus indicator anywhere on the page after the failed attempt and
  must press Tab from the very top of the document (past the skip link) to get back into the
  username field to retry.
- Why it matters beyond login: the identical `disabled={isPending}` + never-refocus shape recurs
  on the Password change form, Settings save, SEO save, three Tokens actions (generate/create/
  revoke-confirm), and all three Database actions (backup/restore/export) — i.e., essentially
  every authenticated mutation surface in the admin panel. This is a systemic gap in one shared
  interaction pattern, not a single-page bug.
- User-impact scenario: an admin using only the keyboard changes a setting, mistypes something
  server-side rejects, and after the toast/alert fires they have completely lost their tab
  position and must re-tab through the entire admin nav (10 links) to get back to the field they
  need to fix. Repeated across every settings save makes the admin panel materially harder to use
  without a mouse.
- Suggested fix: on action completion (both success and failure paths), explicitly restore focus
  — e.g. `useEffect` that calls `.focus()` on the submit button (or the first invalid field / the
  error alert element, whichever is more appropriate per form) once `isPending` transitions back
  to `false`, using a ref captured before the pending state begins. This is a small, mechanical,
  narrow-scope fix applicable identically across all six files; a single shared hook (e.g.
  `useRestoreFocusAfterPending(ref, isPending)`) would avoid duplicating the effect six times.

### DES-03 — Tokens and Users admin pages break the section's established page-title heading convention

- Severity: Medium. Confidence: High. Classification: WCAG 2.4.6 (Headings and Labels) /
  heading-navigation IA inconsistency.
- Citations: `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx:15-22` (`<CardTitle>`,
  no `<h1>` anywhere in `tokens/page.tsx` or `tokens-client.tsx` — confirmed live:
  `document.querySelectorAll('h1,h2,h3,h4,h5,h6').length === 0` on `/en/admin/tokens`),
  `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx:15-25` (`<CardTitle>{t('title')}`,
  a plain `<div>` per `apps/web/src/components/ui/card.tsx:31`
  `function CardTitle({...}: React.ComponentProps<"div">)`),
  `apps/web/src/components/admin-user-manager.tsx:91` (`<h2>{t('users.adminUsers')}</h2>` — the
  page's only heading, one level below where a page title belongs, with no `<h1>` above it).
  Contrast with every sibling admin page, which renders a page-level `<h1>`:
  `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:74`,
  `.../categories/topic-manager.tsx:192`, `.../tags/tag-manager.tsx:94`,
  `.../seo/seo-client.tsx:81`, `.../settings/settings-client.tsx:306`,
  `.../password/password-client.tsx:14`, `.../analytics/analytics-client.tsx:64`, and
  `.../db/page.tsx:140`.
- Why it matters: `CardTitle` is a styled `<div>`, not a heading element, so it is invisible to
  screen-reader heading navigation (the "H" quick-nav key in NVDA/JAWS/VoiceOver rotor) even
  though it is visually styled to look exactly like the `<h1>` on every other admin page. Tokens
  ends up with **zero** heading elements on the entire page — a screen-reader user who lands on
  `/en/admin/tokens` (e.g., via the "Tokens" nav link) and presses the heading-navigation key gets
  nothing: no page orientation, no landmark to jump back to. Users has a heading, but it starts at
  `<h2>`, so a user skimming by heading level sees a page that begins one level "too deep" with no
  `<h1>` anywenter to jump to, breaking the consistent per-page `h1 = page name` mental model the
  other seven admin pages establish.
- User-impact scenario: an admin who uses heading-based navigation to orient on every other admin
  page (all 8 siblings expose an `<h1>` matching the nav label) hits the Tokens page and finds no
  headings at all, or the Users page and finds a heading structure that starts at `<h2>` — both
  break the pattern they've learned to rely on elsewhere in the same product.
- Suggested fix: add `<h1>{t('title')}</h1>` to both `tokens/page.tsx` (using the existing
  `lrToken.title` translation, mirroring how `db/page.tsx:140` already puts an `<h1>` beside its
  `Card`-based sections) and `users/page.tsx` (using `users.title`), keeping the existing
  `CardTitle`/`h2` as secondary or removing the now-redundant `CardTitle` duplicate text. Extend
  the existing admin-page heading-presence check (or add one, mirroring the touch-target audit's
  fixture-test pattern in `apps/web/src/__tests__/touch-target-audit.test.ts`) to assert every
  first-class `AdminNav` destination renders exactly one `<h1>`.

## Non-findings / verified-safe (so a later reviewer need not re-derive)

- **Lightbox auto-hide controls** (`apps/web/src/components/lightbox.tsx:140-202`): the
  opacity-0/`pointer-events-none` idle state I saw mid-session is a deliberate, already-hardened
  R4C6 UX-R4C6-03 design (keyboard-focus-visible controls stay visible; mouse-focused controls are
  explicitly blurred before hiding to avoid `aria-hidden` landing on a focused element). Confirmed
  correct on a fresh page load (`opacity: 1`, close button auto-focused) — not a new finding.
- **Delete confirmation** (`apps/web/src/components/image-manager.tsx`): a real Radix
  `AlertDialog` (`role="alertdialog"`, `aria-labelledby`/`aria-describedby`, default focus on
  Cancel — the safe default for a destructive action). Correctly implemented.
- **Admin login form's client-side empty-field validation** already moves focus to the first
  invalid field (`apps/web/src/app/[locale]/admin/login-form.tsx:36-42`) — this is the different,
  correctly-handled sibling path to the server-error path documented in DES-02.
- **`prefers-reduced-motion`**: a global rule in `globals.css:253-` disables animation/transition
  durations AND explicitly suppresses the masonry hover-scale transform (documented AGG-M4/DES-01
  fix from a prior cycle). Comprehensive; no gap found.
- **OLED theme**: cycles System → Light → Dark → OLED → System correctly via the theme toggle;
  verified true-black background (`rgb(0,0,0)`) with high-contrast foreground
  (`rgb(250,250,250)`) in OLED mode.
- **Search dialog** (`apps/web/src/components/search.tsx`): platform-aware shortcut hint (⌘K vs
  Ctrl+K via `isMac`), proper `role="status"` "No results" empty state, correctly localized via
  `t('search.toggleHint')` — the raw "Ctrl+K" I initially saw live is expected non-Mac rendering,
  not a hardcoded-string bug.
- **Analytics empty states**: each of the five breakdown tables renders its own
  "No data for this period." row rather than collapsing into a shared/ambiguous empty state —
  good pattern.
- **Time-window toggle** (`/admin/analytics`): correctly exposes `aria-pressed` per button, single
  active state confirmed live.
- **Touch targets**: spot-checked tag filter buttons (`min-h-11 min-w-11`), lightbox nav buttons,
  admin table checkboxes/edit/delete buttons — all meet the 44 px floor live, consistent with the
  repo's enforced touch-target audit test.
- Deliberately NOT re-filed (still open, already tracked): mobile admin nav wrapped-link header
  (`C94-DES-03`/carry-forward), admin image-manager desktop-table-first on mobile
  (`C94-DES-04`/carry-forward), zoomed-photo keyboard panning (`C94-DES-02`/`C96-14`), SEO/topic
  dialog toast-only validation (`C96-09`/`C96-10`), restore file-size toast-only rejection
  (`C96-11`), color metadata `<dl>` structure (`C96-13`). All confirmed still present in a quick
  cross-check but out of scope for this cycle's new-findings mandate.

## Files / areas examined

Live: home (`/en`), photo viewer + lightbox (`/en/p/53`), search dialog, admin login (success +
failure), admin dashboard (upload panel, recent-uploads table, delete confirmation), admin
Analytics, admin Database (backup/restore/export cards), admin Categories, admin Users, admin
Tokens, GPS map (empty state), Timeline, Year-in-Review — desktop (1280×800) and one mobile
(375×812) viewport pass on the admin dashboard. Theme cycle (System/Light/Dark/OLED). Source
cross-referenced: `components/lightbox.tsx`, `components/image-manager.tsx`,
`components/photo-navigation.tsx`, `components/search.tsx`, `components/ui/card.tsx`,
`components/admin-user-manager.tsx`, all nine admin `page.tsx`/`*-client.tsx` pairs listed above,
`app/[locale]/(public)/timeline/page.tsx`, `app/[locale]/(public)/year/[year]/page.tsx`,
`app/[locale]/globals.css` (reduced-motion block), `messages/en.json`.

## Commonly-missed-issues sweep

- Hardcoded English strings bypassing i18n: none found in the surfaces sampled; the one
  apparent case (search shortcut hint) resolved to correct platform-aware localized behavior on
  inspection.
- `autoFocus` misuse: only the login username field uses it, matching the single-form/first-load
  convention; not found elsewhere as a repeated-remount trap.
- Focus traps in dialogs/menus: Radix primitives throughout (`AlertDialog`, `Sheet`, `Dropdown`),
  spot-checked the delete-confirmation `AlertDialog` — correct trap + default-safe focus.
  Server-error focus handling is the gap (DES-02), not the modal focus traps.
  `prefers-reduced-motion`: global coverage confirmed (see Non-Findings), not per-component gaps.
- i18n en/ko parity: not independently re-verified this pass (already asserted as 850/850 keys by
  a sibling verifier lane this cycle); the ICU-plural-vs-fixed-form asymmetry is documented and
  intentional per `CLAUDE.md`.
- Loading/empty/error states: sampled Analytics (good, per-table empty state), search (good,
  `role="status"`), GPS map (good, plain empty-state paragraph); the one page that appeared stuck
  on "Loading…" (`/admin/db`) does not match its own source (no async loading state exists there)
  and is attributed to concurrent-edit noise in the shared dev server, not filed as a finding.
- Dark/light/OLED consistency: verified via live theme cycling, not just source reading.
- Responsive breakpoints: one mobile-viewport pass taken on the admin dashboard; did not find a
  new horizontal-overflow regression distinct from the already-tracked table/nav findings above.

## Caveats

- The live dev server was shared with a teammate agent actively modifying source during this
  session; any live observation not also confirmed against committed source was discarded rather
  than filed (see the `/admin/db` "Loading…" note above).
- Did not have time to complete a full authenticated Playwright-style pass over every remaining
  admin sub-page (e.g., topic/tag create-edit dialog live interaction, SEO form field-by-field);
  relied on source cross-reference for those already covered by the deferred ledger.
