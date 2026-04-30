# Plan 05: Architecture & Code Quality (PARTIAL)

**Status:** PARTIAL — US-402 done, US-401 deferred  
**Deployed:** 2026-04-12  
**Commits:** `4a7fa1c`

## Completed Items (US-402)
- [x] LOCALES extracted to shared lib/constants.ts (used in 5 files)
- [x] colorScheme/themeColor moved to viewport export (Next.js 15+ fix)
- [x] Always-truthy condition fixed in uploadImages (guards on result.insertId)
- [x] proxy.ts, layout.tsx, sitemap.ts, i18n/request.ts all use shared LOCALES

## Deferred (US-401 — Split actions.ts)
- [ ] actions.ts split into auth, images, topics, tags, sharing, admin-users, search modules
- [ ] Queue bootstrap moved to instrumentation.ts hook
- [ ] getTags renamed to getAdminTags

**Rationale for deferral:** The 1682-line actions.ts split is a high-risk refactor that touches every server action import in the app (20+ files). It requires creating 6+ new modules, moving shared state (queue, rate limiters, session cache), and updating all imports. Best done as a dedicated PR with thorough testing, not as part of a batch session.
