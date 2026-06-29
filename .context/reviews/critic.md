# Cycle 14 Critic Review

Review target: current HEAD `c2da917d0fe9620bcbef3897570591080445592c` in `/Users/hletrd/flash-shared/gallery`.

Role: cycle-14 critic. I reviewed current HEAD only. I did not modify production code, runtime data, migrations, dependencies, or deployment config. This file is the review artifact requested by the task.

## Coverage

Required guidance read first:
- `AGENTS.md`
- `CLAUDE.md`
- Code-review skill instructions

Inventory built before findings:
- `git ls-files` HEAD inventory: 2551 tracked paths.
- Review-relevant tracked categories: 8 API route files, 13 server-action files, 96 `src/lib` files, 57 component files, 273 test/e2e files, 31 Drizzle migration/meta files, 27 scripts, 17 root/app config and canonical docs, and 1751 committed `.context` review/plan/artifact paths.

High-risk surfaces inspected directly or by whole-category static sweep:
- Public share/photo/topic pages, public actions, search, semantic/similar routes, OG routes, service worker contracts.
- Admin actions, admin API auth wrappers, same-origin/origin guards, auth/session/token code, rate-limit/proxy IP handling.
- Upload/original-file path helpers, queue/backfill/scripts using originals, derivative serving, image processing cleanup.
- Data privacy projections, `_PrivacySensitiveKeys` guards, search/group/listing SQL shapes, schema indexes.
- Restore/dump SQL scanner, migration journal/reconcile contracts, deploy/nginx/Docker docs and tests.
- E2E skip gates, source-contract tests, TODO/FIXME/unsafe-sink/secret/path/SQL pattern sweeps.

