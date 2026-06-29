# Cycle 9/100 Aggregate Review

Date: 2026-06-29
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD range: `adb1ae67` through reviewer artifact commits ending at `35b4ce23`

## Reviewer Coverage

Completed review artifacts:

- `.context/reviews/code-reviewer.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/verifier.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`
- `.context/reviews/architect.md`
- `.context/reviews/debugger.md`
- `.context/reviews/document-specialist.md`
- `.context/reviews/designer.md`
- `.context/reviews/product-marketer-reviewer.md`

UI/UX review was in scope because GalleryKit is a Next.js web app. The designer lane used `agent-browser` against the deployed public site because local DB-backed rendering returned a DB-unavailable error shell. Local/source review covered authenticated admin pages.

## Agent Failures

None. Native child-agent concurrency limited the fan-out to waves, but every required and discovered reviewer-style lane returned a report.

## Merged Findings

### C9-01 - First-page public listing queries aggregate tags and count the full matched set

Severity: High
Confidence: High
Status: Confirmed
Sources: perf-reviewer

Evidence: `apps/web/src/lib/data.ts:877-905`, `apps/web/src/lib/data.ts:1437-1452`, `apps/web/src/app/[locale]/(public)/page.tsx:149-166`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-176`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`.

The initial home/topic/smart-collection listing paths still join/aggregate tags and compute `COUNT(*) OVER()` across the full matched set before returning the first page. On a large gallery, a crawler or visitor hitting broad listings can force MySQL to group/count many rows even though the UI renders one page.

Suggested fix: split initial listing into bounded ID selection plus tag enrichment for those IDs. Use `hasMore` where exact counts are not essential, or isolate exact counts to a cheaper image-only query. Validate with query-shape/source tests and, if possible, `EXPLAIN`.

### C9-02 - Analytics retention deletes lack viewed_at-leading purge indexes

Severity: Medium
Confidence: High
Status: Confirmed
Sources: perf-reviewer, architect

Evidence: `apps/web/src/lib/view-retention.ts:56-81`, `apps/web/src/db/schema.ts:231-259`.

The hourly retention worker deletes rows with `viewed_at < cutoff`, but current indexes on `image_views`, `topic_views`, and `shared_group_views` are led by entity or `bot`, not `viewed_at`. As anonymous event tables grow, retention can degrade into broad scans and lock/IO pressure.

Suggested fix: add dedicated `viewed_at`-leading purge indexes such as `(viewed_at, id)` on all three view tables, with Drizzle migration journal, schema, reconcile coverage, and tests.

### C9-03 - Retry failed image can report success when re-enqueue is rejected

Severity: Medium
Confidence: High
Status: Confirmed
Sources: debugger

Evidence: `apps/web/src/app/actions/images.ts:1196-1239`, `apps/web/src/lib/image-queue.ts:388-400`, `apps/web/src/lib/image-queue.ts:828`, `apps/web/src/__tests__/failed-image-retry.test.ts:99-105`.

`retryFailedImage()` clears `processing_error`, `failed_at`, and in-memory failure maps before calling `enqueueImageProcessing(...)`, but ignores the boolean return. If the queue rejects the job during shutdown, maintenance, invalid filenames, or permanent-failure state, the action still reports success and the image can disappear from the failed-image admin surface.

Suggested fix: validate enqueue prerequisites before clearing failure state, or restore/preserve failure state when `enqueueImageProcessing` returns false. Add a behavioral test for rejected enqueue.

### C9-04 - Docker native package names break on linux/amd64

Severity: Medium
Confidence: High
Status: Confirmed
Sources: critic

Evidence: `apps/web/Dockerfile:38-51`, `apps/web/README.md:48-49`, `CLAUDE.md:17`, `CLAUDE.md:556-559`.

The Dockerfile interpolates Docker BuildKit `TARGETARCH` directly into native npm package names. Docker uses `amd64`, while the npm packages use `x64`, so x86_64 Linux builds try to install nonexistent names such as `@next/swc-linux-amd64-gnu`.

