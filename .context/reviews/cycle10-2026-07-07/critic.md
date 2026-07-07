# Cycle 10 Critic Review - 2026-07-07

Role: skeptical multi-perspective critique for product correctness, operations, maintainability, hidden assumptions, and failure modes.

Scope: whole-repository static review with source/docs/tests inspection and a final missed-issues sweep. I did not edit application source. I used the existing cycle-10 reviewer artifacts only as cross-check input and verified reportable claims against repository files and targeted commands.

## Review-Relevant File Inventory

Core contracts and operations:
- `AGENTS.md`
- `CLAUDE.md`
- `package.json`
- `package-lock.json`
- `.github/workflows/quality.yml`
- `apps/web/package.json`
- `apps/web/deploy.sh`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`

Database and migration surface:
- `apps/web/src/db/schema.ts`
- `apps/web/drizzle/0012_image_embeddings.sql`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/scripts/migrate.js`
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`
- `apps/web/src/__tests__/migration-coverage.test.ts`

Public product paths and performance-sensitive data reads:
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/components/on-this-day-widget.tsx`
- `apps/web/src/components/map-loader.tsx`

Semantic search / CLIP activation path:
- `apps/web/src/lib/clip.ts`
- `apps/web/src/lib/semantic-search.ts`
- `apps/web/src/app/api/admin/semantic/*`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/__tests__/clip-offline-load.test.ts`
- `apps/web/src/__tests__/clip-semantic-integration.test.ts`

Interaction and regression-test surfaces:
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts`
- `apps/web/src/__tests__/deploy-script-contract.test.ts`
- `apps/web/src/__tests__/touch-target-audit.test.ts`

## Findings

### C10-CRIT-01 - Docker native package pins drift from the lockfile

Severity: Medium  
Confidence: High  
Location: `apps/web/Dockerfile` lines 55-60; `package-lock.json` lines 9214-9219 and 9301-9310; `apps/web/src/__tests__/deploy-script-contract.test.ts` lines 255-282

Failure scenario: the Docker build stage manually installs Linux-native optional packages after `npm ci`, but the pins are stale: `@next/swc-linux-${npm_arch}-gnu@16.2.9` and `@swc/core-linux-${npm_arch}-gnu@1.15.41` while the lockfile resolves Next native SWC packages at `16.2.10` and `@swc/core` native packages at `1.15.43`. Local `npm run build` can pass on macOS while the production Linux Docker path installs a compiler/runtime native package set that no longer matches the locked JavaScript packages. The deploy-script contract test currently only checks that tokens are semver-shaped, so it false-passes the drift.

Concrete fix: update the Dockerfile pins to the lockfile versions or derive them from `package-lock.json` at build/test time. Strengthen `deploy-script-contract.test.ts` to parse `package-lock.json` and assert that every manually installed native optional package exactly matches the locked package version. Add a Docker build smoke check for this path if CI capacity allows.

### C10-CRIT-02 - Production audit still contains vulnerable nested PostCSS through Next

Severity: Medium  
Confidence: High  
Location: `apps/web/package.json` lines 59 and 82; root `package.json` lines 7-9; `package-lock.json` lines 9194-9205, 9334-9337, and 9850-9853

Failure scenario: the workspace declares `postcss@^8.5.16` and has an override for top-level PostCSS, but `next@16.2.10` still carries a nested `next/node_modules/postcss@8.4.31`. `npm audit --workspace=apps/web --omit=dev --json` reports GHSA-qx2v-qp2m-jg93 for `postcss <8.5.10` through Next. The practical exploitability depends on attacker-controlled CSS reaching the bundled PostCSS stringify path and then being embedded in a page, which I did not confirm in this app; the dependency nevertheless leaves production audit red and creates a hidden XSS-risk dependency on Next internals.

Concrete fix: do not run `npm audit fix --force` because it suggests a bad downgrade path. Either apply and validate an override/resolution that forces Next's nested PostCSS to `>=8.5.10`, or track/upgrade to the first Next release that removes the vulnerable nested version. If no compatible override is possible, record a temporary, reviewed audit exception with the exact GHSA, affected range, and app-specific exposure analysis.

### C10-CRIT-03 - Dynamic timeline and anniversary reads are non-sargable hot paths

