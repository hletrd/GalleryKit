# Debugger Review — Cycle 7 RPF

## Scope / Inventory

I reviewed the full set of bug-relevant code touched in this cycle and traced the main end-to-end flows rather than sampling.

### Source flows inspected
- Upload / process / delete: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/revalidation.ts`
- Auth / session / password / admin users: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`
- Restore / backup / download: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/backup-filename.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/restore-maintenance.ts`
- Public listing / search / share: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/tag-slugs.ts`, `apps/web/src/lib/image-url.ts`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- Settings / SEO / i18n routing / proxy: `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/lib/locale-path.ts`, `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/proxy.ts`, `apps/web/src/i18n/request.ts`, `apps/web/src/lib/content-security-policy.ts`
- Tags / topics / related admin flows: `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`
- UI components that carry the critical flows: `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/home-client.tsx`
- Gates / scripts / tests: `apps/web/scripts/check-action-origin.ts`, `apps/web/playwright.config.ts`, `apps/web/src/__tests__/*` and `apps/web/e2e/admin.spec.ts`

### Changed files reviewed in this cycle
I reviewed the entire changed set from the cycle 6→7 security/correctness patch, including all source and test files in the diff:
`CLAUDE.md`, `apps/web/e2e/admin.spec.ts`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/playwright.config.ts`, `apps/web/scripts/check-action-origin.ts`, the changed `apps/web/src/__tests__/*` files, and every touched source file under `apps/web/src/app/**`, `apps/web/src/components/**`, and `apps/web/src/lib/**`.

## Causal tracing / competing hypotheses

I traced the suspicious paths that were most likely to regress under this patch set:

1. **Load-more rate limiting drift** (`apps/web/src/app/actions/public.ts:67-110`, `apps/web/src/lib/rate-limit.ts:69-98`)
   - Hypothesis: the new in-memory pre-increment plus DB fallback could leak counts or block unrelated users.
   - Result: rejected as a confirmed bug. The rate limit is intentionally keyed by IP, and the code paths are consistent with the search/share patterns. The unit tests for `public-actions.test.ts` cover rollback, DB-failure fallback, and the over-limit branch.

2. **Same-origin and trusted-proxy handling** (`apps/web/src/lib/request-origin.ts:45-107`, `apps/web/src/lib/rate-limit.ts:69-98`)
   - Hypothesis: the new proxy/header hardening might accidentally accept spoofed provenance or mis-handle default ports.
   - Result: rejected as a confirmed bug. The implementation normalizes default ports, prefers the trusted right-most forwarded hop when proxy trust is explicitly enabled, and fails closed when provenance is missing. The `request-origin.test.ts` and `rate-limit.test.ts` suites exercise the relevant branches.

3. **Backup / upload filesystem containment** (`apps/web/src/app/api/admin/db/download/route.ts:13-108`, `apps/web/src/lib/serve-upload.ts:32-115`, `apps/web/src/lib/db-restore.ts:1-32`)
   - Hypothesis: path traversal or symlink escape could bypass the new containment checks.
   - Result: rejected as a confirmed bug. The route and helper both validate filename shape, then re-check containment with `realpath()` after `lstat()`, and the tests cover the expected unauthorized / missing-file / symlink-style failure modes.

## Findings

### No confirmed findings
I did not find a reproducible correctness or security defect in this cycle’s patch set.

Evidence:
- The full unit test suite under `apps/web/src/__tests__` passed: **59 files / 369 tests passed**.
- The critical path tests for rate limiting, request origin, backup download, SEO settings, and public actions all passed in targeted runs.
- The reviewed source files above cover the requested end-to-end flows, and the added gate scripts/tests are aligned with the mutated action surfaces.

## Coverage check

I did a final sweep for commonly missed issues:
- checked same-origin gating on mutating actions,
- checked trusted-proxy/IP derivation,
- checked restore/backup path containment,
- checked locale path handling,
- checked public search/load-more/share flows,
- checked upload/delete/processing queue interactions,
- checked admin user/session/password rotation.

No relevant file in the changed set was skipped, and I did not find a latent bug that I can support with file/line evidence.
