# Cycle 7 Aggregate Review

Date: 2026-07-07
Repo HEAD reviewed: `cae5fbd9b88f193a815bc91c1e41df2833094fd7`

## Agent Coverage

Callable subagent roles available in this environment were `default`, `explorer`, and `worker`; the named review roles requested by the prompt were not separately registered as callable agent types. To obey the concurrency cap while preserving the requested review perspectives, six review lanes were used. The UI/product lane was retried once after the active-agent limit was reached.

- `code-reviewer` -> `.context/reviews/code-reviewer.md`
- `architect` -> `.context/reviews/architect.md`
- `security-reviewer` -> `.context/reviews/security-reviewer.md`
- `debugger` -> `.context/reviews/debugger.md`
- `perf-reviewer` -> `.context/reviews/perf-reviewer.md`
- `tracer` -> `.context/reviews/tracer.md`
- `verifier` -> `.context/reviews/verifier.md`
- `test-engineer` -> `.context/reviews/test-engineer.md`
- `critic` -> `.context/reviews/critic.md`
- `document-specialist` -> `.context/reviews/document-specialist.md`
- `designer` -> `.context/reviews/designer.md`
- `product-marketer-reviewer` -> `.context/reviews/product-marketer-reviewer.md`

Additional reviewer-style agents found locally: `product-marketer-reviewer` and `ui-ux-designer-reviewer`. The product-marketer perspective was included and adapted to GalleryKit. UI/UX was included because this is a web UI repo.

## Validation Evidence From Review Lanes

- `npm run lint:api-auth --workspace=apps/web`: passed in multiple lanes.
- `npm run lint:action-origin --workspace=apps/web`: passed in multiple lanes.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed in multiple lanes.
- `npm run lint --workspace=apps/web`: passed in verifier/test lane.
- `npm run typecheck --workspace=apps/web`: passed in verifier/test lane.
- `npm test --workspace=apps/web`: passed in verifier/test lane, 3132 passed / 4 skipped.
- Targeted semantic/storage/migration/deploy/security/UI test subsets passed in specialist lanes.
- `npm audit --workspace=apps/web --audit-level=moderate --json`: failed with 6 moderate advisories.

## Deduped Findings

### AGG-C7-01 - Topic deletion leaves smart-collection topic predicates stale

- Original findings: `CR-C7-01`, `ARCH-C7-01`
- Cross-agent agreement: code-reviewer + architect
- Severity: Medium
- Confidence: High
- Status: confirmed correctness/design issue
- Citations: `apps/web/drizzle/0009_smart_collections.sql:6-14`, `apps/web/src/lib/smart-collections.ts:432-440`, `apps/web/src/app/actions/topics.ts:316-349`, `apps/web/src/app/actions/topics.ts:448-462`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:90-111`, `apps/web/src/app/actions/public.ts:219-233`
- Scenario: a public smart collection with `topic eq "travel"` survives topic deletion and silently becomes empty after the topic row is removed.
- Suggested fix: share the rename parser/remapper lifecycle with deletion, then block deletion or mark/update affected collections with an audit trail; add tests for `topic eq` and `topic in`.

### AGG-C7-02 - Shared-group reads hide denormalized view-count writes behind a cached getter

- Original findings: `CR-C7-02`, `ARCH-C7-02`
- Cross-agent agreement: code-reviewer + architect
- Severity: Low
- Confidence: High
- Status: confirmed maintainability/coupling risk
- Citations: `apps/web/src/lib/data.ts:1331-1407`, `apps/web/src/lib/data.ts:1793-1797`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`
- Scenario: a future read-only caller uses `getSharedGroupCached()` and unexpectedly increments a group view counter.
- Suggested fix: split pure shared-group reads from explicit view-event writes; cache only the pure read.

### AGG-C7-03 - Moderate dependency advisories remain in the app dependency graph

- Original finding: `SEC-B-01`
- Severity: Medium
- Confidence: High
- Status: confirmed dependency/security issue
- Citations: `apps/web/package.json:57`, `apps/web/package.json:77`, `apps/web/package.json:80`, `package-lock.json:764-782`, `package-lock.json:9334-9352`
- Scenario: vulnerable dev/build tooling paths remain present through nested `esbuild` and `postcss` dependencies; audit is red even though no direct production exploit path was found.
- Suggested fix: update upstream packages when patched, rerun audit, and avoid `npm audit fix --force`.

