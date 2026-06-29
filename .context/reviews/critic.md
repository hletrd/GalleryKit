# Critic Review - Cycle 5

Role: `critic`
Scope: whole repository and current HEAD
HEAD: `8819d68a`
Timestamp: 2026-06-29 KST
Status: review artifact written for review-plan-fix cycle 5

## Inventory And Method

Required context read first:
- `AGENTS.md`
- `CLAUDE.md`
- `~/.agents/skills/code-review/SKILL.md`
- prior `.context/reviews/critic.md`
- current `.context/reviews/code-review.md`
- current `.context/reviews/security-review.md`

Repository and surface inventory:
- Current route/action surface inventoried under `apps/web/src/app`, including public routes `/`, `/p/[id]`, `/g/[key]`, `/s/[key]`, `/c/[slug]`, `/map`, `/timeline`, admin pages, 8 API route files, and 12 server-action files.
- Runtime/deploy/storage files inspected: `apps/web/scripts/migrate.js`, `apps/web/src/instrumentation.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`.
- Sharing/public-cache surface inspected: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/data.ts`.
- Semantic/search surface inspected: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`.
- Schema/privacy/test surface inspected: `apps/web/drizzle/meta/_journal.json`, migration journal tests, `apps/web/src/db/schema.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/__tests__/upload-paths.test.ts`, `apps/web/src/__tests__/semantic-search-route.test.ts`, `apps/web/src/__tests__/sw-template-contract.test.ts`.

Validation evidence gathered:
- PASS `npm run lint:api-auth --workspace=apps/web`.
- PASS `npm run lint:action-origin --workspace=apps/web`.
- PASS `npm run lint:public-route-rate-limit --workspace=apps/web`.
- PASS `npm test --workspace=apps/web -- --run src/__tests__/sw-template-contract.test.ts src/__tests__/migration-journal.test.ts src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/privacy-fields.test.ts` (4 files, 33 tests).

## Findings

### CRIT-C5-01 - Legacy-original migration can delete the only good original on filename conflict

- Severity: High
- Confidence: High
- Status: Confirmed
- Perspectives: operational risk, product correctness, docs/implementation mismatch, maintainability
- Location/region:
  - `apps/web/scripts/migrate.js:46-55` defines the legacy public original root and the private original root.
  - `apps/web/scripts/migrate.js:58-95` migrates legacy originals at startup.
  - `apps/web/scripts/migrate.js:74-76` deletes the legacy public source whenever the private target path already exists, without verifying equality.
  - `apps/web/scripts/migrate.js:80-84` otherwise moves or copies the source into the private root and unlinks the source.
  - `apps/web/scripts/migrate.js:97-110` refuses production startup if legacy public originals remain.
  - `CLAUDE.md:557-558` documents original uploads as private, persisted data-volume state.
  - `apps/web/src/__tests__/upload-paths.test.ts:58-76` covers runtime path preference when both roots contain a file, but not the destructive migration conflict branch.
- Failure scenario: A previous partial deploy, manual recovery, or interrupted cross-device copy leaves `data/uploads/original/foo.jpg` present but truncated/corrupt while the valid legacy `public/uploads/original/foo.jpg` still exists. On the next startup, `migrateLegacyOriginalUploads()` sees the target and unlinks the valid public source. The production assertion then passes because the public source is gone, but the only recoverable original has been destroyed.
- Concrete fix: In the `fs.existsSync(target)` branch, compare source and target before unlinking. Only delete the source when size and a cryptographic hash match. If they differ, fail startup with an actionable error or quarantine the source into a conflict directory under the private data root with a unique suffix. Add focused tests for identical conflict, divergent conflict, and `EXDEV` copy conflict behavior.

