# GalleryKit Designer UI/UX Review - Cycle 13

Date: 2026-07-07
Workspace: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `bafe639d`
Lane: designer / UI-UX/accessibility reviewer
Mode: review-only. No application source edits, plan edits, commits, pushes, deploys, service changes, Docker/MySQL starts or stops, file removals, or data mutations.

## Scope And Inventory

Instructions followed: `AGENTS.md`, `CLAUDE.md`, and the cycle-13 designer-review prompt. I only wrote this assigned review file.

Reviewed UI-relevant inventory:

- `apps/web/src/app/[locale]/**` and `apps/web/src/components/**`: 111 route/component files inventoried. Covered public home, topic, photo, shared photo/group, smart collection, map, timeline, year archive, privacy/about, not-found/error/loading shells, login, protected admin dashboard/settings/categories/tags/SEO/tokens/users/db/analytics, public/admin nav, search, lightbox, photo viewer, bottom sheet, upload, image manager, tag input, map client, and shadcn/Radix primitives.
- `apps/web/src/app/[locale]/globals.css`, `apps/web/tailwind.config.ts`, `apps/web/messages/en.json`, and `apps/web/messages/ko.json`: reviewed for dark/light/OLED, reduced-motion, forced-colors, touch target policy, i18n parity, labels, empty/error/loading copy, and responsive utilities.
- Review-relevant tests/e2e inventory checked: `touch-target-audit.test.ts`, focus-visible/focus-restore tests, `a11y-us-p15.test.ts`, `i18n-key-parity.test.ts`, password/login a11y tests, search stale/status/short-query tests, map/privacy tests, theme token tests, nav visual e2e, public e2e, hydration, 404, and opt-in admin e2e coverage.
- Non-UI API/feed/upload route files were not exhaustively line-reviewed except where they affect UI metadata, CSP, analytics, or loading/error behavior.

Production browser evidence:

- Used Playwright-style browser automation against `https://gallery.atik.kr` only; no local DB, Docker, or long-lived service was started.
- Checked `/en`, `/ko`, `/en/map`, `/en/timeline`, `/en/privacy`, and `/ko/admin` at `390x844`, `1024x768`, and `1440x900` with reduced motion. Public/admin-login pages returned 200, had one `<main>` with `#main-content`, correct `lang` (`en`/`ko`) and `dir="ltr"`, no horizontal overflow, no visible unnamed buttons, no missing image `alt`, and no visible sub-44 px controls except the intentionally hidden skip link.
- Search interaction on `/en` confirmed `button[aria-label="Search photos"]` opens `#search-dialog[role="dialog"][aria-modal="true"]`, focuses `#search-input`, closes with Escape, and restores focus to the trigger.
- Authenticated protected admin pages were reviewed by source/tests only because no admin auth state was available and the prompt prohibited local long-lived DB/container setup.

## Findings

### DES-C13-01 - Admin category, tag, and SEO save failures remain toast-only

Severity: Medium
Confidence: High

Evidence:

- Category create/update/add-alias errors only call `toast.error(...)`: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90`, `:93-104`, `:108-123`, and `:144-159`.
- The category create and edit forms have labelled inputs but no persistent form alert, `aria-invalid`, error `aria-describedby`, invalid-field focus target, or submit pending state: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:204-221` and `:362-382`. Alias entry repeats the same pattern at `:403-422`.
- Tag update failures are also toast-only at `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:52-65`, while the edit form at `:175-180` lacks inline error/focus wiring.
- SEO save failures render only a toast at `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-70`; fields at `:98-184` expose help text but not server-error state.
- A stronger local pattern already exists in login: `apps/web/src/app/[locale]/admin/login-form.tsx:65-80`, `:92-127`, and `:130-132` wire `aria-invalid`, `aria-describedby`, `role="alert"`, invalid-field focus, autocomplete, and pending submit state.

Failure scenario:

An admin submits a duplicate slug, invalid alias, invalid tag name, disallowed SEO formatting character, invalid OG locale, or invalid OG image URL. The operation fails, a short-lived toast appears, and the dialog/card leaves the failing field visually valid and unfocused. Keyboard and screen-reader users must rediscover which field failed; a user who misses the toast can repeatedly resubmit without actionable guidance. This weakens WCAG 2.2 error identification/suggestion expectations (`3.3.1`, `3.3.3`) and status-message discoverability (`4.1.3`).

Suggested fix:

Reuse the login/settings form conventions. Keep per-form/per-field error state, render persistent `role="alert"` text inside the dialog/card, wire `aria-invalid` and `aria-describedby` to the failed controls, focus the first invalid field or a form-level alert with `tabIndex={-1}`, and disable/show pending text on submit buttons while the server action is in flight.

### DES-C13-02 - Tag autocomplete popovers can be clipped inside the admin image table scroller

Severity: Medium
Confidence: Medium

Evidence:

- The admin image manager wraps the table in a clipping scroll container: `apps/web/src/components/image-manager.tsx:427`.
- Each image row renders `TagInput` inside the tags table cell: `apps/web/src/components/image-manager.tsx:501-534`.
- `TagInput` creates a local positioned ancestor at `apps/web/src/components/tag-input.tsx:183-184`.
- Suggestions render as an absolutely positioned child of that local container at `apps/web/src/components/tag-input.tsx:231-234`; the `z-50` class cannot escape clipping from an overflow ancestor.