### AGG-C7-04 - Production CSP still allows inline styles

- Original finding: `SEC-B-02`
- Severity: Low
- Confidence: Medium
- Status: likely hardening issue
- Citations: `apps/web/src/lib/content-security-policy.ts:138-155`
- Scenario: a future style-injection bug could enable UI redress because `style-src` includes `'unsafe-inline'`.
- Suggested fix: keep the allowance documented until inline style needs can move to static classes, nonces, or hashes.

### AGG-C7-05 - TLS termination depends on live edge topology

- Original finding: `SEC-B-03`
- Severity: Conditional High
- Confidence: Medium
- Status: manual-validation security risk
- Citations: `apps/web/nginx/default.conf:46-57`, `apps/web/nginx/default.conf:90-97`
- Scenario: if the shipped nginx listener is exposed directly over HTTP, admin/session traffic can cross the network unencrypted.
- Suggested fix: validate public HTTP->HTTPS behavior and edge TLS termination; add a 443 server block only if this nginx is the public edge.

### AGG-C7-06 - Proxy trust and per-IP rate limits require live topology validation

- Original findings: `SEC-B-04`, related to `DBG-B-03`
- Cross-agent agreement: security-reviewer + debugger
- Severity: Medium
- Confidence: Medium
- Status: manual-validation security/ops risk
- Citations: `apps/web/src/lib/rate-limit.ts:175-205`, `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:59-71`
- Scenario: behind a load balancer or wrong trusted-hop setting, many visitors can collapse into one bucket or spoofed headers can skew app-side attribution.
- Suggested fix: validate the deployed chain with spoofed forwarded headers and real client traffic; configure `realip`/PROXY protocol and `TRUSTED_PROXY_HOPS` to match.

### AGG-C7-07 - Historical secret rotation cannot be proven from source

- Original finding: `SEC-B-05`
- Severity: Medium
- Confidence: High for historical risk; Low for current production state
- Status: manual-validation security risk
- Citations: `CLAUDE.md` environment-variable warning, `apps/web/src/lib/session.ts:19-35`
- Scenario: if production still uses historical example secrets or credentials, sessions or admin access can be compromised.
- Suggested fix: verify/rotate production `SESSION_SECRET`, admin passwords, PATs, and DB credentials; invalidate sessions after rotation.

### AGG-C7-08 - Upload stream abort listener is not explicitly removed on normal completion

- Original finding: `DBG-B-01`
- Severity: Low
- Confidence: Medium-Low
- Status: likely retention issue
- Citations: `apps/web/src/app/uploads/[...path]/route.ts:7-15`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:7-15`, `apps/web/src/lib/serve-upload.ts:304-366`
- Scenario: high-volume normal image loads can retain closed stream objects through abort listeners until request GC.
- Suggested fix: use a named abort handler and remove it on stream `close`, `end`, and `error` while preserving `{ once: true }`.

### AGG-C7-09 - Restore child-process failure behavior lacks behavioral fake coverage

- Original finding: `DBG-B-02`
- Severity: Medium
- Confidence: Medium
- Status: validation risk
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:572-854`
- Scenario: timeout, spawn error, stdin error, read-stream error, nonzero close, or post-migration failure could leave restore state wrong if event ordering differs.
- Suggested fix: extract/wrap child-process execution for tests and assert final marker, lock, queue, temp-file, and response state for each failure ordering.

### AGG-C7-10 - Deploy cleanup and proxy behavior need live-host validation

- Original finding: `DBG-B-03`
- Severity: Low/Medium
- Confidence: Medium
- Status: manual-validation ops risk
- Citations: `apps/web/deploy.sh:57-104`, `apps/web/nginx/default.conf:99-204`
- Scenario: host-specific compose, bind mount, proxy, or nginx location mismatch can break large uploads, restore caps, persistence, or pruning despite source review.
- Suggested fix: after deploy, exercise login, dashboard upload, Lightroom upload, DB backup download, restore-size rejection, public upload serving, and Docker cleanup.

