# Designer — Cycle 1 Fresh Review (2026-04-27)

## UI/UX Review

This is a web frontend project with Next.js 16, React 19, Tailwind CSS, Radix UI/shadcn, and Framer Motion. UI/UX review is applicable.

---

## Findings

### C1-DSN-01: Photo viewer keyboard shortcuts hint hidden on mobile but no mobile alternative
**File:** `apps/web/src/components/photo-viewer.tsx:272-274`
**Severity:** Low | **Confidence:** High

```tsx
<p className="mb-2 text-xs text-muted-foreground hidden md:block" id="photo-viewer-shortcuts">
    {t('viewer.shortcutsHint')}
</p>
```

The keyboard shortcuts hint is hidden on mobile (`hidden md:block`). This is correct since mobile devices don't have arrow keys or `F` key. However, there's no equivalent touch gesture hint for mobile users (e.g., swipe left/right to navigate, double-tap to open lightbox). The lightbox does have swipe support via Framer Motion, but it's not discoverable without experimentation.

**Fix:** Consider adding a subtle touch-gesture hint for first-time mobile visitors, or ensure the swipe affordance is discoverable via visual cues.

---

### C1-DSN-02: `showInfo` sidebar transition uses `lg:translate-x-10` which may cause layout shift
**File:** `apps/web/src/components/photo-viewer.tsx:416-417`
**Severity:** Low | **Confidence:** Medium

```tsx
"space-y-6 transition-all duration-500 ease-in-out overflow-hidden transform hidden lg:block",
showInfo ? "lg:opacity-100 lg:translate-x-0" : "lg:opacity-0 lg:translate-x-10 lg:w-0 lg:p-0"
```

When the info sidebar collapses, it transitions to `lg:w-0 lg:p-0 lg:translate-x-10`. The `translate-x-10` slide-out animation combined with `w-0` creates a visual where the sidebar appears to slide under the photo area. The `transition-all` property animates both `opacity`, `transform`, `width`, and `padding` simultaneously, which can create a janky animation on slower devices because width and transform transitions compete.

**Fix:** Consider using `transition` with specific properties (e.g., `transition-opacity transform width`) instead of `transition-all` for smoother animations. Alternatively, use `grid-template-columns` animation (already in use at line 357) for the primary layout shift and limit the sidebar's own transition to opacity only.

---

### C1-DSN-03: Touch-target audit fixture exists and enforces 44px minimum
**File:** `apps/web/src/__tests__/touch-target-audit.test.ts`
**Severity:** Info | **Confidence:** High

The repository has a comprehensive touch-target audit test that enforces WCAG 2.5.5 / Apple HIG / Google MDN 44px floor. The test scans all `.tsx`/`.jsx` files under `components/` and `app/[locale]/admin/` and catches violations of shadcn `<Button size="sm">` without h-11 override, `<Button size="icon">` without size-11 override, and small button heights. This is excellent accessibility engineering.

**Status:** No issue — touch targets are well-audited.

---

### C1-DSN-04: `suppressHydrationWarning` on date/time elements
**File:** `apps/web/src/components/photo-viewer.tsx:424,604,609`
**Severity:** Info | **Confidence:** High

Several date/time display elements use `suppressHydrationWarning` because the formatted dates depend on the server/client locale and timezone, which may differ. This is the correct React pattern for server-rendered content that depends on client-side state (timezone, locale).

**Status:** No issue — this is the correct pattern for timezone-sensitive content.

---

### C1-DSN-05: No reduced-motion support for photo navigation transitions
**File:** `apps/web/src/components/photo-viewer.tsx:393-396`
**Severity:** Low | **Confidence:** High

```tsx
initial={prefersReducedMotion ? false : { opacity: 0, x: 20 }}
animate={{ opacity: 1, x: 0 }}
exit={prefersReducedMotion ? undefined : { opacity: 0, x: -20 }}
transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
```

The photo navigation transition correctly respects `prefersReducedMotion` by disabling the slide animation and setting duration to 0. However, the `opacity` transition still applies even with reduced motion (the `initial` is `false`, which means no initial animation, but the `animate` and `exit` states still have opacity changes). With `duration: 0`, the opacity change is instant, which is acceptable.

**Status:** No issue — reduced motion is correctly handled with instant transitions.

---

## Accessibility Summary

- **Touch targets:** 44px minimum enforced by fixture test
- **Keyboard navigation:** Arrow keys + F key with editable-target guard
- **Screen reader:** sr-only h1 for heading navigation, aria-live for photo position
- **Reduced motion:** Respected with Framer Motion `useReducedMotion`
- **Contrast:** Not audited in this review (requires visual tools)
- **Focus management:** Not audited in this review