Failure scenario:

On a tablet-width admin screen, an admin edits tags in the horizontally scrollable image table. Typing into a row near the scrollport bottom/right edge opens the suggestion list below the row, but the overflow ancestor can clip lower options. Pointer and touch users see a partial list or must awkwardly scroll the table before selecting a suggestion.

Suggested fix:

Render tag suggestions through a portal/popover layer that escapes the table scroll container, or convert `TagInput` to the same Radix Popover/Command-style pattern used by other overlays. Add a regression that mounts `TagInput` inside an `overflow-x-auto` table wrapper and verifies the suggestion list remains visible and selectable.

### DES-C13-03 - Production GA beacons are CSP-blocked on `www.google.com/g/collect`

Severity: Low
Confidence: High

Evidence:

- Production browser checks on `https://gallery.atik.kr/ko`, `/en/map`, `/en/timeline`, `/en/privacy`, and `/ko/admin` logged repeated CSP errors: `Fetch API cannot load https://www.google.com/g/collect... Refused to connect because it violates the document's Content Security Policy.`
- The public layout loads Google Analytics when configured: `apps/web/src/app/[locale]/(public)/layout.tsx:23-31`.
- Middleware passes the site-config GA id into the CSP builder: `apps/web/src/proxy.ts:47-50`.
- The CSP builder allows `https://*.google-analytics.com`, `https://*.analytics.google.com`, and `https://*.googletagmanager.com` in `connect-src`, but not `https://www.google.com`: `apps/web/src/lib/content-security-policy.ts:99-104` and `:153-169`.
- The current CSP test pins that allowlist and does not cover the observed `www.google.com/g/collect` path: `apps/web/src/__tests__/content-security-policy.test.ts:21-27`.
- Current Google Tag Platform CSP guidance includes `www.google.com` in `connect-src` for Google tag traffic: https://developers.google.com/tag-platform/security/guides/csp

Failure scenario:

Visitors still get the lazy GA script cost and console noise, but the beacon can be blocked. Admin analytics, privacy-copy expectations, and any GA-dependent operational decisions undercount traffic for affected browsers/regions.

Suggested fix:

Update the analytics-only CSP allowlist to include the observed `https://www.google.com` connect endpoint when a GA id is configured, without adding advertising hosts such as DoubleClick. Add a unit test for `www.google.com/g/collect` and a production-style browser smoke that fails on GA CSP violations.

## Verified Non-Findings

- Information architecture: public pages expose skip link, main nav, topic/tag discovery, search/theme/locale controls, main content, footer, photo links, map accessible list, timeline/year navigation, and recovery links. Source anchors include `apps/web/src/app/[locale]/layout.tsx:130-149`, `apps/web/src/app/[locale]/(public)/layout.tsx:12-22`, `apps/web/src/components/nav-client.tsx:91-193`, and `apps/web/src/components/footer.tsx`.
- Keyboard/focus: search focus trap/restore is implemented in `apps/web/src/components/search.tsx:340-351` and `:411-565` and was verified in production. Lightbox/info-sheet focus restoration is covered by e2e source in `apps/web/e2e/focus-restore.spec.ts`.
- WCAG target size: production DOM checks found no visible sub-44 px controls apart from the hidden skip link; source policy is reinforced by `apps/web/src/components/ui/button.tsx:24-27`, `apps/web/src/components/ui/input.tsx:11-13`, `apps/web/src/components/ui/switch.tsx:27-49`, and `apps/web/src/__tests__/touch-target-audit.test.ts`.
- Responsive breakpoints: production checks at 390, 1024, and 1440 px found no horizontal overflow on checked public/admin-login flows. Admin tables use explicit scroll wrappers where unavoidable.
- Loading/empty/error states: reviewed photo loading, load more, upload progress, map loading/empty/list fallback, timeline empty years, topic empty state, public error, admin error, and localized not-found recovery.
- Dark/light/OLED, reduced motion, and forced colors: central handling is in `apps/web/src/app/[locale]/globals.css:50-101`, `:164-181`, `:253-279`, and `:289-300`; the mobile admin-login production check rendered in dark mode.
- i18n: production `/ko` and `/ko/admin` rendered `lang="ko"` with localized headings/labels. `apps/web/messages/en.json` and `apps/web/messages/ko.json` have matching UI namespaces, and `i18n-key-parity.test.ts` exists for parity.
- Perceived performance: source review confirmed blur placeholders, aspect-ratio reservation, responsive `sizes`/`srcSet`, `content-visibility` for masonry cards, reduced-motion handling, bounded search/load-more state, and service-worker cache contracts. The only production console/perf-adjacent issue found is DES-C13-03.

## Final Sweep

Final sweep covered landmarks, heading hierarchy, skip links, nav layout, target size, focus-visible coverage, modal/dialog semantics, focus restoration, combobox/listbox patterns, keyboard/Escape paths, mobile nav, horizontal overflow, forms and validation UX, toast vs inline error behavior, loading/empty/error states, dark/light/OLED, forced-colors/reduced-motion, i18n, image CLS reservation, admin tables, upload progress, tag controls, map/timeline fallbacks, analytics/CSP, and public console/page errors.

No additional actionable UI/UX/accessibility findings were identified beyond the three above. Protected admin browser validation remains the main evidence gap because no authenticated production session was available.