### AGG-C7-11 - Public map can hydrate 10,000 Leaflet markers plus 10,000 list rows

- Original finding: `PERF-C7-01`
- Severity: Medium
- Confidence: High
- Status: confirmed performance issue
- Citations: `apps/web/src/lib/data.ts:1736-1768`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-105`, `apps/web/src/components/map/map-client.tsx:80-140`
- Scenario: a mobile visit to `/map` can hydrate thousands of marker and list nodes, freezing the main thread and inflating the SSR payload.
- Suggested fix: use viewport/bounds API plus clustering/canvas/WebGL or lower initial cap, virtualize/paginate the accessible list, and compute bounds in one pass.

### AGG-C7-12 - Timeline and On This Day use non-sargable date predicates on uncached public SSR pages

- Original finding: `PERF-C7-02`
- Severity: Medium
- Confidence: High
- Status: confirmed performance issue; production `EXPLAIN` still needed
- Citations: `apps/web/src/lib/data-timeline.ts:88-116`, `apps/web/src/lib/data-timeline.ts:125-145`, `apps/web/src/lib/data-timeline.ts:172-207`, `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/app/[locale]/(public)/page.tsx:232-234`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19-94`
- Scenario: homepage and timeline traffic repeatedly scans the processed/capture-date population because `MONTH()`, `DAY()`, and `YEAR()` wrap indexed columns.
- Suggested fix: use sargable year ranges, add generated/indexed month/day columns for month-day queries, and cache/revalidate low-churn results.

### AGG-C7-13 - Semantic search full-sorts all scanned candidate vectors per public request

- Original finding: `PERF-C7-03`
- Severity: Low
- Confidence: Medium
- Status: likely performance issue
- Citations: `apps/web/src/lib/clip-embeddings.ts:32-44`, `apps/web/src/lib/clip-embeddings.ts:209-217`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`
- Scenario: high `SEMANTIC_SCAN_LIMIT` values can force repeated vector decode/score/full-sort CPU work on public requests.
- Suggested fix: keep a fixed-size min-heap or partial top-K buffer while scanning; consider lower caps, result caches, or a vector index later.

### AGG-C7-14 - Public analytics view recorders track only final inserts, not earlier rate-limit/visibility DB work

- Original finding: `TRACE-C7-01`
- Severity: Medium
- Confidence: Medium
- Status: confirmed code path; timing-dependent failure
- Citations: `apps/web/src/app/actions/public.ts:377-414`, `apps/web/src/app/actions/public.ts:428-460`, `apps/web/src/app/actions/public.ts:463-528`, `apps/web/src/lib/background-db-writes.ts:42-84`
- Scenario: restore maintenance can begin after the first guard but before the rate-limit increment; the final analytics insert is skipped/drained, but the rate-limit write already occurred outside tracked restore causality.
- Suggested fix: wrap the entire recorder body in a tracked restore-aware task or add restore-aware guard/rollback inside `checkViewRecordRateLimit()`.

### AGG-C7-15 - Map cap can make topic visibility changes appear stale

- Original finding: `TRACE-C7-02`
- Severity: Low
- Confidence: High
- Status: confirmed causality/UX risk
- Citations: `apps/web/src/lib/data.ts:1736-1768`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-66`
- Scenario: enabling map visibility for an older topic after 10,000 newer GPS photos exist produces no visible map change because the cap is filled by newer rows.
- Suggested fix: return and display a `truncated` flag or replace the global latest cap with viewport/topic-filtered fetching.

### AGG-C7-16 - Runtime e2e proof is conditional and was not established in review

- Original finding: `VER-C7-01`
- Severity: Medium
- Confidence: High
- Status: manual-validation/test-environment risk
- Citations: `apps/web/playwright.config.ts:48-87`, `apps/web/scripts/run-e2e-server.mjs:49-62`, `apps/web/scripts/seed-e2e.ts:181-215`, `apps/web/e2e/admin.spec.ts:6-12`, `apps/web/e2e/origin-guard.spec.ts:27-73`
- Scenario: authenticated admin, origin, hydration, upload UI, or navigation bugs can pass lint/type/unit gates if e2e is skipped or run without admin credentials.
- Suggested fix: run e2e in a disposable environment or split non-destructive smoke coverage from destructive seed/build coverage.

