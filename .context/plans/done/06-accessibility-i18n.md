# Plan 06: Accessibility & Internationalization (MOSTLY COMPLETE)

**Status:** MOSTLY DONE — US-501/503 fully done, US-502 partial  
**Deployed:** 2026-04-12  
**Commits:** `ddd5eda`, `331d36d`, `bf17c98`

## Completed Items
### US-501 — Keyboard A11y + Focus Traps
- [x] Tag filter badges: role="button", tabIndex={0}, onKeyDown, aria-pressed
- [x] Search dialog wrapped in focus-trap-react
- [x] Lightbox wrapped in focus-trap-react
- [x] focus-trap-react added to dependencies

### US-503 — CSS + Misc Fixes
- [x] scrollbar-hide utility in globals.css (@layer utilities)
- [x] Removed dead <style jsx global> from nav-client.tsx
- [x] Pin button hidden on mobile (hidden lg:flex)
- [x] aria-expanded on nav expand button
- [x] Touch targets: theme toggle and locale switcher min-w/h-[44px]
- [x] bg-gray-100 → bg-muted/20 in shared group page
- [x] Korean backTo translation includes {topic} variable

### US-502 — i18n (Partial)
- [x] Shared group page /g/[key] fully internationalized
- [x] sharedGroup namespace added to en.json and ko.json

## Remaining i18n Work (backlog)
- [ ] 25+ hardcoded English strings in other components (photo-viewer, home-client, histogram, image-manager, optimistic-image)
- [ ] 13+ hardcoded English aria-labels across components
- [ ] Shared photo page /s/[key] has partial i18n
