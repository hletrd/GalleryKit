# Cycle 60 Security / Privacy Review

Reviewed HEAD: `fe112ba5859e42842389020544f2ffa1d91662d9`.

## Inventory Checked

- Repo instructions and current security model in `AGENTS.md` and `CLAUDE.md`.
- Auth/session/PAT boundaries: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/auth.ts`.
- API/action boundaries: `withAdminAuth(...)` admin routes, `requireSameOriginAdmin()` action guards, public route rate-limit contracts.
- Upload/file safety: upload actions, LR upload route, `upload-paths.ts`, `serve-upload.ts`.
- Backup/restore and deploy safety: admin DB actions, SQL restore scanner, deploy helper docs.
- Privacy projections: `data.ts` public/admin select fields and semantic search enrichment fields.

## Findings

No new confirmed security or privacy findings at HEAD `fe112ba5`.

## Non-Findings

- Admin API auth remains centralized through `withAdminAuth(...)`; cookie paths enforce same-origin plus admin session and PAT paths rate-limit/scope-check before handler execution.
- Public expensive routes remain rate-limited before expensive work.
- Public privacy projections still omit the documented admin-only/sensitive fields, with compile-time guards present.
- Upload and serving paths still reject traversal, symlinks, public originals, and unsafe names.

## Validation Evidence

- Security lane reported `npm run lint:api-auth --workspace=apps/web` pass.
- Security lane reported `npm run lint:action-origin --workspace=apps/web` pass.
- Security lane reported `npm run lint:public-route-rate-limit --workspace=apps/web` pass.
- Security lane reported `npm audit --workspace=apps/web --audit-level=high --json` exit 0.
- Security lane reported focused security/privacy Vitest bundle pass: 15 files, 335 tests.
