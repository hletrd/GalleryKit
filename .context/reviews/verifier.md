# Verifier Review - Cycle 20

Date: 2026-06-30 KST
HEAD reviewed: `5c55b68c` (`docs(clip): clarify semantic search operations`)
Scope: verifier review of correctness evidence, repository gates, and behavior-critical invariants at current HEAD. No implementation files were modified.

## Inventory

Required docs read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Cycle-20 review artifacts inspected for cross-checking:

- `.context/reviews/architect.md`
- `.context/reviews/code-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/debugger.md`
- `.context/reviews/document-specialist.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`

Blocking gates inventoried:

- Root scripts: `package.json` exposes `build`, `lint`, `typecheck`, `test`, `test:e2e`, `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, and `deploy`.
- App scripts: `apps/web/package.json` defines `prebuild` (`ensure-site-config`, icon generation, service-worker build), `build` (`typecheck` then `next build`), `typecheck:app`, `typecheck:scripts`, Vitest, Playwright, and the three custom lint scanners.
- Vitest config: `apps/web/vitest.config.ts:16-39` includes only `src/__tests__/**/*.test.{ts,tsx}`, excludes `.next`, and sets a 15s timeout.
- Playwright config: `apps/web/playwright.config.ts:48-87` runs single-worker Chromium, starts `scripts/run-e2e-server.mjs` for local E2E, and gates remote admin tests.
- Type gate: `apps/web/tsconfig.typecheck.json:3-14` includes app/test TS/TSX plus generated Next types and excludes `scripts` from the app pass.

Test and fixture inventory:

- 264 Vitest files under `apps/web/src/__tests__`.
- 5 Playwright specs under `apps/web/e2e`.
- Fixture families checked: color/CLIP fixtures, upload fixtures, E2E JPEG fixtures, scanner fixtures embedded in custom lint tests, migration journal fixtures, service-worker template contracts, privacy field fixtures, and touch-target known-violation fixtures.

Behavior-critical app files inspected:

- Public semantic/similar search: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/rate-limit.ts`.
- OG and fetch fallback: `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/og-photo-fetch.ts`.
- Admin/API/action gates: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, admin API route files, and `apps/web/src/app/actions/**`.
- Upload/ingest parity: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, and `apps/web/src/lib/image-queue.ts`.
- Deploy/build/runtime config: `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/next.config.ts`, `apps/web/src/lib/upload-limits.ts`, and `apps/web/.env.local.example`.
- Analytics side effects: public photo/topic/share pages, `apps/web/src/app/actions/public.ts`, `apps/web/src/components/photo-viewer.tsx`, and `apps/web/src/components/photo-navigation.tsx`.
- Recent cycle-19 fixes: `apps/web/src/components/bulk-edit-dialog.tsx`, `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/components/image-zoom.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/__tests__/cycle-19-source-contracts.test.ts`.
- Restore/migration/deploy invariants: `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/__tests__/migration-journal*.test.ts`, `apps/web/src/__tests__/deploy-script-contract.test.ts`.

Validation run:

- `npm test --workspace=apps/web -- --run src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts src/__tests__/clip-model-contract.test.ts src/__tests__/og-photo-fallback.test.ts src/__tests__/cycle-19-source-contracts.test.ts`: passed, 5 files / 66 tests.
- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.

Full `npm run lint`, `npm run typecheck`, `npm run build`, full `npm test`, and `npm run test:e2e` were not run in this verifier-only pass.

## Confirmed Issues

### V20-01 - Central semantic rollback documentation contradicts current route behavior

Severity: Low-Medium
Confidence: High
Status: Confirmed

Evidence:

