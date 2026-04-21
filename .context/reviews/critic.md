# Cycle 2 ultradeep critic review

## Inventory / review surface

Broad inspection covered:
- repo guidance and docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`
- deploy/runtime: root `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`
- app metadata + public surface: `apps/web/src/app/sitemap.ts`, `manifest.ts`, `robots.ts`, public pages under `apps/web/src/app/[locale]/(public)/...`
- auth/admin/security: `proxy.ts`, `lib/session.ts`, `lib/api-auth.ts`, `lib/rate-limit.ts`, `app/actions/auth.ts`, `app/actions/admin-users.ts`, admin DB backup/download flows
- data/image pipeline: `lib/data.ts`, `lib/process-image.ts`, `lib/image-queue.ts`, `lib/upload-paths.ts`, `lib/serve-upload.ts`, `app/actions/images.ts`
- config + SEO: `lib/constants.ts`, `lib/data.ts`, `app/actions/seo.ts`, admin SEO client
- checks/tests: `scripts/check-api-auth.ts`, unit tests, E2E specs

Verification run on 2026-04-22:
- `npm run lint --workspace=apps/web` ✅
- `npm test --workspace=apps/web` ✅ (96 tests)
- `npm run build --workspace=apps/web` ✅

No current automated failure surfaced; the findings below are mostly architecture/ops/product risks that existing checks do not catch.

---

## Findings

### 1) Pending image processing is only resumed opportunistically, not from a guaranteed startup hook
- **Severity:** High
- **Confidence:** High
- **Category:** correctness / operational resilience
- **Citations:** `apps/web/src/lib/image-queue.ts:287-343`, `apps/web/src/app/actions/images.ts:11-20`, `apps/web/src/instrumentation.ts:1-33`
- **Why this matters:** the queue bootstrap that re-enqueues `processed = false` rows runs only as a side effect of importing `@/lib/image-queue`. In this repo, that import path is tied to image mutation code (`app/actions/images.ts`) and the shutdown path, not to an explicit startup path.
- **Failure scenario:** the server restarts while images are mid-processing. Those rows stay in `processed = false`, but no one touches an image-mutation action after restart. Result: uploads remain stuck in the admin dashboard indefinitely until some later code path happens to import `image-queue`.
- **Suggested fix:** move bootstrap into an explicit startup path (for example `instrumentation.register()`), keep it idempotent, and log/alert when pending jobs exist but bootstrap cannot start.

### 2) SEO updates do not reliably propagate to the web manifest because the manifest is built as a static artifact
- **Severity:** Medium
- **Confidence:** High
- **Category:** deploy/docs drift / product correctness
- **Citations:** `apps/web/src/app/manifest.ts:1-28`, `apps/web/src/app/actions/seo.ts:120-124`, `apps/web/src/lib/revalidation.ts:55-56`
- **Verification note:** `npm run build --workspace=apps/web` on 2026-04-22 emitted `○ /manifest.webmanifest`, confirming the manifest is prerendered static in the current build.
- **Why this matters:** the SEO admin action claims to revalidate long-lived metadata surfaces, but the manifest route itself has no `dynamic`/`revalidate` policy and is emitted as static.
- **Failure scenario:** an admin updates site title/nav title/description in the SEO screen; public HTML may refresh, but installed-PWA metadata and manifest consumers keep stale values until the next full rebuild/redeploy.
- **Suggested fix:** either make `manifest.ts` explicitly dynamic/revalidated with the same invalidation story as the rest of SEO, or remove DB-backed fields from the manifest and document it as deploy-time config only.

### 3) Production canonicals/OG base URLs still depend on a checked-in localhost config that the admin UI cannot correct
- **Severity:** Medium
- **Confidence:** High
- **Category:** product risk / deploy footgun
- **Citations:** `apps/web/src/site-config.json:1-11`, `apps/web/src/lib/constants.ts:11-14`, `apps/web/src/lib/data.ts:748-755`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:16-23`, `apps/web/deploy.sh:21-24`
- **Why this matters:** the committed `site-config.json` defaults to `http://localhost:3000`, and canonical/OG URLs fall back to that value when `BASE_URL` is not set. The admin SEO screen lets operators edit title/description/author/OG image, but not the site URL.
- **Failure scenario:** a production deploy forgets `BASE_URL` or ships the checked-in `site-config.json` unchanged. The app will happily serve canonicals, JSON-LD, sitemap links, and OG URLs pointing at localhost; the admin UI cannot repair this afterward.
- **Suggested fix:** fail closed in production when `BASE_URL` or a non-local `site-config.url` is missing, and/or surface the canonical site URL as an explicitly validated deploy-time setting with health-check coverage.

