# Cycle 32 Designer UI/UX Review

Reviewer lane: designer. Product code was not edited.

## Evidence

- Read first: `AGENTS.md`, `CLAUDE.md`, and the required agent-browser skill files under `/Users/hletrd/.codex/skills/agent-browser*`.
- File inventory built from `apps/web/src/app`, `apps/web/src/components`, `apps/web/messages`, and admin protected routes.
- Local runtime: `npm run dev --workspace=apps/web -- --port 3022`; Next.js 16.2.9 served `http://localhost:3022`. Public DB-backed pages hit the error shell because local DB reads failed; admin login remained reachable.
- Browser evidence: agent-browser 0.22.2 snapshots, box metrics, computed styles, console/errors, and selector evals.
- Public live evidence: `https://gallery.atik.kr/en` and `/ko` at desktop/mobile. Admin protected browser evidence was limited to local login because authenticated DB-backed admin pages were not reachable in this session.

## Relevant File Inventory

- Public routes: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`, `c/[slug]/page.tsx`, `map/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `privacy/page.tsx`.
- Public UI: `components/nav-client.tsx`, `home-client.tsx`, `tag-filter.tsx`, `search.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `color-details-section.tsx`, `lightbox-color-pip.tsx`, `wide-gamut-hint.tsx`, `load-more.tsx`, `footer.tsx`.
- Admin UI: `app/[locale]/admin/login-form.tsx`, `admin-header.tsx`, `admin-nav.tsx`, `upload-dropzone.tsx`, `image-manager.tsx`, `settings-client.tsx`, `tokens-client.tsx`, `admin-user-manager.tsx`, `db/page.tsx`, `analytics-client.tsx`.
- Global systems: `app/[locale]/layout.tsx`, `app/[locale]/globals.css`, `app/[locale]/error.tsx`, `app/[locale]/loading.tsx`, `app/[locale]/not-found.tsx`, `messages/en.json`, `messages/ko.json`.

## Findings

### D32-UX-01: Lightbox auto-hide removes essential modal controls from assistive technology

- Severity: Medium
- Confidence: High
- Evidence: live mobile `390x844`, opened `/en/p/348`, tapped "Open fullscreen view", waited 3.5 s. Accessibility snapshot contained only `dialog "Photo lightbox"` and the image. Selector eval found buttons still in DOM but hidden from AT and keyboard: Close `{hidden:"true", tabIndex:"-1", style:"none", rect:44x44}`, Fullscreen `{hidden:"true", tabIndex:"-1"}`, Next `{hidden:"true", tabIndex:"-1", rect:64x844}`.
- Source: `apps/web/src/components/lightbox.tsx:270` arms the 3 s hide timer, `apps/web/src/components/lightbox.tsx:371` maps hidden state to `tabIndex=-1` and `aria-hidden=true`, and `apps/web/src/components/lightbox.tsx:546` fades the whole controls overlay to opacity 0. Close/fullscreen/slideshow/prev/next live at `apps/web/src/components/lightbox.tsx:555`, `apps/web/src/components/lightbox.tsx:576`, `apps/web/src/components/lightbox.tsx:600`, `apps/web/src/components/lightbox.tsx:623`, and `apps/web/src/components/lightbox.tsx:644`.
- Impact: a screen-reader, switch-control, or voice-control user who pauses in the modal loses discoverable close and navigation actions until another pointer/focus/key event happens.
- Recommendation: keep close and previous/next controls in the accessibility tree while visually hidden, or provide a persistent visually hidden command group. Visual auto-hide should not equal modal affordance removal.

### D32-UX-02: Mobile home still pushes the first photograph below a large tag wall

- Severity: Medium
- Confidence: High
- Evidence: live mobile `390x844` on `https://gallery.atik.kr/en`; box metrics: filter group `{x:16,y:180,w:358,h:200}`, first photo link `{x:16,y:412,w:358,h:238}`. Snapshot showed all eight tag chips before the `Photos` heading and first card.
- Source: `apps/web/src/components/home-client.tsx:257` lays out heading plus filter ahead of the masonry grid; `apps/web/src/components/home-client.tsx:271` renders `<TagFilter>` before photos; `apps/web/src/components/tag-filter.tsx:63` uses `flex flex-wrap`; each chip is a 44 px button at `apps/web/src/components/tag-filter.tsx:70` and `apps/web/src/components/tag-filter.tsx:88`.
- Impact: first-time mobile visitors see taxonomy controls before enough photography, which weakens the photo-first portfolio experience.
- Recommendation: on small screens, collapse filters behind a `Filters` disclosure, cap visible chips to one row with "More", or switch to horizontal scrolling while keeping active filters visible.

### D32-UX-03: Live search remains unavailable for a visible tag