Severity: Medium  
Confidence: High  
Location: `apps/web/src/lib/data-timeline.ts` lines 92-116, 129-141, and 178-207; `apps/web/src/app/[locale]/(public)/timeline/page.tsx` lines 19 and 72-94; `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx` lines 20 and 92-100; `apps/web/src/components/on-this-day-widget.tsx` lines 15-22

Failure scenario: the repository already comments that `MONTH()`, `DAY()`, and `YEAR()` filters are not sargable, but these queries sit on `revalidate = 0` public pages and the homepage widget. As the archive grows, bots or crawlers can repeatedly force MySQL to scan processed dated images and evaluate date functions before grouping, ordering, and limiting. That competes with uploads/admin work on a single-instance deployment and turns an otherwise read-only public path into avoidable DB pressure.

Concrete fix: replace timeline/year filters with sargable date ranges. For the anniversary widget, add a generated/indexed `capture_mmdd` or separate indexed `capture_month`/`capture_day` columns, or cache the daily result. Add a source/SQL regression test that rejects `YEAR(images.capture_date)`, `MONTH(images.capture_date)`, and `DAY(images.capture_date)` in public hot-path queries unless an explicit waiver exists.

### C10-CRIT-04 - Map page can scan and ship a large unbounded marker set per request

Severity: Medium  
Confidence: Medium-High  
Location: `apps/web/src/lib/data.ts` lines 1732-1768; `apps/web/src/app/[locale]/(public)/map/page.tsx` lines 14 and 42-66; `apps/web/src/components/map-loader.tsx` lines 89-96

Failure scenario: `getMapImages` caps results at 10,001 and filters all processed, public, geotagged images before ordering by capture date. The page is dynamic and passes the result into the client map loader. A GPS-heavy archive or crawler traffic can force large DB reads, server serialization, and client-side Leaflet marker work even when the visitor only views one viewport. The current cap prevents infinity but still allows a heavy default public response.

Concrete fix: add a geospatial/visibility-oriented index or persisted `has_gps` predicate, then return clustered or viewport-bounded markers rather than the whole archive. If whole-archive map remains a product requirement, add cache/revalidation and an explicit payload budget test so the 10k-marker ceiling is intentional and monitored.

### C10-CRIT-05 - Migration reconcile is a manual second schema authority with weak parity tests

Severity: Medium  
Confidence: High  
Location: `apps/web/scripts/migrate.js` lines 348-730; `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts` lines 13-19, 95-102, 157-171, and 209-217

Failure scenario: `reconcileLegacySchema` manually recreates the expected current schema for fresh or legacy databases, but the coverage test says it cannot verify column types or defaults and mostly checks that names appear in the script. A future migration can change nullability, default values, column type, index order, uniqueness, or FK actions while the same column/index/FK name remains present in `migrate.js`; CI passes, but a database baselined through reconcile diverges from one built by the migration journal.

Concrete fix: add a disposable MySQL structural parity test that builds schema once via migrations and once via reconcile/baseline, then compares `information_schema` for columns, defaults, nullability, generated/extra attributes, index columns/order/uniqueness, and FK update/delete rules. Longer term, generate reconcile from the same schema/migration source instead of maintaining a parallel hand-written schema.

### C10-CRIT-06 - Drizzle schema type lies about binary CLIP embeddings

Severity: Medium  
Confidence: High  
Location: `apps/web/src/db/schema.ts` lines 271-291; `apps/web/drizzle/0012_image_embeddings.sql` lines 5-8; `apps/web/scripts/migrate.js` lines 684-692

Failure scenario: the physical column is `MEDIUMBLOB`, but the Drizzle schema declares `embedding: text("embedding")` with comments explaining that writes cast through `unknown`. Today the hand-written migration and decode path preserve binary vectors, but future Drizzle diffs, refactors, schema generation, or type-driven writers can trust the TypeScript schema and accidentally treat embeddings as text. That risks binary corruption or a migration that changes the storage type.

Concrete fix: replace the text placeholder with a Drizzle `customType`/binary helper that emits `MEDIUMBLOB` and exposes `Buffer`/`Uint8Array` at the type boundary. Add a regression test that checks the schema helper, committed SQL, and reconcile script all agree on `MEDIUMBLOB`.

### C10-CRIT-07 - Host nginx changes remain outside the deploy boundary

