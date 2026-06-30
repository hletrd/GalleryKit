# Cycle 47 UI / Accessibility / Photographer Review

## Findings

### C47-UI-01 - Admin image table hides HDR when gamut is not wide

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/components/image-manager.tsx:531`, `apps/web/src/lib/data.ts:291`, `apps/web/src/lib/data.ts:995`, `CLAUDE.md:174`
- Problem: the admin `Gamut` column rendered the HDR badge only inside the wide-gamut branch. Narrow-gamut HDR sources therefore appeared as plain `sRGB`.
- Failure scenario: a photographer enables HDR ingest and uploads a BT.709 PQ/HLG source; the dashboard summary hides the HDR audit signal and the SDR-delivery risk.
- Suggested fix: render the gamut label and the HDR badge independently, and distinguish unknown narrow-gamut metadata from confirmed sRGB.

### C47-A11Y-01 - Masonry card accessible names omit visible P3 status

- Severity: Low
- Confidence: High
- Citations: `apps/web/src/components/home-client.tsx:323`, `apps/web/src/components/home-client.tsx:384`, `apps/web/src/__tests__/cycle-22-source-contracts.test.ts:73`
- Problem: wide-gamut cards render a visible P3 badge, but the parent link sets an explicit `aria-label` that excludes the nested badge text from the accessible name.
- Failure scenario: screen-reader users browsing the grid hear only "View photo" and the title, while sighted users also see that the photo is wide-gamut/P3.
- Suggested fix: include the P3 status in the card link label when the badge renders, and update the source contract to pin the link name rather than only the badge span.
