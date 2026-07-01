# Cycle 92 Critic Review

Review date: 2026-07-01
HEAD reviewed: `508d355` (`docs(review): 📝 close cycle 91 release evidence`)
Lane: critic — multi-perspective repository critique across product behavior, reliability, data integrity, operations, testing, and maintainability.

## Inventory Built First

Required context read:

- `AGENTS.md` — repo contract, deploy policy, schema/migration rules, blocking quality gates (`AGENTS.md:15`-`38`).
- `CLAUDE.md` — architecture, schema/product contracts, runtime topology, migration/deploy runbooks (`CLAUDE.md:151`-`161`, `CLAUDE.md:234`-`237`, `CLAUDE.md:424`-`477`, `CLAUDE.md:660`-`674`).

Tracked-file inventory from `git ls-files` before issue triage:

- Total tracked files: 3172.
- `apps/web/src/app/`: 77 route/action/page files.
- `apps/web/src/components/`: 59 component files.
- `apps/web/src/lib/`: 106 data/security/processing/runtime helper files.
- `apps/web/src/__tests__/`: 309 unit/source-contract test files.
- `apps/web/e2e/`: 8 e2e fixture/spec/helper files.
- `apps/web/drizzle/`: 32 migration/metadata files.
- `apps/web/scripts/`: 29 operational/build/lint/backfill/migration scripts.
- `.context/`: 2309 committed review/plan/context artifacts.

High-relevance areas inspected for this critique:

