# Verifier Review - Cycle 20

Role: verifier
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `bd0cc170412b0f70ae231cec27ca54ee50e638fd` (`master`)
Scope note: source/tests/scripts/config/docs review plus local verification. I edited only this report file.

## Inventory

Inventory command: `git ls-files | sort`
Tracked files inventoried: 3,511.

Review-relevant tracked inventory:

- Product source: 81 app route/action files, 61 component files, 114 lib files, 3 db files.
- Verification surface: 362 unit-test files, 12 e2e files, 29 scripts, 33 migration/journal files.
- Runtime/config/assets: 26 web config files, 9 public committed assets, 2 locale message files.
- Written contracts/history: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, 2 docs files, 188 `plan/` files, 2,566 `.context/` files.

Files and interactions examined without source sampling:

- Required contracts: `AGENTS.md`, `CLAUDE.md`, root/app package scripts.
- Custom gates: `check-action-origin.ts`, `check-api-auth.ts`, `check-public-route-rate-limit.ts`, their unit fixtures, and current action/API route outputs.
- Restore/drain/barrier flow: `db-actions.ts`, `admin-mutation-barrier.ts`, `restore-drain-checklist.ts`, `background-db-writes.ts`, `maintenance-scheduler.ts`, `data.ts`, and related tests.
- Service worker/generation: `sw.template.js`, committed `sw.js`, `build-sw.ts`, SW contract tests, delete-image path.
- Migrations/deploy: drizzle SQL/journal, `migrate.js`, migration tests, `deploy.sh`, `deploy-remote.sh`, Docker Compose, nginx template.
- Public route and privacy surfaces: API routes, share/group/photo/map/feed route interactions, public data projections, rate-limit gates.

## Verification Evidence

