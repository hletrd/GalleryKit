# Evidence-based correctness review — Cycle 8

Scope: reviewed the repo’s top-level docs (`README.md`, `CLAUDE.md`), package/build config, app source, e2e specs, and unit tests with an evidence-first lens. Verification run in this session: `npm test --workspace=apps/web` (59 files / 370 tests passed), `npm run typecheck --workspace=apps/web` (passed), and `npm run lint --workspace=apps/web` (passed).

## Findings

### C8-01 — Shared public pages are documented as `revalidate = 0`, but the shared routes do not export it
- **Status:** confirmed
- **Severity / confidence:** medium / high
- **Location:** `README.md:199-204`; `CLAUDE.md:199-204`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:1-120`; `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:1-120`
- **Problem:** the docs say the public photo, topic, shared, and home pages are all pinned to `revalidate = 0` so metadata/image updates appear immediately. The home/topic/photo pages do export `revalidate = 0`, but the shared group/photo pages do not export it at all.
- **Failure scenario:** shared links can drift onto Next’s default caching/dynamic behavior after a refactor or framework change, while the docs still promise immediate freshness.
- **Concrete fix:** add `export const revalidate = 0;` to both shared page files, or revise the docs to describe the actual caching model and add a page-level regression test that asserts the export exists.

### C8-02 — Production nginx serves PNGs from the upload tree despite the public asset allowlist saying only JPEG/WebP/AVIF are served
- **Status:** confirmed
- **Severity / confidence:** medium / high
- **Location:** `README.md:176-178`; `CLAUDE.md:133-139`; `apps/web/nginx/default.conf:96-112`; `apps/web/src/lib/serve-upload.ts:13-18, 38-87`; `apps/web/src/__tests__/serve-upload.test.ts:25-43`
- **Problem:** the Node upload-serving route and its tests restrict public uploads to the `jpeg`, `webp`, and `avif` directories with matching extensions. The shipped nginx deployment diverges by allowing `png` through the regex at the production edge, so a `.png` in one of those directories is served publicly there even though the docs say only JPEG/WebP/AVIF are exposed.
- **Failure scenario:** a stray or attacker-placed `.png` under `public/uploads/jpeg|webp|avif` becomes publicly reachable in the Docker/nginx deployment, but the Node-side tests and docs still imply the tighter allowlist.
- **Concrete fix:** remove `png` from the nginx regex, or intentionally support it end-to-end by updating the Node route, tests, and docs to the same allowlist.

### C8-03 — Admin Playwright coverage is opt-in, so `npm run test:e2e` can pass without exercising login/upload/delete workflows
- **Status:** likely / verification gap
- **Severity / confidence:** medium / high
- **Location:** `README.md:226-231`; `CLAUDE.md:226-232`; `apps/web/e2e/helpers.ts:28-45, 47-73`; `apps/web/e2e/admin.spec.ts:6-13, 20-80`; `apps/web/playwright.config.ts:19-35, 60-68`
- **Problem:** the admin Playwright suite auto-enables only when local plaintext credentials are available or `E2E_ADMIN_ENABLED=true` is set. Remote admin coverage is additionally blocked unless `E2E_ALLOW_REMOTE_ADMIN=true` is set. That means the repo’s nominal e2e command can still report green while the admin workflows the app advertises remain unexecuted.
- **Failure scenario:** login, upload, settings, or delete regressions in the admin dashboard are not caught in CI or local smoke runs when credentials are hashed or omitted.
- **Concrete fix:** split admin workflows into a dedicated required CI job, or make the admin suite fail/loudly report when it is skipped in CI.

## Missed-issues sweep

- No additional confirmed docs/code mismatches surfaced after reviewing auth, rate limiting, request-origin handling, backup restore/download, queueing, upload serving, and public-page tests.
- Remaining manual-validation risks are mostly deployment/UI claims: the live demo link, host-network/nginx topology, masonry/infinite-scroll UX, and drag-and-drop behavior still depend on runtime/browser observation rather than repo-enforced assertions.
