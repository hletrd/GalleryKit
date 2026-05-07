# Cycle 2 — Code Reviewer Findings

**Date**: 2026-05-05
**Scope**: Full repository review focusing on code quality, logic, SOLID, maintainability
**Method**: Single-agent comprehensive review (sub-agent fan-out not available)

---

## Files Examined

- `apps/web/public/sw.template.js` / `sw.js` — Service worker caching strategies
- `apps/web/scripts/check-public-route-rate-limit.ts` — AST-based lint gate
- `apps/web/src/app/api/og/photo/[id]/route.tsx` — OG image generation
- `apps/web/src/components/home-client.tsx` — Masonry grid client component
- `apps/web/src/lib/data.ts` — Data access layer (partial, 1367 lines)
- `apps/web/src/app/actions/images.ts` — Upload/delete/update actions (partial)
- `apps/web/src/lib/process-image.ts` — Sharp pipeline (partial)
- `apps/web/src/proxy.ts` — i18n middleware + auth guard
- `apps/web/src/app/actions/auth.ts` — Authentication (partial)
- `apps/web/src/components/photo-viewer.tsx` — Photo viewer (partial)
- `apps/web/src/lib/blur-data-url.ts` — Blur data URL validation
- `apps/web/src/lib/photo-title.ts` — Title/alt text generation
- `apps/web/src/app/api/reactions/[imageId]/route.ts` — Reaction toggle endpoint
- `apps/web/src/app/api/checkout/[imageId]/route.ts` — Stripe checkout
- `apps/web/src/app/api/download/[imageId]/route.ts` — Token-bound download
- `apps/web/src/app/api/admin/db/download/route.ts` — Backup download
- `apps/web/src/components/search.tsx` — Search overlay (partial)

---

## Findings

**0 new findings.**

All examined files maintain excellent code quality. Notable positive observations:

- The cycle 1 fix for `sw-cached-at` in `networkFirstHtml` is correctly implemented: a new `Response` is constructed with the timestamp header before `htmlCache.put()`.
- The cycle 1 fix for export-specifier blind spot in `check-public-route-rate-limit.ts` correctly traverses `ts.isExportDeclaration(statement)` with `NamedExports` elements.
- The cycle 1 fix for metadata/cache desync correctly uses `if (deleted)` before adjusting `total` in the eviction loop.
- The cycle 1 fix for non-function exports correctly filters with `ts.isArrowFunction || ts.isFunctionExpression || ts.isCallExpression`.
- The cycle 1 fix for exempt tag substring match correctly strips string literals before checking for `EXEMPT_TAG`.
- The cycle 1 fix for OG timeout correctly applies `AbortSignal.timeout(10000)` with fallback to the existing catch path.
- Privacy guards in `data.ts` (compile-time `_privacyGuard`, `_mapPrivacyGuard`, `_largePayloadGuard`) are intact and robust.
- Upload action maintains defense-in-depth: same-origin check, rate limiting, disk space check, topic validation, tag validation, filename sanitization, maintenance mode checks.

---

## Commonly Missed Issues Sweep

- **Race conditions**: Upload tracker uses Map reference sharing to prevent TOCTOU. Image processing uses advisory locks. DB restore uses advisory locks. All reviewed.
- **Error handling**: Consistent try/catch with structured logging across API routes.
- **Resource leaks**: Stream-based downloads use `createReadStream` with proper cleanup. No unclosed DB transactions observed.
- **Type safety**: No `any` types observed in critical paths. Drizzle ORM used throughout.

**Conclusion**: No code quality issues found in this cycle.