Suggested fix: normalize `TARGETARCH` to npm arch (`amd64 -> x64`, `arm64 -> arm64`) before installing native optional packages. Add a source-contract test rejecting raw `${TARGETARCH}` in native npm package names.

### C9-05 - Lightroom token UI grants unimplemented future scopes and obscures non-expiring default

Severity: Medium
Confidence: High
Status: Confirmed
Sources: product-marketer-reviewer

Evidence: `apps/web/messages/en.json:781-806`, `apps/web/messages/ko.json:831-856`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:57-61`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:128-181`, `apps/web/src/app/actions/lr-tokens.ts:28-93`, `apps/web/src/lib/admin-tokens.ts:24-25`, `apps/web/src/app/api/admin/lr/upload/route.ts:527`.

The UI creates every Lightroom token with `lr:upload`, `lr:read`, and `lr:delete`, but only upload is currently implemented. If read/delete endpoints are added later, old tokens will silently gain those powers. The UI also creates non-expiring tokens by default but does not label blank expiry as "never expires".

Suggested fix: mint only `lr:upload` until scope selection/read/delete endpoints exist, update copy, and show explicit "Never expires; revoke to disable" for non-expiring tokens. Add tests around minted scopes and expiry display.

### C9-06 - Public analytics writes trust client-supplied internal IDs

Severity: Medium
Confidence: Medium
Status: Confirmed risk in current code path
Sources: critic

Evidence: `apps/web/src/app/actions/public.ts:319-414`, `apps/web/src/db/schema.ts:220-260`, `apps/web/src/lib/analytics-data.ts:28-53`, `apps/web/src/lib/analytics-data.ts:161-185`.

Public view-recording actions validate only primitive ID syntax before inserting analytics events. They do not verify route context, processed/public photo state, share key validity, or expiry. Abuse can pollute analytics and create avoidable DB writes within the single-writer topology.

Suggested fix: insert analytics via context-derived identifiers or `INSERT ... SELECT` predicates that prove the target is public/processed/valid. For shared groups, record by share key or a signed per-page token and require unexpired group visibility.

### C9-07 - New uploads can become permanently absent from production semantic search

Severity: Medium
Confidence: High
Status: Confirmed
Sources: critic

Evidence: `apps/web/src/lib/image-queue.ts:556-683`, `apps/web/src/lib/image-queue.ts:823-859`, `CLAUDE.md:151`, `apps/web/README.md:53-73`.

The queue marks `processed=true` before CLIP embedding side effects complete. Embedding failures are caught and logged, while bootstrap only re-enqueues `processed=false` rows. A visible photo can therefore miss production semantic/similar search indefinitely until manual backfill.

Suggested fix: persist embedding status/error/attempt fields or a durable embedding job table, and retry missing/failed active-model embeddings independently from image processing.

### C9-08 - setTopicMapVisible lacks runtime boolean validation at the server-action boundary

Severity: Medium
Confidence: High
Status: Confirmed
Sources: code-reviewer

Evidence: `apps/web/src/app/actions/topics.ts:594-614`, `apps/web/src/db/schema.ts:4-12`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:66`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:244-245`.

`setTopicMapVisible(topicSlug, mapVisible)` validates the slug but trusts TypeScript for `mapVisible`. Server actions are runtime boundaries; malformed serialized values can be coerced by Drizzle/MySQL or throw generic failures on a public GPS visibility flag.

Suggested fix: reject `typeof mapVisible !== 'boolean'` before persistence and add a malformed-value regression test.

### C9-09 - DB restore temp dump can survive exceptions after upload save

Severity: Low
Confidence: High
Status: Confirmed
Sources: code-reviewer

Evidence: `apps/web/src/app/[locale]/admin/db-actions.ts:434-493`, `apps/web/src/app/[locale]/admin/db-actions.ts:499-585`.

`runRestore` writes the uploaded SQL dump to a mode-0600 temp file, but cleanup after the write is split across expected branches and child-process handlers. Exceptions during header read, stat, scan open/read, env validation, or child-process setup can bypass unlink and leave plaintext SQL in `os.tmpdir()`.

Suggested fix: make one idempotent cleanup owner for the entire post-write flow with a `finally` that unlinks unless already removed. Add a focused cleanup test.