Validation commands run:
- `npm run lint:api-auth --workspace=apps/web` — passed.
- `npm run lint:action-origin --workspace=apps/web` — passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` — passed for scanned mutating public routes.
- Static sweeps for `test.skip`, `describe.skip`, `TODO/FIXME`, `dangerouslySetInnerHTML`, rate-limit exemptions, action-origin exemptions, original upload path consumers, and tracked secret-like filenames.

## Findings Summary

Confirmed issues: 3

Likely issues: 1

Risks needing manual validation: 2

No finding below claims a test/build failure; this was a static critique pass plus focused lint gates, not a full release gate run.

## Confirmed Issues

### C14-CRIT-01 - Original-upload helpers trust stored filenames as path components

Severity: High

Confidence: High

Category: Security / data-loss / operational recovery

Status: Confirmed

Code regions:
- `apps/web/src/lib/upload-paths.ts:57-60` builds original-file candidates with `path.join(UPLOAD_DIR_ORIGINAL, filename)` and `path.join(LEGACY_UPLOAD_DIR_ORIGINAL, filename)` without validating `filename` or proving realpath containment.
- `apps/web/src/lib/upload-paths.ts:75-79` and `apps/web/src/lib/upload-paths.ts:93-100` use the same raw filename join for best-effort and strict original deletion.
- `apps/web/src/app/actions/images.ts:646-654` and `apps/web/src/app/actions/images.ts:751-760` validate filenames before admin delete, but that protection is local to delete actions.
- `apps/web/src/app/actions/images.ts:1234-1237` re-enqueues a failed DB row using `filename_original` without re-validating it.
- `apps/web/src/lib/image-queue.ts:562-623` resolves `job.filenameOriginal` and passes the resulting path to Sharp.
- `apps/web/src/lib/admin-backfill-runner.ts:442-448`, `apps/web/scripts/backfill-clip-embeddings.ts:152-159`, `apps/web/scripts/backfill-cicp-recheck.ts:92-100`, and `apps/web/scripts/backfill-color-pipeline.ts:197-204` resolve DB-stored original filenames for maintenance work.
- `apps/web/src/__tests__/upload-paths.test.ts:58-81` covers primary/legacy/missing resolution only; it does not cover traversal, absolute paths, symlinks, or containment failure.

Failure scenario:
A crafted or corrupted SQL restore, direct DB repair, or legacy import inserts an unprocessed/failed image row with `filename_original = '../../some-readable-file'` or an absolute-path payload. The queue retry/backfill paths do not repeat the delete action's `isValidFilename` guard; they call `resolveOriginalUploadPath`, which can return a path outside the intended originals directory if that joined candidate exists. The app then reads/processes the outside file through Sharp or embedding code. For deletion paths, a future caller of `deleteOriginalUploadFileStrict` that omits the local action guard can unlink outside the originals directory. This violates the documented assumption that upload path traversal is centrally contained.

Concrete fix:
Move the boundary into `upload-paths.ts` so every original-file consumer gets the same guarantee. Reject filenames unless they pass the existing safe filename policy, reject absolute paths, resolve both base directories and candidate paths with `realpath`, require the candidate to stay under the resolved base, and reject symlink candidates with `lstat` before returning. Add tests to `upload-paths.test.ts` for `../`, absolute paths, symlink escape, missing file, primary hit, and legacy hit. Keep the delete action's local validation as defense in depth, not as the primary invariant.

### C14-CRIT-02 - nginx proxy header contract contradicts the documented multi-hop deployment

Severity: Medium

Confidence: High for the repository mismatch; production impact depends on live topology.

Category: Operations / security / availability

Status: Confirmed

Code regions:
- `apps/web/nginx/default.conf:6-8` and `apps/web/nginx/default.conf:25-29` describe nginx as an internal HTTP hop behind a TLS-terminating load balancer or edge.
- `apps/web/nginx/default.conf:68-70`, `apps/web/nginx/default.conf:85-87`, `apps/web/nginx/default.conf:102-104`, `apps/web/nginx/default.conf:142-144`, `apps/web/nginx/default.conf:159-161`, `apps/web/nginx/default.conf:181-183`, and `apps/web/nginx/default.conf:194-196` overwrite `X-Real-IP` and `X-Forwarded-For` with only `$remote_addr`.
- `README.md:152-154` says shipped compose forces `TRUST_PROXY=true`, calls nginx an internal hop behind a TLS-terminating edge, and tells operators to set `TRUSTED_PROXY_HOPS=2` for `CDN/LB -> nginx -> app`.
- `apps/web/src/lib/rate-limit.ts:88-96` gives share routes a per-IP in-memory budget, and `apps/web/src/lib/rate-limit.ts:161-183` selects client IP from trusted forwarded chains when `TRUST_PROXY=true`.
- `apps/web/src/__tests__/nginx-config.test.ts:30-34` locks the overwrite behavior by asserting `$proxy_add_x_forwarded_for` is absent and `$remote_addr` is used.

Failure scenario:
If production traffic reaches this nginx from Cloudflare or another TLS/LB hop, the original client chain is collapsed to the upstream edge address before the app sees it. With `TRUSTED_PROXY_HOPS=2`, the app cannot select the real client from a one-element chain and falls back to the same edge IP. Login, public search, share lookups, OG generation, and analytics buckets can all collapse unrelated visitors behind the CDN/LB into one rate-limit identity, allowing one abusive client to throttle legitimate users sharing that edge.

Concrete fix:
Choose one supported topology and make code/docs/tests agree. If multi-hop edge support is intended, configure nginx with a trusted upstream allowlist, `real_ip_header X-Forwarded-For`, `real_ip_recursive on`, and forward the sanitized chain/client consistently; update `nginx-config.test.ts` around that contract. If the only supported production topology is direct client -> host nginx -> app, remove the CDN/LB and `TRUSTED_PROXY_HOPS=2` guidance from README/nginx comments and document `TRUSTED_PROXY_HOPS=1` as the invariant.

### C14-CRIT-03 - `.context/reviews/**` unignores reviewer scratch by default

Severity: Low

Confidence: High

Category: Repository hygiene / process reliability

Status: Confirmed

Code regions:
- `.gitignore:19-21` ignores `.context/*` and then unignores the entire `.context/reviews/**` subtree.
- `.gitignore:22-25` re-ignores only `*.log` and `gate-logs`, leaving temporary inventories, JSON dumps, hidden scratch files, and raw command captures trackable under the review tree.

Failure scenario:
A critic/verifier writes an intermediate file under `.context/reviews` while producing a committed report. The file appears in `git status` and can be committed with the final review, leaking noisy inventories or local diagnostic output into review history. The project explicitly stores committed reviews there, so this is an easy path for accidental artifact churn.

Concrete fix:
Add explicit ignore rules for reviewer scratch patterns such as `.context/reviews/**/*.tmp`, `.context/reviews/**/.tmp-*`, `.context/reviews/**/*.scratch.*`, and hidden temp files. Alternatively document and use an ignored `.context/scratch/` directory for transient inventories, keeping `.context/reviews/` for intentional report artifacts only.

## Likely Issues

### C14-CRIT-04 - Invalid share-route keys consume the real share lookup budget

Severity: Medium

Confidence: Medium

Category: Availability / UX / rate-limit design

Status: Likely issue

Code regions:
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:79-90` calls `isShareLookupRateLimited()` before `getImageByShareKeyCached(key)`.
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:84-102` calls the same limiter before `getSharedGroupCached(key, ...)`.
- `apps/web/src/lib/data.ts:1177-1181` and `apps/web/src/lib/data.ts:1243-1250` already reject syntactically invalid Base56 keys without querying share rows.
- `apps/web/src/lib/rate-limit.ts:88-96` sets the share lookup budget to 60 requests/minute per IP.
- `apps/web/src/__tests__/shared-route-rate-limit-source.test.ts:10-30` source-locks "rate limit before DB lookup" but does not distinguish cheap syntactic rejection from valid-looking DB lookup.
- `apps/web/src/__tests__/rate-limit.test.ts:258-275` tests the raw budget only, not route behavior for invalid key shapes.

Failure scenario:
A crawler or attacker on the same NAT sends 61 requests to malformed share paths such as `/s/foo` or `/g/not-a-base56-key`. These requests do not need a DB lookup because the data layer would reject them syntactically, but the page body charges the shared per-IP lookup bucket before validation. A legitimate recipient behind the same IP can then get `notFound()` for a valid share link until the minute window resets.

Concrete fix:
Perform a cheap `isBase56(key.trim(), 10)` check in both page bodies before `isShareLookupRateLimited()`, returning `notFound()` without charging for malformed keys. Preserve the existing limiter before valid-looking key DB lookups so enumeration remains throttled. Update the source-contract test to assert: syntactic validation happens before `isShareLookupRateLimited`, and `isShareLookupRateLimited` still happens before `getImageByShareKeyCached` / `getSharedGroupCached`.

## Risks Needing Manual Validation

### C14-CRIT-R1 - Listing/search SQL may be fine at personal scale but has no production-scale evidence in repo

Severity: Medium if the gallery grows into tens of thousands of images/tags; Low at the documented personal-gallery scale.

Confidence: Medium

Category: Performance / UX

Status: Risk needing manual validation

Code regions:
- `apps/web/src/lib/data.ts:878-907` runs the initial public listing query with `LEFT JOIN imageTags/tags`, `GROUP BY images.id`, `COUNT(*) OVER()`, sort by `capture_date, created_at, id`, and offset pagination.
- `apps/web/src/lib/data.ts:1438-1453` uses the same initial-page shape for public smart collections.
- `apps/web/src/db/schema.ts:115-117` indexes `processed,capture_date,created_at` and `topic,processed,capture_date,created_at`, but the sort tie-breaker includes `id`.
- `apps/web/src/lib/data.ts:1482-1555` public text search uses `%LIKE%` predicates across title/description/camera/lens/topic/topic label before running tag/alias fallbacks.

Failure scenario:
On a larger gallery or high-cardinality tag set, initial page loads and public search can degrade into expensive grouped scans/filesorts, especially because `COUNT(*) OVER()` forces total-count work on the grouped result. The code has keyset pagination for load-more paths, but first-page/topic/smart-collection/search latency still needs measurement against production data.

Concrete validation/fix:
Capture `EXPLAIN ANALYZE` and slow-query samples on a production-sized copy for home, topic, tag-filtered home, smart collection, and common search terms. If confirmed, consider separate count caching, avoiding `COUNT(*) OVER()` on first-page SSR, adding indexes that include the `id` sort tie-breaker where MySQL uses them, or introducing a proper full-text/search index for public keyword search.

### C14-CRIT-R2 - Admin/origin E2E coverage is intentionally environment-gated

Severity: Medium when CI does not set the required E2E credentials; Low when the gated lane runs on seeded CI.

Confidence: High for the gating, Medium for actual CI impact.

Category: Testing / release confidence

Status: Risk needing manual validation

Code regions:
- `apps/web/e2e/admin.spec.ts:7-12` skips admin E2E unless CI and `E2E_ADMIN_ENABLED=true` are present.
- `apps/web/e2e/origin-guard.spec.ts:29-35`, `apps/web/e2e/origin-guard.spec.ts:56-58`, and `apps/web/e2e/origin-guard.spec.ts:77` skip credentialed or baseURL-dependent origin-guard paths when local/CI environment is not configured.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:31` and `apps/web/src/__tests__/clip-offline-load.test.ts:41` skip CLIP-weighted integration suites when model weights are absent; that is expected, but it means production semantic mode still depends on a separate seeded lane.

