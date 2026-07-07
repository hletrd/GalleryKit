# Document-Specialist Review - Cycle 21

Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Lane: `document-specialist`
Reviewed HEAD: `45b32d1db373e03d82a29511f53832051c770880`

## Scope and Method

Required authority reads were completed first: `AGENTS.md`, `CLAUDE.md`, and `.context/plans/README.md`. I then built a tracked-file inventory before writing findings and checked documentation/code/test/deploy-script alignment against the current source at the requested HEAD.

Working tree note: peer review artifacts were already modified in `.context/reviews/*.md`. I did not inspect them as finalized cycle-21 outputs and did not edit them. This review edits only `.context/reviews/document-specialist.md`, per the request.

## Inventory Before Findings

Tracked documentation inventory:

- Live/root authority: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.context/plans/README.md`.
- README files: 5 tracked `*README.md` files, including `apps/web/__test_fixtures__/color/README.md`.
- Current cycle ledgers: `.context/reviews/_aggregate.md`, `.context/plans/cycle-20-2026-07-08-plan.md`, `.context/plans/cycle-20-2026-07-08-deferred.md`, `.context/plans/deferred-carry-forward.md`.
- Historical plan/review corpus: 281 tracked `.context/plans/**` files and 2,287 tracked `.context/reviews/**` files. `.context/plans/README.md:39-44` explicitly marks bare `cycle-20-*`, `cycle-21-*`, and `cycle-22-*` as historical-name hazards, not active current-cycle ledgers.
- Deferred/history directories inventoried: `.context/plans/archive`, `.context/plans/done`, photographer rounds, run-qualified directories, bare historical cycles, and review archives/logs.
- `docs/**`: 2 tracked files under `docs/superpowers/**`. Both are explicit historical CLIP records, not live operator runbooks (`docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:4-9`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:5-17`).

Package, deploy, and config surfaces checked:

- Root/app package scripts: `package.json:17-30`, `apps/web/package.json:8-29`.
- Dependency/toolchain claims: `apps/web/package.json:31-88` and root overrides in `package.json:7-15`.
- Deploy/runbook files: `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/.env.local.example`.
- Build/config/schema files: `apps/web/next.config.ts`, `apps/web/tsconfig*.json`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle.config.ts`.

Source/test modules with documented contracts checked:

- DB/TLS: `apps/web/src/db/index.ts`, `apps/web/scripts/mysql-connection-options.js`, `apps/web/drizzle.config.ts`.
- Migrations: `apps/web/scripts/migrate.js`, migration journal, migration tests.
- Site config/SEO/GA/CSP: `apps/web/src/site-config*.json`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/proxy.ts`, public layouts/pages.
- Upload limits and PAT upload API: `apps/web/src/lib/upload-limits.ts`, upload actions, `/api/admin/lr/upload`, nginx body caps.
- Public/admin security gates: `apps/web/scripts/check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, and their tests.
- Color/HDR/privacy contracts: image processing/color modules, `_PrivacySensitiveKeys` guard, privacy tests.
- CLIP semantic search: semantic/similar routes, CLIP model/inference/embedding modules, download/backfill scripts, preflight tests.
- PWA/service worker contracts: `apps/web/public/sw.template.js`, generated `sw.js`, service-worker tests.
- Touch target and i18n contract tests under `apps/web/src/__tests__/`.

## Findings

### DOC-C21-01 - Root README env snippet still narrows `DB_SSL_CA` to CLI TLS

- Severity: Low-Medium
- Confidence: High
- Stale doc region: `README.md:146-158`
- Contradicting/authoritative regions: `README.md:173`, `CLAUDE.md:94`, `apps/web/.env.local.example:9`, `apps/web/src/db/index.ts:7-18`, `apps/web/scripts/mysql-connection-options.js:13-29`, `apps/web/drizzle.config.ts:7-16`

Problem: the root README environment snippet says `DB_SSL_CA` is "Required for verified MySQL CLI TLS to non-local DB hosts" (`README.md:157`). Current source requires it for runtime DB imports, backup/restore CLI helpers, and Drizzle Kit config when `DB_HOST` is non-local and `DB_SSL=false` is not set. The same README later says runtime connections fail closed without the CA (`README.md:173`), so the doc is internally inconsistent.

Failure/operator-confusion scenario: an operator copies the quick env block, treats `DB_SSL_CA` as relevant only to CLI backup/restore, deploys against managed remote MySQL, and the app fails at runtime import (`@/db`) or Drizzle tooling fails before migrations/schema operations.

Suggested fix: update `README.md:157` to match `.env.local.example`, for example: `# DB_SSL_CA=/etc/mysql/ca.pem  # Required for verified runtime, Drizzle Kit, and backup/restore CLI TLS to non-local DB hosts`.

### DOC-C21-02 - Public route rate-limit docs say `app/api/**`, but the scanner intentionally covers all public `src/app/**/route.*`

- Severity: Low-Medium
- Confidence: High
- Stale doc regions: `AGENTS.md:34`, `CLAUDE.md:696-700`
- Contradicting/authoritative regions: `apps/web/scripts/check-public-route-rate-limit.ts:25-35`, `apps/web/scripts/check-public-route-rate-limit.ts:119-138`, `apps/web/scripts/check-public-route-rate-limit.ts:986-998`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:1317-1330`

