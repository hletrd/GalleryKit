# Cycle 96 Architect Review Retry — Complete Review Artifact

## Reviewed inventory

Reviewed current repository state at `HEAD == origin/master == 2f22620c361304ba0408053f546f45e3c74ddfdb`.

Architecture/design-relevant inventory:

- **Repo rules and operating docs:** `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/cycle-95-2026-07-01-{plan,deferred}.md`, `.context/reviews/_aggregate.md`
- **Schema/migration layer:** `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`
- **Restore/ops boundaries:** `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance*.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/scripts/restore-maintenance-recovery.*`
- **Data/query layer:** `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/smart-collections.ts`
- **Server actions/API boundaries:** `apps/web/src/app/actions/*.ts`, `apps/web/src/app/api/**/route.ts*`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`
- **Image/storage/semantic pipeline:** `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/storage/*`, `apps/web/src/lib/clip-*.ts`, `apps/web/scripts/backfill-*-*.ts`
- **Public rendering/feed routes:** localized public pages, `/feed.xml`, topic feed routes, sitemap/robots/feed helpers
- **Operational/deploy files:** root/package scripts, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`
- **Architectural guard tests:** migration journal/reconcile tests, privacy/source-contract tests, route/action guard lint tests, restore/queue/backfill tests, LR upload/token tests, public listing query tests

## Validation limitations

- Review-only lane: no source files were modified and no build/test/deploy was run.
- `omx explore` was attempted first for inventory but failed in this sandbox with EPERM; inventory then used read-only shell inspection.
- Findings are validated from current source and committed docs, not from comments/tests alone. Tests are cited only where they demonstrate an existing guard or gap.
- No live production host, MySQL instance, Docker volume, browser, or CLIP model-weight runtime was exercised.
- Existing untracked `.context/reviews/cycle-96-2026-07-01/` artifacts were present before this retry; this review validates claims independently against source.

## Confirmed findings

### C96-ARCH-01 — Release/deploy ledgers are stale for current `master`

**Severity / confidence:** Medium / High
**Risk type:** Operational, lifecycle evidence, review convergence

**Evidence:**

- Repo policy requires deploy after every pushed `master` commit: `AGENTS.md:15-20`, especially `AGENTS.md:17`.
- Current durable plan index still records Cycle 95 as committed/pushed/deployed at `2178046587484fb301bc731f855699e44888d2e6`: `.context/plans/README.md:5-8`.
- Cycle 95 plan evidence likewise names only `2178046587484fb301bc731f855699e44888d2e6`: `.context/plans/cycle-95-2026-07-01-plan.md:46-56`.
- Latest aggregate still says the release-ledger finding was scheduled/closed around that parent commit: `.context/reviews/_aggregate.md:13-29`.
- `git rev-parse HEAD` and upstream both resolve to `2f22620c361304ba0408053f546f45e3c74ddfdb`.

**Finding:**

The committed operational ledgers are one pushed commit behind current `master`. This is not an app-runtime bug, but it is an architectural process risk because these `.context` ledgers are the project’s durable state for review/deploy continuation.

**Failure scenario:**

A later cycle treats `2178046` as the last deployed/smoked state, while current source is `2f22620`. Agents may repeat stale-ledger work, skip deploy evidence for the actual terminal commit, or mis-scope future regression review.

**Suggested fix:**

Verify whether `2f22620c361304ba0408053f546f45e3c74ddfdb` was deployed and smoked. If yes, update the plan index and aggregate to name it as the terminal deployed commit. If not, deploy/smoke it through the normal repo policy and then record that evidence.

---

### C96-ARCH-02 — Restore maintenance does not fence foreground admin writes already in flight

**Severity / confidence:** High / High
**Risk type:** Restore boundary, write coordination, data consistency

**Evidence:**

- Restore enters durable maintenance and then drains selected queues/background writers: `apps/web/src/app/[locale]/admin/db-actions.ts:449-503`.
- The in-process restore state is only an `active` boolean; `getRestoreMaintenanceMessage()` is a point-in-time read, not a lease/refcount barrier: `apps/web/src/lib/restore-maintenance.ts:21-30`.
- Example foreground actions check maintenance only at entry, then do later DB writes:
  - Settings: entry check `apps/web/src/app/actions/settings.ts:41-48`, transaction writes `apps/web/src/app/actions/settings.ts:163-175`
  - Tags: entry check `apps/web/src/app/actions/tags.ts:42-49`, transaction/update writes `apps/web/src/app/actions/tags.ts:83-95`
  - Smart collections: entry check `apps/web/src/app/actions/collections.ts:15-21`, insert/update/delete writes `apps/web/src/app/actions/collections.ts:45-51`, `apps/web/src/app/actions/collections.ts:95-123`
  - Sharing: entry check `apps/web/src/app/actions/sharing.ts:91-99`, image row update `apps/web/src/app/actions/sharing.ts:145-156`

**Finding:**

Restore blocks new actions that enter after maintenance is active, and it quiesces specific queue/background paths, but it does not close a shared foreground-write gate and wait for already-entered admin actions to drain. A request can pass the maintenance precheck, await validation/reads/rate limits, and then write after restore has begun.

**Failure scenario:**

An admin starts `updateGallerySettings()`. It passes `getRestoreMaintenanceMessage()` at line 43, performs reads/validation, then a DB restore begins and imports SQL. The settings action later writes at lines 163-175 into a database being restored. The write can be lost, land in the restored dataset unexpectedly, or fail mid-restore.

**Suggested fix:**

Introduce a shared foreground admin-write barrier:

1. Mutating application-table actions acquire a short write lease before their final DB mutation section.
2. Restore flips the barrier into “closing” mode before import.
3. New leases are rejected.
4. Restore waits for active leases to drain before running `runRestore()`.
5. Keep upload/backfill locks, but cover all foreground admin writers with representative race tests.

---

### C96-ARCH-03 — Atom feed routes bypass public restore-maintenance behavior and can cache partial restore data

**Severity / confidence:** Medium / High
**Risk type:** Public read boundary, restore UX, cache correctness

**Evidence:**

- The root feed route imports feed/data helpers but no restore-maintenance guard: `apps/web/src/app/feed.xml/route.ts:1-12`.
- It immediately reads SEO/config and image rows: `apps/web/src/app/feed.xml/route.ts:36-49`.
- It returns public cache headers for successful feed XML: `apps/web/src/app/feed.xml/route.ts:163-174`.
- The topic feed route has the same pattern: request handler and data reads at `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:36-73`, public cache response at `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:172-181`.
- Normal public pages explicitly gate on restore maintenance and render maintenance UI: `apps/web/src/app/[locale]/(public)/page.tsx:13-15`, `apps/web/src/app/[locale]/(public)/page.tsx:155-160`.
- Feed data is sourced from live DB rows via `getImagesForFeed()`: `apps/web/src/lib/data.ts:828-853`.

**Finding:**

Public pages honor restore maintenance, but Atom feed route handlers do not. During restore, feeds can query partially imported DB state and emit cacheable XML.

**Failure scenario:**

A feed reader or crawler requests `/feed.xml` while restore is in progress. The route reads a transient subset of `images`, renders an empty or partial feed, and returns `Cache-Control: public, max-age=600, s-maxage=1800`. A CDN or reader caches the partial feed after user-facing public pages would have shown maintenance.

**Suggested fix:**

Apply the same restore-maintenance policy to feed routes. At the start of root and topic feed handlers, check `isRestoreMaintenanceActive()` or a route-safe durable helper. Return either:

- `503` with `Retry-After` and `Cache-Control: no-store`, or
- a maintenance feed response that is explicitly non-cacheable.

Add route tests that set maintenance active and assert no DB feed rows are read and no public cache header is emitted.

---

### C96-ARCH-04 — `image_embeddings` schema prevents model-version staging and rollback

**Severity / confidence:** Medium / High
**Risk type:** Schema evolution, semantic-search rollout, extensibility

**Evidence:**

- Drizzle schema makes `image_id` the sole primary key: `apps/web/src/db/schema.ts:284-299`.
- Initial SQL migration also uses `PRIMARY KEY (image_id)`: `apps/web/drizzle/0012_image_embeddings.sql:5-12`.
- Legacy reconcile mirrors the same single-key shape: `apps/web/scripts/migrate.js:653-666`.
- Queue writer upserts on duplicate key and overwrites `embedding` plus `modelVersion`: `apps/web/src/lib/image-queue.ts:379-390`.
- Operator backfill explicitly says target-version re-embedding overwrites the existing row: `apps/web/scripts/backfill-clip-embeddings.ts:27-42`, with the same upsert at `apps/web/scripts/backfill-clip-embeddings.ts:212-223`.
- Routes filter by active model version: semantic route `apps/web/src/app/api/search/semantic/route.ts:270-279`; similar route `apps/web/src/app/api/search/similar/[id]/route.ts:135-177`.
- The CLIP runbook requires pre-enable production backfill and potentially repeated runs: `CLAUDE.md:527-546`.

**Finding:**

The schema stores only one embedding row per image. Since writers overwrite on `image_id`, operators cannot keep stub/prod or prod-v1/prod-v2 embeddings side-by-side for staged rollout, comparison, or rollback.

**Failure scenario:**

An operator backfills a new production model version. Existing active embeddings are overwritten incrementally. If the new model underperforms or the rollout is interrupted, there is no old-version row to switch back to. Active-model routes can also return partial or empty results until the replacement backfill completes.

**Suggested fix:**

Migrate to composite storage keyed by `(image_id, model_version)`:

- Add a migration changing the primary/unique key.
- Update Drizzle schema and `reconcileLegacySchema`.
- Upsert by both `image_id` and `model_version`.
- Keep route filters by active model version.
- Add explicit old-model garbage collection only after successful cutover.
- Add tests proving inactive model rows survive backfill and rollback.

---

### C96-ARCH-05 — First-page public listing queries force exact counts through grouped tag joins

**Severity / confidence:** Medium / High
**Risk type:** Query architecture, scalability, product/data coupling

**Evidence:**

- `getImagesLitePage()` selects `COUNT(*) OVER()` together with public fields and `tagNamesAgg`: `apps/web/src/lib/data.ts:911-915`.
- The same query joins `imageTags`/`tags`, groups by image, orders, then limits/offsets: `apps/web/src/lib/data.ts:916-926`.
- Smart-collection first-page path repeats the same grouped window-count shape: `apps/web/src/lib/data.ts:1495-1510`.
- The UI consumes this exact count for display: `apps/web/src/components/home-client.tsx:267-269`.
- A source-contract test currently locks the window-function shape: `apps/web/src/__tests__/data-tag-names-sql.test.ts:107-116`.

**Finding:**

The first page of broad public listings couples a user-visible count to the heaviest listing query shape: tag joins, grouping, ordering, and an exact window count. Cursor load-more avoids the count, but initial/home/smart-collection paths still pay the exact-count cost.

**Failure scenario:**

A large gallery or broad smart collection requests the first page. MySQL must materialize/group the listing set and compute `COUNT(*) OVER()` even though the UI only needs the first page plus a display count. Initial render latency grows with gallery size and tag cardinality.

**Suggested fix:**

Decide the product contract for counts, then change the query shape accordingly:

- Lazy-load count separately.
- Use a cheaper exact count query that avoids tag aggregation where possible.
- Use cached/approximate counts.
- Or remove exact first-page counts from the UI.

Update tests that currently assert `COUNT(*) OVER()` as an invariant.

---

### C96-ARCH-06 — LR token list collapses DB/table failures into an empty-token state

**Severity / confidence:** Medium / High
**Risk type:** Admin API boundary, reliability, error modeling

**Evidence:**

- `listTokensForUser()` catches every SELECT failure and returns `[]`: `apps/web/src/lib/admin-tokens.ts:178-190`.
- `listLrTokens()` returns that array directly after auth: `apps/web/src/app/actions/lr-tokens.ts:131-140`.
- Client load logic clears errors when the result is an array: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:37-47`.
- The UI renders the empty state when `tokens.length === 0`: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:146-163`.

**Finding:**

The library’s “table missing” compatibility behavior is too broad: any DB error is modeled as “zero tokens.” The client has an alert path for `{ error }`, but the lower layer prevents ordinary SELECT failures from reaching it.

**Failure scenario:**

The `admin_tokens` table is missing after migration drift, the DB user loses SELECT permission, or MySQL times out. The admin Tokens page shows “No tokens yet” instead of a retryable operational error. An admin may generate/revoke credentials based on a false view of token state.

**Suggested fix:**

Make token listing return a discriminated result:

- Known missing-table/pre-migration state → explicit “feature unavailable/migration pending” error.
- Other DB failures → `{ error }` or thrown error mapped by `listLrTokens()`.
- Successful empty list → `[]`.

Add behavior tests that mock list failure and assert the persistent retry alert, not the empty state.

---

### C96-ARCH-07 — Token label length contract differs between server code points and browser `maxLength`

**Severity / confidence:** Low / High
**Risk type:** Cross-layer contract, i18n/Unicode UX

**Evidence:**

- Server validates LR token labels by Unicode code points with a 128-code-point limit: `apps/web/src/app/actions/lr-tokens.ts:60-69`.
- Tests encode the intended contract: 128 camera emoji are accepted as 128 code points / 256 UTF-16 units: `apps/web/src/__tests__/lr-tokens-action.test.ts:127-143`.
- Client input applies `maxLength={128}`: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:209-218`.

**Finding:**

The server contract is code-point based, but the browser input cap is UTF-16-code-unit based. Non-BMP labels accepted by the server can be blocked or truncated in the UI before submission.

**Failure scenario:**

An admin enters a 128-emoji camera label. The server would accept it, but the browser input stops around 64 emoji because each emoji uses two UTF-16 code units. UI behavior contradicts the server contract and test intent.

**Suggested fix:**

Remove strict HTML `maxLength={128}` or raise it to a conservative transport limit. Add client-side `Array.from(label).length <= 128` validation using the same inline error path as the server.

## Likely / manual-validation risks

1. **Current production deployment for `2f22620` is unproven from committed artifacts.**
   Source ledgers only prove deploy/smoke for `2178046`; live host verification was not available in this review.

2. **Real CLIP behavior remains operator/manual evidence.**
   Code gates and runbook are present, but production weights, model-path correctness, and full backfill completion require host validation. Relevant runbook: `CLAUDE.md:501-565`.

3. **DB restore is not a full filesystem rollback.**
   Restore imports SQL and reruns migrations, while image originals/derivatives/resources live on bind-mounted filesystem paths. This is documented as an operator boundary, but full recovery still requires host-level backup/restore drills.

4. **Color-pipeline sidecar backfill queues all candidates before awaiting completion.**
   Source fetches all candidate rows at once (`apps/web/scripts/backfill-color-pipeline.ts:383-400`) and pushes one `queue.add()` promise per row before `Promise.allSettled()` (`apps/web/scripts/backfill-color-pipeline.ts:525-562`). This is bounded by personal-gallery expectations but should be manually load-tested before very large galleries.

5. **Storage abstraction is not a backend-switching boundary yet.**
   The storage module itself says live upload/processing/serving still use direct filesystem paths: `apps/web/src/lib/storage/index.ts:1-12`, while upload paths are direct local directories in `apps/web/src/lib/upload-paths.ts:12-47`. Any S3/remote-storage work must migrate all direct filesystem call sites, not just implement `StorageBackend`.

6. **LR upload API remains high-value behavior with limited route-level execution coverage.**
   The route has many runtime branches for token auth/scope, maintenance, body limits, GPS/HDR rejection, cleanup, and success shape: `apps/web/src/app/api/admin/lr/upload/route.ts:84-128`, `apps/web/src/app/api/admin/lr/upload/route.ts:396-434`, `apps/web/src/app/api/admin/lr/upload/route.ts:500-586`. Existing LR test coverage is source-contract based: `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-15`.

## Final missed-issue sweep

- Reviewed current docs/rules, migration runbook, deploy policy, schema/migration/reconcile paths, restore lifecycle, foreground admin mutations, feed/public read paths, semantic-search schema and routes, listing query shape, token admin boundary, storage abstraction, and sidecar backfills.
- Confirmed findings above are grounded in executable source paths, not comments or tests alone.
- No new confirmed auth bypass, public PII leak, raw-SQL injection, or destructive migration drift was found in this pass.
- No files were modified by this review lane.
- Stop condition met: architectural/design findings are enumerated with citations, scenarios, fixes, severity/confidence, and validation gaps.