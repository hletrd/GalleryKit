# Latent-bug / failure-mode review

## Inventory read first
Reviewed the repo docs and the high-risk flows before drilling into code:

- `README.md`, `CLAUDE.md` — deployment/runtime assumptions, upload and revalidation behavior, and the privacy/rate-limit model.
- `apps/web/src/lib/{data,session,image-queue,process-image,serve-upload,upload-paths,rate-limit,restore-maintenance}.ts` — cache/state, queue recovery, and filesystem boundaries.
- `apps/web/src/app/actions/{images,topics,tags,sharing,auth,settings,admin-users,public}.ts` — mutation paths and revalidation surfaces.
- `apps/web/src/app/[locale]/(public)/{[topic],s/[key],g/[key]}/page.tsx` — the public pages that consume cached data.
- `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/instrumentation.ts` — restore/backup and startup wiring.
- Relevant tests in `apps/web/src/__tests__/` for queue shutdown, upload serving, session hashing, rate limiting, restore maintenance, and public actions.

## Findings summary
- Confirmed issues: 1
- Likely issues: 1
- Manual-validation risks: 1
- Total findings: 3

---

## 1) Confirmed: uploads do not invalidate the topic page that actually renders the new photos

**Files / regions**
- `apps/web/src/app/actions/images.ts:337-338`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:16, 84-120`

**Failure scenario**
`uploadImages()` revalidates only `/` and `/admin/dashboard` after a successful batch upload. The public topic page is its own ISR surface (`export const revalidate = 3600`), and it renders the newly uploaded items via `getImagesLite(topic, ...)`. That means a user can upload photos into a topic, see the admin/home refresh, and still not see the new images on `/{topic}` for up to an hour.

This is a classic misleading-success failure mode: the action returns `success: true`, the admin UI refreshes, but the public topic listing remains stale.

**Fix**
Revalidate the affected topic path after a successful upload batch, e.g. `revalidateLocalizedPaths('/', '/admin/dashboard', `/${topic}`)` or broaden to `revalidateAllAppData()` if the full-app invalidation cost is acceptable.

**Confidence**: High

---

## 2) Likely: queue bootstrap is a race at startup because it is invoked twice with no single-flight guard

**Files / regions**
- `apps/web/src/lib/image-queue.ts:292-373`
- `apps/web/src/instrumentation.ts:1-6`

**Failure scenario**
The queue bootstrap runs in two places:
1. the module-level side effect `void bootstrapImageProcessingQueue();` in `image-queue.ts`, and
2. the explicit startup call in `register()` inside `instrumentation.ts`.

`bootstrapImageProcessingQueue()` only sets `state.bootstrapped = true` after it has queried pending rows and enqueued them. There is no in-progress promise lock. On startup, those two callers can overlap, both observe `bootstrapped === false`, both query the same pending rows, and both enqueue work. `enqueueImageProcessing()` dedupes some of that by job ID, but the startup path is still race-prone: slow DB startup, transient latency, or a long pending queue can let the second bootstrap race ahead of the first and enqueue duplicate work or duplicate retry bookkeeping.

This is especially brittle because the comment in `instrumentation.ts` implies startup bootstrap is now the authoritative path, but the import-time side effect was never removed.

**Fix**
Make bootstrap single-flight:
- remove the module-level `void bootstrapImageProcessingQueue();`, and
- keep the explicit startup call in `instrumentation.ts`, or
- add a shared `bootstrapPromise`/`bootstrapInProgress` guard so concurrent callers await the same bootstrap work.

If startup availability needs to be resilient to transient DB failures, add a retry path instead of relying on a one-shot import-time call.

**Confidence**: High

---

## 3) Manual-validation risk: if `TRUST_PROXY` is omitted in a proxied deployment, rate limiting collapses into one shared `unknown` bucket

**Files / regions**
- `apps/web/src/lib/rate-limit.ts:59-81`
- Callers: `apps/web/src/app/actions/auth.ts:90-123`, `apps/web/src/app/actions/public.ts:25-60`, `apps/web/src/app/actions/sharing.ts:62-90`, `apps/web/src/app/actions/admin-users.ts:68-100`

**Failure scenario**
`getClientIp()` returns the literal string `'unknown'` whenever `TRUST_PROXY !== 'true'`. Every caller that uses the helper — login, search, share-link creation, and admin-user creation — then shares the same in-memory and DB-backed throttle bucket.

In a reverse-proxy deployment, forgetting that single env var makes the app look healthy, but unrelated users start tripping the same rate-limit bucket. That can look like an app regression even though the real fault is deployment configuration.

The code does warn once, but it still boots into a globally shared throttle state.

**Fix**
In production, fail fast or surface a stronger readiness error when proxy headers are present but `TRUST_PROXY` is not enabled. At minimum, add a startup check that makes the operator notice before traffic starts flowing.

**Confidence**: Medium

---

## Notes
- I did not find a separate low-confidence code defect that was stronger than the three items above after tracing the relevant flows.
- The review focus stayed on crash/regression surfaces, stale-success paths, and race windows rather than style or architecture.