### AGG-C7-17 - LR PAT upload lacks one real auth-to-upload integration test

- Original findings: `VER-C7-02`, `TE-C7-03`
- Cross-agent agreement: verifier + test-engineer
- Severity: Medium
- Confidence: High
- Status: confirmed integration-proof gap
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:84-92`, `apps/web/src/lib/api-auth.ts:72-90`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:44-47`, `apps/web/src/__tests__/api-auth-response-headers.test.ts:50-149`, `apps/web/src/__tests__/admin-tokens.test.ts:181-323`
- Scenario: token header, scope, context, `last_used_at`, or multipart integration drifts while isolated mocks keep passing.
- Suggested fix: add a disposable integration request that creates an `lr:upload` token, POSTs multipart JPEG with `X-GalleryKit-Token`, asserts upload/actor/last-used/enqueue, and verifies an `lr:read` token fails before handler work.

### AGG-C7-18 - Positive e2e coverage is missing for map, timeline, year archive, and smart collections

- Original findings: `VER-C7-03`, `TE-C7-02`
- Cross-agent agreement: verifier + test-engineer
- Severity: Medium
- Confidence: High
- Status: confirmed coverage gap
- Citations: `apps/web/e2e/public.spec.ts:4-153`, `apps/web/e2e/not-found-status.spec.ts:35-42`, `apps/web/scripts/seed-e2e.ts:36-67`, `apps/web/scripts/seed-e2e.ts:217-267`, `apps/web/src/app/[locale]/(public)/map/page.tsx:34-109`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:61-225`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-164`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:76-225`
- Scenario: Leaflet, timeline, smart-collection, or archive rendering can regress while existing positive public e2e stays green.
- Suggested fix: seed one GPS image and one public smart collection, then add positive Playwright smokes for `/map`, `/timeline`, `/year/<year>`, and `/c/<slug>`.

### AGG-C7-19 - Build and deploy remain unverified by read-only review lanes

- Original finding: `VER-C7-04`
- Severity: Medium
- Confidence: High
- Status: validation gap for this phase
- Citations: `apps/web/package.json:10-11`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`
- Scenario: build-only or deploy-host failures can remain after lint/type/unit pass.
- Suggested fix: run build and deploy in implementation after gates are green, then record evidence.

### AGG-C7-20 - No coverage ratchet protects new critical files

- Original finding: `TE-C7-01`
- Severity: Medium
- Confidence: High
- Status: confirmed test adequacy gap
- Citations: `apps/web/package.json:13`, `apps/web/vitest.config.ts:16-39`
- Scenario: future route/action/lib branches can ship untested while existing tests pass.
- Suggested fix: introduce a non-blocking coverage baseline, then ratchet critical directories or changed files.

### AGG-C7-21 - Admin token-management UI lacks behavior-level coverage

- Original finding: `TE-C7-04`
- Severity: Low
- Confidence: High
- Status: confirmed coverage gap
- Citations: `apps/web/e2e/admin.spec.ts:20-42`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-128`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:167-199`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:250-325`, `apps/web/src/__tests__/client-source-contracts.test.ts:170-222`, `apps/web/src/__tests__/lr-tokens-action.test.ts:16-64`
- Scenario: create, copy/acknowledge, list refresh, or revoke can break while source-contract tests pass.
- Suggested fix: add admin e2e or component coverage for token lifecycle.

### AGG-C7-22 - Nav visual checks write screenshots but do not assert them

- Original finding: `TE-C7-05`
- Severity: Low
- Confidence: High
- Status: confirmed assertion weakness
- Citations: `apps/web/e2e/nav-visual-check.spec.ts:6-37`, `apps/web/e2e/nav-visual-check.spec.ts:58`, `apps/web/e2e/nav-visual-check.spec.ts:72`, `apps/web/e2e/nav-visual-check.spec.ts:85`
- Scenario: clipping, contrast, or visual hierarchy can regress while metric-only assertions pass.
- Suggested fix: convert stable nav regions to `toHaveScreenshot` assertions or rename this as a metrics smoke and add a separate visual snapshot gate.

### AGG-C7-23 - CLIP activation tests are opt-in and one documents a native teardown flake

- Original finding: `TE-C7-06`
- Severity: Low
- Confidence: Medium
- Status: confirmed manual-gate fragility
- Citations: `apps/web/src/__tests__/clip-offline-load.test.ts:15-25`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`
- Scenario: production semantic activation depends on a manual proof that default CI skips, and known native teardown aborts can obscure result interpretation.
- Suggested fix: wrap real CLIP activation proof in a child process and classify assertion pass plus known teardown abort separately from model-load failure.