- Current semantic route posture says all requests that reach DB-backed semantic-mode lookup stay charged, including disabled-mode responses and invalid query lengths: `apps/web/src/app/api/search/semantic/route.ts:12-17`.
- The text route implements that by importing only `preIncrementSemanticAttempt` and charging before `getGalleryConfig()`: `apps/web/src/app/api/search/semantic/route.ts:38`, `apps/web/src/app/api/search/semantic/route.ts:173-200`.
- Tests assert short-query, long-query, and disabled-mode branches stay charged and do not roll back: `apps/web/src/__tests__/semantic-search-route.test.ts:232-267`.
- The similar route does the same for disabled/stub mode: `apps/web/src/app/api/search/similar/[id]/route.ts:24-29`, `apps/web/src/app/api/search/similar/[id]/route.ts:82-109`; tests assert no rollback at `apps/web/src/__tests__/similar-route.test.ts:167-184`.
- But the central convention still says semantic text search "refunds only pre-work short-query rejections" and says `rollbackSemanticAttempt` is used for exits "for example disabled mode": `apps/web/src/lib/rate-limit.ts:24-30`, `apps/web/src/lib/rate-limit.ts:374-377`.

Failure scenario:

A future verifier or implementer follows the central `rate-limit.ts` contract instead of the route-local contract and adds rollback for disabled mode or short-query validation. That would reopen the already-closed DB-config probe and malformed-body budget bypass that current tests are trying to prevent.

Suggested fix/test:

Update `rate-limit.ts` Pattern 2b and the `rollbackSemanticAttempt` comment to match current behavior: semantic text and similar routes do not use rollback after semantic-mode lookup or body admission; rollback is a helper retained for direct bucket tests or future pre-work branches only. Add a source-contract assertion that the central comments do not mention disabled mode or short-query refunds unless a route actually imports and calls `rollbackSemanticAttempt`.

### V20-02 - Docker deploy can build with a different env surface than the runtime container

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- Compose build args come only from Compose interpolation environment: `BASE_URL`, `IMAGE_BASE_URL`, and `UPLOAD_MAX_TOTAL_BYTES` at `apps/web/docker-compose.yml:4-10`.
- The runtime container separately reads `apps/web/.env.local` through `env_file`: `apps/web/docker-compose.yml:17-21`.
- The deploy script checks that `.env.local` exists, but then runs `docker compose -f apps/web/docker-compose.yml up -d --build` without `--env-file` and without sourcing `.env.local`: `apps/web/deploy.sh:15-31`.
- The Docker builder stage only promotes `BASE_URL`, `IMAGE_BASE_URL`, and `UPLOAD_MAX_TOTAL_BYTES`: `apps/web/Dockerfile:64-70`.
- Build-time Next config reads `IMAGE_BASE_URL` for image remote patterns and CSP: `apps/web/next.config.ts:28`, `apps/web/next.config.ts:51-105`.
- Build-time server action body size reads `NEXT_UPLOAD_BODY_MAX_BYTES`: `apps/web/src/lib/upload-limits.ts:19-33`, and `.env.local.example` documents that variable: `apps/web/.env.local.example:45-47`.

Failure scenario:

An operator sets `IMAGE_BASE_URL=https://cdn.example.com` or `NEXT_UPLOAD_BODY_MAX_BYTES=536870912` only in `apps/web/.env.local`, which the deploy docs and script make look authoritative. The runtime container receives those values, but the image may be built without the CDN remote pattern or larger server-action parser cap. The app then fails CDN image validation or rejects large restore/upload bodies despite runtime env showing the intended value.

Suggested fix/test:

Make one deploy env source authoritative. Either run Compose with `--env-file apps/web/.env.local`, or wire every build-time env consumed by `next.config.ts`/`upload-limits.ts` through Compose build args and Dockerfile `ARG`/`ENV`. Add a contract test that every documented build-time env key is present in the Compose/Docker build surface.

### V20-03 - Upload ingest has multiple implementation owners despite a parity contract

Severity: Medium
Confidence: High
Status: Confirmed maintainability/correctness risk

Evidence:

