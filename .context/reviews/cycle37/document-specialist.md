# Cycle 37 Document-Specialist Review

Scope: documentation and operator instructions only. I read `AGENTS.md` and `CLAUDE.md` first, then built an inventory of review-relevant documentation and authoritative source anchors before reviewing. Per the cycle instruction, I did not edit product code and did not commit or push.

## Inventory and Examined Files

- Instruction and canonical docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Historical docs and review/plan corpus: 3,265 markdown/mdx files under `.context/plans`, `.context/reviews`, `docs`, and `plan` were inventoried; reviewed current/high-signal operator docs plus relevant historical cycle references rather than treating every historical review as current product truth. `docs/superpowers/plans/2026-06-15-clip-semantic-search.md` and `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md` were checked and both carry historical/non-current banners.
- Package/config/deploy/nginx anchors: `package.json`, `package-lock.json`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `.env.deploy.example`, `apps/web/nginx/default.conf`.
- Authoritative code/test anchors used for doc claims: `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/messages/en.json`, `apps/web/src/components/nav.tsx`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-model-id.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, and related tests found by `rg` for privacy/settings/deploy/security claims.

## Findings

### C37-DOC-01 - Operator docs omit DB-backed navigation visibility settings

- Severity: Low
- Confidence: High
- Status: Confirmed

The public/operator docs describe `site-config.json` as owning static links and list only SEO/branding DB overrides, but they omit the DB-backed navigation visibility settings for the Timeline and Map links. `README.md:58-60` says file-backed site config owns static links and that DB overrides are limited to editable SEO/branding fields. `apps/web/README.md:47-58` repeats the same environment guidance, and `CLAUDE.md:157` plus `CLAUDE.md:735-750` list `site-config.json` fields and DB-backed SEO/branding overrides without mentioning `show_timeline_nav` or `show_map_nav`.

The code and admin UI support those settings. `apps/web/src/lib/gallery-config-shared.ts:68-70` includes `show_timeline_nav` and `show_map_nav` as setting keys, `apps/web/src/lib/gallery-config-shared.ts:147-149` defaults both to `true`, and `apps/web/src/lib/gallery-config-shared.ts:219-221` validates them as booleans. `apps/web/src/lib/gallery-config.ts:92-94` exposes them as admin-toggleable config, and `apps/web/src/lib/gallery-config.ts:146-155` resolves the DB values. `apps/web/src/app/actions/settings.ts:81-105` accepts allowed gallery setting keys through the settings mutation. The admin Settings UI renders switches for both settings at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:878-920`, with matching copy at `apps/web/messages/en.json:789-794`. Public navigation consumes the resolved values at `apps/web/src/components/nav.tsx:14-30` and conditionally renders the links in `apps/web/src/components/nav-client.tsx:35-49`.

Concrete failure scenario: an operator preparing a privacy-conscious gallery reads the README/CLAUDE configuration sections and sees Map/Timeline as part of the product shape (`README.md:38`) plus `site-config.json` static-link guidance, but no mention that the Map or Timeline nav links are toggleable from DB-backed Settings. They may edit `site-config.json`, fork the nav component, or assume the only way to hide the Map link is a code/deploy change, even though the supported path is the Settings navigation switches. That creates avoidable operator ambiguity and can lead to unnecessary code drift or a rebuild that does not change the live nav setting.

Suggested fix: add a short note to `README.md`, `apps/web/README.md`, and the `CLAUDE.md` deployment/configuration section stating that Timeline and Map navigation links are DB-backed admin settings (`show_timeline_nav`, `show_map_nav`), default to shown, can be changed from Admin Settings, and hide only the navigation links unless route-level access is separately changed. Consider adding the two keys to any concise "runtime DB settings" table rather than the `site-config.json` field list, since they are not build-time JSON.

## Confirmed Alignments Not Promoted

- Deploy/disk-hygiene docs matched implementation: `AGENTS.md` and `CLAUDE.md` describe `npm run deploy`, env-file handling, and post-up Docker pruning; `scripts/deploy-remote.sh:22-93` derives SSH/env configuration, and `apps/web/deploy.sh:55-104` runs compose, checks `/api/live`, then prunes containers/images/build cache/dangling volumes without `volume prune -a`.
- Nginx body-limit and proxy warnings matched source: docs claim 2 MiB default, 64 KiB login, 250 MiB DB restore, 216 MiB dashboard/LR upload, and trusted proxy caveats; `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:74-147`, `apps/web/nginx/default.conf:174-204`, and `apps/web/nginx/default.conf:254-312` align.
- Semantic search docs matched code gates: README/CLAUDE say production CLIP is operator-enabled, disabled by default, offline after weights are seeded, and not enabled directly from Settings UI. `apps/web/src/lib/gallery-config-shared.ts:235-240`, `apps/web/src/lib/clip-model.ts:203-220`, and `apps/web/src/lib/clip-embeddings.ts:238-257` support that. The older `docs/superpowers` plan/spec files are explicitly historical.
- Upload API docs matched source: README says the route is an API contract, not a bundled Lightroom Classic plugin, with PAT auth and 200 MiB file / 2 GiB batch / 100 file defaults. `apps/web/src/app/api/admin/lr/upload/route.ts:1-18`, `apps/web/src/app/api/admin/lr/upload/route.ts:114-141`, and `apps/web/src/lib/upload-limits.ts:1-21` align.
- Version and package claims matched manifests/lockfile in the reviewed areas: root/workspace packages declare Next 16, React 19, Node 24+, `@huggingface/transformers` 3.8.1, and `onnxruntime-node` 1.21.0 through `package.json`, `apps/web/package.json`, and `package-lock.json`.
- Health-check docs matched routes: deploy uses `/api/live`, while `/api/health` is liveness-only unless `HEALTH_CHECK_DB=true`; `apps/web/deploy.sh:57-77`, `apps/web/src/app/api/live/route.ts:1-9`, and `apps/web/src/app/api/health/route.ts:50-80` align.

## Final Missed-Issues Sweep

I ran final targeted sweeps for stale or dangerous documentation terms around `site-config`, deploy, nginx, semantic search, production mode, Lightroom/plugin wording, disabled defaults, `show_timeline_nav`, `show_map_nav`, and "not shipped/not implemented" claims across docs, scripts, config, and source comments. The only issue promoted is C37-DOC-01. No product-code edits, tests, commits, pushes, or deploys were performed for this documentation review.
