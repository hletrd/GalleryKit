# Plan 258 — Cycle 1 review fixes

Status: completed in Prompt 3

## Source reviews

- Individual reports: `.context/reviews/{code-reviewer,perf-reviewer,security-reviewer,critic,verifier,test-engineer,tracer,architect,debugger,document-specialist,designer,api-reviewer,quality-reviewer,style-reviewer}.md`
- Aggregate: `.context/reviews/_aggregate.md`

## Repo rules read before planning

Read order followed before deferrals: `CLAUDE.md`, `AGENTS.md`, relevant `.context/**` rule/deferred-plan material (including `.context/plans/README.md`, prior deferred-plan policy examples, and the current aggregate), `.cursorrules` (absent), `CONTRIBUTING.md` (absent), and `docs/` policy files (absent). Key rules applied:

- `AGENTS.md:3-4`: always commit and push; use gitmoji.
- `CLAUDE.md:160` / `README.md:146`: shipped deployment is single web-instance / single-writer; do not horizontally scale until coordination state is shared.
- `CLAUDE.md:217`: Node.js 24+ and TypeScript 6.0+.
- `CLAUDE.md:227-228`: commit/push and gitmoji workflow.
- `CLAUDE.md:240-253`: API auth and server-action origin lint gates are blocking.
- `CLAUDE.md:257-259`: 44x44 touch-target policy and current audit scope.
- `CLAUDE.md:212-214`: only 2FA/WebAuthn is permanently deferred by repo policy.

## Scheduled implementation items

Every aggregate finding is either scheduled below or explicitly deferred in `plan/plan-259-cycle1-deferred.md`.

### Security / correctness / data integrity

- [x] **P258-01 / AGG-C1-01** — Fix admin deletion invariant race by replacing target-scoped admin delete locks with one global admin-delete lock; update comments and add a concurrency/source regression. Citations: `apps/web/src/lib/advisory-locks.ts:26-32`, `apps/web/src/app/actions/admin-users.ts:198-247`.
- [x] **P258-02 / AGG-C1-02** — Stop share-route metadata from doing rate-limit-bypassing DB lookups; update source-contract tests. Citations: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:42-55,101-112`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:37-51,111-121`, `apps/web/src/__tests__/shared-route-rate-limit-source.test.ts:32-50`.
- [x] **P258-03 / AGG-C1-09** — Remove existing-photo share no-op rollback before any pre-increment; add/update regression coverage. Citations: `apps/web/src/app/actions/sharing.ts:55-76,95-120`, `apps/web/src/__tests__/sharing-source-contracts.test.ts:7-16`.
- [x] **P258-04 / AGG-C1-10** — Make nonexistent-topic `/api/og` requests consume the limiter after DB work; add route/source regression. Citation: `apps/web/src/app/api/og/route.tsx:38-77`.
- [x] **P258-05 / AGG-C1-11** — Harden nginx forwarded-IP behavior by overwriting untrusted inbound `X-Forwarded-For` in the documented topology; update nginx tests/docs as needed. Citations: `apps/web/nginx/default.conf:67-69,84-86,101-103,117-119,134-136,169-171`, `apps/web/src/lib/rate-limit.ts:123-145`.
- [x] **P258-06 / AGG-C1-12** — Reject upload tag/topic strings when control or Unicode formatting sanitization would change submitted input; add upload-action tests. Citation: `apps/web/src/app/actions/images.ts:131-158`.
- [x] **P258-07 / AGG-C1-13** — Align `admin_users.updated_at` schema, migrations, and legacy reconcile path. Citations: `apps/web/src/db/schema.ts:106-113`, `apps/web/drizzle/0001_sync_current_schema.sql:1-8`, `apps/web/scripts/migrate.js:276-289`.
- [x] **P258-08 / AGG-C1-26** — Tighten same-origin action lint so future mutating actions cannot run effects before `requireSameOriginAdmin`; add a failing fixture. Citation: `apps/web/scripts/check-action-origin.ts`.
- [x] **P258-09 / AGG-C1-27** — Align Drizzle Kit DB SSL/TLS semantics with runtime/scripts or add a tested explicit limitation. Citations: `apps/web/src/db/index.ts:6-12`, `apps/web/scripts/mysql-connection-options.js:1-23`, `apps/web/drizzle.config.ts:4-12`.
- [x] **P258-10 / AGG-C1-49** — Deduplicate tag slugs inside data-layer tag filter construction. Citation: `apps/web/src/lib/data.ts` tag-filter builder.
- [x] **P258-11 / AGG-C1-51** — Make Argon2id hashing policy explicit and shared enough to cover app actions plus bootstrap/migration scripts. Citations: `apps/web/src/app/actions/auth.ts:66,379`, `apps/web/src/app/actions/admin-users.ts:138`, `apps/web/scripts/seed-admin.ts:48`, `apps/web/scripts/migrate-admin-auth.ts:49`, `apps/web/scripts/migrate.js:515-520`.
- [x] **P258-12 / AGG-C1-54** — Validate shared-group `photoId` before suppressing group view count. Citations: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-147`, `apps/web/src/lib/data.ts:1014-1019`.
- [x] **P258-13 / AGG-C1-55** — Close restore SQL scan fd before unlinking rejected dangerous dumps on Windows-like filesystems. Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:408-433`.

