# Perf + architecture + UI/UX/i18n review — Run-3 Cycle 4

Reviewer angle: perf-reviewer + architect + designer + i18n.

## Architecture
- The browser-vs-PAT two-path upload divergence is the only standing
  architectural smell. Cycles 1-3 closed all HIGH/MED parity gaps; the 3 LOW
  divergences are the last drift. Closing them this cycle collapses the
  divergence surface and lets the source-contract test fully fence both paths.
  Recommended (consistent with single-writer topology; all coordination state is
  process-local and shared between the two entrypoints).
- Advisory-lock scope, privacy field separation, cache() dedup: all intact.

## Performance
- `data.ts` query shapes (tagNamesAgg GROUP_CONCAT, composite indexes) match the
  documented index set. No N+1 introduced. OK.
- Image pipeline concurrency, rgb16 50MP cap, 10-bit AVIF probe singleton: OK.
- Adding a `statfs` pre-check + tracker claim to the PAT path adds one syscall
  and one Map op per request — negligible; the syscall already runs on the
  browser path per upload batch. No perf concern.
- `use-display-capability.ts` snapshot memoization (React #185 risk) unchanged.

## UI/UX
- The PAT path is a machine-to-machine JSON API (Lightroom plugin); no UI
  surface. The cycle-4 fixes change only JSON error bodies (409/503 maintenance,
  422 disk, 429 rate). These mirror the existing JSON error style in the route
  (plain `{ error: string }`), so the Lua plugin's existing error handling
  continues to work. No localized-string requirement (the route already returns
  English JSON errors, not next-intl strings — consistent with its existing
  surface).
- Touch-target 44px audit, lightbox/color-pip/histogram: unchanged this cycle.

## i18n EN/KO
- 812/812 keys, perfect parity. No missing or untranslated-identical keys found.

## Summary
- CRIT 0, HIGH 0, MED 0, LOW 0 net-new. Endorses closing the 3 LOW PAT
  divergences to remove the last architectural drift between the two upload
  paths. No new perf, UI, or i18n finding.
