# Skeptical whole-repo review — cycle 5

## Scope / inventory reviewed

I reviewed the repository as a whole-system surface rather than sampling isolated files. Inventory covered:

- Root guidance/docs/manifests: `AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`, deploy helper scripts.
- Web app docs/config/deploy: `apps/web/README.md`, `apps/web/package.json`, `Dockerfile`, `docker-compose.yml`, nginx config, Next/Vitest/Playwright/Tailwind/TS configs, env examples.
- Data/migrations/scripts: `apps/web/drizzle/*`, `apps/web/scripts/*`, DB/schema/bootstrap logic.
- Server code: all app routes/actions, core `src/lib/*` modules, i18n, middleware, storage/upload helpers.
- UI surface and admin/public flows: public pages, admin pages, major components, and shared viewers/search/upload managers.
- Test surface: unit tests and e2e specs, with cross-checking against the code paths they claim to protect.

Verification run during review:

- `npm test --workspace=apps/web` ✅ (37 files / 203 tests)
- `npm run lint --workspace=apps/web` ✅
- `npm run build --workspace=apps/web` ✅

Those checks passing does **not** eliminate the issues below; two of the findings are specifically about false confidence created by passing local validation while deployment/runtime invariants remain unenforced.

---

## Findings

### 1) Production builds silently fall back to the example site config, contradicting the deployment contract

- **Exact file / region:**
  - `apps/web/package.json:8-10`
  - `apps/web/Dockerfile:40-45`
  - `README.md:153-167`
  - `CLAUDE.md:225-233`
  - `apps/web/deploy.sh:21-25`
- **Why this is a problem:**
  - The docs and deploy script say a real `apps/web/src/site-config.json` must exist before deployment.
  - But both the workspace build (`prebuild`) and Docker build silently copy `src/site-config.example.json` when the real file is missing.
  - That means CI/container builds can succeed with placeholder metadata instead of failing fast.
- **Concrete failure scenario:**
  - A fresh deployment forgets to bind or copy `src/site-config.json`.
  - `npm run build` and `docker compose ... --build` still succeed because they auto-copy the example.
  - The shipped app then advertises `https://example.com` canonicals / sitemap / OG URLs / branding until someone notices in production.
- **Suggested fix:**
  - Make the fallback development-only.
  - Fail `prebuild`/Docker builds in production or CI if `src/site-config.json` is missing.
  - Keep the example copy behavior only in explicit local-dev bootstrapping scripts.
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed

### 2) Topic slug ↔ alias uniqueness is only checked optimistically, not enforced transactionally, so route collisions can still be created

- **Exact file / region:**
  - `apps/web/src/app/actions/topics.ts:15-32` (`topicRouteSegmentExists`)
  - `apps/web/src/app/actions/topics.ts:34-107` (`createTopic`)
  - `apps/web/src/app/actions/topics.ts:110-245` (`updateTopic`)
  - `apps/web/src/app/actions/topics.ts:305-361` (`createTopicAlias`)
  - `apps/web/src/lib/data.ts:672-705` (`getTopicBySlug` resolves topics before aliases)
  - `apps/web/src/__tests__/topics-actions.test.ts:138-148,175-217,238-242`
- **Why this is a problem:**
  - The app treats topic slugs and aliases as one shared route namespace.
  - Enforcement is done with preflight reads (`topicRouteSegmentExists`) against two tables, but there is **no cross-table constraint, lock, or single transaction** preventing concurrent inserts into `topics` and `topic_aliases`.
  - The tests validate sequential rejection paths, but they do not cover the concurrency hole.
- **Concrete failure scenario:**
  - Admin A creates topic slug `travel` while Admin B simultaneously creates alias `travel` for another topic.
  - Both preflight checks can pass before either insert commits.
  - Both writes succeed because each table only enforces its own PK/unique keys.
  - Routing becomes ambiguous; `getTopicBySlug()` prefers the topic row first, so the alias becomes shadowed/unreachable and admin intent is silently broken.
- **Suggested fix:**
  - Move slug/alias namespace enforcement behind a single DB authority.
  - Options: a dedicated `route_segments` table, a shared advisory lock around slug/alias mutations, or transactional serialization that checks and reserves the segment in one place.
  - Add a concurrency regression test, not just sequential validation tests.
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed

### 3) The promised “same-origin only” OG-image restriction disappears on the documented fallback deployment path

- **Exact file / region:**
  - `apps/web/src/app/actions/seo.ts:93-125`
  - `README.md:113-137`
  - `apps/web/README.md:25-32`
- **Why this is a problem:**
  - The code comment says external OG image URLs are restricted to relative paths or same-origin URLs to avoid tracker/malicious third-party metadata assets.
  - In reality, origin enforcement only happens when `BASE_URL` is set.
  - If `BASE_URL` is omitted (which the app otherwise tolerates by falling back to `site-config.json`), the validator allows any `http/https` URL.
- **Concrete failure scenario:**
  - A deployment relies on `site-config.json` for its public origin and leaves `BASE_URL` unset.
  - An admin sets `seo_og_image_url` to a third-party host.
  - Every public page can now emit third-party OG metadata URLs despite the code/comments implying that same-origin enforcement exists.
- **Suggested fix:**
  - Derive the allowed origin from the same effective base URL used elsewhere (`process.env.BASE_URL || site-config.json.url`) instead of gating enforcement on `BASE_URL` alone.
  - Add unit coverage for both `BASE_URL`-present and `BASE_URL`-absent cases.
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed

---

## Missed-issues sweep

Final sweep focused on auth/session handling, upload serving, restore/backup flows, share pages, SEO metadata generation, route revalidation, Docker/runtime startup, and test/doc alignment.

I did **not** find another confirmed issue at the same signal level as the three above before wrap-up. The biggest remaining risk area is **deployment/config correctness and cross-table route invariants**, not basic build/test health: the repo currently looks “green” locally while still allowing misconfigured production branding and concurrent route-namespace corruption.
