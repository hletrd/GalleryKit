# UI/UX Code Review — Cycle 6

Scope reviewed: Next.js routes, shared UI components, admin/public layouts, design tokens, messages, and e2e coverage. Browser checks were run against the built app.

## Findings

### UX6-01 — Mobile photo info sheet is not actually modal, so keyboard focus can escape while it is open
- **Location:** `apps/web/src/components/info-bottom-sheet.tsx:155-170`; entry point `apps/web/src/components/photo-viewer.tsx:259-267`
- **Severity/confidence:** High / High
- **Status:** Confirmed by browser focus walk.
- **Problem:** `FocusTrap` and `aria-modal` are active only when `sheetState === 'expanded'`; the peek/open dialog state allows focus behind the sheet.
- **Failure scenario:** Keyboard users open the mobile sheet and tab into underlying photo controls/navigation.
- **Suggested fix:** Make the open sheet modal for its entire lifetime, or treat peek state as a non-modal disclosure and remove dialog semantics until expanded.

### UX6-02 — Admin tables reuse an empty `actions` translation, leaving the action column header blank
- **Location:** `apps/web/messages/en.json:150-151`; `apps/web/messages/ko.json:150-151`; `apps/web/src/components/image-manager.tsx:352-358`; `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:195-202`; `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:95-100`
- **Severity/confidence:** Medium / High
- **Status:** Confirmed in browser.
- **Failure scenario:** Screen readers and sighted users get an unlabeled action column.
- **Suggested fix:** Provide localized `Actions` text or an `sr-only` header.

### UX6-03 — Korean admin password page still uses a hard-coded English metadata title
- **Location:** `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx:3-5`
- **Severity/confidence:** Low / High
- **Status:** Confirmed in browser at `/ko/admin/password`.
- **Failure scenario:** Korean users see an English browser tab title.
- **Suggested fix:** Localize the title or remove route-specific hard-coded metadata.

### UX6-04 — RTL support is not wired end-to-end; root layout is hard-coded LTR
- **Location:** `apps/web/src/app/[locale]/layout.tsx:83-88`; locales in `apps/web/src/lib/constants.ts:1-4`
- **Severity/confidence:** Low / Medium
- **Status:** Future-risk gap, current shipped locales are LTR.
- **Failure scenario:** Adding an RTL locale leaves document direction and many physical spacing classes incorrect.
- **Suggested fix:** Add locale-to-direction mapping and prefer logical styles if RTL is planned.