- Admin mutation/restore boundary: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/app/actions/{topics,settings,images,collections}.ts`.
- Smart collections: `apps/web/src/app/actions/collections.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/components/admin-nav.tsx`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`, smart-collection tests.
- Semantic search/embeddings: `apps/web/src/db/schema.ts`, migrations `0012`/`0022`, `apps/web/src/lib/image-queue.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, semantic/similar API routes.
- Product discovery/SEO: `apps/web/src/app/sitemap.ts`, public timeline/year/smart-collection pages, OG metadata paths.
- Operations/deploy/runtime: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, root/app `package.json`, `CLAUDE.md` operational playbook.
- Privacy/data/public serving: `apps/web/src/lib/data.ts`, `apps/web/src/lib/analytics.ts`, upload/delete paths, validation helpers.

Validation/sweeps performed:

- Static scanner scripts passed when run without `tsx` CLI IPC:
  `NODE_OPTIONS='--import tsx' node scripts/check-api-auth.ts`,
  `NODE_OPTIONS='--import tsx' node scripts/check-action-origin.ts`,
  `NODE_OPTIONS='--import tsx' node scripts/check-public-route-rate-limit.ts`.
- The direct npm script wrappers initially failed in this managed sandbox because `tsx` could not `listen` on its IPC pipe (`EPERM`); rerunning through `NODE_OPTIONS='--import tsx'` proved the scanner logic itself.
- Repo-wide `rg` sweeps over smart-collection call sites, route/action surfaces, deploy/runtime files, and source-contract tests.

## Severity / Confidence Legend

- Severity: **Critical**, **High**, **Medium**, **Low**.
- Status: **Confirmed issue** = source evidence proves the defect or mismatch; **Likely issue** = source evidence strongly suggests a defect but runtime/manual state can affect impact; **Manual-validation risk** = known/accepted contract or operational assumption that requires human/runtime validation before it is treated as broken.
- Confidence: High / Medium / Low.

## Executive Summary

The repo has strong defensive foundations: auth/action-origin/rate-limit scanners pass, migration drift has explicit post-conditions, upload/image processing has many race-condition contracts, and privacy-sensitive public fields are guarded by tests and type checks. The highest-risk remaining issues are cross-file contract mismatches rather than isolated syntax problems.

Top concerns:

1. **High confirmed reliability/data-integrity issue:** restore maintenance still does not fence already-in-flight non-upload admin mutations.
2. **Medium confirmed semantic-search data-integrity issue:** `image_embeddings` routes and indexes are version-aware, but storage is one row per image, so model-version changes destructively overwrite prior embeddings.
3. **Medium confirmed product/maintainability issue:** smart-collection CRUD exists server-side but is not reachable from the visible admin action/nav surface.
4. **Medium confirmed product/SEO issue:** sitemap omits indexable archive/collection surfaces.
5. **Operational risks:** single-process runtime state, no staging/per-commit deploys, static-imported `site-config.json`, and floating Docker base images should remain explicit guardrails before scaling or changing deployment practices.

## Confirmed Issues

### C92-CRIT-01 — Restore maintenance does not fence already-in-flight non-upload admin mutations

- Status: **Confirmed issue**
- Severity: **High**
- Confidence: **High**
- Perspectives: reliability, data integrity, operations, maintainability

Evidence:

- `restoreDatabase` acquires the DB restore advisory lock at `apps/web/src/app/[locale]/admin/db-actions.ts:390`-`398`.
- It also acquires the upload-processing contract lock at `apps/web/src/app/[locale]/admin/db-actions.ts:400`-`410` and backfill locks at `apps/web/src/app/[locale]/admin/db-actions.ts:413`-`447`.
- Durable restore maintenance is only entered later at `apps/web/src/app/[locale]/admin/db-actions.ts:449`-`452`, then queue/view-count drains happen at `apps/web/src/app/[locale]/admin/db-actions.ts:492`-`503`.
- The maintenance primitive is a process-local boolean check, not a held write lock: `apps/web/src/lib/restore-maintenance.ts:21`-`31`; `beginRestoreMaintenance` simply flips state at `apps/web/src/lib/restore-maintenance.ts:48`-`60`.
- Representative non-upload mutation `updateTopic` checks maintenance only at entry (`apps/web/src/app/actions/topics.ts:182`-`185`), then performs awaited work before its write transaction (`apps/web/src/app/actions/topics.ts:232`-`243`, `apps/web/src/app/actions/topics.ts:249`-`256`).
- The same `updateTopic` transaction writes multiple application tables after that gap: topic insert (`apps/web/src/app/actions/topics.ts:285`-`291`), image/topic-alias/topic-view updates (`apps/web/src/app/actions/topics.ts:292`-`301`), smart-collection JSON rewrites (`apps/web/src/app/actions/topics.ts:310`-`334`), and old-topic delete (`apps/web/src/app/actions/topics.ts:338`-`339`).
- Representative settings mutation has the same one-time-check shape: entry guard at `apps/web/src/app/actions/settings.ts:41`-`44`, awaited reads at `apps/web/src/app/actions/settings.ts:93`-`116` and `apps/web/src/app/actions/settings.ts:137`-`154`, then DB writes at `apps/web/src/app/actions/settings.ts:163`-`175`.

Impact:

A non-upload admin mutation can pass its entry check, pause on file processing or DB reads, then restore can begin and import/drop/recreate data while the original mutation resumes and writes into the restore window. Uploads/backfills are specially fenced, but broad foreground admin writers are not. Possible outcomes include lost updates, writes against a database mid-import, stale audit/revalidation events, or app/database/filesystem split-brain depending on timing.

Recommended fix:

Add a shared foreground admin mutation barrier used by every application-table writer, not just uploads/backfills. A wrapper such as `withRestoreWriteBarrier(actionName, fn)` should acquire a restore-compatible advisory lock or equivalent durable barrier and re-check restore maintenance immediately before the final write/transaction. Add regression tests where restore begins after a representative action's entry precheck but before its transaction.

---

### C92-CRIT-02 — `image_embeddings` model-version filtering is undermined by one-row-per-image storage

- Status: **Confirmed issue**
- Severity: **Medium**
- Confidence: **High**
- Perspectives: data integrity, product behavior, reliability, maintainability

Evidence:

- Drizzle schema defines `imageEmbeddings.imageId` as the primary key (`apps/web/src/db/schema.ts:284`-`285`) while `modelVersion` is a non-key column (`apps/web/src/db/schema.ts:289`-`290`).
- Migration `0012` creates `PRIMARY KEY (image_id)` only (`apps/web/drizzle/0012_image_embeddings.sql:5`-`11`).
- Migration `0022` adds a serving index on `(model_version, updated_at)`, not a key shape that permits multiple versions per image (`apps/web/drizzle/0022_image_embeddings_model_version_idx.sql:1`-`9`).
- Semantic search chooses an active model version at request time (`apps/web/src/app/api/search/semantic/route.ts:186`-`204`) and scans only matching rows (`apps/web/src/app/api/search/semantic/route.ts:263`-`279`).
- Similar-photo search loads/scans only `PRODUCTION_MODEL_VERSION` rows (`apps/web/src/app/api/search/similar/[id]/route.ts:132`-`147`, `apps/web/src/app/api/search/similar/[id]/route.ts:164`-`177`).
- The live queue writer upserts by primary key and overwrites `embedding` + `modelVersion` for an existing image (`apps/web/src/lib/image-queue.ts:379`-`390`).
- The sidecar backfill selects images missing the target model version (`apps/web/scripts/backfill-clip-embeddings.ts:161`-`180`) but also uses `onDuplicateKeyUpdate` to overwrite the single row's model/version (`apps/web/scripts/backfill-clip-embeddings.ts:212`-`223`).

Impact:

The routes and indexes are designed as if multiple model versions can coexist, but the table can store only one embedding per image. Switching stub → production, rolling back, or introducing a future production model version destroys the previous row for that image. During migrations, active-version queries can return partial/empty results until every image is re-embedded, and rollback requires another destructive re-embedding pass.

Recommended fix:

Migrate `image_embeddings` to one row per `(image_id, model_version)` with a composite primary key or equivalent unique constraint. Update Drizzle schema, `reconcileLegacySchema`, queue writes, sidecar backfill, and route queries. Add a regression test that stores two model versions for one image and proves active-version scans select the requested version without deleting the other.

---

### C92-CRIT-03 — Smart-collection CRUD exists server-side but is not reachable from the visible admin surface

- Status: **Confirmed issue**
- Severity: **Medium**
- Confidence: **High**
- Perspectives: product behavior, maintainability, testing

Evidence:

- CRUD server actions exist: `createSmartCollection` (`apps/web/src/app/actions/collections.ts:15`-`62`), `updateSmartCollection` (`apps/web/src/app/actions/collections.ts:64`-`110`), and `deleteSmartCollection` (`apps/web/src/app/actions/collections.ts:112`-`131`).
- The main action barrel exports auth/images/topics/tags/sharing/admin-users/public/SEO/settings but does **not** export collection CRUD (`apps/web/src/app/actions.ts:4`-`34`). The barrel comment explicitly says it should keep the server-action surface complete (`apps/web/src/app/actions.ts:32`-`34`).
- The admin navigation exposes dashboard/categories/tags/SEO/settings/tokens/password/users/db/analytics, but no smart-collection route or label (`apps/web/src/components/admin-nav.tsx:15`-`26`).
- Public rendering exists for `/c/[slug]`: the page fetches smart-collection rows (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:1`), parses/compiles query JSON (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:96`-`108`), fetches matching images (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:110`-`111`), and passes the collection slug to the public client (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:152`-`161`).
- Tests cover compiler and load-more behavior (`apps/web/src/__tests__/smart-collections.test.ts:12`-`17`; `apps/web/src/__tests__/smart-collection-pagination.test.ts:5`-`25`) but do not prove an admin UI path exists.

Impact:

A feature documented as “Admin-defined dynamic galleries” (`CLAUDE.md:161`) has a public read path and server-side mutations, but the current admin surface does not expose a way to create or manage those rows. That makes the feature effectively manual-DB/import-only and leaves the collection action module as a partially dead surface. It also hides product/test gaps because route behavior can pass while the management workflow is absent.

Recommended fix:

Either add a dedicated admin smart-collections page/nav item that imports the CRUD actions directly (or exports them through the action barrel if that remains the convention), or explicitly mark smart collections as internal/manual and remove or quarantine the unused mutation surface. Add an e2e/admin workflow test for create/edit/delete + public `/c/[slug]` render.

---

### C92-CRIT-04 — Documented color-pipeline smart-collection criteria are not implemented

- Status: **Confirmed issue**
- Severity: **Low**
- Confidence: **High**
- Perspectives: product behavior, data model/API contract, maintainability

Evidence:

- Product/schema docs say `smart_collections.query_json` can define criteria including “color pipeline decision” (`CLAUDE.md:161`).
- The `images` table stores `color_pipeline_decision` (`apps/web/src/db/schema.ts:45`-`53`), and docs describe the column as admin-only color/HDR metadata (`CLAUDE.md:163`-`170`).
- The smart-collection compiler allowlist includes only `iso`, `focal_length`, `f_number`, `exposure_time`, `camera_model`, `lens_model`, `capture_date`, `topic`, and `tag` (`apps/web/src/lib/smart-collections.ts:21`-`30`).
- The direct-column map omits `color_pipeline_decision` (`apps/web/src/lib/smart-collections.ts:32`-`42`).
- The validator’s `VALID_COLUMNS` list also omits it (`apps/web/src/lib/smart-collections.ts:305`-`308`).
- Unknown non-tag columns throw `SmartCollectionColumnError` during compile (`apps/web/src/lib/smart-collections.ts:192`-`200`).

Impact:

Admins/operators reading the repo docs can reasonably expect to build a dynamic collection around color/HDR pipeline decisions, but the parser/compiler rejects that column. Because `color_pipeline_decision` is admin-only metadata, adding it also needs an intentional product/privacy decision about whether public collection membership may reveal that classification indirectly.

Recommended fix:

Either update CLAUDE/product docs to remove the unsupported criterion, or implement it deliberately in the AST type, allowlist, validator, SQL compiler, tests, and admin UI. If implemented, document the privacy posture for public collections filtered by admin-only color metadata.

---

### C92-CRIT-05 — Indexable public archive/collection surfaces are omitted from the sitemap

- Status: **Confirmed issue**
- Severity: **Medium**
- Confidence: **High**
- Perspectives: product behavior, SEO/discoverability, maintainability

Evidence:

- `sitemap.ts` imports only `getImageIdsForSitemap`, `getLatestImageUpdatedAt`, and `getTopics` from data access (`apps/web/src/app/sitemap.ts:1`).
- The sitemap emits homepage entries (`apps/web/src/app/sitemap.ts:57`-`62`), topic entries (`apps/web/src/app/sitemap.ts:64`-`73`), image entries (`apps/web/src/app/sitemap.ts:75`-`85`), the root feed (`apps/web/src/app/sitemap.ts:87`-`95`), and topic feeds (`apps/web/src/app/sitemap.ts:97`-`120`) only.
- Public smart collections are explicitly reachable at `/[locale]/c/[slug]` when public (`apps/web/src/db/schema.ts:301`-`315`) and emit canonical/hreflang metadata when public (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:42`-`81`).
- The timeline page emits canonical/hreflang metadata and no `noindex` on the valid path (`apps/web/src/app/[locale]/(public)/timeline/page.tsx:31`-`58`).
- Valid year pages emit canonical/hreflang metadata and only invalid years are noindexed (`apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:37`-`71`).
- Years are enumerable from processed images via `getTimelineYears()` (`apps/web/src/lib/data-timeline.ts:125`-`145`), but that helper is not used by `sitemap.ts`.

