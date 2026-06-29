# Cycle 11 Document-Specialist Review

**Date:** 2026-06-29
**HEAD reviewed:** `944bbdb0e930c0f4b03bc09b240a2dfcb93935f2`
**Scope:** PROMPT 1 document/code mismatch review only. Production code was not edited; this report is the only intended write.

## Inventory Summary

I built the review inventory before evaluating mismatches. The current unignored repo inventory, excluding `node_modules`, `.next`, `.claude/worktrees`, and `.git`, contains 780 files. I inspected the canonical docs and their implementation touchpoints across:

- Governing docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Package, CI, and quality-gate surfaces: root `package.json`, `apps/web/package.json`, lint/type/build/test scripts, and existing review artifacts for current claims.
- Deploy/runtime contracts: `.env.deploy.example`, deploy scripts, Dockerfile/Compose, nginx config, health routes, and build-time guards.
- Public-source contracts cited by docs: SEO/base URL handling, OpenGraph routes, feed routes, service-worker source/generated copy, public route freshness, semantic-search activation, migration/privacy contracts, and associated tests.
- Final grep sweeps covered `BASE_URL`, `siteConfig.url`, `every public page`, `revalidate = 0`, `per-entry <author>`, and `author_name` references.

## Findings

### CONFIRMED - MEDIUM - Base-URL docs say `site-config.url` must match `BASE_URL`, but the build guard permits a split-brain OG configuration

**Files/regions:** `CLAUDE.md:214`, `CLAUDE.md:633-636`, `apps/web/scripts/ensure-site-config.mjs:11-40`, `apps/web/src/__tests__/ensure-site-config.test.ts:69-76`, `apps/web/src/lib/data.ts:1740-1747`, `apps/web/src/app/api/og/photo/[id]/route.tsx:51-58`, `apps/web/src/app/api/og/photo/[id]/route.tsx:112-131`, `apps/web/src/app/api/og/photo/[id]/route.tsx:252-297`

**Confidence:** High

**Evidence:** `CLAUDE.md:636` documents `site-config.json.url` as the canonical base URL that "must match `BASE_URL` env var", while `CLAUDE.md:214` says production validates the effective canonical base URL as `BASE_URL || siteConfig.url` and also says per-photo OG derivative fetches are pinned to trusted `siteConfig.url`. The validator implements only the effective URL check: it reads `process.env.BASE_URL || siteConfig.url` (`apps/web/scripts/ensure-site-config.mjs:11-12`) and rejects missing, non-http(s), or placeholder effective hosts (`apps/web/scripts/ensure-site-config.mjs:23-40`). The test suite explicitly locks that split by expecting success when `BASE_URL` overrides a `site-config` value of `https://example.com` (`apps/web/src/__tests__/ensure-site-config.test.ts:69-76`). SEO settings then publish `url: process.env.BASE_URL || siteConfig.url` (`apps/web/src/lib/data.ts:1740-1747`), but the per-photo OG route still uses `new URL(siteConfig.url).origin` for internal derivative fetches (`apps/web/src/app/api/og/photo/[id]/route.tsx:112-125`) and falls back when those fetches fail (`apps/web/src/app/api/og/photo/[id]/route.tsx:126-131`). Invalid-ID fallback paths also use `siteConfig.url` directly (`apps/web/src/app/api/og/photo/[id]/route.tsx:51-58`), and the fallback builder redirects relative to whichever canonical base URL it receives (`apps/web/src/app/api/og/photo/[id]/route.tsx:252-297`).

**Failure scenario:** An operator follows the docs loosely, leaves `apps/web/src/site-config.json.url` at `https://example.com`, and sets `BASE_URL=https://gallery.example.com`. The production build passes because the validator and test accept the `BASE_URL` override, sitemap/metadata use `gallery.example.com`, but per-photo OG image generation attempts internal derivative fetches from `https://example.com/uploads/...`. Valid photo OG images then fall back to the site-default/root response instead of rendering the photo, and malformed-ID fallback can derive redirects from the stale `siteConfig.url`.

**Concrete fix:** Pick one contract and align docs, guard, and route. If `siteConfig.url` must match `BASE_URL`, make `ensure-site-config.mjs` validate `siteConfig.url` itself when `BASE_URL` is set and update the override test. If `BASE_URL` is the intended runtime override, change the per-photo OG route to use the same centralized canonical URL (`seo.url` or a shared `BASE_URL` helper) for derivative fetch origin and fallback paths, then update `CLAUDE.md:636` to say `BASE_URL` overrides `site-config.url`.

### CONFIRMED - LOW - Service-worker docs claim every public page sets `revalidate = 0`, but the privacy page does not

