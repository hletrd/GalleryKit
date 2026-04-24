# Critic Review — PROMPT 1 / cycle 4/100

## Inventory / coverage

Reviewed the highest-signal repository surfaces for product correctness, hidden assumptions, brittle invariants, review-history drift, and cross-file coupling.

### Docs / config / deploy
- `README.md`
- `apps/web/README.md`
- `package.json`
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`

### Prior review / plan history
- `.context/reviews/critic.md`
- `.context/reviews/_aggregate-cycle4-rpl.md`
- `.context/reviews/critic-cycle4-rpl2.md`
- `plan/cycle4-gate-warnings.md`

### Core app surfaces
- Auth / session / provenance:
  - `apps/web/src/app/actions/auth.ts`
  - `apps/web/src/lib/session.ts`
  - `apps/web/src/lib/request-origin.ts`
  - `apps/web/src/lib/action-guards.ts`
  - `apps/web/src/lib/api-auth.ts`
- Public pages / metadata / sharing:
  - `apps/web/src/app/[locale]/(public)/page.tsx`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
  - `apps/web/src/app/api/og/route.tsx`
  - `apps/web/src/components/home-client.tsx`
  - `apps/web/src/components/photo-viewer.tsx`
  - `apps/web/src/components/lightbox.tsx`
  - `apps/web/src/lib/photo-title.ts`
  - `apps/web/src/lib/data.ts`
- Upload / restore / queue state:
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/lib/upload-tracker-state.ts`
  - `apps/web/src/lib/image-queue.ts`
  - `apps/web/src/lib/restore-maintenance.ts`

## Verification snapshot
- `npm run typecheck --workspace=apps/web` ✅
- `npm test --workspace=apps/web` ✅ (`57` files, `333` tests)
- `npm run lint --workspace=apps/web` ✅

## Findings

### 1) Shared-photo metadata still drops the normalized tag/title fallback shown in the actual page UI
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** CONFIRMED
- **Exact references:**
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:46-47`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:62-84`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:101-113`
  - `apps/web/src/lib/data.ts:552-584`
- **Code region:** `generateMetadata()` still does `const title = image.title && !isTitleFilename ? image.title : t('ogTitle')`, while the rendered page heading uses `getPhotoDisplayTitle(image, t('sharedPhoto'))`; the share query already fetches tags.
- **Failure scenario:** A shared photo with no meaningful title but with tags (for example tag `Seoul`) renders `#Seoul` in-page, but crawlers/social previews/browser metadata get the generic title `Shared Photo`. The public URL and the visible page disagree about what the content is called.
- **Suggested fix:** Reuse `getPhotoDisplayTitle(image, t('sharedPhoto'))` inside `generateMetadata()` so title/OG/Twitter stay aligned with the rendered heading.

### 2) Shareable `/g/[key]?photoId=...` deep links render a specific photo, but metadata always describes the generic group view
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** CONFIRMED
- **Exact references:**
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:27-84`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:101-145`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:161-164`
- **Code region:** the page creates stable deep links with `?photoId=${image.id}` and renders a selected photo view when that query param is present, but `generateMetadata()` ignores `searchParams` entirely and always emits the generic shared-group title/cover image.
- **Failure scenario:** Someone shares `/en/g/abc123?photoId=7`; the recipient opens a specific image view, but Slack/iMessage/Discord previews show the group cover and `Shared Photos` instead of the selected image. Deep-link sharing works functionally but previews the wrong content.
- **Suggested fix:** Accept `searchParams` in `generateMetadata()`, resolve the selected image when `photoId` is valid, and emit selected-photo title/image metadata; fall back to the generic group metadata only when no photo is selected.

### 3) Gallery-listing title normalization is still inconsistent across visible cards, ARIA labels, and JSON-LD
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** CONFIRMED
- **Exact references:**
  - `apps/web/src/components/home-client.tsx:150-165`
  - `apps/web/src/components/home-client.tsx:233-242`
  - `apps/web/src/app/[locale]/(public)/page.tsx:139-149`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:134-144`
  - `apps/web/src/lib/data.ts:372-375`
  - `apps/web/src/lib/photo-title.ts:17-37`