Fresh gates run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed; current action files all use the real `using mutationSlot = acquireAdminMutationSlot()` shape or reasoned restore/read exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm run lint --workspace=apps/web` - passed.
- `npm run typecheck --workspace=apps/web` - passed.
- `npm test --workspace=apps/web` - 357 files: 355 passed, 2 skipped; 3,326 tests passed, 4 skipped.
- `npm run build --workspace=apps/web` - passed; Next.js 16.2.10 production build completed.
- Focused contract run: 9 files / 377 tests passed for action/public-route/API-auth/deploy/SW/migration gates.
- Manual generated-artifact probe: `public/sw.js` equals `public/sw.template.js` with `__SW_VERSION__` replaced by `2bd9e8ba-p7`; PWA icon regeneration produced no git diff.

Not run:

- `npm run test:e2e --workspace=apps/web` and `npm run test:e2e:admin --workspace=apps/web`: browser/server and admin credentials are required.
- `CLIP_MODELS_ROOT=<abs> npm run test:clip:preflight --workspace=apps/web`: model weights path not provided.
- `npm run deploy`: production/external side effect.
- `npm run check:proxy-topology`: requires `--url` or `PROXY_TOPOLOGY_URL`; no deployed URL was supplied.

## Confirmed Issues

### VER-C20-01 - Restore can hang before the bounded drain checklist runs

- Severity: High
- Confidence: High
- Exact location: `apps/web/src/app/[locale]/admin/db-actions.ts:560-574`, `apps/web/src/lib/data.ts:222-249`, `apps/web/src/lib/restore-drain-checklist.ts:20-50`, `apps/web/src/__tests__/restore-drain-checklist.test.ts:74-115`, `apps/web/src/__tests__/data-view-count-flush.test.ts:221-232`
- Evidence: `restoreDatabase()` sets durable restore maintenance, then directly awaits `flushBufferedSharedGroupViewCounts()` before calling `runRestoreDrainChecklist([...])`. The checklist stages are explicitly bounded by their own drain functions, but the pre-checklist shared-group flush has no timeout. `flushBufferedSharedGroupViewCounts()` can await `currentFlushPromise` and then `flushGroupViewCounts()`, whose DB update promises have no bounded restore timeout. The restore-drain test verifies `flushBufferedSharedGroupViewCounts()` appears before the checklist, so the test locks the risky ordering instead of proving every process-local DB writer is bounded.
- Failure scenario: A shared-group view-count flush is in progress or starts while MySQL is slow, partitioned, or blocked. An operator starts DB restore. Restore maintenance becomes active and future uploads/admin mutations are refused, but the action waits indefinitely in the unbounded flush before the timeout-aware checklist can abort. The site remains in restore maintenance until manual recovery.
- Concrete fix: Move shared-group view-count flushing into `runRestoreDrainChecklist()` as a named bounded stage, e.g. `shared-group-view-counts`, implemented with a timeout wrapper returning `false` on expiry. Add a behavior test where that stage never resolves and assert restore aborts and later stages/import do not run. Avoid source-only assertions that bless pre-checklist awaits.

### VER-C20-02 - Mutation-barrier scanner accepts a spoofed or non-disposable barrier call

- Severity: High
- Confidence: High
- Exact location: `apps/web/scripts/check-action-origin.ts:148-164`, `apps/web/scripts/check-action-origin.ts:1371-1397`, `apps/web/src/__tests__/check-action-origin.test.ts:618-630`, `apps/web/src/lib/admin-mutation-barrier.ts:67-80`
- Evidence: `bodyAcquiresAdminMutationSlot()` returns true for any call expression whose identifier text is `acquireAdminMutationSlot`. It ignores import provenance, shadowed bindings, `using`, and the required `if (!mutationSlot.acquired) return ...` branch documented by the helper. The positive fixture passes with a call shape but no approved import and no acquired-failure check.
- Failure scenario: A future mutating admin action defines or imports a no-op function named `acquireAdminMutationSlot`, or calls the real function without `using`. `lint:action-origin` passes, but the action does not hold a real disposable shared slot for its body. During restore, `drainAdminMutationsForRestore()` can observe no in-flight holder and import while that action later writes into the restored database.
- Concrete fix: Mirror the scanner’s `requireSameOriginAdmin` provenance checks: collect approved `acquireAdminMutationSlot` imports from `@/lib/admin-mutation-barrier`, reject shadowing, require a top-level `using <slot> = acquireAdminMutationSlot()` before protected work, and require an early return on `!<slot>.acquired`. Add negative fixtures for local spoofing, unapproved import, bare call, non-`using` assignment, and missing acquired check.

### VER-C20-03 - Offline HTML cache can serve deleted photo pages for up to 24 hours

- Severity: Medium
- Confidence: High
- Exact location: `apps/web/public/sw.template.js:445-499`, `apps/web/public/sw.template.js:554-562`, `apps/web/src/__tests__/sw-template-contract.test.ts:102-120`, `apps/web/src/app/actions/images.ts:655-752`
- Evidence: `networkFirstHtml()` caches any successful non-admin HTML response and only serves it when fetch throws. The fetch handler explicitly bypasses revocable object pages (`/c`, `/s`, `/g`, `/map`) but says normal `/p/:id` photo pages remain eligible. There is no cached-HTML deletion path for a later online 404/410, unlike derivative image handling. The test suite asserts normal photo pages stay eligible for offline fallback.
- Failure scenario: A visitor opens `/en/p/123`; the SW caches the 200 HTML. An admin deletes photo `123`. Later, while offline or on a failing network and within `HTML_MAX_AGE_MS`, the same browser navigates to `/en/p/123` and receives the stale cached photo page instead of an unavailable/offline response. This can expose metadata for content the operator deleted or expected to be inaccessible.
- Concrete fix: Treat `/p/:id` as revocable HTML and bypass offline caching, or add explicit invalidation: on online non-OK responses delete the matching HTML cache entry, and on admin delete broadcast a SW message or versioned tombstone for affected photo URLs. Add an executable SW test or Playwright offline test for visit -> delete/404 -> offline revisit.

## Likely Issues

### VER-C20-L01 - Cached shared-group read still owns a view-count side effect

- Severity: Medium
- Confidence: Medium
- Exact location: `apps/web/src/lib/data.ts:1402-1407`, `apps/web/src/lib/data.ts:1830-1834`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-142`
- Evidence: `getSharedGroup()` buffers the denormalized `shared_groups.view_count` increment as part of the read helper. `getSharedGroupCached = cache(getSharedGroup)` then caches a function with side effects. The page also fires durable analytics separately after resolving `selectedImage`.
- Failure scenario: A future metadata/component/helper call reuses `getSharedGroupCached()` in the same render with a different option object or count intent. React cache deduplication becomes tied to call order and argument identity, so the denormalized counter can run zero, one, or multiple times independently of the durable `shared_group_views` insert.
- Concrete fix: Split the pure shared-group read from counting. Keep the cached function side-effect-free, and invoke both denormalized and durable count paths explicitly in the page after `selectedImage` is resolved.

