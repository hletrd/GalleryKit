# Designer — Cycle 3 Deep Review (2026-04-27)

**HEAD:** `9958152 docs(reviews): record cycle-2 fresh review findings and plan`

## UI/UX Review

Reviewed all user-facing components: nav, photo viewer, lightbox, search, load-more, admin dashboard, upload dropzone, tag filter, topic empty state, footer, and shared group/photo pages.

## Findings (New — Not in Prior Cycles)

### LOW Severity (1)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-U01 | `nav-client.tsx` uses `overflow-x-auto scrollbar-hide mask-gradient-right` for the topic list on mobile. The `scrollbar-hide` utility hides the scrollbar, which means users cannot see that the list is scrollable. The `mask-gradient-right` provides a visual hint (fade on the right edge), but there is no explicit affordance (like a "scroll" indicator or arrow) for users who don't notice the fade. This is a minor UX concern — the fade is a reasonable hint for most users. | `components/nav-client.tsx:107` | Low |

### INFO (2)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-U02 | The `photo-viewer.tsx` keyboard shortcut `F` for fullscreen is unusual for web apps (most use Escape to close). The code correctly guards against editable targets, but the bare `F` key (without modifier) is not a common web convention. Low priority since it works correctly. | `components/photo-viewer.tsx` | Info |
| C3-U03 | The admin dashboard uses a responsive grid layout. On very small screens (< 640px), some admin tables may require horizontal scrolling. This is expected for data-heavy admin interfaces and is acceptable. | `app/[locale]/admin/(protected)/dashboard/` | Info |

## Verified Controls (No Regressions)

- Touch targets: 44px minimum enforced by `touch-target-audit.test.ts`
- WCAG 2.5.5 compliance: audit catches shadcn `<Button size="sm">` without h-11 override
- Reduced motion: CSS transitions use `duration-300`
- Dark/light mode: theme toggle with `next-themes`
- i18n: Full English and Korean support via `next-intl`
- ARIA labels: `aria-label`, `aria-current`, `aria-expanded` on interactive elements
- Keyboard navigation: Focus management in lightbox, focus trap support
- Responsive breakpoints: Mobile-first with md (768px) breakpoint
- Loading states: Skeleton components, shimmer placeholders
- Error states: `error.tsx` boundary pages
- Empty states: `topic-empty-state.tsx`
