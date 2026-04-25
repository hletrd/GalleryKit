# Plan 302 — Deferred items from cycle 1 loop fresh review (2026-04-25)

## Status: deferred-only

## Source

`_aggregate-cycle1-loop-2026-04-25.md` — items not covered by plan-301. All LOW severity. None are security/correctness/data-loss; deferral is allowed by repo rules. Each item records the original severity, confidence, file citation, deferral reason, and re-open criterion.

## Deferred items

### AGG1L-LOW-03 — Skeleton-shimmer dark mode + animation-never-stops

- **Severity / Confidence:** LOW / High
- **Files:** `apps/web/src/app/[locale]/globals.css:88-106`, `apps/web/src/components/photo-viewer.tsx:346`
- **Deferral reason:** Visual polish; needs designer call on dark-mode visual approach (theme-aware gradient vs. drop the shimmer in dark mode entirely). Animation-never-stops requires stateful onLoad wiring on the photo `<img>` to toggle the shimmer class — non-trivial component refactor. Out of scope for plan-301's mechanical fixes.
- **Re-open criterion:** Battery / Lighthouse perf measurement showing the persistent animation is meaningfully costly OR a designer issue raising the dark-mode invisibility.

### AGG1L-LOW-05 — Focus-style inconsistency (ring vs outline)

- **Severity / Confidence:** LOW / High
- **Files:** `apps/web/src/components/image-zoom.tsx`, `info-bottom-sheet.tsx`, `image-manager.tsx`, `search.tsx`, `upload-dropzone.tsx`, plus shadcn components.
- **Deferral reason:** Cross-cutting design decision. Either roll back image-zoom to `focus-visible:ring-*` (matching the rest) or migrate every focus-style site to `outline-*`. Both are global changes that need a designer commitment.
- **Re-open criterion:** Designer ratifies one approach; PR opened.

### AGG1L-LOW-06 — Login `aria-pressed` + dynamic `aria-label` may double-cue

- **Severity / Confidence:** LOW / Medium
- **File:** `apps/web/src/app/[locale]/admin/login-form.tsx:81-94`
- **Deferral reason:** Requires real screen-reader verification (NVDA + Chrome, JAWS + Edge, VoiceOver + Safari) to confirm the doubling actually happens. Without that evidence the fix could regress AT for users who *want* both cues.
- **Re-open criterion:** AT verification report shows actual double-announcement.

### AGG1L-LOW-07 — Photo-viewer toolbar button-height inconsistency

- **Severity / Confidence:** LOW / Medium
- **Files:** `apps/web/src/components/photo-viewer.tsx:258,275,282`
- **Deferral reason:** Design polish. Wave deliberately bumped only Back + Info to 44px; Share + Lightbox-trigger were left at default `size="sm"`. Needs designer call on whether secondary toolbar actions also need 44px floor.
- **Re-open criterion:** Designer ratifies a uniform toolbar-button-height policy.

### AGG1L-LOW-08 — Search dialog input vs close-X size mismatch

- **Severity / Confidence:** LOW / Medium
- **File:** `apps/web/src/components/search.tsx:219,228`
- **Deferral reason:** Design polish. Same call as AGG1L-LOW-07 — should the input's `h-8` be promoted to `h-11` for consistency, or is the close-X over-bumped?
- **Re-open criterion:** Designer ratifies.

### AGG1L-LOW-09 — Photo container `min-h-[40vh]` in landscape mobile

- **Severity / Confidence:** LOW / Medium (partially debunked)
- **File:** `apps/web/src/components/photo-viewer.tsx:346`
- **Deferral reason:** Debugger H7 confirmed the image still grows the container due to the existing landscape-mobile CSS rule. The 40vh is a minimum; the image's actual height drives the container. No clipping.
- **Re-open criterion:** A user-reported visual issue on landscape mobile that traces to this rule.

### AGG1L-LOW-10 — `--muted-foreground` light-mode change may regress nav link hierarchy

- **Severity / Confidence:** LOW / Medium
- **File:** `apps/web/src/app/[locale]/globals.css:33`
- **Deferral reason:** Needs visual screenshot review on production to confirm whether inactive nav links are now too close to active links.
- **Re-open criterion:** Designer raises a regression issue or screenshot diff shows the regression.

### AGG1L-LOW-11 — Admin "OG locale" setting silently dead on supported routes

- **Severity / Confidence:** LOW / Medium
- **Files:** `apps/web/src/lib/locale-path.ts:57-69`, plus the SEO settings admin page.
- **Deferral reason:** Settings UX/docs improvement. Not urgent — admin's intent (Korean OG locale on `/en/...`) was incorrect anyway, so silently overriding is the right behavior. A future docstring + UI hint is fine.
- **Re-open criterion:** An admin opens an issue confused by the override.

### AGG1L-LOW-13 — Login password-toggle e2e test

- **Severity / Confidence:** LOW / Medium
- **File:** `apps/web/e2e/admin.spec.ts`
- **Deferral reason:** New e2e suite. Component-level coverage via React Testing Library would also work and be faster. Defer until the toggle changes again.
- **Re-open criterion:** A regression in the password-toggle behavior.

### AGG1L-LOW-14 — `showPassword=true` may suppress browser save-password prompt

- **Severity / Confidence:** LOW / Medium
- **File:** `apps/web/src/app/[locale]/admin/login-form.tsx`
- **Deferral reason:** Browser-specific UX concern with no clear cross-browser fix. Some browsers prompt regardless of the field's `type` at submit time.
- **Re-open criterion:** Confirmed Chromium / Firefox behavior measurement showing prompt suppression.

### AGG1L-LOW-15 — F-* / 44x44 AAA policy not documented in CLAUDE.md

- **Severity / Confidence:** LOW / Medium
- **File:** `CLAUDE.md` (or new docs file)
- **Deferral reason:** Documentation. Not blocking; cycle 3's AGG3R-03 (24x24 AA) still appears in code comments which now contradicts the new 44x44 reality. Worth a single doc-only commit.
- **Re-open criterion:** A new PR uses a 24x24 floor when 44x44 was expected.

### AGG1L-LOW-16 — Touch-target gaps still open in non-cycle-1 surfaces

- **Severity / Confidence:** LOW / Medium
- **Files:** `info-bottom-sheet.tsx`, `image-manager.tsx`, `upload-dropzone.tsx`, `footer.tsx`
- **Deferral reason:** Out of scope for the UI fix wave that focused on the public surface. Admin-side targets (image-manager checkbox) and footer secondary targets are lower priority.
- **Re-open criterion:** A formal admin-UX review or a designer-finding wave covers these surfaces.

## Convergence note

None of these items are security, correctness, or data-loss findings. All are LOW. Per CLAUDE.md the deferral is appropriate (no rule prohibits deferring LOW UI/UX/perf polish). Plan-301 implements the four highest-cross-agent items; plan-302 captures the remaining 12 with explicit re-open criteria.
