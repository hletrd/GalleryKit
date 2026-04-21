# Cycle 10 skeptical multi-perspective review

## Inventory reviewed first

Reviewed these repo areas before judging issues:

- **Docs / deploy surface**
  - `README.md`
  - `apps/web/README.md`
  - `apps/web/docker-compose.yml`
  - `apps/web/nginx/default.conf`
  - `apps/web/Dockerfile`
  - `apps/web/package.json`
  - `apps/web/playwright.config.ts`
- **Core runtime / auth / rate-limit**
  - `apps/web/src/lib/rate-limit.ts`
  - `apps/web/src/lib/session.ts`
  - `apps/web/src/lib/api-auth.ts`
  - `apps/web/src/app/actions/auth.ts`
  - `apps/web/src/proxy.ts`
- **Data / public routes / sharing**
  - `apps/web/src/lib/data.ts`
  - `apps/web/src/app/[locale]/(public)/page.tsx`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
  - `apps/web/src/app/actions/public.ts`
  - `apps/web/src/app/actions/sharing.ts`
- **Admin / mutation workflows**
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/app/actions/topics.ts`
  - `apps/web/src/app/actions/tags.ts`
  - `apps/web/src/app/actions/admin-users.ts`
  - `apps/web/src/app/actions/settings.ts`
  - `apps/web/src/app/actions/seo.ts`
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
- **Uploads / image pipeline / restore**
  - `apps/web/src/lib/process-image.ts`
  - `apps/web/src/lib/image-queue.ts`
  - `apps/web/src/lib/upload-paths.ts`
  - `apps/web/src/lib/serve-upload.ts`
  - `apps/web/src/lib/restore-maintenance.ts`
  - `apps/web/src/lib/db-restore.ts`
  - `apps/web/src/lib/sql-restore-scan.ts`
  - `apps/web/src/lib/process-topic-image.ts`
- **DB / schema**
  - `apps/web/src/db/schema.ts`
  - `apps/web/src/db/index.ts`
- **UI / cross-file consumers**
  - `apps/web/src/components/home-client.tsx`
  - `apps/web/src/components/nav.tsx`
  - `apps/web/src/components/nav-client.tsx`
  - `apps/web/src/components/search.tsx`
  - `apps/web/src/components/photo-viewer.tsx`
  - `apps/web/src/components/photo-navigation.tsx`
  - `apps/web/src/components/lightbox.tsx`
- **Test / seed harness**
  - `apps/web/scripts/seed-e2e.ts`
  - `apps/web/e2e/public.spec.ts`
  - `apps/web/e2e/admin.spec.ts`
  - `apps/web/e2e/test-fixes.spec.ts`
  - `apps/web/e2e/helpers.ts`
  - `apps/web/src/__tests__/rate-limit.test.ts`

## Verification run

- `npm run lint --workspace=apps/web` ✅
- `npm run test --workspace=apps/web` ✅ `23` files / `137` tests
- `npm run build --workspace=apps/web` ✅
- Targeted Playwright public checks ✅ `3` passed  
  - This run also emitted the standalone warning noted in Finding 6.

---

## Confirmed issues

### 1) Default proxy + app IP parsing makes rate limits spoofable
**Files / region**
- `apps/web/src/lib/rate-limit.ts:62-69`
- `apps/web/nginx/default.conf:49-52, 65-68, 79-82, 113-117`
- `apps/web/src/__tests__/rate-limit.test.ts:78-87`

**Why it matters**
The app trusts the **left-most** `X-Forwarded-For` IP, while the shipped nginx config uses `proxy_add_x_forwarded_for`, which **appends** the real client IP to any header the attacker already sent. That lets a client spoof its effective rate-limit/audit IP.

**Concrete scenario**
An attacker sends:
`X-Forwarded-For: 198.51.100.10`
Nginx forwards:
`198.51.100.10, <real-ip>`
`getClientIp()` returns `198.51.100.10`, so login/share/search throttles key off attacker-controlled data.

**Suggested fix**
Either:
- overwrite `X-Forwarded-For` in nginx with `$remote_addr`, or
- trust `X-Real-IP`, or
- parse the **right-most trusted hop** instead of the left-most.
Then update `rate-limit.test.ts` to match the hardened contract.

**Confidence:** High

---

### 2) `createTopic()` can hijack an existing alias route
**Files / region**
- `apps/web/src/app/actions/topics.ts:58-63, 80-104`
- compare with `apps/web/src/app/actions/topics.ts:158-160, 319-320`
- `apps/web/src/lib/data.ts:612-644`

**Why it matters**
`updateTopic()` and `createTopicAlias()` both check `topicRouteSegmentExists()`, but `createTopic()` does not. So a new topic slug can collide with an existing alias in another topic.

**Concrete scenario**
Topic A has alias `spotlight-smoke`.  
An admin creates Topic B with slug `spotlight-smoke`.  
`getTopicBySlug()` prefers the direct topic slug first, so old alias links silently start resolving to Topic B instead of Topic A.

**Suggested fix**
In `createTopic()`, call `topicRouteSegmentExists(slug)` before insert (ideally before topic-image processing too), and reject collisions the same way `updateTopic()` / `createTopicAlias()` do. Add a regression test covering “new topic slug collides with existing alias”.

**Confidence:** High

---

### 3) The documented host-nginx deployment cannot use the shipped static upload root as written
**Files / region**
- `README.md:132, 160`
- `apps/web/README.md:31-32`
- `apps/web/docker-compose.yml:10-22`
- `apps/web/nginx/default.conf:89-96`

**Why it matters**
The docs describe **host nginx + host-network app container**, but the nginx config serves uploads from `/app/apps/web/public`, which is a **container-internal path** created by the compose mount. A host nginx process will not see that path unless the operator manually reproduces it.

**Concrete scenario**
An operator follows the README, runs the web container, and installs the provided nginx config on the host. `/uploads/...` requests 404 because host nginx has no `/app/apps/web/public` tree.

**Suggested fix**
Pick one deployment story and make it consistent:
- either document nginx as a sibling container with the same bind mount,
- or change the sample nginx config to point at the real host checkout path,
- or remove direct-static serving from the sample and proxy uploads back to Next.

**Confidence:** High

---

## Likely issues

### 4) Restore maintenance is only process-local and does not protect read paths
**Files / region**
- `apps/web/src/lib/restore-maintenance.ts:1-56`
- `apps/web/src/app/[locale]/admin/db-actions.ts:243-287`
- `apps/web/src/lib/data.ts:315-332, 381-485` (public reads have no maintenance gate)

**Why it matters**
The restore “maintenance mode” is just a `globalThis` flag in one Node process. That blocks many mutations in that process, but it is not shared across multiple app instances/processes, and public reads continue normally.

**Concrete scenario**
One app instance starts a DB restore and sets `active=true`. Another instance behind a load balancer keeps serving reads/writes against the half-restored database. Even on one instance, public routes can still read inconsistent data during the restore window.

**Suggested fix**
Move restore maintenance to shared state:
- DB-backed maintenance flag / shared lock visible to all app instances,
- block or degrade **both reads and writes** during restore,
- optionally expose a temporary maintenance page for public routes.

**Confidence:** Medium

---

### 5) The Playwright seed path can drift from configured derivative sizes
**Files / region**
- `apps/web/scripts/seed-e2e.ts:77-100`
- `apps/web/src/app/[locale]/(public)/page.tsx:80-91`
- `apps/web/src/components/photo-viewer.tsx:178-225`

**Why it matters**
`seed-e2e.ts` hardcodes `[640, 1536, 2048, 4096]` when generating derivatives, but the app renders using `getGalleryConfig().imageSizes`. The seed script does not reset or honor stored `admin_settings.image_sizes`.

**Concrete scenario**
A developer previously changed `image_sizes` in the DB to `800,1600`. Playwright seeds only the hardcoded files, but the app requests `_800` / `_1600` variants. Local E2E becomes flaky or fails with missing asset paths.

**Suggested fix**
Have the seed script:
- reset `admin_settings.image_sizes` to defaults before seeding, or
- read the configured sizes and generate derivatives from that source of truth.

**Confidence:** Medium

---

## Manual-validation risks

### 6) Automated E2E does not exercise the documented production runtime/proxy path
**Files / region**
- `apps/web/playwright.config.ts:54-61`
- `apps/web/next.config.ts:52-55`
- `apps/web/Dockerfile:76-80`

**Why it matters**
Local Playwright launches `npm run start`, while production runs the standalone artifact via `node apps/web/server.js`. My run also emitted:
> `"next start" does not work with "output: standalone" configuration. Use "node .next/standalone/server.js" instead.`

So automated UI coverage is not validating the same runtime topology that deploys, and it bypasses the nginx/static-upload path entirely.

**Concrete scenario**
A bug appears only in:
- standalone server bootstrap,
- instrumentation/shutdown behavior,
- proxy header handling,
- static `/uploads/...` nginx serving,
and local E2E still passes because it exercises a different stack.

**Suggested fix**
Add at least one deploy-like validation lane:
- start `.next/standalone/server.js` in Playwright,
- and/or smoke-test behind the shipped nginx config in CI or release validation.

**Confidence:** High

---

## Final missed-issues sweep

I did one more sweep over:
- topic route/alias interactions,
- rate-limit/proxy boundaries,
- restore coordination,
- deploy topology,
- Playwright/runtime alignment,

and did **not** find stronger confirmed issues than the 6 above.
