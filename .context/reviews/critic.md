# Cycle 16 Critic Review

Date: 2026-07-08
Reviewer: critic
Mode: review-only; this report is the only intended write.
Specialty: product/implementation mismatches, hidden coupling, overfit tests, stale artifacts, and operational tradeoffs.

## Inventory And Coverage

Inventory was built before finding selection.

- Source/review surface counted: 536 TypeScript files, 111 TSX files, 30 SQL migrations, 8 JS/MJS scripts, 13 JSON configs/snapshots, and 2,224 markdown review/plan docs under the repo review surface.
- Core runtime inventory: all files under `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/src/i18n`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, root/app package manifests, Docker/deploy/CI config, `AGENTS.md`, and `CLAUDE.md`.
- Current review surface: top-level `.context/reviews/*.md`, current `.context/plans/README.md`, `cycle-15-2026-07-08-plan.md`, `cycle-15-2026-07-08-deferred.md`, current `_aggregate.md`, and recent cycle artifacts needed to understand provenance.
- Relevant files were examined through full-file reads where findings cite behavior, plus repo-wide scans for auth/origin/rate-limit coverage, raw SQL, filesystem/process operations, source-contract tests, runtime artifacts, TODO/FIXME/HACK markers, deployment claims, migrations, public privacy selectors, semantic search, service worker, and map/UX performance surfaces.
- Excluded from behavioral conclusions: dependencies, generated build output, binary fixtures/screenshots, local env/secrets, and historical plan/review archives except where they are currently linked by active indexes or directly pollute the review inventory.

Validation evidence:

- Confirmed current `HEAD`/`origin/master`: `78778dd8 fix(cycle-15): prevent review-found regressions`.
- Guard evidence from sibling lanes: API-auth, action-origin, and public-route-rate-limit scanners passed in the current cycle reports.
- This lane did not run full lint/typecheck/build/unit/e2e gates; it is a critic/report lane and changed only this markdown report.

## Confirmed Issues

### C16-CRIT-01 - Admin deletion can bypass structured error handling before the advisory-lock try/catch

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- File/region: `apps/web/src/app/actions/admin-users.ts:220-314`
- Problem: `deleteAdminUser()` acquires a dedicated MySQL connection at line 231 before entering the `try/catch/finally` that maps lock, transaction, and domain failures to localized action results. If `connection.getConnection()` rejects, the server action throws a framework-level error instead of returning `{ error: t('failedToDeleteUser') }`.
- Why it matters: The function is deliberately careful after the connection exists: it serializes through an advisory lock, rolls back, maps `LAST_ADMIN`/`USER_NOT_FOUND`, and releases or destroys pooled locks. The one infrastructure step most likely to fail under pool saturation sits outside that envelope.
- Concrete failure scenario: Upload processing or backfill consumes pool capacity while an admin deletes a stale account. `connection.getConnection()` rejects at line 231. The UI receives an unstructured server-action failure instead of a localized, recoverable delete-user error.
- Suggested fix: Declare `let conn: PoolConnection | null = null` and move acquisition inside a guarded try. Release/destroy only when `conn` is non-null, and return `failedToDeleteUser` on acquisition failure while logging the detail server-side.

### C16-CRIT-02 - CLIP embedding backfill has the same pre-try dedicated-connection failure path

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- File/region: `apps/web/src/app/actions/embeddings.ts:59-213`
- Problem: `backfillClipEmbeddings()` takes a restore mutation slot and checks auth/rate limits, then calls `connection.getConnection()` at line 113 before the `try/catch` that returns `{ status: 'error', message: t('embeddingBackfillFailed') }`. A pool/TLS/DB restart failure rejects the action rather than preserving its typed result contract.
- Why it matters: The action is intentionally mode-aware, rate-limited, restore-aware, and typed. A connection-acquisition miss is the only advisory-lock infrastructure failure not converted to the same user-facing shape as later failures.
- Concrete failure scenario: An operator triggers or later wires embedding backfill during semantic-search rollout while MySQL is briefly unavailable. The action rejects before `semanticBackfillLockHeld` exists; callers see a server-action exception instead of a localized `embeddingBackfillFailed` response.
- Suggested fix: Wrap dedicated connection acquisition in the same error-handling policy as the rest of the action. If acquisition fails, return the typed error. Keep `releasePooledAdvisoryLocks()` once a connection exists.