- Browser upload owns auth/input/config/quota setup and the upload contract lock at `apps/web/src/app/actions/images.ts:114-190`.
- Browser upload separately owns disk/topic preconditions at `apps/web/src/app/actions/images.ts:244-292`, save/HDR/GPS/insert state at `apps/web/src/app/actions/images.ts:350-461`, and queue job construction at `apps/web/src/app/actions/images.ts:499-531`.
- The Lightroom route states it reuses upload infrastructure so processing and EXIF behavior are identical to browser upload: `apps/web/src/app/api/admin/lr/upload/route.ts:15-18`.
- The Lightroom route still independently implements topic/config/lock/save/HDR/GPS/insert/enqueue flow at `apps/web/src/app/api/admin/lr/upload/route.ts:225-275`, `apps/web/src/app/api/admin/lr/upload/route.ts:307-452`, and `apps/web/src/app/api/admin/lr/upload/route.ts:479-516`.
- Retry processing constructs another queue job manually at `apps/web/src/app/actions/images.ts:1227-1280`.
- The central `ProcessingSettingsSnapshot` exists at `apps/web/src/lib/image-queue.ts:92-120`, but enqueue sites still copy each field manually.
- Tests document prior drift in this exact contract class: upload settings wiring at `apps/web/src/__tests__/image-queue-settings-wiring.test.ts:1-21`, and Lightroom HDR/GPS source-contract drift at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-15` and `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:69-76`.

Failure scenario:

A new upload-time processing, privacy, or metadata setting is added. The browser action forwards it, but Lightroom upload or retry misses one field. Browser uploads, Lightroom uploads, and retried images then persist different metadata or produce different derivatives for the same input, with differences only surfacing after photographer comparison or a later backfill.

Suggested fix/test:

Extract a server-only ingest service that owns config snapshot creation, save-original gates, image insert value construction, and queue job construction. Keep browser and Lightroom routes as auth/body/response adapters. Add an exhaustiveness test that fails when `ProcessingSettingsSnapshot` or the queue job contract gains a field not handled by the shared builder.

## Likely Issues

### V20-04 - Route-level OG correctness is mostly source-greped rather than behavior-verified

Severity: Low-Medium
Confidence: Medium
Status: Likely verification gap

Evidence:

- The per-photo OG route's critical behavior includes rate-limit charge/rollback placement, canonical fallback redirects, DB lookup, configured-size derivative fetch, Satori rendering, and Sharp JPEG post-processing: `apps/web/src/app/api/og/photo/[id]/route.tsx:45-129`, `apps/web/src/app/api/og/photo/[id]/route.tsx:223-240`, `apps/web/src/app/api/og/photo/[id]/route.tsx:249-295`.
- The route tests assert most route-level properties by reading source strings: `apps/web/src/__tests__/og-photo-fallback.test.ts:40-87`.
- The same file has real runtime tests for `pickFirstAvailablePhotoBuffer`, but those validate only the helper, not the route's response behavior: `apps/web/src/__tests__/og-photo-fallback.test.ts:111-203`.
- The sibling topic OG route has only a minimal source contract for rollback policy: `apps/web/src/__tests__/og-route-source-contracts.test.ts:5-11`.

Failure scenario:

A route refactor can keep the strings `pickFirstAvailablePhotoBuffer`, `rollbackOgAttempt(ip)`, or `canonicalOrigin` present while changing the runtime order or returned response. For example, the route could call the helper but ignore its result, return a request-origin fallback from a new helper, or move a rollback into an alias that the current string count does not catch.

Suggested fix/test:

Add route-level Vitest tests with mocked `getImageCached`, `getSeoSettings`, `getGalleryConfig`, `pickFirstAvailablePhotoBuffer`, `ImageResponse`, and `sharp`. Assert concrete responses for invalid ID rollback, missing image charged fallback, all-derivatives-missing charged fallback, canonical same-origin `Location`, and a successful JPEG response. Keep the source contracts as cheap tripwires, but make behavior tests authoritative.

## Risks Needing Validation

### V20-R01 - Recent UI correctness fixes are source-pinned, not DOM-verified

Severity: Medium
Confidence: High
Status: Risk needing validation

Evidence:

- The fixes exist in implementation: bulk edit resets on successful submit at `apps/web/src/components/bulk-edit-dialog.tsx:155-160`; photo swipe listeners bind to `swipeTarget` at `apps/web/src/components/photo-navigation.tsx:47-48` and `apps/web/src/components/photo-navigation.tsx:134-136`; `ImageZoom` composes the photo identity into its accessible name at `apps/web/src/components/image-zoom.tsx:343-365`, passed from `photo-viewer.tsx:554` and `photo-viewer.tsx:724`.
- The regression lock is a source contract: `apps/web/src/__tests__/cycle-19-source-contracts.test.ts:27-54`.
- The E2E suite exercises some adjacent photo behavior, but not these exact runtime contracts: `apps/web/e2e/test-fixes.spec.ts:49-75` opens info sheet and checks keyboard focus visibility; `apps/web/e2e/public.spec.ts:61-83` opens/closes lightbox.

Failure scenario:

A later refactor can preserve the source strings while breaking runtime behavior: a parent-driven dialog close stops resetting state, `swipeTargetRef.current` becomes null during hydration, or the rendered zoom button accessible name regresses despite `accessibleName` still appearing in source.

Suggested fix/test:

Add Playwright or a real component harness for: bulk edit submit -> close -> reopen -> default modes; mobile swipe starting outside the media container does not navigate; and the focused main photo zoom control has an accessible name containing the photo title/tag-derived alt text.

### V20-R02 - View analytics writes can be triggered by render/prefetch instead of committed views

Severity: Medium
Confidence: Medium
Status: Risk needing runtime validation

Evidence:

- Photo page render fires `recordPhotoView(image.id)`: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:154-156`.
- Topic page render fires `recordTopicView(topicData.slug)`: `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-164`.
- Shared group page render fires `recordSharedGroupView(group.id, key)` for initial group views: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:127-132`.
- The recorders rate-limit and insert durable analytics rows from server actions: `apps/web/src/app/actions/public.ts:371-391`, `apps/web/src/app/actions/public.ts:398-421`, and `apps/web/src/app/actions/public.ts:429-456`.
- The photo page renders hidden adjacent-photo links with `prefetch={true}`: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:284-292`.
- The photo viewer also prefetches adjacent routes on idle, and navigation buttons prefetch on hover: `apps/web/src/components/photo-viewer.tsx:238-264`, `apps/web/src/components/photo-navigation.tsx:220-242`.

