# Verifier Review — Cycle 10 Prompt 1 Retry

## Inventory Reviewed

Core correctness-sensitive surface:
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`

Shared behavior and helper modules:
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/tag-slugs.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/lib/revalidation.ts`

Route / edge entrypoints:
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`

Validation evidence:
- `npx vitest run src/__tests__/{auth-rate-limit.test.ts,public-actions.test.ts,privacy-fields.test.ts,validation.test.ts,upload-tracker.test.ts,gallery-config-shared.test.ts,session.test.ts,tag-slugs.test.ts,rate-limit.test.ts}` → 9 files, 75 tests passed
- `npx vitest run` → 23 files, 137 tests passed
- `npm run lint --workspace=apps/web` → passed
- `npm run build --workspace=apps/web` → passed

## Confirmed Issues

None found in the inspected code paths.

## Likely Issues

None found with sufficient evidence to label as likely correctness defects.

## Manual-Validation Risks

### MV-01: Reverse-proxy deployments collapse rate limits to the `"unknown"` bucket unless `TRUST_PROXY=true` is set
- **Files / regions:** `apps/web/src/lib/rate-limit.ts:59-81`, `.env.local.example:30-34`
- **What happens:** `getClientIp()` returns `"unknown"` when proxy headers are present but `TRUST_PROXY` is not explicitly enabled. Every request then shares the same IP bucket.
- **Concrete scenario:** A Docker/nginx deployment forgets to set `TRUST_PROXY=true`. One aggressive login/search/upload client can throttle unrelated users because all traffic is keyed under the same `"unknown"` IP.
- **Suggested fix:** Keep the documented environment requirement explicit in deployment docs and verify the proxy config in production smoke tests; if the app is always behind a trusted proxy, add a startup check that fails fast when proxy headers are present but `TRUST_PROXY` is unset.
- **Confidence:** Medium

### MV-02: Database dump/restore subprocesses assume `C.UTF-8` exists in the runtime image
- **Files / regions:** `apps/web/src/app/[locale]/admin/db-actions.ts:129-141`, `apps/web/src/app/[locale]/admin/db-actions.ts:359-370`
- **What happens:** Both `mysqldump` and `mysql` are spawned with `LANG=C.UTF-8` and `LC_ALL=C.UTF-8` for deterministic output.
- **Concrete scenario:** A minimal container image or host image lacks the `C.UTF-8` locale support that the subprocess expects; backup/restore commands may emit locale warnings or fail unexpectedly even though the app build and unit tests pass.
- **Suggested fix:** Validate the locale support in the deployment image, or make the locale setting configurable with a documented fallback.
- **Confidence:** Low

## Findings Count

- Confirmed: 0
- Likely: 0
- Manual-validation risks: 2
