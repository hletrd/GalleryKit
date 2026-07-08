# Run-10 Cycle 34 Critic Review

Date: 2026-07-08 KST
Role: `critic`
Review HEAD: `53476e5d2454c9fb66f779cd33e6404913cf9ab5`
Scope: skeptical whole-repo critique across product constraints, reliability, correctness, operator safety, maintainability, UX, and test evidence. Review-only; no implementation changes.

## Inventory First

I read `AGENTS.md` and `CLAUDE.md` before judging code. I inventoried the repository with `rg --files`, then focused on source/config/docs that can affect production behavior. Generated/runtime payloads were out of scope unless they are committed contract artifacts such as `public/sw.js`.

Relevant source/doc/test inventory:

- Control docs and runbooks: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.context/plans`, `.context/reviews`, `plan/`.
- App surfaces: 81 files under `apps/web/src/app`, including public pages, admin pages, server actions, API routes, metadata/OG routes, and DB restore actions.
- Shared code: 115 files under `apps/web/src/lib`, including auth/session/PAT, origin/rate-limit, image processing, upload/file serving, queue/backfill, restore maintenance, pending deletions, semantic search/CLIP, service worker, data privacy projections, and config parsing.
- Data/ops: `apps/web/src/db`, all `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/scripts/*`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `.github/workflows/*`.
- Tests: 368 files under `apps/web/src/__tests__`, plus `apps/web/e2e`, lint guard scripts, CI workflow gates, and CLIP preflight workflow.

Validation evidence from this lane:

- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed.
- Targeted tests passed: `npm test --workspace=apps/web -- --run src/__tests__/images-actions.test.ts src/__tests__/lr-upload-route-behavior.test.ts src/__tests__/db-restore.test.ts src/__tests__/sw-template-contract.test.ts` passed 76 tests.

Not rerun here: full `npm run lint`, `npm run build`, full `npm test`, `npm run audit:prod`, and Playwright e2e. CI defines those as blocking gates in `.github/workflows/quality.yml:54-83`.

## Confirmed Findings

### CRIT34-01 - Browser upload rethrows a post-quota topic lookup failure instead of returning a structured action error

- Severity: Medium
- Confidence: High
- Status: Confirmed reliability/UX defect
- Region: `apps/web/src/app/actions/images.ts:217-274`, `apps/web/src/app/actions/images.ts:608-610`, `apps/web/src/app/api/admin/lr/upload/route.ts:283-297`, `apps/web/src/__tests__/images-action-toctou-claim.test.ts:68-79`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:321-330`.

Why this is a problem:

`uploadImages()` synchronously claims the admin/IP upload quota at `apps/web/src/app/actions/images.ts:217-227`, then performs awaited disk and topic checks. The topic lookup catch at `apps/web/src/app/actions/images.ts:271-274` correctly settles the quota claim, but then `throw err` escapes the server action. The only outer cleanup is the `finally` that releases the upload-processing lock at `apps/web/src/app/actions/images.ts:608-610`; there is no action-level catch converting this transient DB failure into `{ error: ... }`.

The Lightroom upload route handles the same failure more safely: it settles the claim, logs, and returns a JSON 500 at `apps/web/src/app/api/admin/lr/upload/route.ts:283-297`. The browser path instead pushes an expected transient infrastructure fault into Next.js's server-action exception path. Worse, the source-contract test pins the rethrow shape at `apps/web/src/__tests__/images-action-toctou-claim.test.ts:68-79`, while the LR test pins structured JSON behavior at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:321-330`.

Concrete failure scenario:

An admin starts a browser upload while MySQL restarts or the pool times out between the quota claim and the topic existence query. The claim is rolled back, but the action throws. The upload UI receives a framework-level failure instead of a localized recoverable upload error, so the admin sees a generic crash/error state or loses clean per-file feedback even though no file was accepted.

Fix:

Keep the `settleClaim(0, 0)` call, but replace `throw err` with a logged structured return such as `{ error: t('failedToFetchGallerySettings') }` or a dedicated localized upload-temporarily-unavailable message. Update `images-action-toctou-claim.test.ts` so it asserts settlement plus structured return, not settlement plus rethrow. Add a behavior test in `images-actions.test.ts` that mocks the topic select rejection and asserts the action resolves with `{ error: ... }`, does not call `saveOriginalAndGetMetadata`, and releases the upload lock.

### CRIT34-02 - Browser and Lightroom upload ingestion still duplicate a critical privacy/color pipeline

- Severity: Medium
- Confidence: High
- Status: Confirmed maintainability/correctness risk
- Region: `apps/web/src/app/actions/images.ts:87-610`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-633`, `apps/web/src/app/actions/images.ts:397-516`, `apps/web/src/app/api/admin/lr/upload/route.ts:204-214`, `apps/web/src/app/api/admin/lr/upload/route.ts:327-345`, `apps/web/src/app/api/admin/lr/upload/route.ts:398-427`, `apps/web/src/app/api/admin/lr/upload/route.ts:550-586`.

Why this is a problem:

The browser upload action and Lightroom/PAT route independently implement the same ingest lifecycle: quota claim/settle, upload-processing contract lock, topic verification, disk preflight, original save, HDR rejection, GPS stripping, EXIF/color normalization, insert value construction, queue job construction, audit, and revalidation. The LR file contains repeated parity comments documenting prior drift fixes: filename sanitation parity at `route.ts:204-214`, disk precheck parity at `route.ts:327-345`, HDR/GPS parity at `route.ts:398-427`, and queue-setting/color parity at `route.ts:550-586`. The browser insert/enqueue contract at `apps/web/src/app/actions/images.ts:397-516` is the parallel shape that future changes must remember to mirror.

Concrete failure scenario:

A future admin-only color/HDR field or processing setting is added to the browser insert/enqueue block at `apps/web/src/app/actions/images.ts:397-516`, but the LR route's duplicate payload at `apps/web/src/app/api/admin/lr/upload/route.ts:550-586` is missed. Browser uploads then preserve the photographer-intent setting while external publish uploads silently omit it until a backfill repairs rows, causing source-dependent public rendering differences.

Fix:

Extract a shared ingest service after route-specific auth and form parsing. The service should own config snapshotting, topic verification, disk preflight, original save, HDR/GPS policy, EXIF/color normalization, insert values, queue job values, and post-commit bookkeeping. Keep the browser action and LR route as adapters for localization, auth/PAT context, and HTTP status. Add behavior tests proving both adapters produce the same insert/enqueue contract for representative JPEG, HDR-rejected, GPS-stripped, RAW-rejected, and processing-setting cases.

## Likely Risks

### CRIT34-03 - Source-contract tests encode implementation shapes strongly enough to preserve defects

- Severity: Low
- Confidence: Medium
- Status: Likely maintainability/test-design risk
- Region: `apps/web/src/__tests__/images-action-toctou-claim.test.ts:68-79`, `apps/web/src/__tests__/cycle-22-source-contracts.test.ts:125-138`, `apps/web/src/__tests__/sw-template-contract.test.ts:13-15`, `apps/web/src/__tests__/sw-template-contract.test.ts:60-88`, `apps/web/src/__tests__/sw-template-contract.test.ts:171-214`.

Why this is a problem:

Some source-contract tests intentionally guard brittle cross-file invariants, which is appropriate for the service worker template and generated worker parity. The risk is that the same style is also used where a behavior test would be safer. `images-action-toctou-claim.test.ts:68-79` requires `settleClaim(0, 0); throw err;`, preserving CRIT34-01's bad browser-action error surface. `cycle-22-source-contracts.test.ts:125-138` checks broad source snippets around the same upload claim region rather than a failing DB-select behavior. The service-worker suite is explicit about template/source drift at `sw-template-contract.test.ts:13-15`, and its checks at `sw-template-contract.test.ts:60-88` and `171-214` are reasonable because the shipped template cannot import the reference implementation directly.

Concrete failure scenario:

A developer fixes the browser upload path to return a structured error after a topic lookup failure. The behavior is better, but the source-contract test fails because the implementation no longer rethrows. Under time pressure, the developer may keep the rethrow to satisfy the test rather than updating the contract to assert the actual safety property.

Fix:

Keep source contracts only where import/runtime constraints force them. For server-action and route logic, prefer mocked behavior tests that assert externally visible outcomes and side effects: quota settled, no file saved, lock released, localized error returned. Where a source contract remains, make it assert semantic ingredients and explicitly avoid pinning harmful control flow such as `throw err`.

## Manual-Validation Risks

### CRIT34-04 - Public-page and Next image rate limiting depends on manually applied host nginx, but deploy does not verify it

- Severity: High if the deployed host has stale nginx; otherwise Low
- Confidence: High for the manual gap, unknown for current production state
- Status: Manual-validation risk
- Region: `CLAUDE.md:245-249`, `CLAUDE.md:514-526`, `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:246-295`, `apps/web/deploy.sh:51-55`, `apps/web/deploy.sh:99-104`.

Why this is a problem:

The app deliberately relies on edge-level nginx rate limiting for dynamic public SSR pages. `CLAUDE.md:245-249` documents the single-writer topology and says public pages are throttled at nginx, not app-layer. The committed nginx template defines `zone=public` and `zone=nextimage` at `apps/web/nginx/default.conf:1-19`, applies the Next image limiter at `apps/web/nginx/default.conf:246-263`, and applies the public catch-all limiter at `apps/web/nginx/default.conf:274-295`. The same template warns that real-IP handling is topology-sensitive at `apps/web/nginx/default.conf:20-29` and `59-71`.

But deploy only rebuilds/restarts the app container at `apps/web/deploy.sh:51-55` and prunes Docker at `apps/web/deploy.sh:99-104`. `CLAUDE.md:514-526` explicitly says deploys do not touch host nginx and that a committed config change is inert until an operator applies and verifies it.

Concrete failure scenario:

A cycle marks public SSR rate limiting or `/_next/image` flood protection as fixed because `apps/web/nginx/default.conf` is committed and tests pass. The production host still runs an older nginx config, or sits behind a load balancer without realip configuration. Public dynamic pages remain unthrottled, or all visitors share the load balancer's single nginx bucket and legitimate traffic gets 429s.

Fix:

Add a deploy-time read-only verification step that inspects the live host nginx config (`nginx -T` or an operator-owned equivalent) for required zones, locations, and real-IP topology. Fail or loudly warn before declaring deploy complete when the expected limiter blocks are absent. Longer-term, move nginx config into managed deployment automation so `npm run deploy` can apply/test/reload it safely, or record a signed/manual host verification artifact per cycle.

### CRIT34-05 - Production semantic search activation still has a host-weight/manual preflight gap

- Severity: Medium
- Confidence: Medium
- Status: Manual-validation/operator-safety risk
- Region: `CLAUDE.md:558-620`, `apps/web/package.json:21-24`, `.github/workflows/clip-preflight.yml:3-45`, `.github/workflows/quality.yml:54-83`, `apps/web/src/lib/gallery-config.ts:64-69`, `apps/web/src/lib/gallery-config.ts:123-126`, `apps/web/src/app/actions/settings.ts:102-104`, `apps/web/src/app/api/search/semantic/route.ts:186-201`, `apps/web/src/app/api/search/semantic/route.ts:247-260`.

Why this is a problem:

The production semantic-search code is deliberately operator-gated: `gallery-config.ts:64-69` documents that stored `production` heals to `disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, and `gallery-config.ts:123-126` implements that gate. The Settings UI rejects saving `production` at `apps/web/src/app/actions/settings.ts:102-104`; activation requires env + DB row + weights. The public semantic route returns 503 unless mode is `stub` or `production` at `apps/web/src/app/api/search/semantic/route.ts:186-201`, then production embedding failures return 503 at `route.ts:247-260`.

The risk is operational, not type-level. `CLAUDE.md:558-620` says model weights are not baked into the image, must be seeded on the deploy host, and the env-gated integration suites are the only real offline-load proof before flipping the DB row. The package has a local preflight script at `apps/web/package.json:21-24`, and GitHub has a manual/scheduled workflow at `.github/workflows/clip-preflight.yml:3-45`. Main CI does not run this; `.github/workflows/quality.yml:54-83` runs standard gates only.

Concrete failure scenario:

An operator sets `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` and flips `admin_settings.semantic_search_mode='production'` after a normal deploy, but the host bind-mounted `/app/data/models/clip` is missing, stale, or seeded under a different path. CI stays green because it never proves the deployed host's weights. Visitors see the semantic UI as production-enabled, but semantic searches fail with 503 on first real encoder load.

Fix:

Before allowing or documenting production activation as complete, require a host-side preflight against the same env file and bind mount the running container will use. The safest shape is a deploy/activation check that runs `npm run test:clip:preflight --workspace=apps/web` or a smaller encoder-load probe inside a sidecar with `CLIP_MODELS_ROOT=/app/data/models/clip` and `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`. Surface the result in deploy logs or an admin health/status warning so a DB-row flip cannot silently outrun host readiness.

## Product And UX Notes

No confirmed product-constraint breach was found in this pass. The repo still states the photographer-intent boundary clearly: no edit/culling/scoring features, and photos arrive after editing (`CLAUDE.md:305-307`). The public semantic search and similar-photo features are search/discovery surfaces, not scoring/culling, and similar photos are gated to production semantic mode (`apps/web/src/app/api/search/similar/[id]/route.ts:14-20`, `apps/web/src/components/similar-photos.tsx:50-58`, `apps/web/src/components/similar-photos.tsx:141` from the repo search sweep). The main UX concern I confirmed is CRIT34-01: browser upload transient DB failures can escape as framework errors instead of recoverable localized action errors.

## Final Sweep

Common missed-issue checks and result:

- Admin API auth wrappers: passed `lint:api-auth`.
- Mutating server-action same-origin guards: passed `lint:action-origin`.
- Public mutating/expensive route rate-limit guards: passed `lint:public-route-rate-limit`.
- Type-level privacy/schema/test compilation: passed `typecheck`.
- Restore drain/maintenance, upload tracker, LR upload behavior, and service-worker template contracts: targeted tests passed.
- Migration runbook/schema dual-write rule is documented in `AGENTS.md:25-31` and `CLAUDE.md:467-489`; no new migration was authored in this lane.
- Deploy disk-prune safety was inspected at `apps/web/deploy.sh:79-104`; no code change made.
- Existing unrelated dirty file observed: `.context/reviews/perf-reviewer.md`; not touched.

Residual risk:

This was a critic-lane review, not a release certification. Full lint/build/audit/e2e and production host validation remain necessary before claiming deploy safety. The highest-value next fix is CRIT34-01 because it is narrow, user-visible, and currently preserved by a source-contract test.