- **Code region:** `HomeClient` uses filename-like titles for `displayTitle` (`if (image.title && image.title.trim().length > 0) return image.title;`), and home/topic JSON-LD emits `img.title || \`Photo ${img.id}\`` instead of the normalized display-title rules already centralized in `photo-title.ts`.
- **Failure scenario:** A photo whose stored title is `IMG_0001.JPG` and whose tags are meaningful will show a filename in the gallery card title/ARIA label, while detail/shared pages normalize to tags or fallback copy. Search-engine structured data also gets `IMG_0001.JPG` or `Photo 42` even though the gallery already has `tag_names` available.
- **Suggested fix:** Add a lite-payload normalization helper (for `{ title, tag_names }`) and reuse it in `HomeClient` plus home/topic JSON-LD generation so list surfaces match detail/share surfaces.

### 4) Review-history artifacts still contain unresolved-looking findings that the current tree has already fixed
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** CONFIRMED
- **Exact references:**
  - `.context/reviews/_aggregate-cycle4-rpl.md:5-12`
  - `apps/web/src/app/actions/topics.ts:167-175`
- **Code region:** the cycle-4 aggregate still presents `updateTopic` missing `stripControlChars` as the current actionable issue, but `updateTopic` now sanitizes both `label` and `slug` before validation.
- **Failure scenario:** Later planning/review passes can pick up old “open” issues from the aggregate archive, spend time re-triaging already-fixed work, and under-weight newer defects because historical review artifacts read like live backlog.
- **Suggested fix:** Mark archive reviews as historical/resolved when superseded, or generate a small current-state index that distinguishes open review debt from preserved history.

### 5) Correctness still depends on a brittle single-instance / single-writer deployment contract
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** RISK
- **Exact references:**
  - `apps/web/src/lib/restore-maintenance.ts:1-22`
  - `apps/web/src/lib/upload-tracker-state.ts:7-20`
  - `apps/web/src/lib/data.ts:11-25`
  - `apps/web/src/lib/data.ts:28-40`
  - `apps/web/src/lib/image-queue.ts:67-131`
  - `apps/web/docker-compose.yml:13-25`
  - `README.md:140-144`
- **Code region:** restore maintenance, upload quotas, buffered share-group view counts, and the image-processing queue all use in-memory `globalThis` / module-local state. The docs warn about a single-instance deployment, and the compose file hardcodes one host-networked service, but the invariant is operational rather than enforced in-product.
- **Failure scenario:** If an operator later adds a second web replica behind a load balancer, one instance can enter restore maintenance while another continues accepting writes; upload quotas split by process; view counts become per-node buffers; and queue/bootstrap behavior becomes nondeterministic across workers.
- **Suggested fix:** Either hard-enforce singleton deployment in ops/CI/release docs and health checks, or move coordination state (restore gate, upload limiter, queue bookkeeping, view-count buffering) into shared infrastructure before claiming multi-instance safety.

## Missed-issues sweep
- I specifically re-checked previously surfaced metadata/OG/upload findings before writing this pass; some earlier issues are fixed, which is why this review includes an explicit review-history-drift finding rather than repeating stale bugs.
- I re-checked auth/session/provenance surfaces after the prior review; no new confirmed auth bypass or path-traversal bug surfaced in the reviewed code paths.
- I did **not** find a failing lint/type/test gate to anchor any new build-breakage claim.

## Skipped file disclosure
Not audited line-by-line in this pass:
- generated artifacts under `apps/web/.next/**` except where used to confirm review/deploy drift
- dependency trees under `node_modules/**`
- binary/image fixtures under `.context/*.png`, `apps/web/public/uploads/**`, and `apps/web/data/uploads/**`
- older archived review/plan files outside the directly relevant current-cycle artifacts listed above
- most presentational primitives under `apps/web/src/components/ui/**` where no product/security/coupling signal appeared during this review