### C16-CRIT-03 - Active plan provenance still advertises stale cycle-15 push/deploy state after the fix commit is already on origin

- Severity: Low
- Confidence: High
- Status: Confirmed review-surface issue
- File/region: `.context/plans/cycle-15-2026-07-08-plan.md:1-5`, `.context/plans/README.md:34-39`, `.context/reviews/_aggregate.md:1-10`
- Problem: The active cycle-15 plan says `Status: IMPLEMENTED - GATES GREEN, PUSH/DEPLOY PENDING` and points to aggregate HEAD `6256a988`. Current git state shows `HEAD`, `origin/master`, and `origin/HEAD` at `78778dd8`, the cycle-15 fix commit. The plan index still presents cycle 15 as active current-cycle work while cycle 16 reports are being produced.
- Why it matters: In this repo, plan/review files are part of the operating surface for subsequent agents. A stale active status can cause duplicate scheduling, incorrect deploy assumptions, or false "pending push" work in the next plan phase.
- Concrete failure scenario: A planner reads the active plan index, assumes cycle 15 fixes were not pushed, and schedules another provenance/deploy cleanup instead of ingesting the new cycle-16 findings. Alternatively, a deploy operator treats the plan as the current pending action despite origin already carrying the fix commit.
- Suggested fix: After push/deploy completion, update the plan status to reflect the actual terminal state and move or mark superseded active entries. The cycle-16 aggregation step should make `_aggregate.md` and `.context/plans/README.md` unambiguously point at the newest review cycle.

## Likely Issues

### C16-CRIT-04 - Critical behavior is still over-protected by source-string tests instead of behavior tests

