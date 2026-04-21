# Cycle 8 Architect Review (manual fallback)

## Inventory
- Reviewed the public topic alias flow, share-link generation path, admin dashboard data flow, and deploy/runtime configuration contracts.
- Focused on cross-boundary consistency between server-resolved canonical data and client-visible URLs/state.

## Confirmed Issues

### A8-01 — Copied share links still depend on the operator's current browser origin
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/components/photo-viewer.tsx:253-266`, `apps/web/src/components/image-manager.tsx:158-167`, `apps/web/src/lib/data.ts:783-790`
- **Why it matters:** the app already has a canonical public origin (`seo.url` / `BASE_URL`), but share-link composition ignores it and uses `window.location.origin`.
- **Concrete failure scenario:** an admin working on `localhost`, a VPN hostname, or a staging proxy copies a share link that recipients cannot open publicly.
- **Suggested fix:** thread the canonical public origin from the server to these client components and compose share URLs from that value.

### A8-02 — Canonical topic redirects lose active tag filters during alias normalization
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:87-95`
- **Why it matters:** canonicalization is part of the routing architecture, so it must preserve the caller's active filter state.
- **Concrete failure scenario:** an alias URL like `/en/my-alias?tags=portrait,travel` redirects to `/en/canonical-topic` and silently drops the filters.
- **Suggested fix:** rebuild the redirect target with the current query string preserved.

## Carry-forward risk
- Restore coordination and several abuse-control maps still assume a single-process topology (`apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/rate-limit.ts`).