Impact:

Search engines and sitemap-first consumers receive strong discovery hints for home/topics/photos/feeds but not for newer public collection/archive surfaces that are otherwise indexable. Those pages may still be found through links, but the sitemap contract is inconsistent with metadata.

Recommended fix:

Add localized sitemap rows for `/timeline`, valid `/year/{year}` values, and public smart collections if those surfaces are intended for search discovery. If public smart collections are meant to be direct-link-only, make that explicit and consider `robots: noindex` instead of canonical indexable metadata.

## Likely Issues

### C92-CRIT-L1 — Malformed stored smart-collection queries silently degrade into 404/error behavior instead of operator-visible diagnostics

- Status: **Likely issue**
- Severity: **Low**
- Confidence: **Medium**
- Perspectives: reliability, operations, data integrity

Evidence:

- Smart-collection metadata is returned for any existing public collection without parsing/compiling `query_json` (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:24`-`40`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:42`-`81`).
- The page body catches parse errors and returns `notFound()` with no log (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:96`-`101`).
- It also catches compile errors and returns `notFound()` with no log (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:103`-`108`).
- The load-more action catches the same class of parse/compile/fetch failure, rolls back the rate-limit attempt, logs a generic error, and returns an error response (`apps/web/src/app/actions/public.ts:208`-`232`).