Severity: Medium  
Confidence: High  
Location: `CLAUDE.md` lines 479-495; `apps/web/deploy.sh` lines 51-55; `apps/web/nginx/default.conf` lines 1-29 and 46-71

Failure scenario: project docs correctly state that `apps/web/nginx/default.conf` is a committed template and deploys do not touch host nginx. The template now carries important security and availability controls such as public SSR, image optimizer, admin limit zones, and XFF topology caveats. A future fix can be committed, pushed, and even followed by `npm run deploy`, while production continues running the stale host config. That creates a false closure mode for edge-rate-limit, body-size, or proxy-header findings.

Concrete fix: add an operational guard that compares a committed template hash/version with the live host config during deploy and fails or loudly reports `prod-apply pending` when they differ. Alternatively make host nginx application an explicit deploy step gated by `nginx -t` and reload, then record verification in the cycle ledger. Keep manual application acceptable only if the ledger tracks applied template version and limiter smoke evidence.

### C10-CRIT-08 - Real CLIP/semantic-search tests are skipped in default CI

Severity: Medium  
Confidence: High  
Location: `apps/web/src/__tests__/clip-offline-load.test.ts` lines 15-18 and 32-41; `apps/web/src/__tests__/clip-semantic-integration.test.ts` lines 8-10 and 30-31; `apps/web/package.json` lines 21-24; `.github/workflows/quality.yml` lines 66-80

Failure scenario: the CLIP offline-load and semantic integration suites are explicitly gated behind environment variables/seeded assets, and the main quality workflow runs ordinary unit/e2e/build gates without those CLIP preflight conditions. A dependency upgrade, model path change, tokenizer drift, or operator runbook mismatch can break the production semantic-search activation path while default CI remains green.

Concrete fix: add a scheduled or opt-in CI job that seeds/caches CLIP weights and runs `npm run test:clip:preflight --workspace=apps/web`. Require that job for changes touching `clip.ts`, semantic search, model install scripts, or dependency versions. If the full model is too heavy for every PR, add a lightweight hermetic loader/fixture test that at least verifies model path resolution, tokenizer load, embedding decode shape, and DB write/read compatibility.

### C10-CRIT-09 - Bottom-sheet dropdown behavior is protected by source-string assertions, not browser behavior

Severity: Low-Medium  
Confidence: High  
Location: `apps/web/src/components/info-bottom-sheet.tsx` lines 558-595; `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts` lines 14-26

Failure scenario: the regression test checks that source text contains a portal container prop and selected class names. It does not mount Radix in a mobile viewport or verify that the menu is visible, focus-trapped correctly, clipped correctly, and dismissed correctly inside the bottom-sheet dialog. A real interaction regression could pass because the source still contains the expected strings.

Concrete fix: replace or supplement the string test with a Playwright mobile test that opens a seeded photo, opens the info sheet, opens the dropdown, asserts the dropdown content is visible within the dialog stacking context, selects an item, and verifies focus/escape behavior.

## Final Missed-Issues Sweep

I re-scanned the review-relevant inventory after drafting and looked specifically for issues that would change severity or add a more urgent blocker. I did not find evidence of a currently broken core happy path, admin-auth bypass, public original-file exposure, or migration journal omission. The highest-confidence unresolved risks are operational/test-boundary risks rather than obvious source-level correctness regressions.

Targeted evidence collected:
- `npm audit --workspace=apps/web --omit=dev --json` reports the nested PostCSS advisory through Next.
- `npm view next version` returns `16.2.10`; `npm view postcss version` returns `8.5.16`.
- `npm ls postcss next --workspace=apps/web` shows both top-level `postcss@8.5.16` and nested `next/node_modules/postcss@8.4.31`.
- Source inspection confirms the Dockerfile native pins are stale relative to `package-lock.json`.
- Existing cycle-10 code-review artifact reports the standard gates passing, but I did not rerun the full gate suite in this critic pass because this was a read-only review plus artifact write.

## Residual Risk

This review is static and skeptical, not a production runtime audit. The remaining blind spots are live database cardinality, live nginx template version, live CLIP model availability, and real mobile/browser interaction evidence for the bottom sheet. Those are exactly the areas where the findings recommend adding operational or browser-backed checks.
