# Critic Review — Cycle 12 Prompt 1 (ultradeep)

## Scope / inventory reviewed
- Docs & deploy: `README.md`, `apps/web/README.md`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`
- App/runtime: `apps/web/src/instrumentation.ts`, `apps/web/src/proxy.ts`, public/admin routes under `apps/web/src/app/**`
- Data/security/core libs: `apps/web/src/lib/{data,session,rate-limit,auth-rate-limit,request-origin,serve-upload,process-image,image-queue,restore-maintenance,sql-restore-scan,db-restore,gallery-config,image-url}.ts`
- Actions: `apps/web/src/app/actions/{auth,images,public,sharing,settings,seo,tags,topics,admin-users}.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- DB/schema/scripts: `apps/web/src/db/{index,schema}.ts`, `apps/web/scripts/{migrate,seed-admin,seed-e2e,check-api-auth}.ts`
- Tests: unit tests under `apps/web/src/__tests__/*`, Playwright specs under `apps/web/e2e/*`

## Verification sweep
- `npm test --workspace=apps/web` ✅ (`30` files / `159` tests passed)
- `npm run lint --workspace=apps/web -- .` ✅
- `npm run build --workspace=apps/web` ✅

---

## Confirmed findings

### 1) Queue/bootstrap has no retry path after an initial DB outage
**Status:** Confirmed  
**Confidence:** High  
**Citations:** `apps/web/src/lib/image-queue.ts:292-345`, `apps/web/src/lib/image-queue.ts:372-373`, `apps/web/src/instrumentation.ts:1-6`

**Why it matters**
The image-processing bootstrap, orphan cleanup, expired-session purge, rate-limit bucket purge, and audit-log purge are all tied to `bootstrapImageProcessingQueue()`. When the initial DB connection fails, the code only logs and returns; it does not schedule any retry.

**Failure scenario**
The app starts before MySQL is ready. Later the DB recovers, and normal request traffic resumes, but:
- pre-existing `processed = false` images from before the restart are never re-enqueued,
- stale sessions / rate-limit buckets / audit rows never get their hourly cleanup interval,
- orphaned temp files remain until the process is restarted again.

**Suggested fix**
Add a durable retry loop (exponential backoff with jitter) that keeps trying bootstrap until success, or re-attempt bootstrap on the first confirmed successful DB call after startup. The GC interval setup should happen only after a successful bootstrap, but it also needs a retry path.

---

### 2) Shared-group view counts are intentionally lossy because they sit in a process-local debounce buffer
**Status:** Confirmed  
**Confidence:** High  
**Citations:** `apps/web/src/lib/data.ts:10-39`, `apps/web/src/lib/data.ts:47-107`, `apps/web/src/instrumentation.ts:8-30`

**Why it matters**
`bufferGroupViewCount()` accumulates views in memory, flushes every 5s+, and explicitly drops increments when the buffer is full. The only durability bridge is a best-effort flush during graceful shutdown.

**Failure scenario**
A DB hiccup or deploy happens while shared links are getting traffic:
- buffered increments are dropped once `MAX_VIEW_COUNT_BUFFER_SIZE` is hit,
- a crash / forced termination before the next flush loses pending counts,
- multiple app instances each keep their own unsynchronized counters.

**Suggested fix**
If counts matter operationally, move increments to a durable/shared mechanism: direct atomic DB increment per request, Redis-backed counter with periodic fold-in, or a persistent queue. If approximate counts are acceptable, document that clearly in code/docs/UI.

---

### 3) Storage backend support is a dead/partial feature surface; the live pipeline is still hard-wired to local disk
**Status:** Confirmed  
**Confidence:** High  
**Citations:** `apps/web/src/lib/storage/index.ts:4-13`, `apps/web/src/app/actions/images.ts:184-235`, `apps/web/src/lib/serve-upload.ts:32-103`, `apps/web/messages/en.json:542-549`, `apps/web/messages/ko.json:542-549`

**Why it matters**
The repo ships S3/MinIO backend abstractions and user-facing copy about storage backends, but the actual upload, processing, and serving paths still use local filesystem paths directly. There is no integration path from the live image pipeline into `StorageBackend`.

**Failure scenario**
An operator (or future maintainer) assumes S3/MinIO support is real, configures the env vars, or exposes a settings surface later. Uploads still land on local disk, public serving still reads from `UPLOAD_ROOT`, and a stateless/containerized deployment loses or fragments media on replacement/scale-out.

**Suggested fix**
Either:
1. remove or hide the unfinished feature surface until the pipeline is actually wired, or
2. fully integrate `saveOriginalAndGetMetadata`, derivative generation, and upload serving through `StorageBackend`, with migration tooling and integration tests.

---

## Likely findings

### 4) Restore maintenance is process-local, not deployment-wide
**Status:** Likely  
**Confidence:** High  
**Citations:** `apps/web/src/lib/restore-maintenance.ts:1-55`, `apps/web/src/app/[locale]/admin/db-actions.ts:243-284`, `apps/web/docker-compose.yml:1-22`

**Why it matters**
The restore path correctly acquires a DB advisory lock, but the broader “maintenance mode” that blocks writes is just a `globalThis` boolean inside one Node process. The documented compose file runs a single `web` service, so the default deployment shape reduces the blast radius—but the code itself is not safe once there is more than one app process/replica.

**Failure scenario**
During a restore, instance A holds the DB lock and flips its local maintenance boolean. Instance B never sees that flag and can still accept uploads, tag edits, SEO/settings mutations, etc. That creates cross-instance write traffic against a database that is in the middle of being restored.

**Suggested fix**
Keep `GET_LOCK` for restore mutual exclusion, but move the maintenance gate to a shared source of truth (DB row, dedicated table, Redis key). Every mutating action and the background queue should consult that shared state, not a process-local boolean.

---

### 5) Upload quota enforcement is instance-local and keyed only by client IP
**Status:** Likely  
**Confidence:** High  
**Citations:** `apps/web/src/app/actions/images.ts:55-60`, `apps/web/src/app/actions/images.ts:118-172`, `apps/web/src/lib/rate-limit.ts:59-84`

**Why it matters**
The cumulative upload quota is enforced with an in-memory `Map` keyed by `getClientIp()`. That means the protection is neither durable nor shared across replicas, and multiple admins behind one NAT or proxy hop can consume the same quota bucket.

**Failure scenario**
A reverse-proxied multi-instance deployment fans upload requests across replicas. Each process has its own empty tracker, so the intended cross-request 2 GiB / 100-file guard is bypassed. Conversely, two admins sharing the same egress IP can throttle each other even though they are separate authenticated users.

**Suggested fix**
Move the upload tracker to a shared store (DB/Redis) and scope it to an authenticated principal (user/session) with IP as a secondary signal, not the sole key.

---

## Manual-validation findings

### 6) Backup/restore is the riskiest operational workflow, but coverage stops short of a real round-trip
**Status:** Manual-validation  
**Confidence:** High  
**Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:107-429`, `apps/web/e2e/admin.spec.ts:15-55`, `apps/web/src/__tests__/backup-download-route.test.ts:48-92`

**Why it matters**
The backup/restore path shells out to `mysqldump` / `mysql`, depends on temp-file IO, advisory locks, and maintenance-window coordination, and is exactly the sort of feature that fails only in a real environment. Current automated coverage verifies the download route and admin page presence, but not an end-to-end dump/restore execution.

**Failure scenario**
The UI passes, unit tests pass, and the image builds—but a real deploy is missing a client binary, flag compatibility changes, temp storage permissions are wrong, or the restore path mishandles stdin/maintenance in production. The breakage appears only when recovery is urgently needed.

**Suggested fix**
Add an opt-in integration test (containerized MySQL is fine) that:
1. seeds known rows,
2. runs `dumpDatabase()`,
3. mutates the DB,
4. runs `restoreDatabase()`,
5. asserts the original dataset is restored and maintenance gates behaved correctly.

---

## Final sweep / notes
- I did a final pass specifically for cross-boundary issues where deploy/runtime assumptions diverge from code behavior.
- No new typecheck/lint/test failures were introduced by this review pass.
- I did **not** find a current red-flag auth bypass in the reviewed admin/API surfaces; the highest-signal issues are operational-state consistency and feature-surface drift.

## Total findings
- Confirmed: 3
- Likely: 2
- Manual-validation: 1
- **Total: 6**