### CRIT-C5-02 - Service-worker offline HTML cache can outlive share revoke, delete, or expiry

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Perspectives: product correctness, privacy expectation, cache/docs interaction, operational surprise
- Location/region:
  - `apps/web/public/sw.template.js:271-293` caches any successful HTML response that is not marked `x-gk-admin-render: 1`.
  - `apps/web/public/sw.template.js:294-310` serves cached HTML while offline for up to `HTML_MAX_AGE_MS` (24 hours).
  - `apps/web/public/sw.template.js:366-369` applies this network-first HTML handler to every HTML route.
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:14-26` marks single-photo share pages dynamic/no-cache/noindex, but the SW deliberately ignores normal no-cache behavior.
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:79-96` resolves a share key and returns `notFound()` when the key is no longer valid.
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:17-29` does the same robots/no-cache signaling for shared groups.
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:82-108` resolves the group key and returns `notFound()` when invalid.
  - `apps/web/src/app/actions/sharing.ts:306-343` revokes a single-photo share link and revalidates `/s/${oldShareKey}`.
  - `apps/web/src/app/actions/sharing.ts:346-386` deletes a group share link and revalidates `/g/${group.key}`.
  - `CLAUDE.md:404-409` documents the deliberate HTML offline fallback and its current exclusion only for admin-rendered pages/admin routes.
- Failure scenario: A visitor opens `/s/<key>` or `/g/<key>` once, installing a cached HTML copy. The admin later revokes the photo share, deletes the group share, or a group expires. Server-side requests correctly return 404, but if that same device is offline within 24 hours, the service worker still serves the stale shared page HTML from Cache Storage. Server revalidation cannot purge already-installed client service-worker caches.
- Concrete fix: Treat secret-bearing share routes as permissioned even though they are public. Exclude `/s/` and `/g/` from `networkFirstHtml`, or better, set a response header such as `x-gk-no-offline-cache: 1` on share pages and teach the SW to honor it. Add `sw-template-contract` coverage proving share HTML is not cached and update `CLAUDE.md` to document the permissioned-route exclusion.

### CRIT-C5-03 - Disabled semantic search still has an unmetered parse/config work path

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Perspectives: hidden assumption, operational risk, test/implementation interaction, abuse resistance
- Location/region:
  - `apps/web/src/app/api/search/semantic/route.ts:100-156` performs same-origin, maintenance, content-type, transfer-encoding, and optional `Content-Length` gates before charging the limiter.
  - `apps/web/src/app/api/search/semantic/route.ts:158-169` pre-increments the process-local semantic limiter before body materialization.
  - `apps/web/src/app/api/search/semantic/route.ts:171-207` reads and parses the body and validates the query.
  - `apps/web/src/app/api/search/semantic/route.ts:209-225` loads gallery config, then rolls back the limiter and returns 503 when mode is disabled.
  - `apps/web/src/__tests__/semantic-search-route.test.ts:208-218` explicitly locks this behavior: disabled mode increments and then rolls back the limiter.
  - `apps/web/src/lib/rate-limit.ts:312-352` implements the semantic limiter as a bounded in-process map, so rollback removes the only local accounting for this request path.
- Failure scenario: Semantic search is disabled by default or temporarily disabled during operations. A non-browser client can send same-origin-looking JSON requests with valid small bodies. Each request still pays the server cost of body read, JSON parse, query validation, and config lookup, then refunds the limiter token because the mode is disabled. Sustained traffic can create avoidable CPU/DB/config load while never accumulating semantic rate-limit pressure.
- Concrete fix: Move the semantic-mode check ahead of body materialization and limiter charging, immediately after the cheap header gates, so disabled mode fails without reading/parsing the body. If the config lookup is considered non-trivial, add a small disabled-mode limiter that is not rolled back. Update the test to assert disabled mode does not call `request.text()` and does not consume/rollback a semantic attempt, or explicitly charge disabled-mode attempts if rollback is retained.

## Final Missed-Issues Sweep

- Re-ran the review against current HEAD `8819d68a`; the worktree was clean before writing this artifact.
- Rechecked prior recurring topics and did not refile them as new findings: process-local single-writer assumptions, historical migration-journal non-monotonicity, stale `sw.js` stamp behavior for docs-only commits, semantic newest-model scan tradeoffs, admin API/action-origin scanner coverage, and privacy-field omission guards.
- Looked specifically for docs/tests/implementation disagreements. The three findings above are the remaining concrete mismatches with exact source evidence: private-original migration has destructive conflict behavior not covered by tests, share pages carry no-cache/secret semantics but are still eligible for offline HTML caching, and semantic disabled-mode tests encode a rollback that removes accounting after real work.
- Full `lint`, `typecheck`, `build`, and full Vitest were not run in this critic lane; targeted gates relevant to the reviewed risks passed as listed above.

Finding count: 3 total - 1 High, 2 Medium.

