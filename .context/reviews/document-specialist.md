# GalleryKit Document Specialist Review - Cycle 6 Prompt 1

Date: 2026-07-07
Lane: document-specialist
Mode: read-only documentation/source review, except this artifact.

## Inventory

Authoritative docs examined:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `apps/web/README.md`
- `.context/plans/README.md`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`

Implementation/config surfaces checked against those docs:

- Root/app package scripts: `package.json`, `apps/web/package.json`
- Deploy path: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`, `apps/web/.env.local.example`
- Build/config path: `apps/web/next.config.ts`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`
- SEO/site config code: `apps/web/src/lib/data.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/components/nav.tsx`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/components/footer.tsx`
- Schema/migration gates: `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, migration journal tests
- Quality gates/source contracts: `apps/web/src/__tests__/deploy-script-contract.test.ts`, `migration-journal*.test.ts`, `check-*` lint-gate tests, recent `cycle-*-source-contracts.test.ts`
- Upload/API contract: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`

No external official docs were needed for the confirmed findings below; they are repo-internal documentation/code ownership mismatches. I did not run build/test gates because this was a read-only review request and the evidence is static source/docs.

## Confirmed Findings

### DOC-C6-01 - `CLAUDE.md` says SEO locale is not DB-overridable, but the admin SEO path persists and serves it

Severity: Low
Confidence: High

Evidence:

- `CLAUDE.md:148` says fields not DB-overridable include `locale`.
- `README.md:52` correctly says admin-editable SEO/branding fields include `locale` and override file defaults at runtime.
- `apps/web/src/lib/gallery-config-shared.ts:89-96` includes `seo_locale` in `SEO_SETTING_KEYS`.
- `apps/web/src/app/actions/seo.ts:41-46` reads `seo_locale` for the admin SEO page, and `apps/web/src/app/actions/seo.ts:123-128` validates it before persistence.
- `apps/web/src/lib/data.ts:1814-1835` reads `admin_settings` and returns `locale: settingsMap.get('seo_locale') || siteConfig.locale`.
- `apps/web/src/app/[locale]/layout.tsx:17-20` passes `seo.locale` into OpenGraph locale resolution.

Failure scenario:

An operator or future maintainer follows `CLAUDE.md:148`, assumes locale changes require editing `site-config.json` plus an image rebuild, and misses the live admin SEO override path. That can leave OpenGraph locale metadata stale or lead to unnecessary rebuild/deploy work when a DB row update is the intended runtime path.

Concrete fix:

Update `CLAUDE.md:148` to remove `locale` from the "not DB-overridable" list, or spell out the distinction precisely: `site-config.json.locale` is the fallback, while `admin_settings.seo_locale` is runtime-overridable for SEO/OpenGraph metadata.

### DOC-C6-02 - `CLAUDE.md` overstates what `site-config.json` `title` and `locale` control

Severity: Low
Confidence: High

Evidence:

- `CLAUDE.md:704` says `title` is displayed in nav, footer, and OG title.
- Actual nav display uses `seo.nav_title`: `apps/web/src/components/nav.tsx:20-23` passes `seo.nav_title`, and `apps/web/src/components/nav-client.tsx:101-102` renders `navTitle`.
- Actual footer text uses `siteConfig.footer_text`: `apps/web/src/components/footer.tsx:35-36`.
- OG title uses `seo.title`: `apps/web/src/app/[locale]/layout.tsx:24-27` and `apps/web/src/app/[locale]/layout.tsx:42-47`.
- `CLAUDE.md:707` says `locale` is "OG/HTML locale".
- Actual HTML language is route-driven, not site-config-driven: `apps/web/src/app/[locale]/layout.tsx:88-92` validates the route locale and `apps/web/src/app/[locale]/layout.tsx:103-108` renders `<html lang={locale}>`.
- Actual OG locale uses route locale plus SEO fallback: `apps/web/src/app/[locale]/layout.tsx:17-20` and `apps/web/src/app/[locale]/layout.tsx:47-48`.

Failure scenario:

An operator edits `site-config.json.title` expecting the nav brand or footer to change. The nav remains governed by `nav_title` / `seo_nav_title`, and the footer remains governed by `footer_text`. Similarly, editing `site-config.json.locale` cannot change the HTML route locale; it only participates in metadata fallback. This creates confusing branding/SEO deploys where the rebuilt image still appears "unchanged" in the surfaces the doc names.

Concrete fix:

Revise `CLAUDE.md:704-713` field descriptions:

- `title`: fallback site title and OG/title metadata unless DB `seo_title` overrides it.
- `nav_title`: nav-bar brand fallback unless DB `seo_nav_title` overrides it.
- `footer_text`: footer text.
- `locale`: OpenGraph/SEO locale fallback unless DB `seo_locale` overrides it; HTML `lang` comes from the `[locale]` route.

## Verified Aligned Areas

- Deploy docs match `scripts/deploy-remote.sh` and `apps/web/deploy.sh`: config-driven `.env.deploy`, unsafe permission refusal, host `git pull --ff-only`, compose rebuild, `/api/live` health check, then Docker prune.
- Docker persistence docs match compose/deploy: `./data`, `./public/uploads`, `./public/resources`, and read-only `./src/site-config.json` are bind mounts; immutable public assets come from the image.
- Schema docs match current migration safeguards: journal tag/file parity, post-migrate hash assertion, pending-vs-drift split, DML-baseline guard, and `when` monotonicity tests are present.
- Quality-gate docs match package scripts and lint scanners for ESLint, API auth, action origin, public route rate limits, typecheck, build, Vitest, and Playwright.
- Upload API docs match the route: `POST /api/admin/lr/upload`, `X-GalleryKit-Token`, `lr:upload`, multipart `file`/`topic`/optional title/description, 200 MiB file cap, 2 GiB window, 100-file window, and `{ success: true, id }` response.
- CLIP docs under `docs/superpowers/` are clearly marked historical, and current operator guidance lives in `CLAUDE.md` / `apps/web/README.md`.

## Final Sweep

Checked README/CLAUDE/AGENTS/app README against deploy scripts, compose, Dockerfile, nginx template, env examples, site config consumers, SEO actions, migration journal/migrator, lint-gate scripts, package scripts, upload API, and committed source-contract tests. Aside from DOC-C6-01 and DOC-C6-02, I did not find additional current documentation-code mismatches in the reviewed surfaces.
