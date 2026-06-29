# Cycle 9 Document-Specialist Review

**Date:** 2026-06-29
**HEAD reviewed:** `0d00ba667d1eb228eb5e06fd22ba549a761fbf0b`
**Role:** documentation/code mismatch reviewer.
**Boundary:** Review-only lane. This artifact is the only intended write. Application source, migration files, plans, and other reviewer artifacts were not edited.

## Inventory Coverage

Read `AGENTS.md` and `CLAUDE.md` first, then built a review inventory from the repo's authoritative docs, operational scripts, package commands, migration state, security lint contracts, production semantic-search path, service-worker generation path, upload limits, admin navigation, and public behavior.

Primary inventory reviewed:

- Governing docs: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`.
- Deploy/env/runtime docs and scripts: `.env.deploy.example`, `apps/web/.env.local.example`, `package.json`, `apps/web/package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`.
- Migration/schema contracts: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, privacy omit guards in `apps/web/src/lib/data.ts`, and privacy/migration tests.
- Security/lint contracts: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, relevant server actions, admin API routes, public API routes, and action-origin fixtures.
- Semantic-search production state: gallery config resolver, admin settings, CLIP path/inference code, semantic and similar API routes, embedding actions/backfill scripts, production-mode tests, and public demo behavior.
- Service-worker generation: `apps/web/scripts/build-sw.ts`, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, PWA contract tests, `next.config.ts`, and README/CLAUDE PWA text.
- Upload/admin/public behavior: upload limit helper, upload actions, Lightroom upload route, nginx body caps, admin nav/messages/pages, share/public pages, public actions, proxy, and public route tests.

I did not sample only a subset of the requested surfaces. Generated/binary assets and historical archived reviews were inventoried/search-swept where they related to current contracts, but not read line-by-line as authoritative current behavior.

## Confirmed Issues

### DOC-C9-01 - Action-origin docs still say `public.ts` is excluded, but the scanner now includes it

**Severity:** Medium
**Confidence:** High
**Classification:** Confirmed documentation/source-comment mismatch against an active security lint contract.

**Evidence:**

- `CLAUDE.md:590-592` documents `lint:action-origin` as scanning `apps/web/src/app/actions/` while "excluding basenames `auth` and `public`".
- `CLAUDE.md:602` partly contradicts that by saying `public.ts` is scanned with the narrower public-rate-limit contract.
- `apps/web/src/app/actions/public.ts:311-314` repeats the stale source comment: "These live in public.ts (excluded from the action-origin gate by name)".
- `apps/web/scripts/check-action-origin.ts:49` actually excludes only `auth`.
- `apps/web/scripts/check-action-origin.ts:360-364` special-cases `actions/public.ts` only when a public mutating action has a rate-limit call before mutation.
- `apps/web/scripts/check-action-origin.ts:488-490` runs the scanner over the discovered action files.
- Validation: `npm run lint:action-origin --workspace=apps/web` reported `public.ts` entries as scanned and passed.

**Concrete failure scenario:** A contributor adds an unauthenticated mutating server action to `public.ts` and follows the stale docs/comment, believing the file is outside the action-origin gate. They may skip running the relevant lint gate or misread a failure as a scanner bug. The implementation is safer than the docs, but the docs make the security boundary harder to maintain.

**Suggested fix:** Update `CLAUDE.md:591` and `apps/web/src/app/actions/public.ts:313` to say only `auth` is excluded by basename. Document `public.ts` as included by `lint:action-origin` with a narrower requirement: intentionally public mutating actions must carry the exempt comment and prove rate-limit-before-mutation.

### DOC-C9-02 - `.env.deploy.example` tells operators to copy outside the repo while README/AGENTS use root `.env.deploy`

**Severity:** Low
**Confidence:** High
**Classification:** Confirmed deploy-runbook mismatch.

**Evidence:**

- `AGENTS.md:17-18` says root `npm run deploy` reads gitignored root `.env.deploy` copied from `.env.deploy.example`.
- `README.md:108-116` gives the same default workflow: `cp .env.deploy.example .env.deploy`, edit it, then run `npm run deploy`.
- `.env.deploy.example:1-4` instead says to copy the file outside the repository, defaulting to `~/.gallerykit-secrets/gallery-deploy.env`, and only mentions `DEPLOY_ENV_FILE` as an override.
- `scripts/deploy-remote.sh:22-29` resolves the file in this order: explicit `DEPLOY_ENV_FILE`, root `.env.deploy` if present, otherwise `~/.gallerykit-secrets/gallery-deploy.env`.
- `scripts/deploy-remote.sh:55-58` also tells users to copy to either `.env.deploy` or the external default.

**Concrete failure scenario:** A new operator follows README and creates root `.env.deploy`, while another follows the example header and creates only the external file. Both can work, but the contradictory "default" location complicates onboarding and makes troubleshooting "which env file did deploy read?" unnecessarily error-prone.

**Suggested fix:** Change `.env.deploy.example:1-4` to name root `.env.deploy` as the README/AGENTS default and the external path as the supported fallback/alternative. Alternatively, change README/AGENTS if the desired policy is external-only, but that would require matching `scripts/deploy-remote.sh`.

### DOC-C9-03 - Checked-in `public/sw.js` carries an old build stamp even though docs describe build-time stamping from current git SHA

**Severity:** Low
**Confidence:** High for the mismatch, Medium for user impact
**Classification:** Confirmed generated-artifact/docs mismatch.

**Evidence:**

- `CLAUDE.md:402-403` says `apps/web/public/sw.template.js` is the source and `scripts/build-sw.ts` stamps `__SW_VERSION__` into `public/sw.js` using the git short SHA plus image pipeline version.
- `apps/web/scripts/build-sw.ts:28-47` computes `git rev-parse --short HEAD` and writes `${sha}-p${IMAGE_PIPELINE_VERSION}` into the generated service worker.
- `apps/web/package.json:10` runs `tsx scripts/build-sw.ts` in `prebuild`, so production builds regenerate it.
- Current reviewed HEAD short SHA is `0d00ba66`.
- `apps/web/public/sw.js:21,26` still contains `1e182969-p7`.

**Concrete failure scenario:** Production builds are probably safe because `prebuild` regenerates the file. The mismatch matters for development and review: `npm run dev` does not run `prebuild`, so a browser can be served a checked-in service worker with a stale cache namespace after a template or pipeline change. Reviewers also cannot tell from the committed artifact whether the generated service worker corresponds to the reviewed source revision.

**Suggested fix:** Regenerate `apps/web/public/sw.js` before commits that affect service-worker or image-pipeline behavior, or adjust the docs/generator contract so the checked-in artifact uses a source-content or pipeline-version stamp instead of a commit-SHA stamp that is expected to drift after every commit.

## Likely Issues

None found beyond the confirmed issues and manual-validation risk below.

## Risks Needing Manual Validation

### DOC-C9-RISK-01 - Sidecar runbooks pin `tsx@4.21.0` while repo scripts test against `tsx ^4.22.4`

**Severity:** Low
**Confidence:** Medium
**Classification:** Operator-runbook drift risk; may be intentional pinning, but not documented as such.

**Evidence:**

- `CLAUDE.md:349` runs the color backfill sidecar with `npx --yes tsx@4.21.0`.
- `CLAUDE.md:506` runs the CLIP model download sidecar with `npx --yes tsx@4.21.0`.
- `CLAUDE.md:521` runs the CLIP embedding backfill sidecar with `npx --yes tsx@4.21.0`.
- `apps/web/package.json:82` uses repo dev dependency `tsx: ^4.22.4`.

**Concrete failure scenario:** Local scripts and tests execute under the package-managed `tsx` range, but production sidecar runbooks fetch an older exact version. If a script starts depending on behavior fixed in the newer `tsx`, the documented sidecar command can fail only during operator maintenance work. If `4.21.0` is intentionally pinned for production reproducibility, the docs do not say that.

**Suggested fix:** Either update the sidecar commands to the repo-tested `tsx` version/range, or add a short note that the exact `tsx@4.21.0` pin is intentional and covered by manual operator validation.

## False Positives / Already Fixed

- Semantic-search production state is consistent. `CLAUDE.md:151` says production is active only when the DB row and `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` opt-in agree; the code enforces this in `apps/web/src/lib/gallery-config-shared.ts:102-104`, `apps/web/src/lib/gallery-config.ts:123-141`, `apps/web/src/app/api/search/semantic/route.ts:232-249`, and `apps/web/src/app/api/search/similar/[id]/route.ts:97-113`. Live validation against `https://gallery.atik.kr/en` showed `semanticSearchMode:"production"` and `totalCount:445`; a POST to `/api/search/semantic` returned HTTP 200 with results.
- The prior route-header mismatch for semantic search is fixed. `apps/web/src/app/api/search/semantic/route.ts:8-26` now documents active stub-or-production encoders, model-version filtering, and production threshold behavior.
- The prior Tokens navigation mismatch is fixed. `apps/web/src/components/admin-nav.tsx:15-25` includes `/admin/tokens` between Settings and Password.
- Deploy prune and persistence docs match implementation. `apps/web/deploy.sh:31-58` prunes after `docker compose ... up -d --build`, and `apps/web/docker-compose.yml:23-27` bind-mounts persistent `data`, `public/uploads`, `public/resources`, and read-only site config.
- Upload limit docs match code and nginx. `apps/web/src/lib/upload-limits.ts:1-35`, `apps/web/src/app/actions/images.ts:162-228`, `apps/web/src/app/api/admin/lr/upload/route.ts:91-118`, `apps/web/nginx/default.conf:89-93`, and `apps/web/nginx/default.conf:122-132` align with the documented 200 MiB per file, 2 GiB total upload window, 100 files per window, 250 MiB DB restore, and 216 MiB admin/LR upload proxy caps.
- Migration docs match the current migrator. `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js:170-185`, `apps/web/scripts/migrate.js:293-673`, and `apps/web/scripts/migrate.js:719-760` support the documented hash-based postcondition, journal `when` caveat, and reconcile baseline behavior.
- Public/share behavior matches docs. Locale share pages are dynamic/noindex and rate-limited where expected; the service worker excludes share pages from offline HTML caching in `apps/web/public/sw.template.js:61-63`, and `apps/web/src/__tests__/sw-template-contract.test.ts` covers that contract.
- Security lint contracts are otherwise aligned. `npm run lint:api-auth --workspace=apps/web` and `npm run lint:public-route-rate-limit --workspace=apps/web` both passed during this review.

## Final Missed-Issue Sweep

Final sweeps rechecked README/CLAUDE/AGENTS against package scripts, deploy helper defaults, `.env` examples, Docker/nginx body caps, migration journal behavior, privacy omit guards, security scanner behavior, CLIP activation and offline model loading, service-worker template/generated output, upload limits, admin nav/messages, public routes/actions, and current comments containing contract language such as `MUST`, `excluded`, `production`, `stub`, `deploy`, and `not wired`.

I found 3 confirmed issues, 0 additional likely issues, 1 manual-validation risk, and 7 false positives/already-fixed items. The only file changed by this lane is this report.

## Validation

- `npm run lint:action-origin --workspace=apps/web` - passed; output showed `public.ts` is scanned.
- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- Live semantic smoke check: `POST https://gallery.atik.kr/api/search/semantic` returned HTTP 200 results; `https://gallery.atik.kr/en` rendered production semantic mode with 445 total images.
- Not run: full lint, typecheck, build, or full test suite. This was a review-only documentation/source-contract lane.