Impact:

Normal create/update actions validate query JSON, so this mostly affects legacy/manual/imported/corrupt rows. When it happens, the visible page can look like a missing/private collection and metadata can still be generated from the row. Operators get little direct signal about the bad collection row unless the failure goes through load-more.

Recommended fix:

At minimum, log collection id/slug and failure class in the page parse/compile catches. Prefer a private/admin-visible diagnostic path for invalid `query_json` rows. If metadata should not advertise invalid collections, share the validation helper with `generateMetadata` or noindex invalid rows.

---

### C92-CRIT-L2 — Admin delete cannot clean up rows with corrupt/legacy unsafe filenames

- Status: **Likely issue**
- Severity: **Low**
- Confidence: **Medium**
- Perspectives: operations, data integrity, maintainability

Evidence:

- `deleteImage` fetches stored filenames (`apps/web/src/app/actions/images.ts:666`-`676`) and returns `invalidFilename` before deleting the DB row if any original/derivative filename fails validation (`apps/web/src/app/actions/images.ts:678`-`686`).
- `deleteImages` applies the same all-or-nothing filename validation before deleting anything (`apps/web/src/app/actions/images.ts:774`-`795`).
- `isValidFilename` rejects path traversal and any filename outside `[a-zA-Z0-9._-]` starting with alphanumeric (`apps/web/src/lib/validation.ts:153`-`160`).