### 4) The sitemap silently drops images after 24,000 entries instead of splitting into multiple sitemap files
- **Severity:** Medium
- **Confidence:** High
- **Category:** product / SEO scalability
- **Citations:** `apps/web/src/app/sitemap.ts:14-23`, `apps/web/src/app/sitemap.ts:41-55`, `apps/web/src/lib/data.ts:725-735`
- **Why this matters:** the current sitemap hard-caps image inclusion at 24k to stay under the 50k-URL limit after locale expansion, but there is no sitemap index or paging strategy.
- **Failure scenario:** once the gallery exceeds the cap, newer or older photos (depending on ordering policy) simply disappear from the sitemap, reducing discoverability and making SEO quality degrade exactly when the gallery gets large.
- **Suggested fix:** implement multi-sitemap generation (`generateSitemaps` / sitemap index) so the product scales past the first 24k images without silent SEO loss.

### 5) The admin API auth “lint” is string-matching, so future insecure routes can pass CI accidentally
- **Severity:** Medium
- **Confidence:** High
- **Category:** security / hidden assumption
- **Citations:** `apps/web/scripts/check-api-auth.ts:1-31`, `apps/web/src/lib/api-auth.ts:1-16`, `apps/web/src/proxy.ts:47-57`
- **Why this matters:** the repo relies on a custom CI check to enforce auth on `/api/admin/*`, but the script only checks whether the file text contains `withAdminAuth` or `isAdmin`. A comment, dead import, or unused helper call is enough to satisfy the check.
- **Failure scenario:** a future `/api/admin/.../route.ts` forgets to wrap the handler, but includes an unused `isAdmin` import or a comment mentioning `withAdminAuth`; CI passes and the route ships unauthenticated.
- **Suggested fix:** replace the string search with AST-based validation or a stricter convention (for example: every admin route must export `GET/POST/... = withAdminAuth(...)`, with the checker validating actual export structure).

---

## Cross-file / system-level concerns worth watching

### A) The repo still contains a half-integrated storage-backend abstraction that is easy to over-trust
- **Severity:** Low
- **Confidence:** High
- **Citations:** `apps/web/src/lib/storage/index.ts:1-19`, `apps/web/src/lib/process-image.ts:12-13`, `apps/web/src/lib/serve-upload.ts:1-7`, `CLAUDE.md:95-95`
- **Concern:** the codebase includes S3/MinIO/local backend machinery, but the real write and serve paths still go straight to filesystem-specific modules. That mismatch is documented, but it is still a maintenance trap: the abstraction looks production-ready while the actual product is not.
- **Suggested fix:** either remove/archive the unfinished abstraction until it is wired end-to-end, or add loud runtime/test guards that fail if anyone tries to expose backend switching prematurely.

### B) The shared-group view counter is deliberately approximate and single-process
- **Severity:** Low
- **Confidence:** Medium
- **Citations:** `apps/web/src/lib/data.ts:9-37`, `apps/web/src/lib/data.ts:43-104`, `apps/web/src/instrumentation.ts:14-23`
- **Concern:** view counts are buffered in memory, retried best-effort, and flushed on timer/shutdown. That is fine for a single long-lived node process, but it will lose counts on crashes and does not compose cleanly with multi-instance deployments.
- **Suggested fix:** either document view counts as approximate/non-authoritative or move increments to a durable queue/direct SQL update when accuracy matters.

---

## Missed-issues sweep / lower-signal items

These did not rise to top-tier findings, but I would keep them on the radar:
- The privacy test suite is mostly documentary and does not actually assert that public query results omit sensitive fields at runtime (`apps/web/src/__tests__/privacy-fields.test.ts`).
- The build emits repeated `TRUST_PROXY` production warnings during static generation; not a functional bug, but it is noisy and makes it easier to ignore real production warnings later.
- Deploy helpers are intentionally simple (`scripts/deploy-remote.sh`, `apps/web/deploy.sh`): they execute mutable remote state with no health-gated rollback. Fine for personal ops, risky if this ever becomes team-operated.

---

## Bottom line

The repo is in decent shape from a lint/test/build perspective, but its biggest risks are **startup behavior**, **metadata/config freshness**, and **security/process assumptions that are enforced socially or by weak scripts rather than by the runtime itself**.
