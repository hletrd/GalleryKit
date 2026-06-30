# Cycle 29 Document Specialist Review

Reviewer: cycle-29 document-specialist  
Repository: `/Users/hletrd/flash-shared/gallery`  
Scope: documentation/code mismatch review against authoritative repo docs, current source, package/deploy scripts, migration/schema runbooks, policy comments, and current review/plan inventory.  
Mode: Prompt 1 review only. No product-code fixes implemented.

## Inventory

Read first, per instruction:

- `AGENTS.md`
- `CLAUDE.md`

Then inventoried and checked:

- Root docs/config: `README.md`, `.env.deploy.example`, `package.json`
- App docs/config: `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`
- Deploy/operator scripts: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, selected `apps/web/scripts/*` runbook-bearing scripts
- Schema/migration surfaces: `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`
- Behavior source behind doc claims: gallery config, caption/alt-text, semantic search, upload API, route freshness, service worker, touch-target audit, privacy-field guards, lint-gate scripts, deploy/nginx scripts
- Current review/plan context: `.context/reviews/`, `.context/plans/`, `plan/`, and `docs/superpowers/*`

Generated outputs, dependency/build folders, binary screenshots, and archived historical review prose were not treated as current authority unless a current doc points to them.

## Confirmed Issues

### DOC-C29-01 — `CLAUDE.md` still says photographer-r4 is the current photographer surface

Severity: Medium  
Confidence: High  
Files/regions:

- `CLAUDE.md:559-567`
- `.context/reviews/photographer-r8/_aggregate.md:1-18`
- `.context/reviews/run9-cycle8/_aggregate.md:1-14`

Problem:

`CLAUDE.md` states that the current photographer surface is documented in `photographer-r4/_aggregate.md`. The repo now contains later `photographer-r6`, `photographer-r7`, `photographer-r8`, and run-9 review artifacts. `photographer-r8/_aggregate.md` is a newer comprehensive photographer review dated 2026-05-14, and run-9 cycle 8 records a later convergence state.

Failure scenario:

A future reviewer or planner starts from `CLAUDE.md`, treats r4 as the latest photographer baseline, and misses newer color/HDR/UI findings and closures from r6-r8/run-9. That can cause duplicate work, reopened closed issues, or missing current invariants.

Suggested fix:

Update the “Production photographer-perspective audit history” section to name the latest active baseline and explain how r6-r8/run-9 supersede r4. If r8 findings have all been closed by later cycles, point to the aggregate that proves closure instead of leaving r4 as “current.”

### DOC-C29-02 — Auto alt-text is implemented but missing from authoritative runbooks

Severity: Medium  
Confidence: High  
Files/regions:

- `apps/web/src/lib/gallery-config-shared.ts:39-40`, `apps/web/src/lib/gallery-config-shared.ts:100-101`, `apps/web/src/lib/gallery-config-shared.ts:155-156`
- `apps/web/src/lib/caption-generator.ts:1-15`, `apps/web/src/lib/caption-generator.ts:43-63`
- `apps/web/src/lib/image-queue.ts:702-719`
- `apps/web/scripts/backfill-alt-text.ts:1-24`, `apps/web/scripts/backfill-alt-text.ts:52-60`
- `README.md:35-48`
- `apps/web/README.md:28-41`, `apps/web/README.md:57-80`
- `CLAUDE.md:84-119`, `CLAUDE.md:153-161`

Problem:

The current source has an `auto_alt_text_enabled` setting, a caption generator, queue-side caption side effect, admin bulk-apply path, public `alt_text_suggested` fallback, and a manual `backfill-alt-text.ts` operator script. The authoritative docs do not describe the feature contract, the default-off behavior, the fact that the current generator is an EXIF-derived stub rather than vision inference, or the manual backfill command. `apps/web/README.md` lists CLIP and color backfill scripts but not `backfill-alt-text.ts`.

Failure scenario:

An operator enables the setting expecting real AI captioning, or assumes old images are backfilled automatically. Existing rows keep `alt_text_suggested = NULL` unless the manual script runs, and new suggestions are stubbed with `[AUTO]`-prefixed EXIF hints internally. The public/a11y behavior becomes surprising because the docs never state this contract.

Suggested fix:

Add an “Auto alt-text hints” section to `CLAUDE.md` and `apps/web/README.md`: default off, current stub behavior, public fallback chain, admin bulk-apply behavior, `backfill-alt-text.ts [--force]`, and explicit “not real vision captioning yet.” Add the script to the app README script table.

### DOC-C29-03 — Public route freshness docs omit several current `revalidate = 0` surfaces

Severity: Low  
Confidence: High  
Files/regions:

- `CLAUDE.md:410-422`
- `apps/web/src/app/[locale]/(public)/page.tsx:16-18`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:19`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:41`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:18`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:23`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:16`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:18`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:19`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:11-12`

Problem:

`CLAUDE.md` says public photo, topic, shared, and home gallery pages set `revalidate = 0`. Current source also marks smart collections, timeline, year-in-review, and the GPS map as dynamic/no-ISR surfaces. The service-worker section similarly says “dynamic public gallery/photo pages,” while the implementation scope is broader.

Failure scenario:

A future performance pass reintroduces ISR on timeline/year/map/smart-collection pages because they are not named in the documented freshness contract. Those pages would then show stale archive/map/collection data after processing, metadata, GPS visibility, or collection changes.

Suggested fix:

Replace the enumerated sentence with the current full route list or a category rule: “all public data-backed gallery/archive/map/share/photo/smart-collection pages set `revalidate = 0`; static policy pages such as privacy do not.” Keep the SW offline-fallback language aligned with that list.

