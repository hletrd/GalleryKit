# Plan: UI/UX Pass 1 (COMPLETED)

**Status:** DONE  
**Deployed:** 2026-04-12  
**Commits:** `82a913e`, `3f00252`, `49f0ff8`, `cff89cc`, `4d1f37f`, `41e660a`, `797ef45`

## Completed Items
- [x] Photo viewer mobile layout — sidebar `hidden lg:block`, `timerShowInfo=false`
- [x] Locale switcher (EN/KO) added to nav
- [x] Theme toggle (Sun/Moon) added to nav using `resolvedTheme`
- [x] Platform-aware search keyboard hint (⌘K / Ctrl+K via `navigator.userAgentData`)
- [x] Search overlay fullscreen on mobile (`inset-0` at `< sm`)
- [x] Tag underscores replaced with spaces in display
- [x] Topic icon accessibility (`title` + `alt` attributes)
- [x] 404 page copy genericized ("Not Found" not "Category Not Found")
- [x] Inter font removed, Pretendard as sole display font
- [x] Footer admin link de-emphasized (`text-xs text-muted-foreground/50`)
- [x] Architect feedback: `resolvedTheme`, `userAgentData`, removed redundant sr-only span
