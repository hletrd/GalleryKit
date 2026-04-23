# Critic Review — Cycle 6

## Inventory examined
- Root docs/config: `README.md`, `package.json`, root deploy helper, env examples, workspace `AGENTS.md`
- App config/runtime: `apps/web/package.json`, `next.config.ts`, `playwright.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `drizzle.config.ts`, Docker/nginx/compose/deploy files
- Database/runtime internals: `src/db/*`, `src/lib/*`, `src/lib/storage/*`, migrations, all admin/public server actions, API routes, middleware/proxy, instrumentation
- UI/app routes: public pages, admin pages, key client components (`home-client`, `photo-viewer`, `lightbox`, `search`, `nav-client`, `image-manager`, `upload-dropzone`, etc.)
- Validation surface: unit tests (`41 files / 214 tests`) and Playwright specs (`5 files`)

## Verification performed
- `npm test --workspace=apps/web` ✅
- `npm run lint --workspace=apps/web` ✅
- `npx tsc --noEmit -p apps/web/tsconfig.json` ✅
- `npm run build --workspace=apps/web` ✅

## Confirmed Issues

### 1) Client-side masonry reordering will reshuffle the DOM after hydration on most viewports
- **Files / region:** `apps/web/src/components/home-client.tsx:14-107`, `apps/web/src/components/home-client.tsx:174-175`, `apps/web/src/components/home-client.tsx:209-242`
- **Why this is a problem:** `useColumnCount()` defaults to `2`, while the rendered CSS layout can be 1/2/3/4 columns depending on viewport. Because `orderedImages` is derived from that client state, the server-rendered DOM order is wrong for mobile and desktop until hydration completes, then the DOM order changes.
- **Concrete failure scenario:** On a desktop first load, the HTML arrives ordered for two columns, then hydration flips it to four-column ordering. Users see cards jump; keyboard traversal/screen-reader reading order changes mid-session; visual diff tests can miss this because they snapshot after load settles.
- **Suggested fix:** Stop mutating DOM order per viewport. Prefer pure CSS masonry/order, or compute a stable server/client order from a single source of truth. If reordering must remain client-only, gate initial render until viewport is known and accept the UX tradeoff explicitly.
- **Confidence:** High

### 2) Photo navigation drops topic/tag context and silently jumps back into the global gallery sequence
- **Files / region:** `apps/web/src/components/home-client.tsx:242-243`, `apps/web/src/lib/data.ts:474-545`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:217-229`, `apps/web/e2e/public.spec.ts:79-97`
- **Why this is a problem:** Gallery/topic/tag pages always link to bare `/p/[id]`. Once there, `getImage()` computes `prevId`/`nextId` against the entire processed-image table, not the originating filtered set. Only shared-group navigation preserves context.
- **Concrete failure scenario:** A user browsing `/en/travel?tags=night,film` opens one photo, presses next, and lands on an unrelated image outside that topic/filter because the route forgot the originating collection.
- **Suggested fix:** Carry collection context into the photo route (query params, return token, or scoped navigation data) and compute prev/next inside that scope. Add E2E coverage for topic-filter navigation, not just shared-group navigation.
- **Confidence:** High

### 3) The Playwright seed path hardcodes derivative sizes, so configurable image sizes are not actually testable end-to-end
- **Files / region:** `apps/web/scripts/seed-e2e.ts:77-100`, `apps/web/src/lib/gallery-config-shared.ts:82-152`, `apps/web/src/app/actions/settings.ts:68-99`
- **Why this is a problem:** Production code treats `image_sizes` as configurable, but the E2E seed script always writes only `640/1536/2048/4096` derivatives and base files copied from `2048`. That means the default test fixture only matches one configuration.
- **Concrete failure scenario:** A maintainer changes `image_sizes` before running local E2E or validating a migration. The app now requests derivatives that the seed script never generated, causing broken thumbnails/OG assets while the test harness still claims to represent a valid seeded environment.
- **Suggested fix:** Have `seed-e2e.ts` read the active gallery config from DB/defaults and generate exactly those derivative sizes, or explicitly reset `image_sizes` as part of the seed contract.
- **Confidence:** High

### 4) Shared-group view counts are intentionally lossy, but nothing in the product surface communicates that they are approximate
- **Files / region:** `apps/web/src/lib/data.ts:11-108`, `apps/web/src/instrumentation.ts:8-25`
- **Why this is a problem:** View counts are buffered in memory for up to 5 seconds and dropped when the buffer is full or the process dies before flush. That is a product-level semantic choice, not just an implementation detail.
- **Concrete failure scenario:** A shared album gets traffic during a restart/crash window. The UI/database permanently undercounts some views even though the requests were served successfully.
- **Suggested fix:** Either make counts durable (immediate atomic increments / durable queue / persisted WAL) or relabel them as approximate and keep the lossy buffering as an explicit tradeoff.
- **Confidence:** High

## Likely Issues

### 5) SEO titles/descriptions for tag-filtered pages use raw slugs, while the visible UI maps them back to canonical names
- **Files / region:** `apps/web/src/app/[locale]/(public)/page.tsx:32-42`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:42-52`, `apps/web/src/components/home-client.tsx:181-186`
- **Why this is a problem:** Metadata is built from `tagSlugs`, but the page UI resolves slugs back to display names. That creates a mismatch between what users/robots see in `<title>`/OG text and what they see in the page heading.
- **Concrete failure scenario:** A canonical tag named `Black & White` stored as slug `black-white` renders correctly in the page UI, but the title/OG text becomes `#black-white`, which is worse for share previews and search snippets.
- **Suggested fix:** Resolve tag slugs to canonical tag names before composing metadata.
- **Confidence:** High

## Risks Requiring Manual Validation

### 6) Restore maintenance and queue coordination are process-local globals, so the current design does not safely generalize beyond a single long-lived Node process
- **Files / region:** `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/image-queue.ts:39-94`, `apps/web/src/lib/image-queue.ts:347-370`, `apps/web/src/app/[locale]/admin/db-actions.ts:248-289`
- **Why this is a risk:** `Symbol.for(...)` state works for the documented single-container deployment, but it is not shared across multiple app instances/processes. If the deployment model expands later, one instance can still accept uploads/process queue work while another is in restore maintenance.
- **Concrete failure scenario:** A future blue/green or horizontally scaled deployment starts a DB restore on instance A while instance B keeps enqueuing uploads and mutating state against the same database.
- **Suggested fix:** Move maintenance/queue coordination to shared infrastructure (DB advisory state, Redis, durable job system) before supporting multi-instance runtime topologies.
- **Confidence:** Medium

## Testing / coverage gaps found during sweep
- No automated coverage for the masonry hydration/order behavior in `home-client`.
- No automated coverage for topic/tag-scoped photo navigation; current E2E only checks shared-group context preservation.
- No automated coverage proving `seed-e2e.ts` stays aligned with non-default `image_sizes`.
- Existing tests/lint/build are healthy, so the main risks are behavioral/architectural rather than obvious regressions caught by CI.

## Final missed-issues sweep
I did a final pass across docs/config/runtime/tests looking for contradictions, stale file references, and unverified assumptions. The repository is generally disciplined and the current automated checks are green; the main problems are hidden cross-file tradeoffs (ordering, navigation context, config drift in E2E, lossy counters, and process-local coordination) rather than straightforward compile/test failures.
