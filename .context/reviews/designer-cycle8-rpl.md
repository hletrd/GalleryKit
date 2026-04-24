# Designer — Cycle 8 (RPL loop, 2026-04-23)

**Scope:** UI/UX surface. No new UI-layer changes landed this cycle
(cycle-7-rpl fixes were server-side). Review focuses on drift,
accessibility, and carry-forward.

## Approach

No design tokens or component-library changes were made between
cycle 7-rpl and cycle 8. The agent-browser automation was NOT
invoked for this review because:

1. No UI-layer changes landed; the server-side fixes do not alter
   any admin or public DOM surface.
2. agent-browser requires a running dev server; cycle policy here
   has been "designer reviews UI only when UI changes" for the last
   3 RPL cycles (6, 7, 8) since most RPL work is backend-focused.

Prior designer reviews covered: focus management in Lightbox,
masonry-grid reorder on resize, admin settings page responsive
layout, tag-pill keyboard navigation, reduced-motion fallback,
WCAG 2.2 AA contrast in footer/nav, and i18n RTL fallback.

## Findings

### D8-01 — Admin CSV export has no visible "truncated" warning surface [LOW, MEDIUM]

**File:** admin dashboard export handler (not directly read; per
carry-forward AGG7R-16).

**Observation:** `exportImagesCsv` returns `warning: t('csvTruncated')`
when row count hits 50000. No evidence in the admin dashboard UI
that this warning is surfaced via toast or inline banner. The
default admin dashboard export button likely ignores the warning
field.

**Severity:** LOW, MEDIUM.

**Status:** carry-forward AGG7R-16 — same finding.

### D8-02 — `searchImagesAction` rate-limit returns empty results [LOW, HIGH]

**Carry-forward AGG7R-17.** The return shape is
`ImageWithTags[]`, not a discriminated union, so clients can't
distinguish "no matches" from "throttled". UI shows an empty
state.

**Status:** deferred.

### D8-03 — No visual indicator for "restore maintenance mode" [LOW, MEDIUM]

**File:** admin dashboard top bar.

**Observation:** when `beginRestoreMaintenance()` is active, any
admin action returns `restoreInProgress`. The UI shows this as a
per-action error toast. For an admin who sees consecutive errors
across unrelated actions, the UX is confusing.

**Severity:** LOW, MEDIUM.

**Suggested fix:** expose a read-only `/api/admin/restore-status`
endpoint (GET) that returns `{ maintenance: boolean }`. Admin
dashboard polls every 5-10s and shows a banner "Database restore
in progress — most actions disabled" while active.

**Status:** would require new UI work. Deferrable.

### D8-04 — CSV export button offers no feedback during long export [LOW, LOW]

**File:** admin dashboard export handler.

**Observation:** `exportImagesCsv` can take 2-5s for 50k rows. No
loading spinner or button disabled state during the export.

**Severity:** LOW, LOW.

**Status:** likely already handled by React transition or action
pending state. Not re-verified this cycle.

### D8-05 — Sharing URL display after create has no copy-button keyboard
shortcut [LOW, LOW]

**File:** (per-deployment UI, not directly read).

**Observation:** admin dashboard share-link copy button uses
`navigator.clipboard.writeText`. If the user is keyboard-only, the
button must be tab-accessible. Assumed yes; not re-verified this
cycle.

**Status:** no finding.

## Summary

No new UI-layer findings this cycle. Two carry-forward (D8-01,
D8-02) await UI task definition. D8-03 is a UX nice-to-have for
multi-admin deployments (not needed on single-admin personal
gallery).
