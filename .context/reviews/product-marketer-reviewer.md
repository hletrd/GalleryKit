# GalleryKit Product Marketer Reviewer - Cycle 6 Prompt 1

Date: 2026-07-07
Reviewer: project-specific product-marketer reviewer-style lane
Methodology: `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` was used only for code-verified claim review discipline. Its BurstPick market assumptions were not treated as GalleryKit guidance.

## Executive Summary

GalleryKit's core public position is credible: a self-hosted finished-photo gallery, not an editor, culler, scoring tool, proofing system, payment product, or hosted SaaS. The implementation backs the major trust claims around private originals, processed public derivatives, color/HDR honesty, PAT upload API scope, and operator-gated semantic search. The remaining product-marketing risk is operational expectation drift: several surfaces make GalleryKit sound more turn-key and self-service than the code currently is. Go-to-market readiness for the stated niche: 7/10 if sold as a technical self-hosted publishing kit; 5/10 if sold to non-technical photographer teams.

## Findings

### PM-C6-01 - Static site config is marketed like runtime configuration

Severity: Medium
Confidence: High

Citations:

- `README.md:52-68` says file-backed site configuration lives in `apps/web/src/site-config.json` for static links and analytics, and separately says DB-backed SEO/branding fields override defaults at runtime.
- `README.md:191` tells Docker operators to provide `apps/web/src/site-config.json` on the host before starting the compose stack.
- `apps/web/README.md:48` says file-backed `src/site-config.json` owns static links/analytics defaults; `apps/web/README.md:55` says the compose setup assumes a host-side `src/site-config.json` bind mount.
- `CLAUDE.md:148` states the actual implementation: every consumer imports `siteConfig` statically, Next inlines JSON imports at build time, and the compose bind mount has no runtime effect until the image is rebuilt.
- `apps/web/docker-compose.yml:28-32` carries the same implementation warning in a comment.
- Source confirms static imports for runtime-visible fields: `apps/web/src/components/footer.tsx:3-36` renders `siteConfig.footer_text`; `apps/web/src/components/nav-client.tsx:14-74` uses `siteConfig.home_link`; `apps/web/src/app/[locale]/layout.tsx:156-164` loads Google Analytics from `siteConfig.google_analytics_id`.

Failure scenario:

An operator changes the mounted `src/site-config.json` to remove a Google Analytics ID, change the footer, or point the home link at a portfolio landing page, then restarts the container. The visible site does not change because those values were baked into the image. For a privacy-positioned product, a stale analytics ID or stale branding is a trust failure even though the code is behaving as designed.

Suggested fix:

In both README files, explicitly split configuration into:

- Runtime DB settings: SEO/branding fields editable in Admin.
- Build-time JSON settings: `home_link`, `footer_text`, fallback URL/locale, and `google_analytics_id`; changing them requires `next build` / Docker rebuild / `npm run deploy`.

Also reword Docker step 3 to say "provide before building" rather than "before starting," and mention that the compose bind mount exists for rebuild context, not live runtime edits.

### PM-C6-02 - The shipped nginx template still hardcodes the demo domain

Severity: Medium
Confidence: High

Citations:

- `README.md:48` markets Docker support as a documented Linux host-network + reverse-proxy deployment.
- `README.md:198-205` tells operators to publish the app through a reverse proxy and references the checked-in nginx config.
- `apps/web/nginx/default.conf:46-55` is the checked-in server block, but `server_name` is hardcoded to `gallery.atik.kr`.
- The repo-level deploy docs otherwise emphasize config-driven deployment and avoiding hardcoded deploy details in `AGENTS.md` and `README.md:120-131`.

Failure scenario:

A self-hosting operator copies the shipped nginx file as the "documented reverse-proxy deployment" and misses the demo `server_name`. Depending on their nginx layout, requests for their actual domain can fall through to another server block or fail certificate/host routing tests. The product promise is "self-hosted gallery"; the first production proxy file should not carry the maintainer's demo domain as an active value.

Suggested fix:

Change `server_name gallery.atik.kr;` to a placeholder or catch-all such as `server_name _;` with a nearby comment requiring operators to set their domain. If a demo-domain example is useful, move it to documentation prose, not the active template.

### PM-C6-03 - Semantic search is true, but the product surface is runbook-first, not self-service

Severity: Low-Medium
Confidence: High

Citations:

- `README.md:42` lists semantic search as a feature and correctly caveats that it is disabled by default, requires model weights, backfill, and env opt-in, and uses bounded newest-first scans.
- `apps/web/README.md:62-84` gives the full operator activation story, including disabled/stub/production modes and the DB row flip.
- `apps/web/src/lib/gallery-config-shared.ts:119-128` defaults semantic search to disabled; `apps/web/src/lib/gallery-config-shared.ts:223-228` heals stored `production` to `disabled` unless production is explicitly allowed.
- `apps/web/src/app/api/search/semantic/route.ts:186-201` returns `503 semantic_not_configured` unless the resolved mode is `stub` or `production`.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:824-842` intentionally exposes only Disabled and Stub as writable Settings values; Production appears only as a disabled read-only state.
- `apps/web/messages/en.json:763-773` explains the operator gate in admin copy.

Failure scenario:

A small-team photographer reads the feature list, downloads the model weights, and expects Settings to offer a "Production" toggle after setup. Instead, production requires an env flag, sidecar backfill, deploy/recreate, and a direct DB setting. The implementation is defensible, but the activation flow belongs to an operator runbook, not a normal admin workflow.

Suggested fix:

Keep the root README feature, but rename the claim to "Operator-runbook semantic search" or add "not enabled from Settings UI" in the same bullet. Add a short product-status table: `Keyword search: available by default`, `Semantic stub: admin-testable`, `Semantic production: operator runbook only`.

### PM-C6-04 - "Small teams" positioning underspecifies the all-root-admin account model

Severity: Low-Medium
Confidence: High

Citations:

- `README.md:29` positions GalleryKit for "photographers and small teams."
- `README.md:44` says the admin dashboard supports multiple root-admin accounts and no role separation yet.
- `CLAUDE.md:5` repeats multiple root-admin accounts with authentication only and no role/capability separation.
- `CLAUDE.md:239` states any admin can upload, edit, export/restore DB backups, change settings, and manage other admins.
- `apps/web/src/components/admin-nav.tsx:15-25` shows every admin navigation surface, including users, database, settings, tokens, analytics, and dashboard, with no role-specific nav branching.

Failure scenario:

A photographer interprets "small teams" as "I can add an assistant or client-facing studio manager." In practice, every account is a trusted owner account. That assistant can reach DB backup/restore, user management, API tokens, settings, and analytics. The README does disclose "no role separation," but the audience-level phrase "small teams" needs a stronger trust qualifier.

Suggested fix:

Change the audience line to "photographers and trusted co-admin teams" or "small owner/operator teams." In setup/admin docs, add: "Do not create accounts for assistants, clients, or contractors unless they should have full owner access."

## Verified Claim Inventory

- Finished-photo positioning is aligned. `README.md:31-46` explicitly says the product is for finished-photo publishing and not for editing, culling, scoring, proofing, payment, or hosted SaaS workflows. `CLAUDE.md:278-280` reinforces the same product premise.
- Private-original claim is backed. Originals default to `data/uploads/original`, not public uploads, and the private directory is created with mode `0700` in `apps/web/src/lib/upload-paths.ts:27-50`. Public derivatives live under `public/uploads` per `README.md:82-84` and `apps/web/src/lib/upload-paths.ts:42-47`.
- GPS/privacy copy is stronger than before. Public selects omit GPS and sensitive original fields (`apps/web/src/lib/data.ts:368-407`), map coordinates are a separate opt-in select path (`apps/web/src/lib/data.ts:409-444`), and the privacy page discloses analytics, map metadata, and OpenStreetMap tile requests (`apps/web/src/app/[locale]/(public)/privacy/page.tsx:13-33`; `apps/web/messages/en.json:820-830`).
- Color/HDR claims are broadly code-backed. The README describes libheif-gated 10-bit AVIF and explicit fallback (`README.md:37-38`); the encoder probes 10-bit AVIF support (`apps/web/src/lib/process-image.ts:59-173`) and tracks per-image fallback (`apps/web/src/lib/process-image.ts:1302-1348`). Public HDR honesty is enforced by admin-only fields and render gates (`apps/web/src/components/color-details-section.tsx:532-568`).
- PAT upload API is accurately positioned as an API, not a bundled Lightroom plugin. `README.md:207-218` and `apps/web/README.md:90-99` match the route comment and token scope implementation (`apps/web/src/app/api/admin/lr/upload/route.ts:1-18`; `apps/web/src/app/actions/lr-tokens.ts:29-55`).
- PWA/offline copy now includes the important same-origin caveat. `README.md:43` says visited-image caching is same-origin and not full offline sync; `README.md:163` warns CDN-origin derivatives are not covered unless proxied through the app origin.
- Smart collections are not overmarketed in the README. CLAUDE correctly warns that public read-side code exists but admin authoring is not operable in UI (`CLAUDE.md:162`), and admin nav has no Collections item (`apps/web/src/components/admin-nav.tsx:15-25`).

## Positioning Recommendation

Current best one-sentence position:

GalleryKit is a self-hosted publishing gallery for photographers who already finished their edits and want private originals, color-conscious public derivatives, first-party analytics, and optional operator-runbook semantic search without moving the archive into a hosted SaaS.

Avoid:

- "AI gallery" unless every instance of the copy repeats disabled-by-default/operator-runbook semantics.
- "Team gallery" unless the copy says trusted full-admin team.
- "Runtime configurable" for JSON-owned fields unless the implementation changes away from static JSON imports.
- "Lightroom plugin" or "Lightroom integration" beyond the current PAT upload API contract.

## Prioritized Fixes

Tier 0 - Blocking before broader non-technical launch:

- Fix the site-config runtime/rebuild messaging gap. This is the only finding likely to cause privacy or branding surprises immediately after deploy.

Tier 1 - High leverage trust fixes:

- Replace the nginx demo `server_name` with a placeholder/catch-all template value.
- Add "trusted full-admin team" wording wherever "small teams" appears.

Tier 2 - Growth/positioning improvements:

- Add a README capability table separating default user features, admin features, and operator-runbook features.
- Create one short "what changes require rebuild vs admin save vs backfill" deployment section.

Tier 3 - Long-term moat:

- Productize production semantic search activation in admin only after the model-weight, env, DB mode, and backfill state can be verified safely from the UI.
- Add non-root roles before marketing GalleryKit to assistant-heavy studio workflows.

## Final Sweep

Swept README, app README, CLAUDE, site config, admin navigation, Settings semantic-search UI, search route, upload API, token actions, privacy page, map tile behavior, upload accept list, upload/original paths, color/HDR rendering, Docker compose, nginx config, and package metadata. No source files were edited. No tests were run because this was a read-only product/docs review artifact. The main implementation is stronger than the remaining marketing surface; the review findings are about expectation-setting and operator trust, not missing core gallery functionality.
