# Cycle 1 critic review — whole repo change surface

Repo: `/Users/hletrd/flash-shared/gallery`  
Scope: critic-only review. I wrote only this report and did not intentionally modify source files. Existing concurrent edits in other review files were left untouched.

## Inventory first

Reviewed the repo as a Next.js 16 / React 19 gallery app with MySQL/Drizzle, server actions, background image processing, public share routes, Docker/nginx deployment, and CI gates.

Key files/docs inspected:
- Root/app scripts and CI: `package.json`, `apps/web/package.json`, `.github/workflows/quality.yml`.
- Public route/data path: `apps/web/src/app/[locale]/(public)/**`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/lib/data.ts`.
- Admin mutation path: `apps/web/src/app/actions/*`, `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Auth/provenance/rate limiting: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/action-guards.ts`.
- Upload/image processing: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-limits.ts`.
- Deployment/docs: `README.md`, `apps/web/README.md`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/scripts/ensure-site-config.mjs`.
- Verification artifacts: `.context/gate-logs/{lint,typecheck,test,build,test-e2e}.log`.

## Findings summary

| ID | Severity | Confidence | Perspective | Finding |
| --- | --- | --- | --- | --- |
| C1-CRIT-01 | High | High | Correctness | Photo prev/next navigation is wrong across `capture_date IS NULL` boundaries. |
| C1-CRIT-02 | High | High | Deployment/security | Shipped nginx config breaks admin origin checks behind a TLS-terminating edge. |
| C1-CRIT-03 | High | High | CI/deployment | CI prepares a placeholder/localhost production URL that the production prebuild guard rejects. |
| C1-CRIT-04 | Medium | Medium-High | Product/SEO | Sitemap swallows DB failures and can cache a homepage-only sitemap for an hour. |
| C1-CRIT-05 | Medium | High | Security/ops | nginx admin rate limiting omits `/admin/seo` and `/admin/settings`. |
| C1-CRIT-06 | Medium | High | Tests/gates | Current gate evidence has lint timed out and E2E with no completion result. |
| C1-CRIT-07 | Low-Medium | High | Docs/product | Checked-in `site-config.json` points to the maintainer domain, so self-hosters can ship wrong canonical URLs. |

## Detailed critique

### C1-CRIT-01 — Photo prev/next navigation is wrong across `capture_date IS NULL` boundaries

- **Severity:** High
- **Confidence:** High
- **Files/lines:** `apps/web/src/lib/data.ts:655-683`, `apps/web/src/lib/data.ts:686-718`; listing/cursor sort contract is `capture_date DESC, created_at DESC, id DESC` at `apps/web/src/lib/data.ts:494-495` and `apps/web/src/lib/data.ts:555-556`.
- **Problem:** `getImage()` handles adjacent-photo queries differently from listing pagination. For an undated current image, the prev query includes *all* dated images (`capture_date IS NOT NULL`) and then orders them descending, so it picks the newest dated photo rather than the immediate predecessor before the undated block. For the oldest dated image, the next query does not include `capture_date IS NULL`, so navigation stops instead of moving into undated images.
- **Failure scenario:** Gallery order is `2026 photo`, `2025 photo`, `undated A`, `undated B`. Opening `undated B` and pressing previous can jump to `2026 photo`, skipping `undated A`; opening `2025 photo` and pressing next may fail to reach `undated A`.
- **Suggested fix:** Centralize the ordering comparator for listing and adjacency. Model sort explicitly as `(capture_date IS NULL) ASC, capture_date DESC, created_at DESC, id DESC`; for prev, filter rows that come before the current row and order by the reverse tuple to get the nearest predecessor; for next, filter rows that come after and order by the normal tuple. Add unit/integration coverage for dated-to-null and null-to-null transitions.

### C1-CRIT-02 — Shipped nginx config breaks admin origin checks behind a TLS-terminating edge

- **Severity:** High
- **Confidence:** High
- **Files/lines:** nginx says it is intended behind a TLS-terminating edge at `apps/web/nginx/default.conf:16-19`, but forwards `$scheme` as proto at `apps/web/nginx/default.conf:57`, `apps/web/nginx/default.conf:74`, `apps/web/nginx/default.conf:89`, and `apps/web/nginx/default.conf:124`. The app trusts `x-forwarded-proto` first at `apps/web/src/lib/request-origin.ts:45-52` and compares Origin/Referer to that expected origin at `apps/web/src/lib/request-origin.ts:96-106`; login enforces this at `apps/web/src/app/actions/auth.ts:91-95`.
- **Problem:** If TLS terminates before nginx and nginx receives plain HTTP, `$scheme` is `http`. Browser `Origin` is `https://...`, but the app computes expected origin as `http://...`, causing login/admin actions/downloads to fail closed.
- **Failure scenario:** Production is deployed as documented: CDN/LB terminates TLS → nginx on port 80 → Next app. Every admin login POST returns the generic auth failure because same-origin validation sees `https` origin versus trusted forwarded proto `http`.
- **Suggested fix:** Either terminate TLS at this nginx server, or preserve a trusted upstream proto with a `map` such as `$http_x_forwarded_proto` fallback to `$scheme`, and document the exact trusted-hop topology. Add a regression test for `hasTrustedSameOrigin()` with `Origin: https://site` and forwarded proto from a TLS edge.

### C1-CRIT-03 — CI prepares a production URL that the prebuild guard rejects

- **Severity:** High
- **Confidence:** High
- **Files/lines:** CI sets `BASE_URL: http://127.0.0.1:3100` at `.github/workflows/quality.yml:27-35`, copies the example site config at `.github/workflows/quality.yml:51-52`, then runs build at `.github/workflows/quality.yml:78-79`. The app `prebuild` runs with `NODE_ENV=production` at `apps/web/package.json:8-11`. The guard rejects placeholder hosts including `127.0.0.1` at `apps/web/scripts/ensure-site-config.mjs:13-21` and `apps/web/scripts/ensure-site-config.mjs:28-37`; the example config is `https://example.com` at `apps/web/src/site-config.example.json:1-5`.
- **Problem:** The official CI build path appears self-contradictory: it supplies a placeholder/localhost base URL while the production prebuild guard refuses placeholder production URLs.
- **Failure scenario:** A push/PR reaches the final Build step. `npm run build` invokes `prebuild`, sees `BASE_URL=http://127.0.0.1:3100`, and exits before Next build. CI fails even though app code may be valid.
- **Suggested fix:** Use a non-placeholder CI URL such as `https://ci.example.invalid` only if the guard permits reserved TLDs intentionally, or introduce an explicit `ALLOW_PLACEHOLDER_BASE_URL_FOR_CI=true` escape hatch scoped to CI. Alternatively set CI `BASE_URL` to a real staging origin. Add a workflow smoke check for `npm run prebuild` to catch this earlier.

### C1-CRIT-04 — Sitemap fallback can cache a homepage-only sitemap for real runtime outages

- **Severity:** Medium
- **Confidence:** Medium-High
- **Files/lines:** sitemap is ISR for one hour at `apps/web/src/app/sitemap.ts:4-12`; it catches all DB errors and empties topics/images at `apps/web/src/app/sitemap.ts:24-46`; it then returns only homepage/topic/image entries from those arrays at `apps/web/src/app/sitemap.ts:48-76`. Existing build evidence shows this fallback on DB connection failure at `.context/gate-logs/build.log:23-31`, with `/sitemap.xml` prerendered for 1h at `.context/gate-logs/build.log:70-72`.
- **Problem:** The fallback was added to tolerate build-time DB unavailability, but it also applies at runtime. A transient DB outage during sitemap revalidation can replace the full sitemap with a minimal homepage-only sitemap for the ISR window.
- **Failure scenario:** Googlebot hits `/sitemap.xml` during a short MySQL restart. The route catches the error, emits only localized homepages, and that incomplete sitemap remains cached for up to 3600 seconds.
- **Suggested fix:** Split build-time tolerance from runtime behavior. For example, make the sitemap dynamic and return `503`/`no-store` from a route handler on runtime DB failure, or detect build phase explicitly and only use the minimal fallback during static generation. At minimum, do not update the ISR cache with fallback content on runtime failures.

### C1-CRIT-05 — nginx admin rate limiting omits settings and SEO mutation pages

- **Severity:** Medium
- **Confidence:** High
- **Files/lines:** nginx admin mutation regex includes only `dashboard|db|categories|tags|users|password` at `apps/web/nginx/default.conf:77-90`. The app exposes `/admin/settings` at `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:1-23` and `/admin/seo` at `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx:1-22`; their mutating actions are `updateGallerySettings()` at `apps/web/src/app/actions/settings.ts:40-47` and `updateSeoSettings()` at `apps/web/src/app/actions/seo.ts:55-62`.
- **Problem:** The comment says this location rate-limits admin mutation routes, but two privileged mutation surfaces fall through to the generic `location /` without the `admin` limiter.
- **Failure scenario:** An authenticated-but-buggy browser session or automation loop repeatedly submits SEO/settings changes. App-level auth/origin checks pass, but nginx does not apply the admin request budget for those paths, increasing DB writes/revalidation churn.
- **Suggested fix:** Include `seo|settings` in the admin mutation regex, or use a broader `^(/[a-z]{2})?/admin/` location with specific exceptions only where needed. Consider lightweight app-level rate limits for global settings mutations too.

### C1-CRIT-06 — Gate evidence is incomplete: lint timed out and E2E has no result

- **Severity:** Medium
- **Confidence:** High
- **Files/lines:** lint log is only `[TIMEOUT after 240s]` at `.context/gate-logs/lint.log:1-2`; E2E log stops immediately after starting Playwright at `.context/gate-logs/test-e2e.log:1-8`; unit tests did pass at `.context/gate-logs/test.log:13-16`; typecheck log has no success summary beyond command echo at `.context/gate-logs/typecheck.log:1-8`.
- **Problem:** The current verification artifact set does not establish the full repo gate. This is especially risky because the repo has custom static checks (`lint:api-auth`, `lint:action-origin`) and browser flows around admin/login/upload.
- **Failure scenario:** A source change that only ESLint, action-origin lint, or Playwright would catch is treated as reviewed because unit tests passed, while the actual lint/E2E evidence is absent or timed out.
- **Suggested fix:** Re-run and capture clean `npm run lint`, `npm run lint:api-auth`, `npm run lint:action-origin`, and `npm run test:e2e` logs. If lint regularly exceeds 240s, profile rule/file hotspots or split lint into app/scripts/tests jobs.

### C1-CRIT-07 — Checked-in site config can ship the maintainer's canonical domain

- **Severity:** Low-Medium
- **Confidence:** High
- **Files/lines:** checked-in `apps/web/src/site-config.json` uses `https://gallery.atik.kr` at `apps/web/src/site-config.json:1-10`. The README tells users to copy/edit the example at `README.md:92-97`, but because the real file already exists, `ensure-site-config` only checks existence at `apps/web/scripts/ensure-site-config.mjs:4-9` and placeholder hosts at `apps/web/scripts/ensure-site-config.mjs:14-21`, not whether the domain is project-specific.
- **Problem:** A fork/self-hosted deployment can build successfully without editing `site-config.json`, producing canonical URLs, robots sitemap URL, OG URLs, and JSON-LD that point to the maintainer domain.
- **Failure scenario:** A user clones, sets DB/admin env, runs Docker build, and skips editing `site-config.json` because it already exists. Search/social metadata on their site advertises `gallery.atik.kr`.
- **Suggested fix:** Do not commit an instance-specific `site-config.json`; commit only the example and generate/copy during setup, or add a production guard that rejects known maintainer/demo domains unless explicitly allowed.

## Final sweep

- No source fixes were implemented in this review.
- Concurrent uncommitted edits outside my ownership (`.context/reviews/code-reviewer.md`, `.context/reviews/perf-reviewer.md`) were observed and left untouched.
- Highest-priority fixes: C1-CRIT-01, C1-CRIT-02, C1-CRIT-03.