### DOC-C29-04 — Touch-target audit docs omit explicitly scanned app-level files

Severity: Low  
Confidence: High  
Files/regions:

- `CLAUDE.md:621-625`
- `apps/web/src/__tests__/touch-target-audit.test.ts:52-65`
- `apps/web/src/__tests__/touch-target-audit.test.ts:79-83`

Problem:

`CLAUDE.md` says the audit walks every `.tsx`/`.jsx` file under `SCAN_ROOTS` only: components, admin route group, and public route group. The test also scans `app/global-error.tsx`, `app/[locale]/error.tsx`, `app/[locale]/not-found.tsx`, `app/[locale]/layout.tsx`, and `app/[locale]/loading.tsx` through `appLevelExtraFiles`.

Failure scenario:

A maintainer edits a root-level error/not-found/layout/loading surface and relies on `CLAUDE.md` to understand touch-target scope. They may not know these files are audited or that exemptions must be documented in `KNOWN_VIOLATIONS`, causing avoidable test failures or undocumented exemptions.

Suggested fix:

Update the Touch-Target Audit section to mention both `SCAN_ROOTS` and `appLevelExtraFiles`, naming the five explicitly scanned root-level files.

## Likely Issues

### DOC-C29-05 — Historical migration comments still use superseded product language

Severity: Low  
Confidence: Medium  
Files/regions:

- `apps/web/drizzle/0006_admin_tokens.sql:1-8`
- `apps/web/drizzle/0011_image_alt_text_suggested.sql:1-4`
- `CLAUDE.md:160`
- `README.md:45`, `README.md:207`
- `apps/web/README.md:91`
- `apps/web/src/lib/caption-generator.ts:1-15`

Problem:

Current docs consistently say the PAT route is an external-client API and no Lightroom Classic plugin is bundled. Current caption source says auto alt-text is an EXIF-derived stub and real vision inference is deferred. Two applied migration comments still say “Lightroom Classic publish plugin” and “Auto alt-text via local Florence-2.”

Why likely, not confirmed:

These are historical migration files, and migration comments often describe the intent at creation time rather than current product state. Also, editing applied migration SQL changes migration hashes, so the fix is not as simple as editing the comments in place.

Failure scenario:

Someone greps current source for product contracts, lands on the migration comments, and concludes GalleryKit ships a Lightroom plugin or a local Florence-2 captioning path. That conflicts with current README/CLAUDE/source behavior.

Suggested fix:

Do not casually edit applied migration SQL without accounting for hash/postcondition consequences. Prefer adding a short `CLAUDE.md` “historical migration wording” note or a migration-comment errata near the schema/migration runbook. If the team chooses to edit comments in old migrations anyway, handle the expected migration-hash impact deliberately.

## Risks Needing Manual Validation

No external/live deployment behavior was validated in this Prompt 1 pass. In particular:

- I did not verify the deployed host’s current semantic-search DB row, CLIP model volume, or live route behavior.
- I did not run the deploy helper against a remote host.
- I did not run the full quality gate suite; this was a documentation/source inspection pass only.

## Confirmed Matches / Non-Findings

- Package scripts and documented quality gates align: root scripts delegate to `apps/web`; app `build` runs typecheck before `next build`; lint-gate script names match docs.
- Deploy docs and scripts align on config-driven `.env.deploy`, remote `apps/web/deploy.sh`, host-network compose, health check, and post-up Docker pruning without `volume prune -a`.
- Nginx body-size docs match `apps/web/nginx/default.conf`: default 2 MiB, login 64 KiB, DB restore 250 MiB, dashboard upload 216 MiB, LR upload 216 MiB, generic admin API 2 MiB.
- Semantic/similar route posture matches docs: same-origin gate and `preIncrementSemanticAttempt` are present in the route implementations.
- Storage quarantine docs match source/tests: `@/lib/storage` exists but is not wired into the live upload/serve pipeline.
- Privacy-field guard docs match the current `privacy-fields.test.ts` symmetric guard and `data.ts` public/admin select boundary.

## Final Missed-Issues Sweep

Final sweep covered:

- Terms: deploy, backfill, semantic, CLIP, restore maintenance, health/live, upload limits, nginx body caps, site-config, TRUST_PROXY, privacy/sensitive fields, route freshness, touch targets, auto alt-text, caption, Lightroom/plugin, Florence, Stripe/paid/entitlements/reactions historical language.
- Surfaces: `AGENTS.md`, `CLAUDE.md`, root/app READMEs, env examples, package scripts, deploy scripts, nginx/compose/Dockerfile, migrations/journal, schema, scripts, source comments, route files, contract tests, `.context` current review directories, and `docs/superpowers`.

Historical archive/review files contain many obsolete product references by design. I did not file those as current-doc defects unless current docs still point at the stale baseline.

## Covered-File Summary

Directly read or line-checked:

- `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`
- `package.json`, `apps/web/package.json`
- `.env.deploy.example`, `apps/web/.env.local.example`
- `scripts/deploy-remote.sh`, `apps/web/deploy.sh`
- `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, `apps/web/next.config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/caption-generator.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/storage/*`
- `apps/web/scripts/backfill-alt-text.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/download-clip-models.ts`, `apps/web/scripts/migrate.js`, lint/check scripts by targeted scan
- `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`
- Public route pages under `apps/web/src/app/[locale]/(public)/`
- `apps/web/src/__tests__/touch-target-audit.test.ts`, `privacy-fields.test.ts`, public-route/lint/source-contract tests by targeted scan
- `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`
- `.context/reviews/photographer-r6`, `photographer-r7`, `photographer-r8`, `run9-cycle8` aggregates

Fixes implemented: none. This artifact is the only file written for Prompt 1.