Problem: `CLAUDE.md` says the gate scans every public API route file under `apps/web/src/app/api/**` excluding admin (`CLAUDE.md:697`), and `AGENTS.md` also calls these "PUBLIC API" routes. The actual CLI starts from `../src/app`, recursively finds every `route.ts|tsx|js|mjs|cjs`, excludes admin segments, and checks the remaining public route handlers. A test explicitly locks this broader behavior and asserts the scanner does not use `API_DIR`.

Failure/operator-confusion scenario: a contributor adding or modifying `app/feed.xml/route.ts`, `app/[locale]/(public)/[topic]/feed.xml/route.ts`, or `app/uploads/[...path]/route.ts` may read the docs and assume the lint gate only applies under `/api`. That can either produce surprising CI failures or, worse, make reviewers miss that non-API public route handlers are intentionally part of the same rate-limit contract.

Suggested fix: reword both docs to "public App Router route handlers under `apps/web/src/app/**/route.*` excluding admin/private segments" and then clarify that this includes non-`/api` public route handlers such as feeds, upload serving fallbacks, and OG routes when they export mutating or expensive read handlers.

### DOC-C21-03 - Per-photo OG docs overstate the 1 MB cap as applying to the final generated card

- Severity: Low
- Confidence: High
- Stale doc region: `CLAUDE.md:150`
- Partly accurate related region: `CLAUDE.md:147`
- Contradicting/authoritative regions: `apps/web/src/lib/og-photo-fetch.ts:30-31`, `apps/web/src/lib/og-photo-fetch.ts:56-87`, `apps/web/src/app/api/og/photo/[id]/route.tsx:197-209`, `apps/web/src/app/api/og/photo/[id]/route.tsx:211-310`, `apps/web/src/__tests__/og-photo-fallback.test.ts:126-132`

Problem: `CLAUDE.md:147` accurately says `OG_PHOTO_MAX_BYTES` is a byte cap on each fetched derivative candidate. But `CLAUDE.md:150` describes the per-photo Satori OG card itself as `<= OG_PHOTO_MAX_BYTES` 1 MB. The route enforces the cap before embedding the source photo data URL, then generates a Satori PNG, re-encodes it as JPEG, and returns that JPEG without checking `jpegBuffer.length`.

Failure/operator-confusion scenario: an operator or future reviewer may believe social-card output is hard-capped at 1 MB and use that as evidence that crawler image-size limits are impossible to exceed. In reality, the cap protects internal fetch/base64 input size; final output is likely small for 1200x630 JPEG but not explicitly bounded by `OG_PHOTO_MAX_BYTES`.

Suggested fix: either reword `CLAUDE.md:150` to say "uses candidates capped at `OG_PHOTO_MAX_BYTES`" or add a final response-size guard/test if the product wants the generated JPEG itself to be a hard contract.

## Historical vs Stale

Not classified as stale docs:

- `docs/superpowers/**` CLIP docs are intentionally historical and point to `CLAUDE.md` / `apps/web/README.md` for current operation.
- Bare `.context/plans/cycle-20-*`, `cycle-21-*`, and `cycle-22-*` files are historical-name hazards already called out by `.context/plans/README.md:39-44`.
- Old `.context/reviews/**` lane artifacts and logs are provenance unless the current aggregate, plan index, or carry-forward register points at them as active.
- `apps/web/__test_fixtures__/color/README.md` documents fixture limitations and is not an operator runbook.

## Validated Matches

- HEAD matched the requested commit: `45b32d1db373e03d82a29511f53832051c770880`.
- Package scripts match the quality-gate docs: root scripts delegate to the app workspace; app scripts define lint, auth/origin/rate-limit gates, typecheck, build, Vitest, Playwright, and CLIP preflight.
- Deploy docs match `scripts/deploy-remote.sh` and `apps/web/deploy.sh`: env-file precedence, SSH-derived remote command, `.env.local` permission refusal, `/api/live` health wait, and post-`up -d` Docker pruning.
- Docker/nginx docs match checked-in config for host network, `TRUST_PROXY=true`, body caps, upload/PAT cap precedence, liveness/readiness split, and persisted bind mounts.
- Migration docs match the current migration/journal contract, including monotonic journal `when`, reconcile baseline mirroring, and post-migration hash assertions.
- Root/app README CLIP activation docs match current code gates: disabled default, production env opt-in, offline model root, production backfill, and no one-click Settings production toggle.
- Site-config/GA docs match current behavior: file-backed static values are build-time inlined, admin SEO fields override DB-backed editable metadata, and `google_analytics_id` is optional/empty by default.
- Lightroom/PAT docs match the route contract: token header, `lr:upload` scope, multipart `file`/`topic` plus optional title/description, no bundled Lightroom Classic plugin.
- Touch-target docs match the current Vitest scan roots and app-level extra-file coverage.
- Privacy-sensitive field docs match `_PrivacySensitiveKeys`, omit blocks, and the symmetric privacy fixture pattern.

## Final Sweep

Relevant file categories I could not verify from repo files alone:

- Live production host state: actual nginx config applied on the host, TLS/cert chain, MySQL CA file, deployed env values, CLIP weight presence, production DB rows, and semantic embedding counts require operator/live-host validation.
- Untracked local files, ignored secrets, and runtime data directories were intentionally not inspected.
- Concurrent peer lane review files were dirty before this review and not treated as finalized authoritative cycle-21 artifacts.

No tests or deploys were run; this was a documentation/code alignment review with source inspection only. No commit or push was performed.
