# Cycle 64 UI/UX/Accessibility Review

Reviewer: UI/UX/accessibility designer lane
Date: 2026-07-01
Start HEAD: `efdbaf9a4971e8c59051fe422c8b44d6e9dd455f`

## Scope And Method

- Read required context: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/reviews/_aggregate.md`, `.context/plans/cycle-63-2026-07-01-plan.md`, and `.context/plans/cycle-63-2026-07-01-deferred.md`.
- Reviewed public/admin UI source, accessibility guard tests, Korean/i18n strings, and current Cycle 63 fix evidence.
- Browser/dev-server pass was not run; source/test evidence was sufficient for this review lane. Residual risk remains for runtime-only visual layout and authenticated admin data combinations.
- Review only; no files modified. `git status --short` was clean.

## Findings

### C64-UX-01 - Admin GPS map links do not meet the 44 px touch-target floor

- Severity/confidence: Low / High.
- File/line: `apps/web/src/components/photo-viewer.tsx:886`, `apps/web/src/components/info-bottom-sheet.tsx:457`.
- Evidence: both admin-only location links render as plain flex text links with `className="font-medium text-primary hover:underline flex items-center gap-1 rounded ..."` and no `min-h-11`, `min-w-11`, `inline-flex`, padding, or block-level hit area. The icon is `h-3 w-3`, and the target height is effectively the small text line box, below the repo's 44 px touch-target policy. The block is reachable for authenticated admins because `PhotoPage` switches to `getImageForViewerCached(imageId, true)` when `isAdminUser` is true, and `adminSelectFields` includes `latitude` / `longitude`.
- Failure scenario: an admin viewing a GPS-bearing photo on a tablet or mobile info sheet tries to open the coordinates in Google Maps. The visual row looks tappable, but only the compact coordinate text/icon area activates.
- Fix direction: give both anchors a shared compliant shape, for example `inline-flex min-h-11 min-w-11 items-center gap-1 rounded px-2 -mx-2`, and add a narrow source-contract test for the two `google.com/maps/search` anchors.

### C64-UX-02 - Radix Select options are compact despite compliant Select triggers

- Severity/confidence: Low / Medium.
- File/line: `apps/web/src/components/ui/select.tsx:103`, `apps/web/src/components/ui/select.tsx:112`, current call sites including `apps/web/src/components/bulk-edit-dialog.tsx`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`.
- Evidence: `SelectTrigger` has `data-[size=default]:min-h-11 data-[size=sm]:min-h-11`, but `SelectItem` renders Radix option rows with only `py-1.5 pr-8 pl-2 text-sm`, which is a compact menu row rather than a 44 px touch target. Existing touch-target audit covers native `<select>` and button/link patterns, but not the custom `SelectItem` primitive.
- Failure scenario: admins changing image-processing settings or bulk-editing photos on a touch device can open a 44 px trigger, then must tap smaller option rows.
- Fix direction: add `min-h-11` to `SelectItem` in `components/ui/select.tsx` so all current/future custom select options inherit the touch floor, and add source-contract coverage.

## Non-Findings / Checks

- Cycle 63 search feedback ownership and single-announcement work is present in `components/search.tsx`; focused source tests pass.
- Cycle 63 admin Analytics link target fix is present: Top Photos and shared-album anchors now carry `inline-flex min-h-11 min-w-11`.
- Korean/i18n key parity passed. No new Korean UX blocker was found in the reviewed strings.
- Public nav, search dialog, masonry cards, map fallback list, timeline/year pages, and main photo controls show accessible names, focus indicators, and 44 px target evidence in source.

## Validation Evidence

- `npm test --workspace=apps/web -- touch-target-audit focus-visible-links-scan a11y-us-p15 analytics-link-touch-targets search-status-source data-viewer-select-fields i18n-key-parity` - pass: 7 files, 50 tests.