### Build, deploy, supply-chain, and docs/config correctness

- [x] **P258-14 / AGG-C1-03** — Use the committed lockfile in Docker dependency stages with `npm ci` instead of dynamic `npm install`. Citation: `apps/web/Dockerfile:21-36`.
- [x] **P258-15 / AGG-C1-04** — Add fail-fast shell options to the remote deploy script. Citation: `apps/web/deploy.sh:1-34`.
- [x] **P258-16 / AGG-C1-30** — Pin Node type surface to runtime major 24 and update lockfile. Citation: `apps/web/package.json:59-63`, `.nvmrc:1`.
- [x] **P258-17 / AGG-C1-31** — Add `.gitignore` exceptions so required `.context/reviews/**` artifacts are visible without force-add. Citation: `.gitignore:16-20`.
- [x] **P258-18 / AGG-C1-45** — Pass/document `BASE_URL` as a Docker build arg or correct Docker build docs. Citations: `apps/web/docker-compose.yml:7-20`, `apps/web/Dockerfile:39-42`, `apps/web/scripts/ensure-site-config.mjs:11-37`.
- [x] **P258-19 / AGG-C1-46** — Align deploy-env docs and script behavior; make the documented root `.env.deploy` path work or update docs to the home-secret path. Citations: `README.md:103-113`, `CLAUDE.md:287-294`, `scripts/deploy-remote.sh:4-6,47-50`.
- [x] **P258-20 / AGG-C1-47** — Correct upload/body-cap docs to match nginx/app behavior. Citations: `README.md:142-146`, `CLAUDE.md:219-220`, `apps/web/nginx/default.conf:29-31,72-76,89-93`.
- [x] **P258-21 / AGG-C1-53** — Correct stale upload action topic-FK comment. Citations: `apps/web/src/app/actions/images.ts:239-243`, `apps/web/src/db/schema.ts:30`, `apps/web/scripts/migrate.js:456`.
- [x] **P258-22 / AGG-C1-16** — Reword storage abstraction comments to state future intent, not current live upload/process/serve usage. Citations: `apps/web/src/lib/storage/types.ts:1-15,50-72,89-93`, `apps/web/src/lib/storage/index.ts:1-12`.
- [x] **P258-23 / AGG-C1-61** — Fix low-risk copy/style/doc drift: localize DB invalid-download URL, normalize ellipses where safe, remove dead `.masonry-grid` CSS, align `components.json` global CSS path, and replace stale blur-data-url line references / stale `db:push` deploy guidance. Citations: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:33-41`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/app/[locale]/globals.css:117-158`, `apps/web/components.json:6-10`, `CLAUDE.md:185,281-282`, `apps/web/src/lib/process-image.ts:393-397`.

### UI/UX/accessibility and test hardening

