# Critic Review — Cycle 3 review-plan-fix

## Inventory / coverage

Reviewed the highest-signal repo surfaces and their cross-file interactions:

- Auth / session / rate limiting:
  - `apps/web/src/app/actions/auth.ts`
  - `apps/web/src/lib/session.ts`
  - `apps/web/src/lib/rate-limit.ts`
  - `apps/web/src/lib/auth-rate-limit.ts`
  - `apps/web/src/lib/request-origin.ts`
  - `apps/web/src/lib/action-guards.ts`
  - `apps/web/src/proxy.ts`
- Public pages / SEO / OG:
  - `apps/web/src/app/[locale]/(public)/page.tsx`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
  - `apps/web/src/app/api/og/route.tsx`
  - `apps/web/src/lib/photo-title.ts`
  - `apps/web/src/components/photo-viewer.tsx`
- Upload / processing / sharing / admin DB:
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/lib/process-image.ts`
  - `apps/web/src/lib/image-queue.ts`
  - `apps/web/src/lib/data.ts`
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/src/app/api/admin/db/download/route.ts`
- Config / deploy / ops:
  - `apps/web/docker-compose.yml`
  - `apps/web/nginx/default.conf`
  - `apps/web/next.config.ts`
  - `README.md`

Cross-checks run:
- `npm run typecheck --workspace=apps/web` ✅
- `npm test --workspace=apps/web` ✅ (57 files, 329 tests)

## Findings

### 1) Photo detail SEO/title logic disagrees with the actual UI and suppresses curated titles
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Files / regions:**
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:52-56`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:129-134`
  - `apps/web/src/lib/photo-title.ts:17-35`
  - `apps/web/src/components/photo-viewer.tsx:82-97`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:101-102`
- **Code region:** photo page metadata + JSON-LD call `getPhotoDisplayTitle(..., { preferTags: true, formatTitleAsTags: true })`, while the hydrated viewer and shared-photo page use the default helper behavior.
- **Failure scenario:** A photo with title `Sunrise at Hallasan` and tags `landscape, jeju` gets SSR metadata/OG title like `#landscape #jeju` (or `#Sunrise #at #Hallasan` when no tags exist), but after hydration the browser title and visible viewer use `Sunrise at Hallasan`. Crawlers/social previews/indexed titles diverge from what users actually see.
- **Suggested fix:** Stop using the tag-preferred / tag-formatting options in `p/[id]/page.tsx` for metadata/JSON-LD. Reuse the same default title path as `PhotoViewer` and shared pages, or introduce one shared `getPhotoSeoTitle()` helper and use it everywhere.

### 2) `/api/og` still trusts attacker-controlled `label` and `site` query params
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Files / regions:**
  - `apps/web/src/app/api/og/route.tsx:29-33`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:57-67`
- **Code region:** OG route reads `searchParams.get('label')` / `searchParams.get('site')` and renders them directly after truncation.
- **Failure scenario:** Anyone can request `/api/og?topic=e2e-smoke&label=Urgent%20Invoice&site=PayPal` and get a convincing branded social card served from this domain. Topic slug validation does not prevent brand/text spoofing.
- **Suggested fix:** Do not trust public `label` / `site` params. Either derive them server-side inside the route, sign the params, or ignore them and fall back to canonical topic/site values. At minimum, `site` should come from trusted config, not the request.

### 3) Photo page Open Graph `publishedTime` uses `Date.toString()` instead of ISO-8601
- **Severity:** LOW
- **Confidence:** HIGH
- **Files / regions:**
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:88-96`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:20-24`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:75-77`
- **Code region:** photo page sets `publishedTime: image.created_at?.toString()`; shared-photo page already uses `toIsoTimestamp(...)`.
- **Failure scenario:** `<meta property="article:published_time">` gets a locale-specific string like `Fri Apr 24 2026 ...` instead of an ISO timestamp. Parsers/social consumers can reject or misread it; direct photo pages and shared photo pages behave inconsistently.
- **Suggested fix:** Reuse the shared `toIsoTimestamp` logic for the photo page too.

### 4) Cumulative upload throttling is keyed only by IP, so legitimate admins can block each other
- **Severity:** LOW
- **Confidence:** HIGH
- **Files / regions:**
  - `apps/web/src/app/actions/images.ts:145-191`
- **Code region:** upload tracker uses `const uploadIp = getClientIp(requestHeaders)` and `uploadTracker.get(uploadIp)` for the hourly file/byte window.
- **Failure scenario:** Two admins behind the same NAT/VPN/office proxy share one `UPLOAD_MAX_FILES_PER_WINDOW` and one cumulative byte budget. Admin A uploads a large batch; Admin B gets `uploadLimitReached` / `cumulativeUploadSizeExceeded` even though they are a separate authenticated user.
- **Suggested fix:** Key the cumulative tracker by authenticated admin identity (for example `userId`, or `userId + ip`) instead of raw IP alone. If multi-instance correctness matters, move this limiter to persistent storage rather than process memory.

## Representative implementation simulations

1. **Fix photo title inconsistency**
   - Update only `p/[id]/page.tsx` to use the default helper path.
   - Add a regression test asserting photo metadata title matches the same helper semantics used by `PhotoViewer` / shared pages.
   - No missing code-context blockers.

2. **Fix OG spoof surface**
   - Update `api/og/route.tsx` to stop trusting `label` / `site`.
   - Adjust topic-page metadata URL generation if the route no longer needs those params.
   - Current code gives enough context; no architecture discovery needed.

3. **Fix upload quota false positives**
   - Update `uploadImages()` key construction to include the authenticated admin identity.
   - Add a unit test around tracker-key behavior.
   - If the intended product policy is “shared quota per source IP”, document that explicitly; otherwise the executor can proceed without guessing.

## Final sweep

No test/type errors surfaced in the current tree, but the four issues above remain actionable and are not protected by the current automated suite.
