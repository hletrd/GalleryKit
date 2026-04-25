# Architect Review — Cycle 8 Prompt 1

## Summary
The repo is broadly coherent for its documented **single-node, local-filesystem** deployment, but several architectural seams are only partially abstracted. The biggest risks are (1) storage abstraction drift from the real file topology, (2) selective cross-process coordination that makes accidental multi-instance deployment unsafe, and (3) metadata/OG behavior that is not driven by the same canonical topic data as the page layer.

## Inventory
Reviewed these repo areas before forming findings:

- Docs / deployment: `README.md`, `apps/web/README.md`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`
- Runtime topology / framework: `apps/web/next.config.ts`, `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`
- DB / schema: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle.config.ts`
- Core server libs: `apps/web/src/lib/{data,gallery-config,gallery-config-shared,image-queue,process-image,process-topic-image,rate-limit,request-origin,revalidation,restore-maintenance,serve-upload,session,sql-restore-scan,upload-paths,upload-tracker-state,storage/*}.ts`
- Server actions / routes: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/api/*`, public/admin page routes under `apps/web/src/app/[locale]`
- Tests: representative unit tests under `apps/web/src/__tests__/*` and e2e suites under `apps/web/e2e/*`

## Analysis

### 1) Confirmed: the storage abstraction has already drifted from the real storage topology
- **Severity:** Medium
- **Confidence:** High
- **Class:** Confirmed

**Evidence**
- The storage module explicitly says it is **not wired into the live pipeline**: `apps/web/src/lib/storage/index.ts:4-12`
- The experimental backend assumes everything lives under `UPLOAD_ROOT`, including `original` and `resources`: `apps/web/src/lib/storage/local.ts:4-5`, `apps/web/src/lib/storage/local.ts:20`, `apps/web/src/lib/storage/local.ts:43-47`
- The live upload topology does **not** match that assumption:
  - originals are split to `UPLOAD_ORIGINAL_ROOT`, not `UPLOAD_ROOT`: `apps/web/src/lib/upload-paths.ts:24-46`
  - topic images live under `public/resources`: `apps/web/src/lib/process-topic-image.ts:10-19`, `apps/web/src/lib/process-topic-image.ts:42-80`

**Why this matters**
This is more than “unused code.” The abstraction models the wrong topology. If someone later routes uploads/serving through `getStorage()` or adds a non-local backend, they will inherit a shape that does not match the real split between:
- private originals
- public processed derivatives
- public topic resources

**Failure scenario**
A future “switch storage backend” change migrates only `UPLOAD_ROOT` data and silently leaves original files or topic resources outside the abstraction, causing broken restores, partial migrations, or mixed serving paths.

**Concrete fix**
Either:
1. **Delete** `src/lib/storage/*` until the repo is ready for end-to-end adoption, or
2. Replace it with a topology-aware abstraction that has explicit domains like:
   - `originals` → private root
   - `derivatives` → public uploads root
   - `topicResources` → public resources root  
   Then route live upload/process/serve code through that single contract.

---

### 2) Confirmed: cross-process coordination is inconsistent, so “single-instance” is a hard runtime invariant
- **Severity:** High
- **Confidence:** High
- **Class:** Confirmed / Manual-validation risk

**Evidence**
- The docs explicitly say the shipped deployment is **single web-instance/single-writer** because restore maintenance, upload quotas, and image queue state are process-local: `README.md:143-146`
- Restore maintenance is a process-local global boolean: `apps/web/src/lib/restore-maintenance.ts:1-55`
- Health and actions trust that local flag:
  - `apps/web/src/app/api/health/route.ts:7-16`
  - `apps/web/src/app/actions/auth.ts:70-75`
  - `apps/web/src/app/actions/public.ts:76-77`, `apps/web/src/app/actions/public.ts:114-116`
- Upload-contract locking is also process-local:
  - tracker storage: `apps/web/src/lib/upload-tracker-state.ts:7-20`
  - “active upload claims” gate: `apps/web/src/lib/upload-tracker-state.ts:52-60`
  - settings mutation depends on that local gate: `apps/web/src/app/actions/settings.ts:74-78`
  - upload action mutates that local tracker: `apps/web/src/app/actions/images.ts:122-143`
- Shared-group view counts are buffered in process memory and can be dropped: `apps/web/src/lib/data.ts:11-109`
- By contrast, image processing **does** use DB advisory locks across connections/processes: `apps/web/src/lib/image-queue.ts:145-171`

**Why this matters**
The repo has mixed coordination models:
- image queue: cross-process aware
- restore mode / upload claims / view-count buffering: process-local only

That means the app is not merely “optimized for singleton”; parts of correctness depend on singleton semantics.

**Failure scenario**
If a second app instance appears during a rolling deploy or accidental scale-out:
- one node can enter restore mode while another still reports healthy and accepts traffic
- one node can block settings changes for local uploads while another keeps uploading
- buffered shared-group view counts can diverge or be lost across restarts

**Concrete fix**
Choose one direction:
1. **Enforce singleton at runtime**  
   Add a startup assertion / deployment guard / health metadata that fails loud if more than one app instance is active.
2. **Make coordination shared**  
   Move restore state, upload claims, and buffered counters to MySQL/Redis and keep node-local memory only as a cache.

---

### 3) Confirmed: topic OG image generation is semantically decoupled from canonical topic data
- **Severity:** Medium
- **Confidence:** High
- **Class:** Confirmed

**Evidence**
- Topic page metadata uses canonical topic data from DB, including `topicData.label`: `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:43-56`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:67-90`
- But `/api/og` does **not** read the topic record; it reconstructs display text from the slug: `apps/web/src/app/api/og/route.tsx:17-23`, `apps/web/src/app/api/og/route.tsx:28-31`, `apps/web/src/app/api/og/route.tsx:89-104`
- Topic mutations do full app revalidation: `apps/web/src/app/actions/topics.ts:128-129`, `apps/web/src/app/actions/topics.ts:272-273`
- The OG route still adds its own hour cache: `apps/web/src/app/api/og/route.tsx:39`, `apps/web/src/app/api/og/route.tsx:137-143`

**Why this matters**
The page layer and the OG-image layer are driven by different sources of truth:
- page title/description: canonical topic row
- OG image text: slug prettification

So a topic can have correct page metadata but still produce an OG card with the wrong label style.

**Failure scenario**
A topic label like “E2E Smoke” or a curated human-friendly title is shown in page metadata, while shares render “E2e Smoke”/slug-derived text in the OG image. Alias/canonical redirects don’t help because the OG route only sees the slug.

**Concrete fix**
Have `/api/og` resolve the topic row and use `topics.label` as its primary display string. If avoiding DB reads is important, pass the canonical label as a signed/generated param from the page layer instead of recomputing from slug.

---

### 4) Likely: public rate-limiting policy drifts by surface in multi-node deployments
- **Severity:** Medium
- **Confidence:** Medium
- **Class:** Likely

**Evidence**
- Infinite-scroll load-more uses an in-memory-only limiter: `apps/web/src/app/actions/public.ts:35-111`
- Search uses a DB-backed limiter in addition to memory: `apps/web/src/app/actions/public.ts:114-160`

**Why this matters**
The hottest public read path (`loadMoreImages`) changes behavior when you add replicas or restart processes, while search/login/share do not drift the same way. That is hidden coupling between deployment topology and abuse posture.

**Failure scenario**
A scraper can multiply its effective load-more budget by replica count, while search remains globally bounded. Ops sees inconsistent rate-limit behavior depending on which public surface is being abused.

**Concrete fix**
Either:
- move load-more to the same shared limiter strategy as search, or
- explicitly declare it best-effort and shift throttling to CDN/reverse-proxy layer so topology doesn’t change behavior.

---

### 5) Likely: CDN/asset-origin support is upload-only, not asset-wide
- **Severity:** Low
- **Confidence:** Medium
- **Class:** Likely / Manual-validation risk

**Evidence**
- `IMAGE_BASE_URL` is the helper path for upload images: `apps/web/src/lib/image-url.ts:1-21`
- Topic thumbnails bypass that helper and are hardcoded to app-origin `/resources/...`: `apps/web/src/components/nav-client.tsx:123-131`
- Topic images are stored separately under `public/resources`: `apps/web/src/lib/process-topic-image.ts:10-19`

**Why this matters**
The repo’s asset-origin abstraction is partial:
- gallery photos can be moved behind `IMAGE_BASE_URL`
- topic thumbnails cannot

**Failure scenario**
A deployment expecting one CDN asset origin still serves topic thumbnails from the app origin, creating mixed caching behavior and uneven offload.

**Concrete fix**
Add a generic asset URL helper or a dedicated `resourceUrl()` path so topic resources and upload derivatives follow the same origin policy.

## Root Cause
The fundamental pattern is **partial extraction**: the app evolved from a single-node local-filesystem design, and some boundaries were abstracted (`upload-paths`, DB-backed queue claims, revalidation helpers), but others remained process-local or route-specific. That leaves the codebase coherent for the documented default topology while still carrying hidden drift between:
- abstraction vs. live topology
- page metadata vs. OG/image generation
- shared-state expectations vs. actual node-local state

## Recommendations
1. **Make topology explicit in code, not just docs** — **Medium effort** — **High impact**  
   Either enforce singleton deployment at startup/health level or move restore/upload/view-count coordination into shared storage.

2. **Resolve the storage contract drift** — **Medium effort** — **High impact**  
   Delete the experimental storage layer or rebuild it around the actual three-way file topology before any backend-pluggability work.

3. **Unify topic metadata and OG generation** — **Low effort** — **Medium impact**  
   Drive `/api/og` from canonical topic records so page metadata and share cards stay consistent.

4. **Normalize asset-origin and public throttling strategy** — **Low/Medium effort** — **Medium impact**  
   Decide whether these are intentionally local-only optimizations or part of the production contract, then align helpers and rate-limit storage accordingly.

## Trade-offs
| Option | Pros | Cons |
|---|---|---|
| Keep strict singleton deployment | Minimal code churn; preserves current simplicity | Operationally fragile; accidental scale-out becomes correctness risk |
| Move coordination to shared storage | Safe rollouts and replica scaling | More infra complexity; more moving parts |
| Delete experimental storage layer | Removes misleading abstraction debt | Gives up near-term backend portability |
| Finish storage abstraction properly | Future-proofs storage backend changes | Requires touching multiple upload/process/serve paths |

## Missed-issues sweep
I did a final sweep for two common classes of repo-wide architectural leaks and did **not** find a confirmed current break:
- **Public/private image field separation looks intentional and guarded**: `apps/web/src/lib/data.ts:111-181`
- **The current `/api/admin/*` download surface is both auth-wrapped and same-origin guarded**: `apps/web/src/app/api/admin/db/download/route.ts:13-32`

## References
- `README.md:143-146` — deployment is explicitly single-instance/single-writer
- `apps/web/src/lib/storage/index.ts:4-12` — storage layer declares itself not wired into runtime
- `apps/web/src/lib/storage/local.ts:20,43-47` — storage backend assumes `original` and `resources` live under `UPLOAD_ROOT`
- `apps/web/src/lib/upload-paths.ts:24-46` — live upload topology splits originals from public derivatives
- `apps/web/src/lib/process-topic-image.ts:10-19,42-80` — topic resources use a separate `public/resources` root
- `apps/web/src/lib/restore-maintenance.ts:1-55` — restore mode is process-local global state
- `apps/web/src/lib/upload-tracker-state.ts:7-20,52-60` — upload claim tracking is process-local global state
- `apps/web/src/lib/data.ts:11-109` — shared-group view counts are buffered in process memory
- `apps/web/src/lib/image-queue.ts:145-171` — image queue uses DB advisory locks across processes
- `apps/web/src/app/actions/settings.ts:74-78` — settings lock depends on local upload claims
- `apps/web/src/app/actions/images.ts:122-143` — uploads mutate local tracker state
- `apps/web/src/app/api/og/route.tsx:17-39,89-104,137-143` — OG route derives topic label from slug and caches separately
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:43-56,67-90` — page metadata uses canonical topic label from DB
- `apps/web/src/app/actions/topics.ts:128-129,272-273` — topic mutations revalidate app data
- `apps/web/src/app/actions/public.ts:35-111` — load-more limiter is in-memory only
- `apps/web/src/app/actions/public.ts:114-160` — search limiter is DB-backed
- `apps/web/src/components/nav-client.tsx:123-131` — topic thumbnails are hardcoded to `/resources/...`
- `apps/web/src/lib/image-url.ts:1-21` — `IMAGE_BASE_URL` abstraction currently applies to upload images only
