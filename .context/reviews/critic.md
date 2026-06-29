# Cycle 6/100 Whole-Repo Critique

Role: critic, PROMPT 1
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `e6db9241b3b4f2adbedaeeb46eb5d68275b74879`
Mode: read-only critique of current HEAD; no fixes implemented.

## Required First Reads

- Read `AGENTS.md` first.
- Read `CLAUDE.md` second.
- Loaded and followed the local `code-review` skill instructions for finding-first review output.

## Review Inventory Before Findings

I built the inventory from current HEAD before promoting findings:

- Total tracked files in HEAD: 2504.
- Major behavior-bearing buckets inspected:
  - Workspace and project docs: `AGENTS.md`, `CLAUDE.md`, root/package metadata, deploy notes embedded in docs.
  - App package/config: root `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig*.json`, ESLint/lint scripts, proxy/middleware.
  - App routes and pages: public photo, topic, map, timeline, search, admin pages, share pages, OG pages, API routes.
  - Server actions: auth, admin users, image mutations, topics, collections, tags, settings, sharing, embeddings, public analytics.
  - Data layer and privacy surfaces: `data.ts`, timeline/search/map helpers, privacy omission guards, public/admin select fields, schema objects.
  - Upload/image/color/HDR surfaces: browser upload, Lightroom upload, image processing, variants, resources, queue/bootstrap, service worker image caching.
  - Security/rate-limit/origin surfaces: admin auth wrapper, same-origin helpers, public API rate-limit lint, server-action origin lint, proxy CSP, nginx config.
  - Migrations/schema/scripts: all `apps/web/drizzle` journal entries and SQL migrations, migration reconciliation script, schema compatibility tests, backfill scripts.
  - Tests: current Vitest/e2e/lint-rule tests relevant to privacy, auth, CSP, topics, migration coverage, upload processing, public routes, touch targets, service worker contracts.
  - Deployment/runtime: `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `nginx.conf`, worker scripts, service worker generation.

Relevant file families intentionally not inspected byte-for-byte:

- Historical review archives under `.context/reviews/archive/`: inventoried but not treated as current behavior, except where names helped identify areas to rescan. Current HEAD code/tests/docs were the source of truth.
- Binary assets such as fonts/icons/images: names and placement were inventoried; binary contents were not decoded because the request is for whole-repo code/product critique and no image artifact bug was indicated by current code paths.
- Ignored working-tree runtime uploads under `apps/web/public/uploads/`: checked and excluded from findings because they are not tracked in HEAD. This review is HEAD-only.

## Confirmed Issues

### 1. Production CSP blocks the public map tile layer

Severity: Medium
Confidence: High
Category: product correctness / cross-file interaction

Code regions:

- `apps/web/src/components/map/map-client.tsx:114-117`
- `apps/web/src/lib/content-security-policy.ts:28-34` and `apps/web/src/lib/content-security-policy.ts:74-79`
- `apps/web/src/proxy.ts:36-49` and `apps/web/src/proxy.ts:118-140`
- Missing test coverage is visible in `apps/web/src/__tests__/content-security-policy.test.ts:23-45`

Why this is a problem:

The map client renders a Leaflet tile layer from OpenStreetMap:

```tsx
<TileLayer
    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
/>
```

But the production CSP image source list is only:

```ts
const sources = ["'self'", 'data:', 'blob:'];
if (imageBaseUrl) {
  sources.push(imageBaseUrl.origin);
}
```

`buildContentSecurityPolicy()` then uses that list for `img-src`, optionally adding Google Analytics image endpoints only. It never permits `https://a.tile.openstreetmap.org`, `https://b.tile.openstreetmap.org`, `https://c.tile.openstreetmap.org`, or an equivalent tile proxy origin. `proxy.ts` applies this production CSP to matched HTML routes, and the matcher includes normal public pages such as localized `/map`.

Concrete failure scenario:

In production, an admin enables `map_visible` for topics and visitors open `/en/map`. Leaflet asks the browser for `https://a.tile.openstreetmap.org/...png` tile images. The browser blocks those images under `img-src 'self' data: blob: ...`, leaving the map background blank or partially unusable while markers/popups still appear. Server-side tests do not catch this because the current CSP tests assert GA/self image sources but do not exercise the map tile dependency.

Suggested fix:

Choose one policy and lock it with tests:

- Add the exact tile origins required by the chosen provider to `img-src`, for example `https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org`, or a narrowly accepted wildcard if the CSP parser/browser support target is intentional.
- Prefer a same-origin tile proxy/self-hosted tile source if third-party tile requests are undesirable for privacy or OSM policy reasons.
- Add a CSP unit test that fails if the configured map tile source is not allowed.
- Add a Playwright smoke check for the production CSP path that visits the map and fails on CSP console violations for tile images.