## Test And Documentation Gaps

### VER-C20-T01 - Service-worker generated-artifact parity is manually true but not directly tested

- Severity: Low
- Confidence: High
- Exact location: `apps/web/src/__tests__/sw-template-contract.test.ts:60-66`, `apps/web/src/__tests__/sw-template-contract.test.ts:266-278`, `apps/web/src/__tests__/sw-template-contract.test.ts:412-450`, `apps/web/scripts/build-sw.ts:27-43`
- Evidence: `build-sw.ts` deterministically writes `public/sw.js` from `public/sw.template.js`, but the test suite only checks selected fragments and generator shape. It does not assert full `sw.js === template.replaceAll('__SW_VERSION__', computedVersion)`. A manual probe found current parity is true.
- Failure scenario: A template edit outside the fragment assertions is committed without regenerated `sw.js`. Unit tests remain green while the committed generated worker is stale.
- Concrete fix: Add one full parity test that imports `IMAGE_PIPELINE_VERSION`, computes the same SHA-256 stamp as `build-sw.ts`, replaces all placeholders, and compares the entire generated string to committed `public/sw.js`.

## Manual-Validation Risks

- Public edge/nginx state: repo deploy does not apply host nginx. `apps/web/nginx/default.conf` and docs are consistent, but live `zone=public` / `zone=nextimage` enforcement requires operator verification.
- Proxy topology: the script exists and is explicit about limits, but it needs a deployed URL and cannot prove effective client-IP bucket selection without edge logs or a diagnostic.
- Production semantic search: code gates and runbooks are covered; real CLIP model offline load/ranking requires seeded weights and the preflight command.
- E2E/browser coverage: local unit/build gates passed, but browser-flow proof was not run in this review. Admin e2e remains credential-gated.

## Clean / Refuted Areas

- Current action files are not missing the restore barrier; every current mutating admin action found by the scanner uses the real import and `using` shape, or carries a reasoned restore/read exemption.
- Admin API route scanner output covers the two current admin API routes and both wrap `withAdminAuth(...)`.
- Public route rate-limit scanner covers current public route files and passed.
- Migration journal has known historical non-monotonic `when` values, but committed migration tests for pending/drift/DML guards passed; SQL files and journal entries match by tag.
- Deploy script preserves the documented prune order: `docker compose up -d --build`, bounded health check, then `container/image/builder/volume prune` with no `volume prune -a`.
- Generated `sw.js` is currently synchronized with the template and pipeline stamp.

## Final Sweep

Common verifier misses checked:

- Generated artifacts: SW parity checked; PWA icon regeneration produced no diff.
- Guardrail false-greens: confirmed one in mutation-barrier scanner; API auth and public route scanners did not show the same provenance gap in inspected paths.
- Source-string tests: restore drain and SW generated-worker coverage still include source/fragment tests that do not prove the full behavior claimed.
- Stale docs: no current conflict found for deploy pruning, migration drift, semantic activation, no-payment policy, local-only storage, or privacy projection contracts.
- Skipped/non-product files: historical `.context` archives, screenshots, and plan history were inventoried as repository state but not treated as live behavior sources unless referenced by current contracts or current review candidates.