### C9-10 - Bulk update reports requested image count rather than existing/changed rows

Severity: Low
Confidence: Medium
Status: Likely issue
Sources: code-reviewer

Evidence: `apps/web/src/app/actions/images.ts:940-963`, `apps/web/src/app/actions/images.ts:1024-1037`, `apps/web/src/app/actions/images.ts:1091-1134`, `apps/web/src/app/actions/tags.ts:304-343`.

`bulkUpdateImages` validates requested IDs but does not canonicalize to existing IDs inside the transaction. Under concurrent deletion, it can update fewer rows than requested while logging and returning `count: ids.length`.

Suggested fix: select existing IDs inside the transaction before scalar/tag mutations, use that set for writes/audit/return count, and warn or fail on missing IDs.

### C9-11 - Upload preview creates and renders every selected file at once

Severity: Medium
Confidence: High
Status: Confirmed
Sources: perf-reviewer

Evidence: `apps/web/src/components/upload-dropzone.tsx:45-49`, `apps/web/src/components/upload-dropzone.tsx:95-123`, `apps/web/src/components/upload-dropzone.tsx:458-490`.

The uploader permits 100 files and 2 GiB per batch, creates an object URL for every selected file, and renders every preview card. `loading="lazy"` and `decoding="async"` reduce decode pressure but not object URL creation or initial React/render work.

Suggested fix: cap or virtualize previews, show a remaining-file count, and generate/release thumbnail previews incrementally.

### C9-12 - Semantic scan limit hard maximum is unsafe if misconfigured

Severity: Medium
Confidence: Medium
Status: Risk needing manual validation
Sources: perf-reviewer, tracer

Evidence: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:242-280`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`.

`SEMANTIC_SCAN_LIMIT` defaults to 2000 but allows up to 1,000,000. A public request at that configured limit can materialize gigabytes of embedding data and scoring overhead in one Next.js process.

Suggested fix: lower the hard maximum to a host-budgeted value until vector indexing/streamed batches exists; warn/fail on unsafe configuration.

### C9-13 - AVIF bit-depth metadata can overstate the base/downloadable AVIF

Severity: Low
Confidence: Medium
Status: Likely issue
Sources: critic

Evidence: `apps/web/src/lib/process-image.ts:1018-1024`, `apps/web/src/lib/process-image.ts:1224-1262`, `apps/web/src/lib/process-image.ts:1409`, `apps/web/src/lib/image-queue.ts:542-560`, `apps/web/src/components/color-details-section.tsx:471-497`, `apps/web/src/components/lightbox-color-pip.tsx:237-256`.

`avif10bit` is an image-level boolean set after any high-bitdepth AVIF encode succeeds. If an early size succeeds at 10-bit but a later/larger base/download derivative falls back to 8-bit, the UI can label the delivered AVIF as 10-bit.

Suggested fix: track base/largest AVIF bit depth explicitly or store richer per-output status. Test mixed success/fallback behavior.

### C9-14 - Shared-group durable analytics and denormalized view counts can diverge

Severity: Low
Confidence: High
Status: Confirmed
Sources: critic