Impact:

The security check is valid for normal file cleanup, but it also means an admin cannot use the UI/action to delete a row whose filename became corrupt through a legacy bug, manual DB edit, or failed restore. Batch delete is worse: one bad row aborts the whole batch before any DB cleanup. That leaves DB repair/manual SQL as the only recovery path.

Recommended fix:

Keep path-safe file deletion strict, but allow DB-row deletion with skipped file cleanup for invalid stored filenames after logging/audit, or add a separate admin repair action that deletes the DB row and reports that file cleanup was intentionally skipped.

## Manual-Validation Risks

### C92-CRIT-R1 — Single-instance/process-local runtime state is an explicit scaling boundary

- Status: **Manual-validation risk**
- Severity: **Medium**
- Confidence: **High**
- Perspectives: operations, reliability, data integrity

Evidence:

- CLAUDE states the shipped topology is “single web-instance / single-writer” and warns that restore maintenance, upload quota tracking, image queue state, backfill status, several rate-limit fast paths, and shared-group view buffering are process-local (`CLAUDE.md:234`-`237`).
- Compose defines a single `web` service with host networking (`apps/web/docker-compose.yml:3`-`17`) and bind-mounted persistence (`apps/web/docker-compose.yml:24`-`28`).
- Upload quota tracking uses a process-local tracker map via `getUploadTracker()` and mutates it before async work (`apps/web/src/app/actions/images.ts:205`-`256`).
- Image processing state is stored behind a process-global symbol (`apps/web/src/lib/image-queue.ts:76`, `apps/web/src/lib/image-queue.ts:292`-`343`).
- Shared-group view count increments are buffered in module-level maps/timers (`apps/web/src/lib/data.ts:13`-`63`).

Risk:

This is acceptable for the documented deployment, but unsafe if an operator adds a second web process/container, uses multiple Node workers, or changes the host topology without moving coordination state to MySQL/Redis/etc. Attack-defense rate limits can weaken per process, queue/status surfaces diverge, and buffered analytics can be lost on SIGKILL.

Recommended control:

Keep the single-replica invariant visible in deploy checks/runbooks. If scale-out is planned, first move restore/barrier state, upload quotas, queue state, fast-path rate-limit buckets, and analytics buffers to a shared/durable store or explicitly make them best-effort per instance.

---

### C92-CRIT-R2 — Per-commit production deploy with no staging is a release-process risk

- Status: **Manual-validation risk**
- Severity: **Medium**
- Confidence: **High**
- Perspectives: operations, testing, maintainability

Evidence:

