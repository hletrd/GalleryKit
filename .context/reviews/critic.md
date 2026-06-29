# Cycle 17 Critic Review

Scope: whole repository and current HEAD `5e054f80` on `master`.

Role: critic reviewer. I did not implement fixes. This artifact is the only file I changed.

## Executive Summary

I found two current product/architecture issues worth fixing before another feature pass:

1. **Confirmed MEDIUM:** the public home page catches image-query failures and renders a successful empty gallery, which can hide outages and mislead crawlers/users.
2. **Confirmed MEDIUM:** admin topic slug validation does not reserve several existing public route segments (`timeline`, `year`, `privacy`, `c`), so admins can create canonical topic URLs that Next.js will route somewhere else.

The repository has unusually strong defense-in-depth around admin APIs, server-action origin checks, public mutation rate limits, privacy field omission, share metadata lookup avoidance, semantic-search activation gates, upload serving containment, and DB restore scanning. The highest residual risks are mostly consistency gaps between route topology, operational documentation, and custom lint assumptions.

## Inventory Inspected

Primary docs and policy:
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `.env.deploy.example`
- `.context/plans/` and `.context/reviews/` inventory shape

Deploy and operations surfaces:
- `package.json`
- `scripts/deploy-remote.sh`
- `apps/web/package.json`
- `apps/web/deploy.sh`
- `apps/web/docker-compose.yml`
- `apps/web/Dockerfile`
- `apps/web/nginx/default.conf`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/restore-db.sh`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-admin-api-auth.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/scripts/check-prod-build-origin.ts`
- `apps/web/scripts/check-legacy-public-originals.ts`

App routing surface:
- Public routes under `apps/web/src/app/[locale]/(public)/`: home, topic, photo, map, timeline, year, privacy, group share, set share, smart collection, uploads, robots, sitemap, feed, manifest, icons.
- Admin routes under `apps/web/src/app/[locale]/admin/`: login, dashboard, categories, tags, users, tokens, settings, SEO, DB, password, analytics.
- API routes under `apps/web/src/app/api/`: `health`, `live`, `og`, `og/photo/[id]`, `search/semantic`, `search/similar/[id]`, `admin/db/download`, `admin/lr/upload`.
- Server actions under `apps/web/src/app/actions/`: auth, images, topics, tags, sharing, settings, SEO, public analytics, collections, embeddings, admin users, admin backfill, Lightroom tokens.

