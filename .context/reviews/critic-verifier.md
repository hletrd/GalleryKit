# Critic + Verifier Report - review-plan-fix cycle 33

## Scope Inventory

Reviewed operating contracts and context:

- In-session `AGENTS.md` instructions and project `CLAUDE.md`.
- Root and app package scripts, deploy/nginx/compose/Docker surfaces.
- Current cycle-33 review artifacts present in `.context/reviews/` as leads only; findings below were re-checked against current source.

Inspected relevant implementation flows:

- Admin/public route handlers under `apps/web/src/app/api/**`, root feed route, and localized topic feed route.
- Server actions under `apps/web/src/app/actions/**`, with focus on auth, upload, bulk metadata, settings, and public actions.
- Auth/origin/rate-limit guards: `api-auth.ts`, `request-origin.ts`, `action-guards.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, plus lint scanners.
- Upload/processing paths: browser upload action, Lightroom PAT upload route, `process-image.ts`, `upload-paths.ts`, queue/bootstrap, upload locking, nginx upload serving.
- Data/privacy/search/feed paths: `data.ts`, `data-timeline.ts`, smart collections, semantic search, feed XML routes, OG fallback handling.
- Test/verification surfaces for the above: source-contract tests, lint scanner tests, privacy/rate/origin gates.

Validation evidence collected:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Static scans for paid/download entitlements, reactions/scoring/culling/editing, unsupported storage backends, `new URL(req.url)`, `dangerouslySetInnerHTML`, TODO/FIXME, and route/action coverage.

Not run:

- Full `npm test`, `npm run typecheck`, `npm run build`, and e2e. This lane was asked to write a review artifact only and avoid app/source edits; running full gates would add build/cache churn and duplicate the implementation lanes' verification work.

## CRITIC

### CV33-CRIT-01 - Bulk "apply suggested alt" can persist unsanitized or overlong metadata

- Severity: MEDIUM
- Confidence: High
- Files/regions:
  - `apps/web/src/app/actions/images.ts:928-944` correctly sanitizes and length-checks manual title/description updates via `sanitizeAdminString()` and `countCodePoints()`.
  - `apps/web/src/app/actions/images.ts:1050-1065` applies the same contract for bulk explicit title/description fields.
  - `apps/web/src/app/actions/images.ts:1102-1147` copies `alt_text_suggested` into `title` or `description` after only `stripUnicodeFormatting(stripStubPrefix(...)).trim()`.
  - `apps/web/src/lib/sanitize.ts:161-190` rejects C0/C1 controls and Unicode formatting for admin-persistent strings.
  - `apps/web/src/db/schema.ts:82-86` defines `alt_text_suggested` as `text`, so the source can exceed title's `varchar(255)` budget.
- Failure scenario: A pre-fix or imported row contains `alt_text_suggested = "[AUTO]caption\x01"` or a 600-character EXIF-derived hint. Bulk apply to title bypasses the normal admin sanitizer and title length check, then tries to persist a control character or a `TEXT`-sized value into a title field whose other entry points reject it. Depending on MySQL mode, the write can fail the transaction, truncate, or store data that violates the admin metadata invariant.
- Suggested fix: Normalize the copied caption through the same helper and bounds used for the target field. After prefix stripping, call `sanitizeAdminString(stripped)`, reject/skip on `rejected`, enforce `<=255` code points for title and `<=5000` for description, and add tests covering C0/C1, Unicode formatting, and overlong source captions.

### CV33-CRIT-02 - Lightroom upload buffers full multipart bodies before serialization and disk checks

- Severity: HIGH
- Confidence: High
- Files/regions:
  - `apps/web/src/app/api/admin/lr/upload/route.ts:153-167` calls `await request.formData()` before reading `fileEntry.size`.
  - `apps/web/src/app/api/admin/lr/upload/route.ts:225-259` verifies topic and acquires the upload-processing contract lock only after multipart materialization.
  - `apps/web/src/app/api/admin/lr/upload/route.ts:307-310` later writes the already-materialized `File` through `saveOriginalAndGetMetadata`.
  - `apps/web/nginx/default.conf:91-96` allows 216 MiB dashboard upload bodies with admin burst 10.
  - `apps/web/docker-compose.yml:12-28` defines the web service without an explicit memory limit.
- Failure scenario: A valid PAT client, compromised PAT, or internal integration bug sends several near-limit multipart requests concurrently. Nginx admits the burst; each Next handler materializes the full body in memory before the app can serialize work with the advisory lock or reject by actual file size. The process can hit memory pressure or OOM while the database and disk checks are still healthy.
- Suggested fix: Avoid `request.formData()` for this large-file route. Use a streaming multipart parser or a route-level semaphore that limits concurrent body materialization before parsing. Tighten the LR-specific proxy limit if the PAT route does not need browser dashboard burst behavior, and add a route-level test or stress harness that proves only one or a bounded number of large bodies can be resident at once.

### CV33-CRIT-03 - Public route rate-limit scanner does not cover all public Next route handlers

- Severity: MEDIUM
- Confidence: High
- Files/regions:
  - `apps/web/scripts/check-public-route-rate-limit.ts:1-11` claims to enforce every public API route and expensive GET handler.
  - `apps/web/scripts/check-public-route-rate-limit.ts:25-26` roots discovery at `src/app/api`, excluding non-API route handlers.
  - `apps/web/scripts/check-public-route-rate-limit.ts:74-85` recursively discovers route files only under that API root.
  - `apps/web/src/app/feed.xml/route.ts:41-53` and `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:41-78` are public GET route handlers that call config/SEO/data helpers outside `src/app/api`.
  - `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:739-744` only asserts the API discovery fails closed when zero files are found; it does not assert discovery over all `src/app/**/route.*` files.
- Failure scenario: A future public expensive or mutating route lands outside `/api`, as feed routes already do. The lint gate remains green because discovery never sees it, so the route can ship without rate limiting or an explicit exemption despite matching the stated policy.
- Suggested fix: Discover `src/app/**/route.{ts,tsx,js,mjs,cjs}` and then exclude admin/private surfaces by route classification, not by starting under `/api`. Add fixtures for root `feed.xml/route.ts` and localized dotted routes so this exact blind spot cannot recur.

### CV33-CRIT-04 - Low-risk data-shape edge cases remain in auto-caption and bulk ID handling

- Severity: LOW
- Confidence: High
- Files/regions:
  - `apps/web/src/lib/caption-generator.ts:35-40` truncates the stub caption with UTF-16 `.slice(0, ALT_TEXT_MAX_CHARS)`.
  - `apps/web/src/app/actions/images.ts:997-1008` rejects `ids.length > 100` before deduplicating into `requestedIds`.
- Failure scenario: A camera model containing supplementary characters can be split mid-surrogate, producing replacement-character text in the generated suggestion. Separately, a client that accidentally submits duplicate image IDs can get `tooManyImages` even when the unique selected image count is within the documented bulk limit.
- Suggested fix: Use the existing code-point/counting pattern for caption truncation and deduplicate IDs before applying the 100-image cap.

## VERIFIER

### CV33-VER-01 - Auth server actions are currently guarded, but the lint gate intentionally excludes them

- Severity: HIGH
- Confidence: High
- Files/regions:
  - `apps/web/scripts/check-action-origin.ts:13-19` documents that `auth.ts` is excluded from the generic scanner.
  - `apps/web/scripts/check-action-origin.ts:49-73` implements the basename exclusion.
  - `apps/web/src/__tests__/check-action-origin.test.ts:493-503` asserts `auth.ts` is skipped.
  - Current implementation is manually guarded: `login` checks `hasTrustedSameOrigin` at `apps/web/src/app/actions/auth.ts:95-99`, `logout` checks before session deletion at `apps/web/src/app/actions/auth.ts:264-284`, and `updatePassword` checks before session/user reads at `apps/web/src/app/actions/auth.ts:287-299`.
- Failure scenario: A future auth mutation is added to `auth.ts` without the manual origin check. `npm run lint:action-origin` still passes by design, and the test suite reinforces the exclusion. This is a verification gap, not a current exploit in the three existing mutators.
- Suggested fix: Bring `auth.ts` under lint coverage with an auth-specific approved guard detector for `hasTrustedSameOrigin`, or add a dedicated auth-action scanner that fails on exported mutating functions lacking the check before cookie/session/database mutation. Keep the current manual guards.

### CV33-VER-02 - Lightroom upload parity is mostly source-locked, not behavior-locked

- Severity: MEDIUM
- Confidence: High
- Files/regions:
  - `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-16` states the route is heavy to exercise and uses source-contract tests.
  - `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:27-67` checks HDR gate/auth strings by regex/source matching.
  - `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:78-112` checks GPS strip strings.
  - `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:123-172` checks metadata/parity strings.
  - `apps/web/src/app/api/admin/lr/upload/route.ts:194-223` contains runtime title/description validation branches that are not route-executed by these source tests.
- Failure scenario: A refactor can preserve the expected import names or string fragments while changing control flow, response status, cleanup ordering, tracker settlement, or returned error semantics. The source-contract tests stay green even if the route no longer behaves like browser upload for a real multipart request.
- Suggested fix: Add mocked route-level tests for representative branches: invalid filename, title too long, missing topic, lock unavailable, HDR reject cleanup, GPS strip failure, RAW reject, insert/enqueue success, and tracker settlement. Keep source-contract tests only for coarse architectural invariants that are hard to execute.

### CV33-VER-03 - Feed conditional-request helper/tests are now detached from live route behavior

- Severity: LOW
- Confidence: High
- Files/regions:
  - `apps/web/src/lib/feed-conditional.ts:1-42` still defines `isFeedNotModified` for If-Modified-Since behavior.
  - `apps/web/src/__tests__/feed-conditional.test.ts:1-66` thoroughly tests that helper.
  - Live feed routes now use content ETags and do not call the helper: `apps/web/src/app/feed.xml/route.ts:151-180` and `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:158-186`.
  - `apps/web/src/__tests__/feed-sized-derivative.test.ts:63-69` explicitly asserts the root feed source does not contain `isFeedNotModified`.
- Failure scenario: The helper test suite can pass while the live feed conditional behavior regresses, because it is testing dead code. The source-grep feed test is useful but does not exercise HTTP semantics for 200/304 responses.
- Suggested fix: Delete the unused helper and its tests, or rewire route-level tests around the actual ETag behavior. A behavior test should assert settings/content changes alter the ETag and stale `If-None-Match` receives 200 while matching `If-None-Match` receives 304.

### Verified corrections and non-findings

- Semantic search no-embedding honesty gate: fixed. In production, zero scanned embedding rows return `503` with code `semantic_no_embeddings` at `apps/web/src/app/api/search/semantic/route.ts:285-290`.
- Host-side nginx upload serving: fixed. Uploaded derivatives are proxied to Next instead of rooted at a container-internal path at `apps/web/nginx/default.conf:169-185`; originals still return 404 at `apps/web/nginx/default.conf:165-167`.
- Per-photo OG fallback origin: fixed. `buildFallbackResponse` derives and validates against the canonical configured origin and fails closed on invalid canonical URLs at `apps/web/src/app/api/og/photo/[id]/route.tsx:249-294`.
- Auth/admin API/action gates: current scanned gates passed. Existing admin API files are covered by `withAdminAuth`; non-auth mutating server actions are covered by `requireSameOriginAdmin` or explicit exemptions.
- Feed locale guard: localized topic feed validates dotted route-handler locale before building links at `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:47-60`.
- Product-policy sweep: no live Stripe/payment/entitlement, reaction/scoring/culling/editing, or wired unsupported storage backend surfaced in current source scans. Remaining hits are migrations/tests/deferred abstractions or historical context.
- Privacy sweep: public select/enrichment/map/feed paths inspected did not show a fresh sensitive-field leak. Existing compile-time privacy guard patterns remain in place.

### Final sweep

No additional high-confidence blocker surfaced after re-checking prior cycle fixes, current cycle reviewer leads, lint gates, and cross-file flows. The highest-priority open item is the bulk alt-copy sanitization/length bypass because it is a direct invariant violation on persisted metadata. The broadest operational risk is LR multipart buffering because the route accepts large authenticated uploads before app-level serialization can take effect.