- `AGENTS.md` requires `npm run deploy` after every commit pushed to `master` and says there is no staging (`AGENTS.md:15`-`20`).
- `CLAUDE.md` repeats that per-iteration deploy policy and says every commit pushed to `master` is followed by deploy, with no staging environment (`CLAUDE.md:465`-`469`).
- The root deploy script maps `npm run deploy` to `./scripts/deploy-remote.sh` (`package.json:11`-`23`).
- The host deploy script runs `git pull --ff-only`, rebuilds/starts Docker, waits for health, then prunes Docker artifacts (`apps/web/deploy.sh:10`-`11`, `apps/web/deploy.sh:51`-`77`, `apps/web/deploy.sh:79`-`104`).

Risk:

This is a policy choice, not a source-code bug. It does mean doc/review/ledger-only commits and code commits share the same production path unless an exception is explicitly recorded. A failed deploy after a non-product commit can still trigger operational work and reviewer confusion about the live baseline.

Recommended control:

Continue recording exact deploy/smoke evidence for every pushed `master` commit, or define a narrow documented exception for review/plan-only commits. If product risk grows, add a staging/smoke lane before production deploy.

---

### C92-CRIT-R3 — Runtime `site-config.json` may be split-brain because consumers statically import JSON

- Status: **Manual-validation risk / likely operator-contract issue**
- Severity: **Medium**
- Confidence: **Medium**
- Perspectives: operations, product behavior, maintainability

Evidence:

- Compose bind-mounts `./src/site-config.json` into the runtime container (`apps/web/docker-compose.yml:24`-`28`).
- Docker validates `site-config.json` before build (`apps/web/Dockerfile:96`-`100`) and copies the standalone build into the runtime image (`apps/web/Dockerfile:130`-`145`).
- Runtime consumers use static JSON imports: layout imports `siteConfig` (`apps/web/src/app/[locale]/layout.tsx:11`) and gates GA script injection from it (`apps/web/src/app/[locale]/layout.tsx:147`-`159`); nav client imports it (`apps/web/src/components/nav-client.tsx:14`) and computes `home_link` from it (`apps/web/src/components/nav-client.tsx:71`-`74`); SEO fallbacks read it (`apps/web/src/lib/data.ts:1793`-`1800`).
- CLAUDE says the file is read directly by import and is also fallback/static build-time state (`CLAUDE.md:660`-`674`).

Risk:

If an operator edits the bind-mounted JSON and restarts without rebuilding, static-imported client/server bundle values may not all change as expected. This is especially sensitive for `home_link` and analytics script behavior. The exact runtime behavior should be verified against the built standalone output before declaring it a live bug.

Recommended validation/fix:

Choose one contract: rebuild-only static config, or true runtime config. For true runtime config, use a validated server-side loader for runtime-editable fields and pass client-safe values through props. Add a Docker/standalone smoke that changes the mounted JSON after build and asserts the documented behavior.

---

### C92-CRIT-R4 — Floating Docker base image trades reproducibility for automatic base updates

- Status: **Manual-validation risk**
- Severity: **Low**
- Confidence: **High**
- Perspectives: operations, supply chain, maintainability

Evidence:

- Docker uses floating `node:24-slim` for both build and runner bases (`apps/web/Dockerfile:1`, `apps/web/Dockerfile:15`).
- The comment says to keep the base on latest Node 24 LTS and record the resolved digest in build/deploy logs before changing the file (`apps/web/Dockerfile:3`-`6`).
- Native runtime/build package versions are pinned explicitly in install commands (`apps/web/Dockerfile:49`-`61`, `apps/web/Dockerfile:71`-`80`), so the base image is the remaining intentionally floating layer.

Risk:

This may be intentional to consume Debian/Node security updates quickly, but production builds are not bit-for-bit reproducible from git alone. A deploy can pick up base image changes with no repo diff, affecting Node patch behavior, system libraries, or CVE posture.

Recommended control:

If reproducibility matters more than automatic patch uptake, pin by digest and bump deliberately. If staying floating, make the resolved digest part of deploy logs/release evidence so incidents can reconstruct the exact runtime image.

---

### C92-CRIT-R5 — Analytics referrer grouping uses a known Public Suffix List approximation