- Severity: Medium-High
- Confidence: High
- Status: Likely issue
- File/region:
  - Logout revocation source contracts: `apps/web/src/__tests__/pending-session-revocations.test.ts:88-107`, `apps/web/src/__tests__/auth-mutation-barrier-source.test.ts:63-72`, runtime `apps/web/src/app/actions/auth.ts:275-317`
  - Upload quota TOCTOU source contract: `apps/web/src/__tests__/images-action-toctou-claim.test.ts:17-56`, runtime `apps/web/src/app/actions/images.ts:232-320`
  - Tag aggregation source contract: `apps/web/src/__tests__/data-tag-names-sql.test.ts:234-248`, runtime `apps/web/src/lib/data.ts:1682-1729`
  - Migration reconcile self-declared source tripwire: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:107-122`, runtime `apps/web/scripts/migrate.js:858-947`
- Problem: The suite has many valuable regression tripwires, but several high-risk contracts assert strings, index order, or name presence rather than executing the behavior. The current inventory found 170 tests that read source files and 249 tests with source/contract/wiring/lock-style markers. For the examples above, a real behavior regression can preserve the checked strings.
- Why it matters: These tests can create false confidence in the exact areas this codebase most needs behavioral proof: logout session revocation, upload quota concurrency, search result tag correctness, and schema bootstrap parity.
- Concrete failure scenario: A refactor leaves `enqueuePendingSessionRevocation(hashSessionToken(token))` and `if (!revoked)` in `auth.ts`, but moves them outside the real blocked logout branch. The source tests pass while logout during restore fails to queue server-side revocation. Similarly, a new awaited precheck can be inserted between upload quota validation and claim without matching the two hard-coded awaited needles in the test.
- Suggested fix: Keep source contracts only as cheap secondary guards. Add behavior tests for the blocked logout branches, concurrent same-key upload quota, multi-tag search aggregation, and a structural schema parity check against `information_schema` for reconcile/bootstrap. When behavior tests exist, remove or downgrade brittle source-order assertions.

### C16-CRIT-05 - OMC runtime artifacts still leak into source/review inventories

- Severity: Low
- Confidence: High
- Status: Likely maintainability issue
- File/region: `.gitignore:16-17`, `.omc/plans/plan-cycle12-fixes.md:1-63`, `apps/web/src/__tests__/.omc/state/sessions/cf88ba27-b054-4385-83b8-446a5996bdbf/pre-tool-advisory-throttle.json:1-10`
- Problem: The repo ignores `.omc` and `.omx`, but `git ls-files` still includes `.omc/plans/plan-cycle12-fixes.md`, and an untracked `.omc` state JSON lives under `apps/web/src/__tests__`. Even when not tracked, nested runtime state under `src/__tests__` is picked up by broad `rg --files` inventories.
- Why it matters: Review-plan-fix lanes depend on accurate inventory. A completed April 2026 runtime plan and an advisory throttle JSON are not app source, tests, or committed project memory, but they appear in the same tree locations as relevant material.
- Concrete failure scenario: A future reviewer or static scan counts `apps/web/src/__tests__/.omc/...json` as test surface, or reads `.omc/plans/plan-cycle12-fixes.md` as a live plan and reopens old work. This increases review noise and makes "no relevant file skipped" harder to audit.
- Suggested fix: Remove tracked `.omc` artifacts from git and keep `.context/plans`/`.context/reviews` as the committed review surfaces. Add a small CI/source hygiene check that fails if tracked files match `(^|/)\\.omc/` or `(^|/)\\.omx/`, and clean nested runtime state from `apps/web/src`.

### C16-CRIT-06 - Docker production-image correctness is still mostly deploy-time, not CI-time

- Severity: Medium
- Confidence: High
- Status: Likely operational fragility
- File/region: `.github/workflows/quality.yml:48-83`, `apps/web/Dockerfile:50-62`, `apps/web/Dockerfile:76-85`, `apps/web/deploy.sh:51-56`
- Problem: The quality workflow runs npm lint/typecheck/tests/e2e/build on the runner, but it does not build the production Docker image. The Dockerfile then overlays hard-coded Linux-native package pins after `npm ci --no-save`. This is a separate build graph from the CI `npm run build` graph.
- Why it matters: Production deploys are where Linux native packages, standalone output copying, and Docker-only build args are actually exercised. A dependency or lockfile update can pass CI and fail only during `npm run deploy`.
- Concrete failure scenario: Next, Sharp, Lightning CSS, SWC, or Parcel watcher versions change in `package-lock.json`; `.github/workflows/quality.yml` stays green, but the Dockerfile still installs stale native packages at lines 56-62 or 82-84. The production image build fails on the remote host or ships mismatched native bindings.
- Suggested fix: Add a CI job or required local gate that builds the Docker image for the target architecture, or add a lockfile-vs-Dockerfile pin checker. Prefer deriving Docker native package versions from the lockfile instead of duplicating them by hand.

## Manual-Validation Risks

### C16-RISK-01 - Public map UX can still hydrate 10,000 Leaflet markers plus a duplicate accessible list

- Severity: Medium-High at GPS-heavy gallery scale
- Confidence: High
- Status: Manual performance/UX validation risk
- File/region: `apps/web/src/lib/data.ts:1766-1816`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`, `apps/web/src/components/map/map-client.tsx:77-140`
- Problem: The code intentionally caps public map data at 10,000 rows, but it still materializes, serializes, hydrates, fits bounds for, and renders one Leaflet `Marker` per row, plus a separate HTML list row for every marker. The truncation notice is honest, but it does not make the 10,000-marker path responsive.
- Concrete failure scenario: A GPS-enabled archive grows to several thousand public map-visible photos. Mobile Safari or low-memory Android receives the large SSR payload, hydrates thousands of React/Leaflet nodes, computes bounds across every marker, and presents a slow or crashing map. The page is technically capped but not practically usable.
- Suggested fix: Validate `/map` with production-like marker counts on mobile. Schedule clustering, viewport/bbox queries, pagination/virtualization for the accessible list, or a lower operational cap before advertising map as scalable beyond personal small/medium GPS sets.

