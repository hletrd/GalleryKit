# Cycle 5 Deep Repository Review — Verifier

## Verdict
PASS (no confirmed correctness defects found against the documented behavior, tests, or gate scripts that were reviewed)

## Scope reviewed
I inspected the primary docs and the code paths they describe:
- `README.md`
- `CLAUDE.md`
- `apps/web/README.md`
- `package.json`
- `apps/web/package.json`
- security gates: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`
- proxy / auth / rate-limit / CSP / config: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/constants.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/session.ts`
- server actions and routes: `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`
- app shell / middleware / Docker / nginx: `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`
- UI surfaces changed in the latest commit: `apps/web/src/components/search.tsx`, `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/photo-viewer-loading.tsx`, `apps/web/src/components/footer.tsx`, `apps/web/src/app/[locale]/admin/login-form.tsx`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/src/components/tag-input.tsx`, `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/alert-dialog.tsx`, `apps/web/src/components/ui/sheet.tsx`, `apps/web/src/components/ui/switch.tsx`
- representative tests: `apps/web/src/__tests__/request-origin.test.ts`, `rate-limit.test.ts`, `next-config.test.ts`, `content-security-policy.test.ts`, `check-api-auth.test.ts`, `check-action-origin.test.ts`, `settings-image-sizes-lock.test.ts`, `images-actions.test.ts`, `public-actions.test.ts`, `photo-title.test.ts`, `health-route.test.ts`, `live-route.test.ts`

## Evidence gathered
### Gate / test commands
- `npm run lint:api-auth --workspace=apps/web` → passed (`OK: src/app/api/admin/db/download/route.ts`)
- `npm run lint:action-origin --workspace=apps/web` → passed; all mutating actions reported `OK`, getter exemptions reported `SKIP`
- `npm exec --workspace=apps/web -- vitest run src/__tests__/request-origin.test.ts src/__tests__/rate-limit.test.ts src/__tests__/next-config.test.ts src/__tests__/content-security-policy.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts` → 6 files passed, 65 tests passed
- `npm run build --workspace=apps/web` → passed; production build completed and route list matched the documented app surface
- `npm run test --workspace=apps/web` → passed; 58 test files / 341 tests passed

### Key behavior checks
- Proxy / same-origin logic matched docs and tests:
  - `apps/web/src/lib/request-origin.ts` respects `TRUST_PROXY=true`, prefers right-most forwarded headers, strips default ports, and fails closed when origin metadata is missing.
  - `apps/web/src/app/actions/auth.ts` uses that trusted-proxy protocol to set Secure cookies and uses same-origin checks before login/logout.
- Security gates matched documentation:
  - `check-api-auth.ts` discovered the only admin API route and verified `withAdminAuth(...)` wrapping.
  - `check-action-origin.ts` recursively scanned mutating actions, exempted getters, and passed every mutating export.
- CSP and build-time config matched docs:
  - `next.config.ts` rejects plaintext `IMAGE_BASE_URL` in production, and `content-security-policy.ts` enforces HTTPS in production.
  - `proxy.ts` applies nonce-bearing production CSP headers.
- Storage / restore / backup behavior matched docs:
  - `upload-paths.ts` and `instrumentation.ts` fail closed on legacy public-original uploads in production.
  - `/api/admin/db/download` is behind `withAdminAuth` and a same-origin check.
  - `/api/health` is DB-aware and `/api/live` is liveness-only.
- UI changes in the latest commit were supported by tests and build output:
  - search / upload / dialog / sheet / switch / loading / footer changes compiled cleanly and did not introduce test regressions.

## Findings
None confirmed.

## Missed-issues sweep
I re-checked the highest-risk claims from the docs after the broad pass:
- reverse-proxy trust and same-origin assumptions
- admin API and mutating-action security gates
- backup download / restore hardening
- upload path isolation and legacy-original fail-closed behavior
- production CSP / `IMAGE_BASE_URL` rules
- liveness/readiness route split
- settings lock behavior and upload limits

I did not find a code/doc/test mismatch that rose above confidence threshold for a reportable defect.

## Files reviewed
Reviewed directly or via targeted tests/commands:
- Root docs: `README.md`, `CLAUDE.md`
- App docs/config: `apps/web/README.md`, `apps/web/package.json`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`
- Gate scripts: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/ensure-site-config.mjs`
- Core security/utilities: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/constants.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`
- Routes/actions: `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`
- UI surfaces changed in the latest commit: `apps/web/src/components/search.tsx`, `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/photo-viewer-loading.tsx`, `apps/web/src/components/footer.tsx`, `apps/web/src/app/[locale]/admin/login-form.tsx`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/src/components/tag-input.tsx`, `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/alert-dialog.tsx`, `apps/web/src/components/ui/sheet.tsx`, `apps/web/src/components/ui/switch.tsx`
- Representative tests: `apps/web/src/__tests__/request-origin.test.ts`, `rate-limit.test.ts`, `next-config.test.ts`, `content-security-policy.test.ts`, `check-api-auth.test.ts`, `check-action-origin.test.ts`, `settings-image-sizes-lock.test.ts`, `images-actions.test.ts`, `public-actions.test.ts`, `photo-title.test.ts`, `health-route.test.ts`, `live-route.test.ts`