Failure scenario:

Opening one photo can cause adjacent photo routes to be prefetched. If the current Next.js runtime evaluates those server components for prefetch, the server-render side effect inserts view rows for photos the visitor never committed to viewing and spends the per-IP analytics budget before real views happen.

Suggested fix/test:

Move analytics recording to a committed-view client boundary or a tiny public analytics route called from a visibility-aware client effect. If server-side recording remains, add a prefetch guard and a regression proving that route prefetch does not mutate `image_views`, `topic_views`, or `shared_group_views`.

### V20-R03 - Similar-photo route does not observe client aborts during bounded embedding work

Severity: Low-Medium
Confidence: Medium-High
Status: Risk needing validation

Evidence:

- The semantic text route checks `request.signal` before production embedding, before DB scan continuation, and before enrichment: `apps/web/src/app/api/search/semantic/route.ts:247-260`, `apps/web/src/app/api/search/semantic/route.ts:267-279`.
- The similar-photo route scans up to `SEMANTIC_SCAN_LIMIT`, decodes rows, scores, sorts, and enriches results at `apps/web/src/app/api/search/similar/[id]/route.ts:140-178`.
- `SEMANTIC_SCAN_LIMIT` defaults to 2000 and can be configured up to 25000: `apps/web/src/lib/clip-embeddings.ts:36-44`.
- A direct search found no `request.signal`, `isRequestAborted`, or abort handling in `apps/web/src/app/api/search/similar/[id]/route.ts` or its test file.