Components and client UX surface:
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/photo-modal.tsx`
- `apps/web/src/components/photo-card.tsx`
- `apps/web/src/components/share-dialog.tsx`
- `apps/web/src/components/map-*`
- `apps/web/src/components/admin/*`
- `apps/web/src/components/lightroom/*`
- `apps/web/src/components/ui/*`

Core libraries:
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/lib/smart-collections.ts`
- `apps/web/src/lib/db-restore-scan.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/lib/semantic-search-*`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/upload-limits.ts`

Schema, tests, migrations:
- `apps/web/src/db/schema.ts`
- migrations `apps/web/drizzle/0000_*.sql` through `0027_*.sql`
- `apps/web/drizzle/meta/_journal.json`
- Unit tests under `apps/web/src/__tests__/`, including privacy, proxy/origin, nginx config, uploads, share metadata, semantic search, similar search, restore scan, action-origin lint, public-route rate-limit lint, touch-target audit.
- E2E tests under `apps/web/e2e/`.

Validation run this cycle:
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

Not run this cycle:
- `npm run lint --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm run build --workspace=apps/web`
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`

## Findings

### C17-MED-01 - Confirmed: public home page masks image-query failures as a successful empty gallery

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- `apps/web/src/app/[locale]/(public)/page.tsx:166-176` initializes `images`, `totalCount`, and `hasMore` to empty values, catches any `getImagesLitePage(...)` error, logs a warning, and continues rendering.
- `apps/web/src/app/[locale]/(public)/page.tsx:231-233` passes those empty values to `HomeClient`, so the response is still a normal public page.

Why it matters:
- The public home page is the primary product surface. If the image query fails because of a migration bug, DB outage, bad deploy, or schema drift, visitors and crawlers see an apparently valid empty gallery instead of an error, maintenance state, or retryable failure.
- Operators lose the strongest user-visible signal that the core gallery is broken. A warning in server logs is much weaker than a failed request or explicit degraded state.
- SEO and social crawlers can cache or index an empty homepage while the database is transiently unavailable.

Concrete failure scenario:
- A deploy introduces an SQL regression in `getImagesLitePage`. Topic/tag config still loads, so `GalleryHome` reaches the `try` block, catches the thrown query error, logs once, and returns `200 OK` with no images and `totalCount=0`. Monitoring that checks only `/api/live` or page status does not fail, while the public site appears wiped.

Suggested fix:
- Do not silently degrade the primary gallery to empty data on unexpected query errors. Prefer one of:
  - Let the error propagate to the Next.js error boundary.
  - Render an explicit unavailable/maintenance state with an error status where feasible.
  - Gate the fallback behind a narrow, typed “no images exist” condition rather than `catch (err)`.
- Add a regression test that mocks `getImagesLitePage` throwing and asserts the home route does not render a successful empty gallery.

### C17-MED-02 - Confirmed: topic slug reservation misses existing public route segments

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- `apps/web/src/lib/validation.ts:4-21` reserves `admin`, `g`, `map`, `p`, `s`, `uploads`, public metadata files, and locale codes for topic slugs/aliases.
- `apps/web/src/app/actions/topics.ts:115-120` rejects reserved topic slugs through `isReservedTopicRouteSegment(slug)`.
- `apps/web/src/app/actions/topics.ts:500-505` rejects reserved topic aliases through the same helper.
- Existing concrete public route segments include:
  - `timeline`: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:16-25`
  - `year`: `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:17-20`
  - `privacy`: `apps/web/src/app/[locale]/(public)/privacy/page.tsx:5-14`
  - `c`: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:14-18`
- The dynamic topic route has its own smaller static-file-only reserved list at `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:19-31`, which is already divergent from `validation.ts`.

Why it matters:
- Admins can create a topic slug or alias such as `timeline`, `year`, `privacy`, or `c`. The database will accept it, the admin UI can link to it as a normal topic, and SEO/canonical generation can treat it as valid content. But Next.js will route `/en/timeline`, `/en/privacy`, `/en/year/...`, and `/en/c/...` to the concrete route tree rather than the topic page.
- This creates unreachable or misleading canonical URLs. It also makes future route additions dangerous because the slug guard has to be updated by memory.

Concrete failure scenario:
- An admin creates a “Timeline” topic with slug `timeline`. The create action passes validation because `timeline` is not in `RESERVED_TOPIC_ROUTE_SEGMENTS`. Topic navigation links point to `/en/timeline`, but that URL renders the timeline feature page, not the topic gallery. The topic looks broken even though the DB row exists.

Suggested fix:
- Create one shared `RESERVED_PUBLIC_ROUTE_SEGMENTS` source of truth that covers all top-level concrete public segments: `admin`, `c`, `g`, `map`, `p`, `privacy`, `s`, `timeline`, `uploads`, `year`, metadata files, and locale codes.
- Use it from both `validation.ts` and `[topic]/page.tsx`.
- Add a test that enumerates concrete siblings of `[topic]` and fails if the reservation set is missing any slug-valid segment.

### C17-LOW-03 - Confirmed: checked-in nginx template is production-host specific despite reusable deploy docs

Severity: Low
Confidence: Medium
Status: Confirmed

Evidence:
- `apps/web/nginx/default.conf:21-29` hardcodes `server_name gallery.atik.kr`.
- `README.md:173-184` documents Docker deployment as a generally adaptable path.
- `.env.deploy.example:6-14` makes remote deployment host/path/user config-driven.

Why it matters:
- The deploy and README surfaces present this repository as configurable, but the checked-in nginx template still bakes one production hostname into the server block. Anyone adapting the repo can complete the documented env-driven deploy flow and still carry a stale server name.
- In nginx, `server_name` interacts with host matching and virtual-host selection. On a shared host or future multi-domain setup, this can serve the app from the wrong default server or make a cloned deployment fail host routing.

Concrete failure scenario:
- A second gallery instance is deployed with a different public hostname using `.env.deploy`. The app boots, but nginx still only declares `gallery.atik.kr`; depending on other server blocks, the new host may hit the default server, receive wrong headers, or bypass intended host-specific policy.

Suggested fix:
- Template `server_name` from deploy configuration, use `_` for an explicitly internal-only default, or document that operators must rewrite this line before deployment.
- Add a lightweight test that either permits only the chosen generic default or verifies the deployment docs mention the required edit.

### C17-LOW-04 - Confirmed: upload cache comment contradicts the actual cache duration

Severity: Low
Confidence: High
Status: Confirmed

Evidence:
- `apps/web/src/lib/serve-upload.ts:245-249` says edge caches keep files fast “for one day”.
- `apps/web/src/lib/serve-upload.ts:250-252` says the policy was reduced from `86400` to `3600`, and the actual header is `Cache-Control: public, max-age=3600, must-revalidate`.

Why it matters:
- This is not a runtime bug, but it is a documentation-code mismatch in a performance-sensitive path. Future operators or reviewers may reason about a 24-hour stale window when the application actually promises one hour.
- Cache behavior is part of the color/HDR delivery contract. Incorrect comments make it easier to reintroduce stale derivative behavior during future pipeline work.

Concrete failure scenario:
- A color-pipeline fix is deployed and an operator expects old derivatives to remain edge-cached for one day because of the comment, delaying investigation in the wrong direction. In reality the browser/edge TTL is one hour plus revalidation behavior.

Suggested fix:
- Update the comment to say “within an hour” or remove the stale “one day” sentence. Keep the R8-R7 rationale next to the header.

### C17-RISK-05 - Risk: custom action-origin lint advertises TSX/JSX coverage but parses every file as TypeScript

Severity: Low
Confidence: Medium
Status: Risk

Evidence:
- `apps/web/scripts/check-action-origin.ts:47` includes `.tsx` and `.jsx` in `ACTION_FILE_EXTENSIONS`.
- `apps/web/scripts/check-action-origin.ts:58-77` recursively discovers those files.
- `apps/web/scripts/check-action-origin.ts:476-479` always creates the AST with `ts.ScriptKind.TS`.

Why it matters:
- The current action files are covered by the passing lint run, but the gate’s stated future coverage is wider than its parser mode. If a future server-action file uses TSX/JSX syntax, the scanner may parse it incorrectly and either fail noisily in an unexpected way or silently miss the structure it was meant to analyze.
- Security lint gates should fail predictably. A misleading extension allowlist is a maintenance hazard because reviewers may believe `.tsx` actions are fully supported.

Concrete failure scenario:
- A future admin action is added in `app/actions/bulk-editor.tsx` with JSX used in a helper or returned fragment. Discovery includes the file, but `createSourceFile(..., ScriptKind.TS)` does not parse it as TSX. The scanner’s AST walk can produce false positives/negatives unrelated to the actual origin-guard contract.

Suggested fix:
- Select `ScriptKind.TSX` for `.tsx`, `ScriptKind.JSX` for `.jsx`, and JS/TS kinds for the other extensions.
- Add fixture tests for guarded and unguarded `.tsx` action files so the claimed extension coverage is executable.

### C17-RISK-06 - Risk: deploy escape hatch executes arbitrary shell from a gitignored env file

Severity: Low
Confidence: Medium
Status: Risk

Evidence:
- `scripts/deploy-remote.sh:61-72` sources the selected env file, allows `DEPLOY_CMD`, and executes it with `bash -lc`.
- `.env.deploy.example:13-14` documents `DEPLOY_CMD` as an optional override for the derived SSH command.

Why it matters:
- This is an intentional escape hatch, not a vulnerability by itself. The risk is operational: `.env.deploy` is gitignored and outside review, while `npm run deploy` is required per iteration. A compromised or accidentally edited env file can run any local shell command under the developer account.
- Because deploy is habitual, this path deserves strong guardrails or at least loud documentation.

Concrete failure scenario:
- A local `.env.deploy` is copied from a shared note with a malformed `DEPLOY_CMD`, or is modified by unrelated tooling. The next routine `npm run deploy` executes the arbitrary command locally before any SSH boundary is reached.

Suggested fix:
- Prefer deriving the SSH command from structured fields and require an explicit `ALLOW_DEPLOY_CMD=1` for the escape hatch.
- Print the resolved command and require an interactive confirmation only for `DEPLOY_CMD`, or restrict the override to commands beginning with `ssh`.
- Document the local-code-execution property in `.env.deploy.example`.

## Positive Contracts I Tried To Break But Did Not

- Admin API authentication is currently enforced by the custom scanner; `npm run lint:api-auth --workspace=apps/web` passed.
- Mutating server actions are currently covered by the same-origin guard scanner; `npm run lint:action-origin --workspace=apps/web` passed.
- Public mutating API routes are currently covered by the rate-limit scanner; `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Lightroom upload attribution appears fixed in current HEAD: `apps/web/src/app/api/admin/lr/upload/route.ts:68-75` derives an authenticated token/cookie actor and `apps/web/src/app/api/admin/lr/upload/route.ts:443` persists `uploaded_by: actorUserId`.
- Public share pages avoid token lookup in metadata and rate-limit before lookup on page render; I inspected `g/[key]` and `s/[key]` flows.
- Semantic search and similar search have same-origin checks, activation gates, request-size checks, rate-limit pre-increment, and processed-image filtering.
- Upload serving validates path segments, extensions, realpaths, containment, non-symlink files, ETags, and content type before streaming.
- Privacy-sensitive fields have type/test guards around public data omission and search enrichment fields.

## Final Missed-Issue Sweep

I did a final sweep across:
- Route conflicts and reserved segment validation.
- Home/topic/photo/share/search public behavior.
- Admin action/API guard coverage.
- Nginx proxy trust and rate-limit IP derivation.
- Upload serving and cache headers.
- DB restore/backup surfaces and deploy helper behavior.
- Schema migration journal conventions.
- Existing test and lint gates.
- Prior critic findings to avoid repeating issues already fixed at HEAD.

Residual uncertainty:
- I did not run the full unit suite, typecheck, build, or Playwright E2E in this critic pass.
- I did not execute production deploy or destructive DB restore paths.
- I sampled broad code regions rather than line-reading every component and every one of the 2000+ tests end to end.
