# Debugger Review — Cycle 4

## Scope reviewed
Inventory-first sweep across the app router, server actions, shared libs, UI components, DB helpers, and operational scripts. The highest-risk code paths inspected in detail were:
- `apps/web/src/app/actions/{auth,images,public,seo,sharing,settings,topics}.ts`
- `apps/web/src/app/[locale]/(public)/*` and `apps/web/src/app/[locale]/admin/*`
- `apps/web/src/app/api/{health,live,og}.ts*`, `sitemap.ts`, `robots.ts`, `manifest.ts`
- `apps/web/src/lib/{data,image-url,process-image,serve-upload,revalidation,validation,tag-records,tag-slugs,restore-maintenance,request-origin,rate-limit,upload-paths}.ts`
- `apps/web/src/components/*` relevant to public rendering and admin mutations
- supporting tests in `apps/web/src/__tests__/*`

## Verification performed
- `npm test --workspace=apps/web` ✅
- `npm run typecheck --workspace=apps/web` ✅
- `npm run build --workspace=apps/web` ✅

## Findings

### 1) Sitemap can exceed the 50k-URL limit because topics are unbounded
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Code region:**
  - `apps/web/src/app/sitemap.ts:15-54`
  - `apps/web/src/lib/data.ts:202-204`
  - `apps/web/src/app/actions/topics.ts:59-145`
- **What fails:** The sitemap caps images at 24,000, but it emits **every topic for every locale** with no topic cap. `getTopics()` returns the full topic table, and `createTopic()` has no global ceiling, so the sitemap array grows without bound as content grows.
- **Concrete failure scenario:** With 24,000 images and 1,001 topics, the generated sitemap contains `2 homepage + (2 * 1,001 topics) + (2 * 24,000 images) = 50,004 URLs`. That crosses the Google sitemap file limit, so entries past the cap can be truncated or ignored by crawlers.
- **Suggested fix:** Apply a topic cap in `sitemap.ts` as well, or split the sitemap into multiple files / a sitemap index. If you keep one file, the current image budget leaves room for only 999 topics at 2 locales.
- **Risk:** SEO/indexing failure and avoidable request-time overhead as topic count grows.

## Missed-issues sweep / skipped files
### Reviewed but not escalated
- `apps/web/src/lib/tag-records.ts:5-12` — spot-checked locale-sensitive slug generation; no repo-default failure path was established, so it was not promoted to a finding.
- `apps/web/src/app/api/og/route.tsx:6` — build emits the known edge-runtime/static-generation warning; I did not treat it as a bug because it appears intentional and was already documented in prior planning artifacts.
- Shared upload/queue paths (`process-image.ts`, `image-queue.ts`, `serve-upload.ts`) were inspected for race/cleanup hazards; no additional high-confidence regressions were confirmed beyond the sitemap issue above.

### Intentionally not deep-dived
- Generated/artifact areas under `.context/`, build outputs, and dependency trees (`node_modules`, `.next`, etc.)
- Long-form docs and historical review artifacts outside the active runtime path
- Test fixtures and images that do not affect production request flow

## Bottom line
I found one confirmed latent bug with a concrete growth-triggered failure mode: the sitemap will eventually exceed the 50k URL ceiling because topics are uncapped. No other high-confidence production bugs were confirmed in this cycle.