Failure scenario:
The lightweight lint/source-contract/unit tests pass while the browser-level admin login, admin mutations, same-origin rejection, and CLIP model-loading paths are not exercised in the actual CI run. A regression in cookie/session wiring, browser form behavior, reverse-proxy origin headers, or production semantic weights can ship despite strong unit coverage.

Concrete validation/fix:
Check the CI configuration and recent run logs to confirm these gated suites run in at least one required lane with seeded credentials, `baseURL`, and any CLIP model artifacts expected for production semantic mode. If not, add a protected CI job that runs the admin/origin E2E tests against seeded data, and keep CLIP integration as a separate explicit model-weight job rather than a silent default skip.

## Final Missed-Issues Sweep

Common missed issue classes checked:
- Admin API wrappers and mutating server-action same-origin guards: lint gates passed and spot checks matched the guard model.
- Public route/action throttling: mutating public API lint passed; share-route GET throttling and OG/search routes were manually inspected because GET routes are outside that lint gate.
- XSS/HTML sinks: `dangerouslySetInnerHTML` hits are JSON-LD patterns already routed through the safe helper in current source; no new arbitrary HTML sink was promoted.
- Privacy leakage: public selectors, search result fields, share selectors, and privacy guard tests were inspected; no new public exposure was promoted.
- Upload/path traversal: public derivative serving has containment checks; original private helper is the confirmed exception above.
- SQL/restore boundaries: SQL restore scanner and dangerous SQL blocklist were inspected; no additional restore finding was promoted.
- Tests/skips: no `.only` found; skips are admin/origin environment gates and CLIP weight gates.
- Docs/comments/playbooks: current docs generally match code except the proxy topology mismatch and review scratch hygiene above.

Relevant files skipped:
- No tracked source, config, script, migration, canonical doc, or test category was intentionally skipped from inventory or static sweeps.
- I did not line-read every historical `.context/reviews/**` artifact or every binary/image artifact one by one. They were inventoried as tracked HEAD files and included in text/pattern sweeps where applicable, but the direct inspection focus was current product/code/docs/tests/playbooks.

Residual verification gaps:
- Full `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, and Playwright E2E were not run because the task was a review artifact with no production code changes.
- Production proxy topology, CI gated-suite execution, and production-scale query plans require environment evidence outside the repository.