### AGG-C7-24 - Embedding storage cannot retain multiple model versions despite version-gated serving

- Original findings: `CRIT-E-01`, `DOC-E-01`
- Cross-agent agreement: critic + document-specialist
- Severity: Medium
- Confidence: High
- Status: confirmed docs/architecture/rollback issue
- Citations: `apps/web/drizzle/0012_image_embeddings.sql:5-11`, `apps/web/src/db/schema.ts:286-300`, `apps/web/scripts/backfill-clip-embeddings.ts:25-42`, `apps/web/scripts/backfill-clip-embeddings.ts:212-223`, `apps/web/src/app/actions/embeddings.ts:175-186`, `apps/web/src/app/api/search/semantic/route.ts:270-279`, `apps/web/src/app/api/search/similar/[id]/route.ts:140-148`, `apps/web/src/app/api/search/similar/[id]/route.ts:181-190`, `apps/web/README.md:64-72`, `CLAUDE.md:527-602`
- Scenario: a partial model-version rollout overwrites some old embeddings; rolling back makes those images invisible to the prior-version filter until re-embedded.
- Suggested fix: either document the single-active-embedding limitation clearly, or migrate to `(image_id, model_version)` retention with query/upsert/reconcile/cleanup changes.

### AGG-C7-25 - 404 pages keep the generic gallery document title

- Original findings: `DES-C7F-01`, `PMKT-C7F-03`
- Cross-agent agreement: designer + product-marketer-reviewer
- Severity: Medium
- Confidence: High
- Status: confirmed accessibility/product trust issue
- Citations: `apps/web/src/app/[locale]/not-found.tsx:12-49`, `apps/web/src/app/[locale]/layout.tsx:22-27`, `apps/web/src/app/[locale]/layout.tsx:54-66`, `apps/web/e2e/not-found-status.spec.ts:14-89`
- Scenario: dead-end 404 tabs remain titled like valid gallery tabs, hurting screen-reader/tab recovery and support screenshots.
- Suggested fix: set a localized `Page not found | {siteTitle}` title after hydration or adopt a supported metadata structure; add e2e assertions for English and Korean 404 titles.

### AGG-C7-26 - The live demo sells Atik's gallery, not GalleryKit's product promise

- Original finding: `PMKT-C7F-01`
- Severity: Low-Medium
- Confidence: High
- Status: confirmed product-positioning issue
- Citations: `README.md:22-24`, `apps/web/src/app/[locale]/(public)/page.tsx:212-235`, `apps/web/src/components/footer.tsx:32-59`, `apps/web/src/site-config.json:2-10`
- Scenario: a prospect clicks the live demo, sees a gallery, and leaves without learning the self-hosted GalleryKit value proposition.
- Suggested fix: add a low-friction product path such as a footer link or `/about-gallerykit` page that does not degrade the gallery-first demo.

### AGG-C7-27 - The README's strongest positioning sentence is too dense for first-contact readers

- Original finding: `PMKT-C7F-02`
- Severity: Low
- Confidence: High
- Status: confirmed product-doc clarity issue
- Citations: `README.md:29`, `README.md:36-44`
- Scenario: a viable self-hosting buyer bounces before reaching the crisp "For/Not for" boundary because the opening paragraph reads like an engineering decision record.
- Suggested fix: restructure the top README into one short promise, three plain-language value bullets, a status table, and a later technical-proof section.

## Agent Failures

- Initial spawn for the UI/product lane failed once with `agent thread limit reached`; it was retried successfully after a completed lane was closed.
- No review lane ultimately failed.