- Severity: Medium
- Confidence: High
- Evidence: live `https://gallery.atik.kr/en`; visible chip `JIHOON (134)`. Searching `jihoon` produced "Search is temporarily unavailable. Please try again later.", no `#search-results` options, and `results:0`.
- Source: `apps/web/src/components/search.tsx:160` performs the request, `apps/web/src/components/search.tsx:240` calls `searchImagesAction`, `apps/web/src/components/search.tsx:245` maps non-ok status to `searchStatus`, and `apps/web/src/components/search.tsx:473` renders the empty/error message. The server action catches search failure and returns structured `status:'error'` at `apps/web/src/app/actions/public.ts:305`.
- Impact: users try the most obvious discovery mechanism for a tag they can see on the page and get a generic outage message, reducing trust in gallery findability.
- Recommendation: fix the underlying live search failure, then add a graceful fallback for exact visible tag matches or link users to the matching tag filter when full search is unavailable.

### D32-UX-04: Photo card accessible names are verbose and repetitive

- Severity: Low
- Confidence: Medium
- Evidence: live mobile and Korean snapshots show each card link exposes a link label, image alt, visible heading, and topic text. Example: link "View photo: #Color in Music Festival #DOHOON #JIHOON" contains image "Color in Music Festival, DOHOON, JIHOON", heading with the same tags, and topic `TWS`.
- Source: authoritative link label at `apps/web/src/components/home-client.tsx:323`, image alt at `apps/web/src/components/home-client.tsx:353`, mobile overlay heading/topic at `apps/web/src/components/home-client.tsx:395`, and desktop overlay heading/topic at `apps/web/src/components/home-client.tsx:401`.
- Impact: screen-reader browse mode across the masonry grid is unnecessarily noisy.
- Recommendation: when the link `aria-label` is authoritative, hide the decorative overlay copy from AT inside the linked card, or reduce card-image alt verbosity while preserving rich alt text on photo detail pages.

## Positive Coverage

- Admin login validation works well locally: submitting empty Korean login focused the username field, set `aria-invalid=true`, attached `aria-describedby` error ids, surfaced both errors as alerts, and all visible controls measured 44 px high. Source: `apps/web/src/app/[locale]/admin/login-form.tsx:28` and `apps/web/src/app/[locale]/admin/login-form.tsx:62`.
- Dark/light mode is wired and browser-verified. Theme cycling reached `html.dark`; computed body colors changed from `rgb(255,255,255) / rgb(9,9,11)` to `rgb(9,9,11) / rgb(250,250,250)`. Source tokens and contrast notes: `apps/web/src/app/[locale]/globals.css:14`, `apps/web/src/app/[locale]/globals.css:50`, and `apps/web/src/app/[locale]/globals.css:75`.
- Reduced motion and forced-colors coverage are explicit in CSS: `apps/web/src/app/[locale]/globals.css:253` suppresses motion, and `apps/web/src/app/[locale]/globals.css:164` plus `apps/web/src/app/[locale]/globals.css:281` handle high-contrast color surfaces.
- Public loading/error/not-found states are accessible: loading uses `role=status` at `apps/web/src/app/[locale]/loading.tsx:8`; local DB failure rendered an error page with Try Again and Return to Gallery actions from `apps/web/src/app/[locale]/error.tsx:34`; not-found preserves nav/footer at `apps/web/src/app/[locale]/not-found.tsx:20`.
- Admin protected source has substantial UX safeguards: 44 px admin nav links at `apps/web/src/components/admin-nav.tsx:29`, upload no-category empty state with direct category CTA at `apps/web/src/components/upload-dropzone.tsx:373`, upload progress `role=progressbar` at `apps/web/src/components/upload-dropzone.tsx:476`, settings field validation with `aria-invalid` at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:424`, and destructive image operations with confirmation/settle states at `apps/web/src/components/image-manager.tsx:391`.
- Korean localization is complete at key surfaces tested: live `/ko` rendered Korean nav/search/theme/language labels; local `/ko/admin` rendered Korean login labels and validation. Message parity files both have 916 lines.

## Prior-Cycle Status

- D31 duplicate search error announcement appears addressed in source: visible empty/error status is now inside `aria-hidden="true"` at `apps/web/src/components/search.tsx:473`, while the live region remains at `apps/web/src/components/search.tsx:440`.
- D31 lightbox hidden controls, mobile filter wall, live search failure, and repetitive card AT text remain open as D32 findings above.
- Dormant RTL risk remains a future-activation note, not a current English/Korean defect. `dir` is wired at `apps/web/src/app/[locale]/layout.tsx:94`, but several controls still use physical `left/right` classes in `apps/web/src/components/lightbox.tsx:555` and `apps/web/src/components/nav-client.tsx:100`. Do an RTL pass before adding RTL locales.

## Verdict

The UI foundation is strong: touch targets, form validation, localization, color modes, reduced motion, and admin safety messaging are mature. The main cycle-32 priorities should be lightbox accessibility, mobile photo-first IA, and live search reliability.