### C16-RISK-02 - Edge/proxy assumptions remain operator-validated rather than release-validated

- Severity: High if live host config drifts
- Confidence: Medium
- Status: Manual security/ops validation risk
- File/region: `apps/web/deploy.sh:51-56`, `apps/web/nginx/default.conf:20-29`, `apps/web/nginx/default.conf:290-306`, `apps/web/src/lib/rate-limit.ts:175-205`, `apps/web/src/lib/request-origin.ts:47-145`, `CLAUDE.md` runtime topology / public SSR page-rate-limit sections
- Problem: App-layer origin checks are fail-closed, but several abuse controls depend on live nginx/CDN/LB configuration: public SSR throttling, `/_next/image` throttling, upload body caps, and trustworthy client IP extraction. The normal deploy script rebuilds/restarts Docker and does not prove host nginx state.
- Concrete failure scenario: Production is moved behind a CDN/LB or nginx config is edited manually. The app sees collapsed or spoofable client IPs, or the public-page limiter is absent. Public dynamic routes and semantic/OG endpoints then take traffic based on app-only assumptions that were never validated against the active edge config.
- Suggested fix: Add an operator/deploy diagnostic that reads active `nginx -T` or probes rate-limit behavior from outside the host. Keep `BASE_URL`, `TRUST_PROXY`, and `TRUSTED_PROXY_HOPS` tied to real topology and fail health/deploy checks where practical.

### C16-RISK-03 - Single-writer correctness is documented but still warn-only at runtime

- Severity: High if replicas are introduced
- Confidence: High
- Status: Manual deployment-topology risk
- File/region: `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/instrumentation.ts:22-31`, `apps/web/src/lib/admin-mutation-barrier.ts:11-29`, `CLAUDE.md` runtime topology section
- Problem: The app is explicitly single-web-instance, but persistent singleton-lock contention only logs and continues startup. Restore mutation slots, upload tracker/quota state, queue/backfill status, some rate-limit buckets, and buffered analytics remain process-local.
- Concrete failure scenario: An operator accidentally runs two containers during blue/green testing. Restore drains one process's mutation slots while the other process can still admit writes, and in-memory limiter budgets split by process.
- Suggested fix: Make multi-instance contention fail startup/readiness in production unless an explicit unsafe override is set, or move correctness-bearing state to shared durable coordination before allowing scale-out.

## Final Sweep

Commonly missed areas checked:

- Product claims vs implementation: smart collections, semantic-search gating, site-config build-time behavior, map visibility/GPS privacy, and current plan provenance were checked against source and docs.
- Hidden coupling: restore maintenance, admin mutation slots, upload tracker, advisory locks, token usage tracking, image queue/backfills, Docker native packages, and service-worker template/generated output were traced across files.
- Security/privacy: no new public selector GPS/original-filename leak was confirmed; API auth/origin/rate-limit guard reports are green in sibling lanes. Remaining security concerns are topology/manual-validation risks.
- Performance/UX: map marker hydration, semantic scan recency limits, Docker/deploy-only validation, and source-contract-heavy tests remain the highest critic-lane concerns.
- Stale/misleading artifacts: active plan status and `.omc` runtime artifacts are called out above.
- Skipped files: binary fixtures/screenshots, dependency/build outputs, local secrets, and historical archives not linked from the current review surface were excluded. No current source/config/review file relevant to the findings above was intentionally skipped.