- [x] **P258-24 / AGG-C1-06** — Expand touch-target audit to cover app-level error files and fix `global-error.tsx` reset button hit target. Citations: `apps/web/src/__tests__/touch-target-audit.test.ts:49-52,257-260`, `apps/web/src/app/global-error.tsx:71-75`.
- [x] **P258-25 / AGG-C1-40 + AGG-C1-41** — Move design-system/custom controls toward 44px hit targets where low-risk: shadcn button/input/select/switch defaults, tag remove/suggestion rows, bottom-sheet close/handle, histogram toggles; update touch-target audit expectations if needed. Citations: `apps/web/src/components/ui/button.tsx:23-29`, `apps/web/src/components/ui/input.tsx:10-13`, `apps/web/src/components/ui/select.tsx:27-40`, `apps/web/src/components/ui/switch.tsx:13-24`, `apps/web/src/components/tag-input.tsx:169-176,219-240`, `apps/web/src/components/info-bottom-sheet.tsx:181-214`, `apps/web/src/components/histogram.tsx:293-326`.
- [x] **P258-26 / AGG-C1-36** — Extract image zoom math into production code used by both component and unit tests so tests no longer duplicate private logic. Citations: `apps/web/src/components/image-zoom.tsx:12-38`, `apps/web/src/__tests__/image-zoom-math.test.ts:3-39`.
- [x] **P258-27 / AGG-C1-38** — Add Playwright upload cleanup in `try/finally`. Citation: `apps/web/e2e/admin.spec.ts:73-88`.
- [x] **P258-28 / AGG-C1-42** — Ensure combobox `aria-controls` / listbox state stays valid in search and tag input. Citations: `apps/web/src/components/search.tsx:195-203,246-288`, `apps/web/src/components/tag-input.tsx:183-244`.
- [x] **P258-29 / AGG-C1-44** — Use display tag labels, not slugs, for filtered page metadata and OG tags. Citations: `apps/web/src/app/[locale]/(public)/page.tsx:37-43`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:67-86`, `apps/web/src/app/api/og/route.tsx:80-86,182-195`.
- [x] **P258-30 / AGG-C1-48** — Disable `strip_gps_on_upload` UI switch after images exist and connect the lock hint. Citations: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:142-185`, `apps/web/src/app/actions/settings.ts:115-132`.
- [x] **P258-31 / AGG-C1-58** — Add shared-group card focus affordance matching public gallery cards. Citations: `apps/web/src/components/home-client.tsx:192-201`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:188-209`.
- [x] **P258-32 / AGG-C1-60** — Improve low-risk announcements/relationships: image error polite status, load-more completion/no-more status if feasible, mobile nav `aria-controls` for expansion. Citations: `apps/web/src/components/optimistic-image.tsx:70-78`, `apps/web/src/components/load-more.tsx:91-124`, `apps/web/src/components/nav-client.tsx:86-161`.

## Required gates

Prompt 3 must run the full configured gate list after implementation:

- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test`
- [x] `npm run test:e2e`
- [x] `npm run lint:api-auth`
- [x] `npm run lint:action-origin`

## Progress log

- [x] Prompt 2 plan authored; no implementation started in Prompt 2.
- [x] Prompt 3 implementation started.
- [x] Scheduled items fixed or explicitly reconciled.
- [x] Full gates green.
- [x] Signed gitmoji commits pushed.
- [x] Per-cycle deploy attempted after green gates — `DEPLOY: per-cycle-failed:missing deploy env file`.

- [x] Implemented security/correctness fixes: global admin-delete lock, charged successful admin creation, generic share metadata, share/OG limiter semantics, nginx forwarded-IP overwrite, upload input rejection, schema/migration alignment, Drizzle TLS, tag-filter dedupe, shared-group photoId counting, and restore cleanup ordering.
- [x] Implemented build/deploy/docs/config fixes: Docker lockfile/npm ci, BASE_URL build arg, fail-fast deploy script, root `.env.deploy` fallback, Node 24 type pin, review-artifact ignore exceptions, body-cap docs, stale comments, localized DB URL error, components config path, and CSS cleanup.
- [x] Implemented UI/test fixes: 44px control defaults and custom touch targets, image zoom math extraction, E2E upload cleanup, combobox ARIA relationships, display tag-label metadata/OG tags, locked GPS switch, shared-card focus affordance, and polite status/nav relationships.
- [x] Gates run green after implementation: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test`, `npm run test:e2e`, `npm run lint:api-auth`, `npm run lint:action-origin`.
