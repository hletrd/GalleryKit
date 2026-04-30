# Plan 13: R4 Remaining Backlog

**Priority:** P3 — Nice to have  
**Sources:** UX open questions, Architecture low-priority items

---

## UX Polish
1. **Lightbox swipe navigation on mobile** — extract swipe handler from photo-navigation and reuse in lightbox
2. **`<title>` update on in-page photo navigation** — update `document.title` in PhotoViewer on navigate
3. **LoadMore aria-live announcement** — announce "X new photos loaded" when infinite scroll triggers
4. **SSR column count flash** — `useState(4)` → `useState(2)` as compromise default closer to median viewport
5. **Clear filter link locale prefix** — `home-client.tsx:294` bare path without locale

## Permanently Deferred
- **2FA/WebAuthn** — documented in CLAUDE.md. Not planned for personal gallery.
- **Persistent rate limiting via Redis** — MySQL-backed solution implemented instead
- **Full virtual masonry (react-window)** — content-visibility CSS solution is sufficient

---

*Items here are all Low/Informational. Promote when they become blocking.*