---

# Critic Review - Cycle 4

Role: `critic`
Scope: current HEAD only
HEAD: `0fa5beb1`
Timestamp: 2026-06-29 KST
Status: review artifact written for review-plan-fix cycle 4

## Inventory And Method

Required context read first:
- `AGENTS.md`
- `CLAUDE.md`
- `~/.agents/skills/code-review/SKILL.md`
- `.context/reviews/_aggregate.md`
- current `.context/reviews/architect.md`
- prior `.context/reviews/critic.md`
- `.context/plans/cycle-3-2026-06-29-plan.md`
- `.context/plans/cycle-3-2026-06-29-deferred.md`
- recent deferred/plan records including `plan/plan-365-run6-cycle11-fixes.md`, `plan/plan-366-run6-cycle11-deferred.md`, and `.context/deferred-cycle7-r2.md`

Repository inventory:
- 2,497 tracked files at current HEAD.
- 475 tracked TypeScript/TSX files under `apps/web/src`.
- 288 tracked files across the review-relevant app, component, library, script, e2e, and migration surfaces (`apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, `apps/web/scripts`, `apps/web/e2e`, `apps/web/drizzle`).
- Current route/action surface inventoried: 8 API route files and 12 server-action files.
- Current cycle-3 implementation commits reviewed: restore-maintenance guards, rate-limit scanner hardening, UI/e2e-adjacent label changes, upload-format copy, map fallback, Docker/Compose public mount change, and semantic constant split.

Review-relevant files examined by surface:
- Runtime/deploy: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/package.json`.
- Auth/origin/rate-limit gates: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/request-origin.ts`, public/admin API routes.
- Restore/upload/data paths: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`.
- Semantic/search surface: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-embedding-constants.ts`, `apps/web/src/components/search.tsx`, semantic route tests.
- UI/e2e surface: `apps/web/src/components/nav-client.tsx`, `apps/web/src/components/map/map-loader.tsx`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/e2e/nav-visual-check.spec.ts`, `apps/web/e2e/test-fixes.spec.ts`, client source-contract tests.
- Migration/schema/privacy docs: `apps/web/drizzle/meta/_journal.json`, migration journal tests, `apps/web/src/db/schema.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/lib/safe-json-ld.ts`, README/CLAUDE deployment guidance.

Validation evidence gathered:
- PASS `npm run lint:api-auth --workspace=apps/web`.
- PASS `npm run lint:action-origin --workspace=apps/web`.
- PASS `npm run lint:public-route-rate-limit --workspace=apps/web` against current route files.
- PASS targeted Vitest: `client-source-contracts.test.ts`, `map-thumb-wiring.test.ts`, `check-public-route-rate-limit.test.ts`, `semantic-search-route.test.ts`.
- Manual scanner proof: `checkPublicRouteSource(...)` accepts an unreachable `if (false) { preIncrementSemanticAttempt(...) }` fixture before `db.insert(...)`, returning `OK: route.ts (uses rate-limit helper)`.

Recurring-pattern handling:
- I did not re-file deferred cycle-3 architecture/performance items: semantic vector recall/windowed scan, process-local topology, upload quota scoped-claim refactor, timeline generated-column redesign, public-map scalability, topic mutable-natural-key migration, selector consolidation, auth helper layering, or storage abstraction cleanup.
- I did not re-file the old semantic missing-Content-Length streaming cap as a new finding; it remains a known historical/deferred body-size hardening issue. I did note that the route-level comment now overstates the protection, but the cleaner schedulable issue found this cycle is the rate-limit scanner partial-fix miss below.
- I rechecked fixed cycle-3 findings before excluding them: restore guards now exist for `bulkUpdateImages`, LR token create/revoke, and public analytics writes; upload picker no longer advertises `.arw`, `.heic`, `.heif`, or `.bmp`; Docker/Compose loopback and public-upload mount tests exist; map fallback source contract exists; semantic client constants were split.

## Findings

### CRIT-C4-01 - Public route rate-limit lint still accepts unreachable helper calls before mutation

Severity: Medium  
Confidence: High  
Risk type: Confirmed gate blind spot  
Validation status: Confirmed

Location/code region:
- `apps/web/scripts/check-public-route-rate-limit.ts:125-153`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:167-193`
- Cycle-3 plan expectation: `.context/plans/cycle-3-2026-06-29-plan.md:112-119`

Why this is a problem:
- Cycle 3 explicitly scheduled a fix for unreachable limiter calls and uncalled nested helper calls. The implementation closes nested function/callback cases by skipping function-like descendants, but it still treats any top-level statement containing a helper call as proof that the handler is charged.
- `inspectStatement()` marks `statementHasRateLimit = true` even when the call sits inside an unreachable branch such as `if (false) { ... }`; later mutation statements see `sawRateLimit = true`, so the scanner returns pass.
- The current tests cover nested functions and callbacks, but there is no `if (false)` / unreachable branch fixture despite the aggregate naming that exact failure scenario.

Concrete failure scenario:
- A future public mutating route is committed with:
  ```ts
  export async function POST() {
    if (false) preIncrementSemanticAttempt(ip, Date.now());
    await db.insert(rows).values({ ok: true });
  }
  ```
- `npm run lint:public-route-rate-limit --workspace=apps/web` passes, but the route mutates public state without charging a rate-limit bucket.

Concrete fix:
- Add fixtures for `if (false)`, `if (DEBUG_DISABLED)`, and branch-only helper calls before mutation.
- Make the scanner statement/control-flow aware enough to require an executable guard on all paths before the first known mutation, or fail closed for control-flow shapes it cannot prove. At minimum, do not let helper calls inside conditional blocks satisfy the gate unless the branch is the actual rate-limit early-return guard.

Evidence:
- Direct proof run against current scanner:
  ```json
  {
    "passed": ["OK: route.ts (uses rate-limit helper)"],
    "failed": []
  }
  ```
  for a fixture with `if (false) { preIncrementSemanticAttempt(...) }` before `db.insert(...)`.

### CRIT-C4-02 - Playwright nav specs still query the removed static theme-toggle accessible name

Severity: Medium  
Confidence: High  
Risk type: Confirmed test drift / CI failure risk  
Validation status: Confirmed by source inspection

Location/code region:
- `apps/web/src/components/nav-client.tsx:41-46`, `apps/web/src/components/nav-client.tsx:161-165`
- `apps/web/messages/en.json:608-612`
- `apps/web/e2e/test-fixes.spec.ts:24-40`
- `apps/web/e2e/nav-visual-check.spec.ts:66-76`

Why this is a problem:
- Cycle 3 correctly changed the theme button from a static label to a stateful label: `aria-label={themeAriaLabel}`, with English text `"Theme: {theme}. Switch to {nextTheme}."`.
- The Playwright specs still locate the button by the old exact accessible name `"Toggle theme"`.
- The old translation key remains in `en.json`, so string search alone can miss the drift, but the component no longer renders that key.

Concrete failure scenario:
- `npm run test:e2e --workspace=apps/web` runs the nav specs after the stateful-label change. The desktop checks execute `nav.getByRole('button', { name: 'Toggle theme' })`; the actual initial accessible name is `Theme: System. Switch to Light.`. The locator does not match, so the e2e suite fails even though the UI behavior is correct.

Concrete fix:
- Update e2e locators to use a regex such as `/^Theme: .* Switch to .*[.]$/`, or expose a stable test id only for test selection while keeping the accessible name stateful.
- Add one e2e assertion that the accessible name changes after clicking, which would make the test align with the product accessibility contract instead of the obsolete static label.
- Remove the unused `aria.toggleTheme` key if no caller remains, or keep it only if another visible UI still uses it.

Evidence:
- Source search found stale exact locators in `apps/web/e2e/test-fixes.spec.ts:24`, `:28`, `:40`, and `apps/web/e2e/nav-visual-check.spec.ts:74`.
- The component computes `themeAriaLabel` from `aria.cycleTheme`, and the initial English label resolves to `Theme: System. Switch to Light.`, not `Toggle theme`.

## Missed-Issues Sweep

Security posture:
- Admin API auth gate passed for both current admin API routes.
- Server-action same-origin gate passed for mutating actions, including the newly guarded `bulkUpdateImages`, LR token mutations, and restore paths.
- Public mutating route rate-limit lint passes against current route files; the finding above is about the scanner's future-regression blind spot, not an unmetered current route.
- Search enrichment selectors remain compile-guarded against `PrivacySensitiveKeys`; no public PII leak was found in semantic/similar result enrichment.
- JSON-LD emitters continue to route through `safeJsonLd` / sanitized paths in inspected public pages.

Operator/deploy posture:
- Docker/Compose loopback binding is now source-tested.
- The public mount change now mounts only `./public/uploads`; `entrypoint.sh` chowns that bind mount before dropping to `node`, so I did not file a write-permission issue.
- Nginx LR upload exception, upload proxying, and body caps are tested in `nginx-config.test.ts`.

Product/UX posture:
- The map dynamic chunk fallback exists and is localized via a prop.
- The upload picker format list now aligns better with runtime-supported first-class browser uploads.
- The stateful theme label improves accessibility, but stale e2e selectors now need to follow it.

Known deferred items not re-filed:
- Timeline/year/on-this-day sargability and calendar timezone semantics.
- Semantic/similar search newest-first scan recall and request-path vector architecture.
- CLIP embedding queue/backpressure.
- Process-local topology enforcement.
- Upload quota scoped-claim refactor.
- Visual snapshot baseline policy for nav artifacts.

Coverage statement:
- This was a repository-wide skeptical review of current HEAD with line-level inspection of the changed cycle-3 surfaces plus high-risk cross-file invariants. Generated/binary/image assets, `node_modules`, live production, and destructive/external operations were not exercised. Full `lint`, `typecheck`, `build`, full Vitest, and e2e were not run; targeted tests and lint gates listed above were run to ground the findings.

Finding count: 2 total — 2 Medium, 0 High/Critical.

---

# Critic Review - Cycle 3

Role: `critic`
Scope: current HEAD only
HEAD: `3f24038b04f48c73f5dac079cd3276fecbd48282`
Timestamp: 2026-06-29 13:21:36 KST
Status: review artifact written for review-plan-fix cycle 3

## Inventory And Method

Required context read first:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/_aggregate.md`
- existing `.context/reviews/critic.md`
- `.context/plans/cycle-2-2026-06-29-plan.md`
- `.context/plans/cycle-2-2026-06-29-deferred.md`
- `.context/plans/user-injected/pending-next-cycle.md`
- `.context/plans/README.md`

Repo inventory:
- 756 tracked files at current HEAD.
- 482 files under `apps/web/src`.
- 2230 review/plan files under `.context/reviews` and `.context/plans` were inventoried by path, with the current aggregate, critic, active/deferred plans, and pending user-injected plan read for recurring-pattern routing.

Relevant implementation surfaces reviewed:
- Runtime/deploy edge: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `.dockerignore`, `scripts/deploy-remote.sh`.
- Auth/origin/rate limits: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/proxy.ts`, admin and public API routes.
- Upload/restore/data paths: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/data.ts`.
- Timeline/search/semantic surfaces: `apps/web/src/lib/data-timeline.ts`, `apps/web/src/components/on-this-day-widget.tsx`, `apps/web/src/components/search.tsx`, semantic and similar search API routes, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/image-queue.ts`, schema indexes.
- Test and lint gates: API-auth/action-origin/public-route scanners, nginx config tests, Playwright specs, upload/header tests, semantic route tests, privacy/touch-target conventions.

Validation evidence gathered during this pass:
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Static line-numbered inspection was performed for every cited region below.

Recurring-pattern handling:
- I did not repeat prior fixed claims about `.claude` leaking into Docker context, SQL restore re-injection, semantic disabled-route charging, production semantic empty-index handling, per-photo OG fallback origin trust, nginx upload proxy rooting, or focus-visible scanner path handling.
- Deferred cycle-2 risks were rechecked against current code before being carried forward. Where still current, this report marks them as confirmed or likely rather than treating the prior cycle as proof.

## Findings

### CRIT-C3-01 - Timeline and On-This-Day queries remain non-sargable, and one comment now states the opposite

Severity: Medium
Confidence: High
Risk type: Confirmed
Perspectives: product correctness, documentation honesty, performance, maintainability

Evidence:
- `apps/web/src/lib/data-timeline.ts:88-94` says `MONTH() + DAY()` keeps the query within the `(processed, capture_date)` index prefix and avoids a full table scan.
- `apps/web/src/lib/data-timeline.ts:95-114` implements `getOnThisDayImages()` with `MONTH(capture_date)` and `DAY(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:127-140` implements timeline years with `YEAR(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:176-205` implements yearly/monthly timeline pages with `YEAR(capture_date)` and optional `MONTH(capture_date)`.
- `apps/web/src/db/schema.ts:111-117` indexes `processed`, `capture_date`, and `processed_capture_date`, but has no generated month/day/year columns or functional index that would make those function predicates sargable.

Concrete failure scenario:
- A larger gallery grows to tens or hundreds of thousands of processed images. The home page On-This-Day widget and public timeline pages repeatedly evaluate functions over many `capture_date` rows. Operators see the comment at `data-timeline.ts:88-94` and assume the query shape is already index-friendly, so the issue is not prioritized until public pages become slow.

Fix:
- First make the documentation honest: replace the `MONTH() + DAY()` index-prefix claim with an explicit note that this is non-sargable and acceptable only at current personal-gallery scale.
- Then fix the query shape: use range predicates for year pages, and add generated/stored `capture_month` and `capture_day` columns plus a composite index such as `(processed, capture_month, capture_day, capture_date)` for On-This-Day. Add migration, schema update, reconciliation path, and query-plan regression coverage.

### CRIT-C3-02 - Semantic search still scans a newest-first capped candidate set, so older relevant photos can be unreachable

Severity: Medium
Confidence: High
Risk type: Confirmed
Perspectives: product correctness, UX, performance, architecture

Evidence:
- `apps/web/src/app/api/search/semantic/route.ts:240-249` selects embeddings ordered by newest images and caps the scan with `SEMANTIC_SCAN_LIMIT`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-150` uses the same newest-first capped scan for similar-photo search.
- `apps/web/src/lib/clip-embeddings.ts:39-40` makes `SEMANTIC_SCAN_LIMIT` an env-tunable cap with a default of 2000.
- `apps/web/src/db/schema.ts:282-285` indexes image embeddings by `(model_version, updated_at)` but does not provide any vector index or recall-preserving nearest-neighbor strategy.

Concrete failure scenario:
- A production gallery has 15,000 embedded images. A visitor searches for a rare older image that is outside the newest 2000 embeddings. The route returns no result or a weaker newer result even though a high-similarity match exists in the database. Raising `SEMANTIC_SCAN_LIMIT` increases DB transfer and CPU work on the request path instead of fixing recall.

Fix:
- Move semantic retrieval off request-path brute force: add a real vector search backend/index, or build an offline/worker-maintained candidate index with recall-aware pagination.
- Until then, surface an operator warning when total eligible embeddings exceed `SEMANTIC_SCAN_LIMIT`, and make public UI copy honest that search covers only the scanned candidate window.

### CRIT-C3-03 - Process-local state remains a scale-out and restart correctness boundary

Severity: Medium
Confidence: High
Risk type: Likely
Perspectives: operator safety, architecture, security posture, product correctness

Evidence:
- `apps/web/src/lib/restore-maintenance.ts:1-18` stores restore-maintenance state in `globalThis`.
- `apps/web/src/lib/restore-maintenance.ts:44-56` begins/ends maintenance by toggling that process-local boolean.
- `apps/web/src/lib/upload-tracker-state.ts:7-20` stores upload quota windows in a `globalThis` `Map`.
- `apps/web/src/lib/data.ts:12-33` stores shared-group view-count buffers and retry counters in module-level maps.
- `apps/web/src/lib/rate-limit.ts:314-318` stores semantic rate-limit counters in a process-local bounded map.
- `apps/web/docker-compose.yml:14-21` documents a single host-networked app behind host nginx, but the code does not actively reject accidental multi-process or multi-replica deployment.

Concrete failure scenario:
- An operator starts a second app process during maintenance or a future deployment moves to two replicas. One process enters restore maintenance while the other still accepts uploads. Upload quotas, semantic rate limits, and view-count buffers split across processes; rate limits are easier to bypass and maintenance protection is inconsistent.

Fix:
- Make the single-instance contract executable: add a startup guard or deployment health check that fails if more than one writer process is active, or move these state machines to shared storage with DB/Redis-backed locks, counters, and queues.
- Document which process-local states are intentional and add tests around the startup/deploy guard so future orchestration changes cannot silently widen the topology.

### CRIT-C3-04 - The direct-exposure hardening fix has no regression guard

Severity: Medium
Confidence: High
Risk type: Confirmed
Perspectives: operator safety, security posture, test strategy

Evidence:
- `apps/web/Dockerfile:83-84` sets `PORT=3000` and `HOSTNAME="127.0.0.1"`.
- `apps/web/docker-compose.yml:14-21` uses host networking and sets `HOSTNAME: 127.0.0.1`.
- `apps/web/nginx/default.conf:1-4`, `apps/web/nginx/default.conf:56-60`, `apps/web/nginx/default.conf:72-76`, and `apps/web/nginx/default.conf:131-150` contain the intended host-nginx rate/body-limit envelope.
- `apps/web/src/__tests__/nginx-config.test.ts:7-36` asserts nginx hardening details, but it does not assert that the app binds only to loopback under Docker/Compose.
- A current repo search for `direct-exposure` and `HOSTNAME` found docs/plans/config only; there is no dedicated test such as `direct-exposure-guard.test.ts`.

Concrete failure scenario:
- A future Dockerfile or compose edit drops `HOSTNAME=127.0.0.1` or sets it to `0.0.0.0`. The container again listens directly on the host network, bypassing nginx rate limits, upload body limits, HSTS/header policy, and proxy header normalization. Current nginx tests still pass because nginx remains configured correctly.

Fix:
- Add a static regression test that reads `apps/web/Dockerfile` and `apps/web/docker-compose.yml` and asserts loopback binding for the production runner and compose service.
- Consider a runtime startup assertion in production that refuses host-network startup unless the configured bind host is loopback, with a documented explicit override for local diagnostics.

### CRIT-C3-05 - Upload quota settlement relies on a manually maintained invariant across many awaited branches

Severity: Medium
Confidence: Medium
Risk type: Likely
Perspectives: maintainability, operator safety, product correctness

Evidence:
- `apps/web/src/app/actions/images.ts:224-228` pre-claims upload count/bytes before disk, topic, file, DB, and cleanup work.
- `apps/web/src/app/actions/images.ts:233-250` manually rolls back the claim for disk pre-check failures.
- `apps/web/src/app/actions/images.ts:257-265` documents that every await between claim and final settlement must roll back on throw.
- `apps/web/src/app/actions/images.ts:266-278` manually catches and rolls back topic lookup failures.
- `apps/web/src/app/actions/images.ts:507-522` documents another post-claim await whose safety depends on `deleteOriginalUploadFile()` never rejecting.
- `apps/web/src/app/actions/images.ts:540-564` performs final settlement only after the file loop.
- `apps/web/src/app/actions/images.ts:590-592` has an outer `finally`, but it releases only the upload contract lock and does not settle the quota claim.

Concrete failure scenario:
- A future maintainer adds a new awaited validation or cleanup between the pre-claim and final settlement, and that path returns or throws without calling `settleUploadTrackerClaim()`. The admin/IP upload window is inflated until expiry even though no files were accepted, producing confusing "limit reached" failures during a live upload session.

Fix:
- Replace the informal invariant with a scoped claim object, for example `const claim = uploadTracker.claim(...)`, whose `finally` automatically settles or rolls back unless explicitly committed.
- Add a focused regression test that injects a failure after the quota claim and verifies the tracker is restored.

### CRIT-C3-06 - Client search imports a server-oriented CLIP module that reads process env at module scope

Severity: Low
Confidence: High
Risk type: Confirmed
Perspectives: maintainability, architectural coherence, bundle hygiene

Evidence:
- `apps/web/src/components/search.tsx:1` marks the file as a client component.
- `apps/web/src/components/search.tsx:19` imports `SEMANTIC_TOP_K_DEFAULT` from `@/lib/clip-embeddings`.
- `apps/web/src/lib/clip-embeddings.ts:18-40` parses server env values and references `process.env` at module scope, while the same file also contains Buffer-based embedding encode/decode helpers at `apps/web/src/lib/clip-embeddings.ts:85-149`.
- The module comment at `apps/web/src/lib/clip-embeddings.ts:4` says it is safe for server-only lib modules, not browser components.

Concrete failure scenario:
- A future edit exports another helper from `clip-embeddings.ts` or changes bundling behavior, pulling Buffer-heavy or process-env logic into the client search bundle. The client only needs a display/default value, but it is coupled to server semantic internals.

Fix:
- Move shared UI-safe constants such as `SEMANTIC_TOP_K_DEFAULT` into a small `clip-constants` or `semantic-search-shared` module with no `process`, `Buffer`, or server-only imports.
- Keep `clip-embeddings.ts` server-only and add an import-boundary lint/test so client components cannot import it.

### CRIT-C3-07 - Visual Playwright screenshots are artifacts, not visual regression assertions

Severity: Low
Confidence: High
Risk type: Manual-validation risk
Perspectives: UX, test strategy, documentation honesty

Evidence:
- `apps/web/e2e/nav-visual-check.spec.ts:22-35` now asserts touch-target size and non-overlap for navigation, so this is not the old "no assertions at all" finding.
- `apps/web/e2e/nav-visual-check.spec.ts:49`, `apps/web/e2e/nav-visual-check.spec.ts:63`, and `apps/web/e2e/nav-visual-check.spec.ts:76` still call `page.screenshot({ path: ... })` without `expect(page).toHaveScreenshot(...)` or another automated visual comparison.

Concrete failure scenario:
- A CSS change makes the navigation visually misaligned, low contrast, or cramped while preserving 44 px targets and non-overlap. CI still passes; the only evidence is an updated screenshot artifact that nobody is required to compare.

Fix:
- Either convert these captures to Playwright visual snapshots with a tight threshold, or rename/scope the spec as manual artifact capture and add DOM/CSS assertions for the visual invariants the project actually wants to enforce.

### CRIT-C3-08 - Calendar features depend on server/runtime timezone interpretation of stored capture dates

Severity: Low
Confidence: Medium
Risk type: Likely
Perspectives: product correctness, UX, documentation honesty

Evidence:
- `apps/web/src/components/on-this-day-widget.tsx:15-17` derives today's month/day from `new Date()` on the server.
- `apps/web/src/components/on-this-day-widget.tsx:51-52` derives the displayed capture year with `new Date(photo.capture_date).getFullYear()`.
- `apps/web/src/lib/data-timeline.ts:233-241` groups Year-in-Review months with `new Date(img.capture_date).getMonth() + 1`.
- `CLAUDE.md` documents the app's photo-color/HDR intent carefully, but the calendar semantics for timezone-less EXIF/MySQL dates remain an implementation convention rather than an explicit product contract.

Concrete failure scenario:
- The server runs in a timezone different from the photographer/viewer, or a stored MySQL `DATETIME` is parsed differently by Node. On-This-Day can show yesterday/tomorrow's anniversary near midnight, and Year-in-Review can place photos in the wrong month for dates near UTC boundaries.

Fix:
- Define the product timezone contract explicitly: gallery-local timezone, server timezone, or pure stored-date semantics.
- For photo capture dates, avoid `new Date()` where only calendar parts are needed. Extract year/month/day from the stored `YYYY-MM-DD` portion or add normalized date-part columns and query/render those consistently.

## Missed-Issues Sweep

Security posture:
- Admin API scanner passed; current admin API exports are wrapped by `withAdminAuth(...)`.
- Mutating server-action same-origin scanner passed.
- Public mutating route rate-limit scanner passed.
- Rechecked public share/group and OG routes for known prior issues; prior same-origin/rate-limit/host-trust claims appear fixed and are not repeated here.

Operator safety:
- Nginx body-limit and proxy-header hardening tests exist and passed by inspection.
- The remaining operator risk is not the nginx config itself; it is that the application binding and single-instance assumptions are not enforced as executable deployment contracts.

Maintainability and architecture:
- The most fragile current pattern is still comment-enforced invariants: upload quota settlement and process-local topology assumptions.
- The clearest layer leak is the client import of `clip-embeddings.ts`.

UX/product:
- Current high-risk UX issues are search recall honesty and calendar/date semantics. The nav visual spec has useful geometry assertions but does not enforce visual snapshots.

Documentation honesty:
- The timeline query comment is actively misleading relative to the SQL shape.
- Existing CLIP comments are unusually explicit about stub/prod model honesty; the remaining semantic honesty gap is result-window coverage once the corpus exceeds the scan cap.

## Finding Count

Total findings: 8
- Confirmed: 5
- Likely: 2
- Manual-validation risk: 1