**Files/regions:** `CLAUDE.md:399-410`, `apps/web/public/sw.template.js:7-15`, `apps/web/public/sw.js:7-15`, `apps/web/src/__tests__/sw-template-contract.test.ts:6-11`, `apps/web/src/app/[locale]/(public)/privacy/page.tsx:1-15`, `apps/web/src/app/[locale]/(public)/page.tsx:16`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:38`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:14`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:19`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:14`, `apps/web/src/app/[locale]/(public)/map/page.tsx:10`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:16`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:17`

**Confidence:** High

**Evidence:** `CLAUDE.md:399` accurately narrows freshness to public photo, topic, shared, and home pages, but `CLAUDE.md:410` broadens the service-worker rationale to "every public page sets `revalidate = 0`". The shipped service-worker template and generated copy repeat that broad statement (`apps/web/public/sw.template.js:7-15`, `apps/web/public/sw.js:7-15`), and the SW contract test preamble says every public page ships `no-store` (`apps/web/src/__tests__/sw-template-contract.test.ts:6-11`). Most public routes do export `revalidate = 0` at the cited route files, but `apps/web/src/app/[locale]/(public)/privacy/page.tsx:1-15` has metadata and render code without a `revalidate` export.

**Failure scenario:** A maintainer extending `networkFirstHtml` or the SW cache contract can rely on the broader doc/test/template claim and assume all public HTML is dynamic/no-store. The privacy page is a counterexample, so the stated Cache-Control premise is false for at least one public route. The current privacy page is static and low-risk, but the mismatch makes future offline-cache reasoning and route audits less reliable.

**Concrete fix:** Update the service-worker docs, template comment, generated `sw.js`, and test preamble to match the narrower true contract: dynamic public gallery/photo/topic/share/map/timeline/year pages set `revalidate = 0`, while static public pages such as privacy may be cacheable. If the product intent really is "every public page", add `export const revalidate = 0` to the privacy route and keep the broad docs.

### CONFIRMED - LOW - Atom feed route comments still describe per-entry admin authors even though data intentionally emits `NULL`

**Files/regions:** `CLAUDE.md:171`, `apps/web/src/lib/data.ts:827-845`, `apps/web/src/app/feed.xml/route.ts:76-83`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:87-93`

**Confidence:** High

**Evidence:** `CLAUDE.md:171` documents the current privacy contract: `uploaded_by` is admin-only and public Atom uses the feed-level author until a safe public display-name exists. The data layer enforces that by selecting `author_name: sql<string | null>\`NULL\`` and explaining that public Atom must not expose the admin login username (`apps/web/src/lib/data.ts:827-845`). The route-level comments still say "per-entry `<author>` when the upload carries a known admin" and explain the `NULL` fallback (`apps/web/src/app/feed.xml/route.ts:76-83`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:87-93`). Because the helper always returns `NULL`, the per-entry author branch is currently dead for production feed data.

**Failure scenario:** A future maintainer reads the route comments as the intended R17-L2 behavior and restores an admin-user join or otherwise wires `uploaded_by` into public feed entries, contradicting the documented privacy decision in `CLAUDE.md` and the data-layer security comment. That could expose valid admin identifiers through unauthenticated `feed.xml` endpoints.

**Concrete fix:** Replace the stale route comments with the current invariant: `author_name` is intentionally `NULL`, so entries fall back to the feed-level author until a separate admin-set public display-name field exists. Alternatively, remove the dead per-entry branch from the routes until such a field is implemented.

## Likely Issues

None beyond the confirmed findings above.

## Final Missed-Issue Sweep

The final sweep rechecked canonical docs and code comments against implementation for base URL validation/OG origin selection, public route cache freshness, service-worker offline fallback rationale, Atom feed author privacy, semantic search activation, migration/hash contracts, upload/derivative limits, health/readiness behavior, Docker/nginx deploy assumptions, and privacy-sensitive field guards.

Already-aligned areas included Node/package script names, Docker bind mounts and prune-after-up policy, upload and nginx body-size limits, health/live route behavior, semantic-search stub/production gating, similar-search production-only UI gating, migration journal postconditions, and the `_PrivacySensitiveKeys`/`SENSITIVE_KEYS` privacy guard.

## Validation Evidence

- Inventory command: `rg --files -g '!node_modules/**' -g '!.next/**' -g '!.claude/worktrees/**' -g '!.git/**' | wc -l` returned 780 files.
- Read-only line sweeps over `CLAUDE.md`, root/app READMEs, build guard tests, OG routes, service-worker template/generated copy, public route files, feed routes, and data helpers.
- `git status --short` checked before writing; `.context/reviews/critic.md` was already dirty and was not touched.
- Not run: lint, typecheck, build, unit tests, or E2E. This was a review-only document/source-contract task and no production source was edited.
