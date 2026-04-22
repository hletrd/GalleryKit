# Designer — Cycle 1 Review

> Provenance: requested subagent timed out after retry in this environment; this file is the leader's designer-angle synthesis from direct repo inspection plus current E2E run.

## SUMMARY
- Confirmed 1 meaningful accessibility/UX issue in the photo viewer. No additional high-confidence UI regressions surfaced during this pass.

## INVENTORY
- Viewer interaction shell: `src/components/photo-navigation.tsx`, `src/components/photo-viewer.tsx`
- Existing browser evidence: current Playwright E2E run for public navigation and photo flows

## FINDINGS

### UX-01 — Desktop photo navigation is hidden from keyboard users until mouse hover
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/components/photo-navigation.tsx:208-233`
- **Why it matters:** The desktop prev/next buttons use `lg:opacity-0 lg:group-hover:opacity-100` with no focus-state reveal. That creates a weak focus affordance and undermines keyboard discoverability.
- **Concrete user scenario:** A desktop user tabs into the viewer after opening a photo. Focus moves to the nav buttons, but the buttons remain visually transparent, so the user cannot tell where focus went.
- **Suggested fix:** Add `lg:group-focus-within:opacity-100` or equivalent focus-driven visibility on the wrapper.

## FINAL SWEEP
- I did not find another equally strong confirmed UI defect from the inspected routes/components during this pass.
