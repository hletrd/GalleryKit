# Code Review — Cycle 5 (current checkout)

## Scope and inventory covered
Reviewed the current HEAD of `/Users/hletrd/flash-shared/gallery` across public routes, data helpers, topic actions, tests, and supporting docs/config.

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 0
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### CR5-01 — Public first-page rendering still executes a separate exact-count query beside the listing query
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:108-114`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:116-123`, `apps/web/src/lib/data.ts:253-276`
- **Why it is a problem:** Both public page variants run `getImagesLite(...)` and `getImageCount(...)` for the same filters on first render. That duplicates the same filtered scan/subquery work on the hottest unauthenticated routes.
- **Concrete failure scenario:** Large galleries or heavily tagged pages pay two DB round-trips and two filtered scans per request before HTML can stream, increasing latency and DB load under crawler bursts.
- **Suggested fix:** Return first-page rows and total count from one paginated query (for example `COUNT(*) OVER()` + `PAGE_SIZE + 1`) and derive `hasMore` from the extra row.

### CR5-02 — Topic label sanitization errors are surfaced as `invalidSlug`, pointing admins at the wrong field
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/actions/topics.ts:43-48`, `apps/web/src/app/actions/topics.ts:130-135`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`
- **Why it is a problem:** When a topic label contains control characters, create/update currently return the slug error key instead of a label-specific error.
- **Concrete failure scenario:** An admin pastes a malformed label, the server rejects it, but the UI tells them the slug is invalid even when the slug is fine. That causes misdirected correction and inconsistent field validation UX.
- **Suggested fix:** Add a dedicated `invalidLabel` translation and return it for the label mismatch path.

## Final sweep
Rechecked the current code only; earlier locale-reserved topic slug and histogram worker findings are already fixed in HEAD and are not carried forward.
