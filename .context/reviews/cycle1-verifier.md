# Verifier — Cycle 1 Fresh Review

**Date**: 2026-05-05
**Scope**: Evidence-based correctness check against stated behavior.

---

## VERIFICATION RESULTS

### Claim: "HTML routes: network-first, 24 h fallback cache" (sw.js comment)
**Status**: FALSE — The 24-hour expiry is not enforced.

Evidence:
- `sw.template.js` line 139: `await htmlCache.put(request, networkResponse.clone());`
- No `sw-cached-at` header is added to the cached response.
- Line 148: `const dateHeader = cached.headers.get('sw-cached-at');` — always `null`.
- Line 151: `if (age > HTML_MAX_AGE_MS)` — unreachable.

The comment claims 24-hour fallback cache, but the implementation serves cached HTML indefinitely.

---

### Claim: "Every public API route with mutating handler has rate limiting"
**Status**: TRUE for current code, FALSE for future patterns.

Evidence:
- Ran `npm run lint:public-route-rate-limit` — all 9 routes pass.
- checkout, reactions, and semantic search routes all use documented rate-limit helpers.
- stripe/webhook carries `@public-no-rate-limit-required` with valid justification.

However, the lint script's AST checker does not handle `export { handler as POST }`. A future route using this pattern would pass the lint without rate limiting. The current codebase does not use this pattern, so the claim holds for now.

---

### Claim: "Rate limiting uses DB as source of truth"
**Status**: TRUE for auth, PARTIAL for public routes.

Evidence:
- Login uses `incrementRateLimit` + `checkRateLimit` with MySQL `rate_limit_buckets` table.
- Public routes (checkout, OG, semantic search) use in-memory `BoundedMap` only. The DB is not consulted.
- This is documented behavior — public routes use in-memory fast-path; auth routes use DB-backed limits.

---

### Claim: "Processed images are stored in public/uploads/"
**Status**: TRUE.

Evidence:
- `UPLOAD_DIR_WEBP`, `UPLOAD_DIR_AVIF`, `UPLOAD_DIR_JPEG` all resolve under `public/uploads/`.
- `serve-upload.ts` and `image-url.ts` construct URLs pointing to `/uploads/`.
- Original uploads are stored under `data/uploads/original/` (private).

---

## VERDICT

One documented behavior (24h HTML cache) is not actually implemented. All other verified claims match the code. The codebase is largely honest between docs and implementation.
