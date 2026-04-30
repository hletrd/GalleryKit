# Plan 07: Backlog (P3 — Nice to Have)

**Priority:** P3 — Fix when convenient  
**Sources:** All 5 reviews, lower-priority items

---

## Features
1. **Shared link expiry** — add `expires_at` column to `sharedGroups`, optional TTL on photo share keys
2. **Shared link access counting** — add `view_count` column for analytics
3. **Client-side photo navigation in shared groups** — currently query-param based (full SSR per click)
4. **Admin dashboard search/filter/pagination** — currently loads 200 images, no search
5. **Back-to-top button** — long gallery pages with infinite scroll
6. **Audit log** — `audit_log` table for admin action tracking

## Reliability
7. **Disk space pre-check on upload** — check available space before writing
8. **MAX_QUEUE_RETRY limit** — prevent permanently failed processing jobs from retrying forever
9. **Persistent rate limiting** — Redis or MySQL-backed rate limiter (survives restart/scales)
10. **2FA / WebAuthn** — TOTP via `otplib` or WebAuthn via `@simplewebauthn/server`
11. **Sitemap pagination** — split into index + chunks of 10K URLs (Google 50K limit)
12. **CDN support** — configurable `IMAGE_BASE_URL` for CDN-fronted images

## Code Quality
13. **Automated test suite** — Vitest for unit tests, Playwright for E2E
14. **Dependabot/Renovate** — automated dependency update workflow
15. **Standardized action result types** — `ActionResult<T>` union type across all server actions
16. **Remove `useTranslation()` wrapper** — or document why it exists over direct next-intl hooks
17. **Remove `getLocaleAsync()` wrapper** in topic page — use `getLocale()` directly
18. **Virtual masonry grid** — for galleries with 500+ images (react-window)
19. **OptimisticImage retry** — stop retrying on 404 (only retry on 5xx/network)
20. **Histogram computation** — use OffscreenCanvas + Web Worker
21. **Docker image size** — verify standalone output makes prod-deps COPY redundant
22. **`capture_date` migration** — varchar→datetime (high effort, high impact on sort/filter)

## UX Polish
23. **Download button label** — says "Download Original" but serves JPEG (rename to "Download JPEG" or serve actual original)
24. **Search results keyboard navigation** — arrow keys to move between results
25. **Loading.tsx skeleton screens** — for route transitions
26. **Admin skip-to-content link** — missing from admin protected layout
27. **Show photo counter only when `images.length > 1`** — "1 / 1" is useless
28. **Topic active state locale fix** — `pathname === '/${topic.slug}'` doesn't account for locale prefix
29. **Clipboard API fallback** — for HTTP or older browsers
30. **Admin nav responsive** — horizontal overflow on mobile, needs flex-wrap or dropdown

---

*Items here can be promoted to a higher-priority plan when they become blocking or when capacity allows.*
