# Cycle 7 Architect Review (manual fallback)

## Inventory
- Reviewed repo structure, root/app docs, deploy/runtime config, public pages, admin actions, shared lib boundaries, and prior cycle plans.
- Focused on cross-boundary contracts between query parsing, data filtering, SEO/settings state, and public/admin delivery surfaces.

## Confirmed Issues

### A7-01 — Share-link creation still couples copied URLs to the operator's current browser origin
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/components/photo-viewer.tsx:253-266`, `apps/web/src/components/image-manager.tsx:158-167`, `apps/web/src/lib/data.ts:783-790`
- **Why it matters:** copied share URLs depend on the hostname the admin used to open the dashboard, not the configured public site URL.
- **Concrete failure scenario:** an operator uses `127.0.0.1`, a VPN hostname, or staging proxy to manage the site and then copies a share link that recipients cannot open publicly.
- **Suggested fix:** return or inject a canonical public origin from the server-side SEO/base-url source and compose share links from that canonical value.

## Carry-forward risk
- Multi-instance restore maintenance still depends on process-local state (`apps/web/src/lib/restore-maintenance.ts`) and needs a shared authority if deployment topology ever scales beyond a single app instance.