Failure scenario:

A visitor quickly navigates through photos while similar-photo requests are in flight. The browser aborts prior requests, but the server continues target lookup, scan, decode/score/sort, and enrichment for each admitted request. The shared rate limit bounds abuse, but legitimate rapid navigation can still burn avoidable CPU/DB work.

Suggested fix/test:

Mirror the semantic route's lightweight abort helper in the similar route. Check before charging when possible, then before/after target lookup, after the scan before CPU scoring, and before enrichment. Add a route test for an already-aborted request that returns 499 before `preIncrementSemanticAttempt()`.

### V20-R04 - CLIP queue abort/concurrency behavior is locked by source contracts, not behavior tests

Severity: Medium
Confidence: High
Status: Risk needing validation

Evidence:

- Queue state, waiters, timeout, abort listener cleanup, and slot release live in `apps/web/src/lib/clip-model.ts:65-160`.
- `embedTextReal` accepts queue options and passes them to `withInferenceSlot`: `apps/web/src/lib/clip-model.ts:228-236`.
- The current test checks source strings such as `ClipInferenceQueueAbortError`, `signal.addEventListener('abort'`, and `}), options)`: `apps/web/src/__tests__/clip-model-contract.test.ts:32-50`.

Failure scenario:

A refactor can keep those strings while breaking behavior: timed-out waiters could still be woken, an abort listener could remain but not reject the queued call, or `activeInferenceCount` could be decremented too early. The source contract stays green while disconnected production text searches again consume ONNX inference work.

Suggested fix/test:

Extract a testable queue helper or add a test-only injection seam for model/tokenizer loading. Use fake timers to test saturated concurrency, queued abort, queue-full rejection, timeout removal, and no model invocation for an aborted queued request.

## Verified Closures Since Cycle 19

- CLIP text inference now threads `AbortSignal` through the queue and removes aborted waiters: `apps/web/src/lib/clip-model.ts:74-160`, `apps/web/src/lib/clip-model.ts:228-236`; the route passes `request.signal` at `apps/web/src/app/api/search/semantic/route.ts:247-260`.
- Semantic route body admission now rejects missing `Content-Length`, mixed-case chunked transfer, and post-read multibyte byte overages with tests: `apps/web/src/app/api/search/semantic/route.ts:136-218`, `apps/web/src/__tests__/semantic-search-route.test.ts:178-210`.
- SQL restore comment-separated dangerous statements are covered by scanning both comment-stripped forms: `apps/web/src/lib/sql-restore-scan.ts:113-155`.
- Lightroom enqueue now source-pins `semanticSearchMode` parity in `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:382-394`.
- Bulk edit reset, photo swipe scoping, and zoom accessible-name fixes are present, with the source-contract caveat above.

## Final Missed-Issue Sweep

Final sweep covered:

- Other cycle-20 review artifacts and their promoted findings.
- All API route files under `apps/web/src/app/api`.
- All mutating server-action scanner outputs.
- Public semantic/similar route behavior and rate-limit charge/rollback tests.
- OG route fallback, rate-limit, and helper tests.
- CLIP queue bounds and abort source contracts.
- Recent UI fix source contracts and adjacent Playwright coverage.
- Upload/browser/Lightroom/retry ingest parity surfaces.
- Deploy/runtime/build env wiring.
- Analytics view-recording render side effects and photo-route prefetch callers.
- Migration journal, deploy safety, privacy-field, service-worker, touch-target, and scanner fixture surfaces at inventory level.

No critical or high-severity confirmed correctness bugs were found in this pass. Confirmed verifier findings are medium or lower and center on contract drift or maintainability hazards: semantic rate-limit prose, deploy env split-brain, upload ingest ownership, and source-heavy route/UI/queue tests. Remaining items need runtime validation before they should be treated as production bugs.
