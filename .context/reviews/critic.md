# Critic Review - Run-10 Cycle 6 Prompt 1

Reviewer: critic lane. Repo: `/Users/hletrd/flash-shared/gallery`. HEAD reviewed: `423fa6c1`.
Mode: read-only static critique plus scanner/typecheck verification. Source files were not modified; this review artifact is the only write.

## Inventory

I inventoried the current repo before filing findings:

- Project rules/docs: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`, `.context/plans/deferred-carry-forward.md`.
- App surface: 639 implementation/test/script/e2e files under `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/scripts`, `apps/web/e2e`, and `apps/web/src/__tests__`.
- Test surface: 344 Vitest files and 12 Playwright/e2e files.
- High-risk files sampled in detail: auth/session/origin/rate-limit, public actions, semantic search routes, smart collections, admin settings/SEO, DB backup/restore scanner, deployment scripts, Docker/Compose, nginx template, site config, data access/privacy selects.

Validation run during review:

- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- `npm run typecheck --workspace=apps/web` - pass.

## Confirmed Issues

### CRIT-C6-01 - The shipped nginx template still hardcodes the demo domain

- Severity: Medium
- Confidence: High
- Perspectives: operational risk, self-host product correctness, docs-policy mismatch, hidden assumption
- Citations: `apps/web/nginx/default.conf:46-49`; `.context/plans/deferred-carry-forward.md:41`; `README.md:48`; `CLAUDE.md:483-495`

`apps/web/nginx/default.conf` declares a reusable deployment template, but the only server block is bound to `server_name gallery.atik.kr` at lines 46-49. The product is documented as self-hostable Docker support in the root README line 48, and the deferred register already carries `C96-07` to parameterize the demo domain. CLAUDE also states that committed nginx changes are templates and require operator application, not automatic deploy application.

Failure scenario: a self-host operator copies the checked-in nginx file onto a host that already has other server blocks. Requests for `photos.example.com` may miss this server block, hit the wrong default server, lose the intended body caps/rate limits, or serve a misleading TLS/host config. Because the template visually looks production-ready and line 48 is a real domain, this can survive review as an environment problem rather than a repo defect.

Concrete fix: turn `server_name` into an explicit template value (`server_name ${GALLERYKIT_SERVER_NAME};`) with a rendered example, or use a safe catch-all (`server_name _;`) in the checked-in generic template and put the demo host in deploy-local config only. Add a source-contract test that fails if `gallery.atik.kr` appears in `apps/web/nginx/default.conf`.

### CRIT-C6-02 - SEO locale is exposed as an admin-editable override, but valid pages ignore it

- Severity: Low-Medium
- Confidence: High
- Perspectives: UX, product correctness, docs-policy mismatch
- Citations: `README.md:50-52`; `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:151-161`; `apps/web/src/lib/data.ts:1827-1834`; `apps/web/src/lib/locale-path.ts:63-74`; `apps/web/src/app/[locale]/layout.tsx:17-20`; `apps/web/src/app/[locale]/layout.tsx:90-93`; `CLAUDE.md:148`

The root README says `locale` is one of the SEO/branding fields admins can edit and override at runtime. The admin SEO page renders a `seo_locale` input. `getSeoSettings()` persists and returns that DB value as `seo.locale`. But `getOpenGraphLocale()` always returns the route locale for supported routes and uses the configured locale only for unsupported/unknown route locales. The `[locale]` layout rejects unsupported locales with `notFound()`, so the configured value is effectively not an override for normal public pages.

There is also a direct documentation contradiction: `CLAUDE.md:148` says `locale` is not DB-overridable and requires a rebuild, while `data.ts:1832` does read `seo_locale` from `admin_settings`.

Failure scenario: an admin changes the SEO Locale field to `ko_KR` expecting English pages to advertise Korean OpenGraph metadata or expecting a site-wide locale change. `/en` still emits `en_US`, `/ko` still emits `ko_KR`, and no visible UI explains that route locale wins. Another maintainer reading CLAUDE may instead think the field is file-only and remove or bypass the DB-backed SEO control.

Concrete fix: either remove the SEO Locale field from the admin UI and docs, or relabel it as "Fallback Open Graph locale" with help text explaining that localized routes override it. Update `README.md` and `CLAUDE.md` to agree on the actual contract. Add a docs/source test that pins the wording to the `getOpenGraphLocale()` route-locale precedence contract.

## Operational / Evidence Risks

### RISK-C6-01 - Edge limiter correctness still depends on manual host-nginx application

- Severity: Medium evidence risk
- Confidence: High for the repo-state risk; Medium for live production state
- Perspectives: operational risk, hidden assumption, release evidence
- Citations: `apps/web/nginx/default.conf:1-19`; `CLAUDE.md:238`; `CLAUDE.md:483-495`; `.context/plans/deferred-carry-forward.md:93-97`

The repo now contains `zone=public` and `zone=nextimage` limiters, but CLAUDE explicitly says deploys do not apply host nginx and that committed config is inert until an operator copies, tests, reloads, and verifies it. The carry-forward register still has `C3-08op` and `C4-13` open for operator application and a >burst 429 probe.

Failure scenario: local gates pass and `npm run deploy` rebuilds the app container, but the host is still running an older nginx config. Public dynamic pages and `/_next/image` stay unthrottled at the edge even though source review sees the limiter definitions. Under crawl/bot load this can turn into DB/Sharp pressure, and the app-layer scanners cannot detect it because they do not inspect the live proxy.

Concrete fix: keep this as a Prompt 2 operational work item unless live evidence already exists. Minimum close evidence: on the deploy host, record `nginx -t`, reload timestamp, and a read-only burst probe proving `zone=public` and `zone=nextimage` return 429 past the documented burst while normal page loads do not. Longer-term fix: render/apply nginx from config as part of an explicit ops step, or add a deploy check that reports the active nginx config hash without modifying it.

### RISK-C6-02 - Storage abstraction remains a product-boundary trap

- Severity: Low-Medium architecture risk
- Confidence: High
- Perspectives: maintainability, product correctness, docs-policy mismatch
- Citations: `CLAUDE.md:150`; `.context/plans/deferred-carry-forward.md:75`; `apps/web/src/lib/storage/index.ts`; `apps/web/src/lib/storage/local.ts`; `apps/web/src/lib/storage/types.ts`

CLAUDE correctly warns that the `@/lib/storage` module exists but the product supports only local filesystem storage. The deferred register still carries `C2-27` as "wire or delete the storage abstraction." This is not a new code defect, but it remains a hidden assumption: a future contributor can see a storage interface and infer S3/MinIO is a supported seam even though upload, processing, serving, backups, restore, service-worker caching, and nginx are all local-path oriented.

Failure scenario: a future change wires only `storage.put()` for originals or derivatives and markets "S3 support" while restore, delete cleanup, public serving, service-worker image caching, and backup docs still assume bind-mounted local files. The result is split-brain media storage and incomplete rollback/cleanup behavior.

Concrete fix: either delete the abstraction until a real storage backend project starts, or add an explicit `local-only` naming/comment tripwire plus a test that prevents any README/admin copy from advertising alternate storage. If S3/MinIO is desired, schedule it as an end-to-end storage project, not a small adapter swap.

## Final Sweep

Checked issue classes:

- Product correctness: smart collections now gate `is_public`; semantic search has disabled/stub/production honesty gates; no edit/culling/scoring features found in the sampled UI.
- Security/rate-limit/auth: admin API auth scanner, action-origin scanner, public route limiter scanner, and typecheck all pass.
- Privacy: public data access is heavily guarded by select-field tests; no new public PII leak found in sampled search/feed/share/smart-collection paths.
- Operational: nginx/template/live-apply and site-config control-plane expectations remain the main risks.
- UX/docs: SEO locale field and docs are misleading relative to route-locale precedence.
- Hidden assumptions: single-instance topology and local storage are documented, but both remain easy future footguns if contributors treat existing abstractions/templates as complete product surfaces.

No Critical or High confirmed defects were found in this pass. The review should still request Prompt 2 scheduling for CRIT-C6-01, CRIT-C6-02, and the nginx live-evidence risk because they affect operator correctness and user/admin expectations.
