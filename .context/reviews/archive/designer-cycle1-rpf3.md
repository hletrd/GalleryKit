# designer — Cycle 1 RPF v3 (HEAD: 67655cc)

## Scope

Inherit and verify the user-injected designer-v2 review at
`.context/reviews/designer-uiux-deep-v2.md`.

## Inherited findings (cross-checked)

| Finding | Severity | Cross-check status |
|---|---|---|
| NF-1: admin submit + password toggle below 44 px | Medium | confirmed against `login-form.tsx:84,102` |
| NF-2a: LightboxTrigger 32 px | High | confirmed against `lightbox.tsx:41` |
| NF-2b: desktop Info toggle 32 px | High | confirmed against `photo-viewer.tsx:314` |
| NF-3: tag_names null in `getImagesLite` correlated subquery | High | confirmed against `data.ts:324,374` |
| NF-4: nav topic links 32 px | Medium | confirmed against `nav-client.tsx:119` |
| NF-5: Load More 36 px | Low | confirmed against `load-more.tsx:102` |
| NF-6: site title 28 px | Low | confirmed against `nav-client.tsx:78` |
| F-10 partial: photo viewer min-h reduced but blur placeholder absent | Low | confirmed; blur fetched but unused |
| F-18 partial: tag_names null defeats humanize fix | High (same as NF-3) | confirmed |
| F-19 partial: scroll affordance still weak | Low | confirmed; tracked |
| F-20 partial: LightboxTrigger and desktop Info toggle missed | High (same as NF-2) | confirmed |
| F-23 partial: blur placeholder not wired | Low | confirmed |

## Per-viewport priority

- **Mobile (390 / 360):** NF-2, NF-3, NF-4, NF-1
- **Tablet (768, 1024):** NF-2, NF-4
- **Desktop (1440, 1920, 2560):** NF-2 (still 32 px)
- **All:** NF-3 — affects screen-reader + bot indexing across all viewports

## Verdict

NF-3 is the most-impacting cycle-1 task. NF-2 is second because it
affects the primary fullscreen interaction. NF-1, NF-4, NF-5, NF-6 are
tractable touch-target fixes.