Evidence: `apps/web/src/lib/data.ts:1312-1327`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:93-119`, `apps/web/src/lib/data.ts:120-125`, `apps/web/src/lib/analytics-data.ts:140-185`.

For numeric-but-invalid `photoId` share URLs, `getSharedGroup()` can increment denormalized `view_count` while the page skips durable `shared_group_views` because `photoId` is truthy. Admin counters can diverge.

Suggested fix: centralize "counts as group view" resolution and use the same boolean for the buffer and durable event, or make the route own both counters after selected-image validation.

### C9-15 - Lightroom upload can relay raw processor errors to PAT callers

Severity: Low
Confidence: Medium
Status: Confirmed defensive-boundary issue
Sources: security-reviewer

Evidence: `apps/web/src/app/api/admin/lr/upload/route.ts:284-304`, `apps/web/src/lib/process-image.ts:844-887`.

The Lightroom PAT upload route returns `err.message` for non-RAW `saveOriginalAndGetMetadata()` failures. Current errors are mostly generic, but future filesystem/codec/internal errors could expose implementation details to token callers.

Suggested fix: return a fixed client message for unknown non-RAW failures and log detailed exceptions server-side. Keep explicit RAW rejection user-actionable.

### C9-16 - Sidecar deleted-mid-reencode cleanup can make a committed batch fail

Severity: Low
Confidence: Medium
Status: Likely issue
Sources: debugger

Evidence: `apps/web/scripts/backfill-color-pipeline.ts:127-132`, `apps/web/scripts/backfill-color-pipeline.ts:400-459`, `apps/web/src/lib/admin-backfill-runner.ts:430-439`.

After a sidecar DB batch commits, deleted-mid-reencode cleanup awaits raw `Promise.all(...)`. A cleanup failure can turn post-commit best-effort orphan removal into a fatal run failure, while the in-app runner catches/logs the same cleanup class.

Suggested fix: catch cleanup failures inside the sidecar helper, log context, and optionally count cleanup warnings instead of throwing after committed DB work.

### C9-17 - Semantic and OG rate-limit comments/tests contain stale rollback descriptions

Severity: Low
Confidence: High
Status: Confirmed stale artifact
Sources: debugger

Evidence: `apps/web/src/lib/rate-limit.ts:17-30`, `apps/web/src/lib/rate-limit.ts:323-340`, `apps/web/src/app/api/search/semantic/route.ts:12-16`, `apps/web/src/app/api/search/semantic/route.ts:181-230`, `apps/web/src/__tests__/semantic-search-route.test.ts:187`, `apps/web/src/__tests__/og-photo-fallback.test.ts:9-10`, `apps/web/src/app/api/og/photo/[id]/route.tsx:126-131`.

Central comments describe rollback behavior that no longer matches locked route behavior for semantic malformed bodies and OG all-sizes-fail fallback. Future maintainers could "fix" code away from the current DoS/enumeration policy.

Suggested fix: update comments/test headers to match the current charged/refunded branches and prefer behavioral tests where practical.

### C9-18 - Action-origin docs still say public.ts is excluded, but the scanner now includes it

Severity: Medium
Confidence: High
Status: Confirmed documentation/source-comment mismatch
Sources: document-specialist

Evidence: `CLAUDE.md:590-602`, `apps/web/src/app/actions/public.ts:311-314`, `apps/web/scripts/check-action-origin.ts:49`, `apps/web/scripts/check-action-origin.ts:360-364`, `apps/web/scripts/check-action-origin.ts:488-490`.

Docs and source comments say `public.ts` is excluded from `lint:action-origin`, but the scanner includes it and applies the narrower public-action contract. The implementation is safer than the docs, but stale docs make the security boundary harder to maintain.

Suggested fix: update `CLAUDE.md` and the `public.ts` comment to document the actual scanner behavior.

### C9-19 - Deploy env-file docs present two competing defaults

Severity: Low
Confidence: High
Status: Confirmed documentation mismatch
Sources: document-specialist, product-marketer-reviewer

Evidence: `AGENTS.md:17-18`, `README.md:108-116`, `CLAUDE.md:648-657`, `.env.deploy.example:1-4`, `scripts/deploy-remote.sh:22-29`, `scripts/deploy-remote.sh:55-58`.

README/AGENTS/CLAUDE present root `.env.deploy` as the normal path, while `.env.deploy.example` says to copy outside the repo by default. Both work, but the mismatch complicates deployment troubleshooting.

Suggested fix: pick one canonical recommendation and make README, CLAUDE, AGENTS, example comments, and deploy helper text agree.

### C9-20 - Checked-in public/sw.js has a stale generated version stamp

Severity: Medium
Confidence: High
Status: Confirmed
Sources: verifier, document-specialist

Evidence: `CLAUDE.md:402-403`, `apps/web/scripts/build-sw.ts:28-47`, `apps/web/package.json:10`, `apps/web/public/sw.js:21-26`.

`build-sw.ts` stamps the service worker with the git short SHA plus pipeline version. Review lanes observed committed `sw.js` carrying an older stamp than the reviewed HEAD. Production builds regenerate it, but dev/review paths can inspect or serve a stale cache namespace.

Suggested fix: regenerate and commit `apps/web/public/sw.js` for the current HEAD, and add a test/lint assertion or adjust the versioning contract so the checked-in artifact does not drift after every commit.

### C9-21 - Tracked review/plan artifacts still contain credential-assignment strings

Severity: Low
Confidence: High
Status: Confirmed
Sources: security-reviewer

Evidence: `.context/plans/done/plan-166-cycle1-admin-upload-test-and-docs.md:22`, `.context/reviews/archive/security-reviewer-cycle1-rpf.md:167-196`, `.context/reviews/archive/security-reviewer-cycle7-rpf.md:36-38`, `.context/reviews/logs-cycle4/designer.log:2467`, `.context/reviews/run7-cycle1/security-reviewer.md:42`, `plan/plan-353-run6-cycle3-deferred.md:168`, `apps/web/src/__tests__/tracked-secrets.test.ts:5-20`.

Committed historical review/plan/log artifacts contain credential-assignment patterns. Some are placeholders or historical references, but the scanner covers only a fixed allowlist rather than all committed docs/logs.

Suggested fix: redact credential assignment strings to placeholders and broaden the tracked-secrets test with explicit allowlists.

### C9-22 - Test coverage gaps remain around semantic malformed rows, audit metadata, visual assertions, and coverage reporting

Severity: Medium
Confidence: High
Status: Confirmed coverage gap
Sources: test-engineer

Evidence: `.context/reviews/test-engineer.md` findings `TE9-C01` through `TE9-C04`.

Test-engineer found missing regression coverage for mixed malformed semantic embedding rows and audit metadata serialization/truncation, nav "visual" screenshots that do not assert visuals, and no coverage script/report/threshold gate for critical surfaces.

Suggested fix: add targeted behavioral tests for the first two code paths. Treat visual assertion/coverage-threshold work as quality-infrastructure follow-up unless scoped into this cycle.

## Manual Validation / Operational Risks

These were recorded by multiple lanes but are not directly implementable code defects in this cycle:

- Process-local coordination remains valid only for the documented single web-instance topology. Sources: critic, security-reviewer, architect, tracer.
- DB-only restore can drift from file storage; restore drills should include filesystem consistency. Sources: critic, architect, security-reviewer.
- Production semantic search depends on env, DB row, model weights, and embedding rows staying aligned; live demo claims need smoke validation. Sources: architect, product-marketer-reviewer, document-specialist.
- TLS/HSTS and `TRUST_PROXY=true` safety depend on production ingress/edge topology. Source: security-reviewer.
- Multiple root admins and deferred 2FA fit only the current personal-gallery threat model. Source: security-reviewer.
- Plaintext DB backups at rest depend on host disk/backup controls. Source: security-reviewer.
- Custom modal shells need real assistive-technology validation for virtual-cursor isolation. Source: designer.
- Authenticated admin UI needs live browser coverage with an auth state. Source: designer.
- Sidecar runbooks pin `tsx@4.21.0` while repo dev dependency is `^4.22.4`; validate or document intentional pin. Source: document-specialist.
- Playwright e2e is Chromium-only; WebKit/Firefox/mobile-engine risks remain manual. Source: test-engineer.

## Cross-Agent Agreement

Higher-signal findings:

- Analytics retention indexes: perf-reviewer + architect.
- Stale service worker stamp: verifier + document-specialist.
- Deploy env-file docs mismatch: document-specialist + product-marketer-reviewer.
- Process-local single-instance boundary: critic + security-reviewer + architect + tracer.
- DB-only restore/file drift: critic + security-reviewer + architect.
- Semantic search runtime alignment/scan limits: perf-reviewer + tracer + architect + product-marketer-reviewer.

## Already-Fixed / False-Positive Themes

Reviewers confirmed prior-cycle findings are closed for tag-filter canonical state, grid-card fallback hydration, top-view analytics indexes, CLIP preprocessing limiter, retry settings snapshot, public nav resilience, search modal accessibility basics, touch-target guardrails, semantic route header comments, token navigation, and migration/privacy/security scanner contracts.