- Status: **Manual-validation risk**
- Severity: **Low**
- Confidence: **High**
- Perspectives: product analytics, privacy/accuracy, maintainability

Evidence:

- The code explicitly ships a subset of known two-part TLDs and says it does not ship the full Public Suffix List (`apps/web/src/lib/analytics.ts:85`-`94`).
- `extractTldPlusOne` returns a last-two-label fallback unless the last two labels match that subset (`apps/web/src/lib/analytics.ts:103`-`125`).
- Sanitized referrer hosts use that extracted value after private/same-origin filtering (`apps/web/src/lib/analytics.ts:159`-`190`).

Risk:

For uncommon or newly delegated public suffixes, analytics can group referrers incorrectly. This is not a privacy-critical bug by itself because hosts are already coarse and capped, but it can distort product analytics and make referrer reports inconsistent.

Recommended control:

If analytics accuracy matters, either import/update a PSL-derived table at build time or document the approximation in the analytics UI/operator docs. Keep the current lightweight implementation if dependency size and privacy minimization are more important than precision.

## Testing / Validation Gaps

- Full blocking gates (`npm run lint`, `npm run typecheck`, `npm run build`, full `npm test`, Playwright e2e) were **not** run in this critic lane. This report is a source-review artifact, not release evidence.
- The targeted scanner gates did pass via `NODE_OPTIONS='--import tsx'` as listed above.
- `apps/web/package.json` defines e2e as Playwright (`apps/web/package.json:21`) and the repo has eight e2e files/fixtures under `apps/web/e2e/`; however, smart collections currently have compiler/load-more tests (`apps/web/src/__tests__/smart-collections.test.ts:12`-`17`; `apps/web/src/__tests__/smart-collection-pagination.test.ts:5`-`25`) without an admin CRUD/UI workflow because the admin surface itself is missing (C92-CRIT-03).
- Manual validation still needed for production semantic-search activation/weights, built Docker `site-config.json` behavior, and production deploy state; source review cannot prove live-host state.

## Positive Findings / Strengths

- Admin API exports are covered by the auth scanner; both admin API routes passed the check.
- Mutating server actions passed the same-origin scanner, including the smart-collection actions.
- Public mutating/expensive routes passed the public-route rate-limit scanner.
- Migration docs and code directly address Drizzle’s max-timestamp skip behavior, and AGENTS/CLAUDE require monotonic migration journal entries plus `reconcileLegacySchema` updates (`AGENTS.md:22`-`27`; `CLAUDE.md:424`-`448`).
- Deploy disk hygiene preserves the important guarantees: prune after `up -d`, bind-mounted data, and `volume prune` without `-a` (`AGENTS.md:17`-`20`; `apps/web/deploy.sh:79`-`104`; `CLAUDE.md:471`-`477`).
- The public smart-collection compiler uses allowlisted columns, bounded depth, and parameter binding contracts (`apps/web/src/lib/smart-collections.ts:1`-`13`) with unit tests targeting the security boundary (`apps/web/src/__tests__/smart-collections.test.ts:12`-`17`).

## Final Missed-Issue Sweep

After drafting the findings, I performed a final sweep for missed issue classes:

- Rechecked `AGENTS.md` / `CLAUDE.md` line contracts against deploy, schema, topology, color/HDR, smart collections, and test gates.
- Re-ran the three targeted scanner gates via `NODE_OPTIONS='--import tsx'`; all passed.
- Re-ran smart-collection call-site search over `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, and tests; no additional admin UI caller surfaced.
- Checked representative destructive/repair paths (`deleteImage`, `deleteImages`, restore, deploy prune) for file/DB side effects.
- Checked semantic search routes, queue writer, backfill writer, schema, and migrations together for model-version consistency.
- Checked product discovery metadata vs sitemap coverage for public collection/archive surfaces.
- Checked runtime/deploy contracts for process-local state, bind mounts, static config, health/prune behavior, and base image reproducibility.

No additional Critical issues were identified in this final sweep. The highest-priority fix remains the restore foreground-mutation barrier (C92-CRIT-01), followed by embedding schema versioning (C92-CRIT-02) and making smart collections either fully productized or explicitly internal/manual (C92-CRIT-03/C92-CRIT-04).