### 2. Concurrent topic cover updates can leak orphaned resource files

Severity: Medium
Confidence: High
Category: implementation risk / latent concurrency assumption

Code regions:

- `apps/web/src/app/actions/topics.ts:232-247`
- `apps/web/src/app/actions/topics.ts:250-358`
- `apps/web/src/app/actions/topics.ts:360-362`
- Existing happy-path test pins the stale assumption at `apps/web/src/__tests__/topics-actions.test.ts:431-486`
- File lifecycle helper deletes only a caller-provided filename in `apps/web/src/lib/process-topic-image.ts:59-102`

Why this is a problem:

`updateTopic()` reads the current topic image before acquiring the route mutation lock:

```ts
const [currentTopic] = await db.select({ image_filename: topics.image_filename })
  .from(topics)
  .where(eq(topics.slug, cleanCurrentSlug))
  .limit(1);
const previousImageFilename = currentTopic?.image_filename ?? null;
```

It then processes a new image before the lock, performs the database update or rename under `withTopicRouteMutationLock()`, and after the lock commits it deletes `previousImageFilename`:

```ts
if (previousImageFilename && imageFilename && previousImageFilename !== imageFilename) {
    try { await deleteTopicImage(previousImageFilename); }
```

The rename branch correctly re-reads the authoritative topic row under the lock for data preservation, and the comments explicitly call out closing the pre-lock `image_filename` TOCTOU for the transaction. The cleanup path still uses the stale pre-lock value, so the file lifecycle is not actually protected by that invariant.

Concrete failure scenario:

Two admins update the same topic cover around the same time:

1. Both requests read `previousImageFilename = old.webp` before the lock.
2. Request B acquires the lock first and updates the topic image to `b.webp`, then deletes `old.webp`.
3. Request A later acquires the lock and updates the topic image to `a.webp`.
4. Request A's post-commit cleanup still tries to delete only stale `old.webp`.
5. `b.webp` is no longer referenced by `topics.image_filename`, but remains in `public/resources` permanently.

The same leak can happen through the rename path because the insert carries the locked `transactionTopic.image_filename`, but cleanup after commit still deletes the pre-lock `previousImageFilename`, not the file actually replaced by this transaction.

Suggested fix:

Capture the replaced image filename inside the same locked section that performs the authoritative update:

- In the same-slug branch, select `{ image_filename }` under the lock immediately before the update, store it as `replacedImageFilename`, then update.
- In the rename branch, use `transactionTopic.image_filename` as the candidate replaced file when `imageFilename` is supplied.
- Return that captured value from the locked action and use it for post-commit `deleteTopicImage()`.
- Add a regression test that simulates a stale pre-lock read and a different locked row value, then asserts the locked row's replaced image is deleted.

## Likely Issues

No likely issue was promoted without enough current-HEAD evidence. I discarded several weaker candidates after checking the code paths:

- Ignored `.nfs*` and AppleDouble files exist in the local working tree under `apps/web/public/uploads`, but they are ignored and absent from HEAD, so they are not a HEAD finding.
- The generated `apps/web/public/sw.js` contains an older stamped version string, but `apps/web/package.json` runs `scripts/build-sw.ts` in `prebuild`, so production builds regenerate it. This is at most a local-dev hygiene risk unless a deployment path skips `npm run build`.
- Migration journal ordering has historical non-monotonic entries, but the current migrator explicitly reconciles/baselines committed hashes and the latest entries are ordered above the current max journal timestamp.

## Risks Needing Manual Validation

- The CSP/map issue should be validated in a production-mode browser run with at least one map-visible photo. The expected evidence is a blocked `tile.openstreetmap.org` image request before the fix and no CSP console violation after the fix.
- The topic-image leak should be validated with a targeted unit test because the race is timing-sensitive in a live app. The deterministic test should mock the pre-lock row as `old.webp` and the under-lock row as `b.webp`, submit a new `a.webp`, and assert `deleteTopicImage('b.webp')`.

## Final Missed-Issues Sweep

I performed an end sweep across route boundaries and previous-cycle-heavy areas:

- Admin API auth wrappers and same-origin handling.
- Public mutating API rate limits.
- Server-action origin lint expectations.
- Public/admin privacy field selection and symmetric privacy tests.
- Map/timeline/search public data projections.
- Topic rename child-table interactions and smart collection slug remapping.
- Upload pipeline, Lightroom upload auth, image variant paths, HDR/color metadata surfaces.
- Service worker cache exclusions for admin/share routes.
- Drizzle migration journal, reconcile baseline behavior, and deploy migration assertions.
- Nginx body-size/path routing and Docker runtime mounts.

The two confirmed findings above are the only issues I found with enough evidence to report as real current-HEAD defects.
