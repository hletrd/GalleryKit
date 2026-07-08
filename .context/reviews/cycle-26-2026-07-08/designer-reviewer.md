# Cycle 26 Designer Reviewer

Read-only UI/UX/accessibility lane for commit `101ebef57ae2a379cce4b5fa04dccd538c438b0c`.

## Inspected Inventory

- Project guidance: `AGENTS.md`, `CLAUDE.md`.
- Public photo surfaces: `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/lightbox-color-pip.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/color-details-section.tsx`, `apps/web/src/components/masonry-card.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/components/tag-filter.tsx`.
- Public routes: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`.
- Admin/workflow surfaces: `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/components/admin-nav.tsx`, `apps/web/src/components/admin-user-manager.tsx`, `apps/web/src/app/[locale]/admin/login-form.tsx`, `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`.
- Map and data plumbing: `apps/web/src/components/map/map-client.tsx`, `apps/web/src/lib/data.ts`.
- Localization and tests: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/__tests__/touch-target-audit.test.ts`, `apps/web/src/__tests__/a11y-us-p15.test.ts`, `apps/web/src/__tests__/focus-visible-links-scan.test.ts`, `apps/web/src/__tests__/password-form-a11y.test.ts`, `apps/web/src/__tests__/privacy-page-landmark.test.ts`, `apps/web/src/__tests__/error-shell-heading.test.ts`, plus targeted source-contract scans around lightbox color, search, focus rings, and HDR honesty.

## Validation Evidence

- `git rev-parse HEAD` returned `101ebef57ae2a379cce4b5fa04dccd538c438b0c`.
- `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/a11y-us-p15.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/password-form-a11y.test.ts src/__tests__/privacy-page-landmark.test.ts src/__tests__/error-shell-heading.test.ts` passed: 6 files, 50 tests.
- I used textual DOM/source/test evidence only; no screenshot-based claims.

## Findings

### 1. Lightbox color pip disclosure is not programmatically tied to its expanded panel

- Severity: Low
- Confidence: High
- Location: `apps/web/src/components/lightbox-color-pip.tsx:166-198`
- Selector/component region: `.lightbox-color-pip` trigger and the conditional expanded panel immediately after it.

The lightbox color pip button exposes `aria-expanded={interactive && open}` at `lightbox-color-pip.tsx:171`, but it does not expose `aria-controls`, and the expanded panel at `lightbox-color-pip.tsx:198` has no stable `id`, `role="region"`, or accessible name. The panel contains photographer-relevant color pipeline details, delivered formats, HDR status, histogram preview, and copy actions, so the missing relationship makes the disclosure less understandable to screen reader users even though the controls are keyboard reachable and have focus rings.

Concrete user failure scenario: a keyboard and screen reader user opens a lightbox, presses the color pip, and hears that a control is expanded, but their assistive tech has no programmatic relationship to the newly revealed color details. In a dense lightbox with auto-hiding controls, they must manually explore nearby DOM to discover whether the expanded content appeared and where it starts.

Suggested fix: give the expanded panel a stable id, add `aria-controls={panelId}` to the pip button, and mark the panel as a named region, for example `role="region"` with `aria-label={t('aria.toggleColorPip')}` or a more specific localized color-details label. Keep the existing `aria-expanded` and focus-visible treatment.

### 2. Empty shared albums report a loading/processing state instead of an empty state

- Severity: Low
- Confidence: High
- Location: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:250-253`; existing localized empty copy at `apps/web/messages/en.json:450` and `apps/web/messages/ko.json:450`
- Selector/component region: shared group page empty branch after the shared-image grid.

When a valid shared group has zero images, the page renders `t('processing')` at `g/[key]/page.tsx:250-253`. The locale files already have a more accurate `sharedGroup.empty` string: "No photos in this group." / "이 그룹에 사진이 없습니다." The current message tells visitors the photos are "still being processed", which is a loading-state claim rather than an empty-state claim.

Concrete user failure scenario: a photographer shares an album link, later removes every photo from that share, and the recipient opens the still-valid link. The page says the photos are still processing, so the recipient waits or retries later instead of understanding that the shared set is currently empty.

Suggested fix: render `t('empty')` for `group.images.length === 0`. Reserve `t('processing')` only for a real pending-processing state if the route can distinguish that state from an intentionally empty or emptied group.

### 3. Accessible map photo list discards the localized topic label already returned by data

- Severity: Low
- Confidence: Medium
- Location: `apps/web/src/app/[locale]/(public)/map/page.tsx:55-66`, `apps/web/src/app/[locale]/(public)/map/page.tsx:98-107`, `apps/web/src/lib/data.ts:1784-1789`
- Selector/component region: `#map-photo-list` fallback list under the map.

`getMapImages()` returns `topic_label: topics.label` at `data.ts:1784-1789`, but the map route builds each marker with only `topic: img.topic` at `map/page.tsx:55-66`. The accessible fallback list then renders `marker.topic` at `map/page.tsx:105-106`. That means keyboard and screen reader users who skip the map get raw topic slugs, while the data layer already has the human-maintained topic label available for presentation.

Concrete user failure scenario: a Korean locale visitor uses "Skip map to photo list" and hears or sees a slug such as `family_trip_2026` instead of the topic label the photographer/admin configured. The result is harder to scan, less localized, and less aligned with the visible gallery naming model.

Suggested fix: carry `topic_label` through the `markers` object and render `marker.topic_label ?? humanizeTagLabel(marker.topic)` in the fallback list. If the Leaflet popup also displays topic text later, use the same label source there for consistency.

## Final Sweep

- Touch target, focus-visible, password form, privacy landmark, and error shell tests passed in the targeted validation run.
- Current inspected public controls generally preserve the 44 px minimum through `min-h-11`, `h-11`, or larger hit areas, including nav, tag chips, search dialog controls, lightbox toolbar controls, bottom-sheet controls, upload actions, admin table actions, and map fallback links.
- The reviewed photo/HDR surfaces largely preserve photographer workflow honesty: public HDR badges are gated away until delivery, admin-only color pipeline detail remains scoped to audit contexts, and download labels distinguish AVIF/P3 from JPEG/sRGB paths.
- I did not include historical findings that appear fixed by the current source, including active tag count contrast, missing focus-visible rings on known lightbox/search controls, public HDR badge overclaiming, and insufficient 44 px floors in the previously tested interactive surfaces.
