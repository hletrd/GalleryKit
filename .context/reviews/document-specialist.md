# Cycle 16 Document-Specialist Review

Date: 2026-06-30
Reviewed HEAD: `7506661e247ee63680b547ed89a1e8462883b2e8`
Scope: documentation, README/CLAUDE/AGENTS, operational docs, config examples, comments, and code-contract claims against current HEAD only.

## Inventory Summary

Required context read: `AGENTS.md`, `CLAUDE.md`, and the code-review skill instructions.

Inventory built before findings:

- Tracked HEAD inventory: 2557 files.
- Documentation and text surfaces: 1823 markdown/text/license files, including 7 README/AGENTS/CLAUDE surfaces.
- Config examples: `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`.
- Operational/config surfaces: 23 deployment/build/runtime files, including package scripts, Dockerfile, compose, nginx, deploy helper, GitHub workflow, Next/Vitest/Playwright/TypeScript config, and Drizzle journal.
- Script/runbook surfaces: 28 tracked scripts under repo/app script paths.
- Tests-as-contract: 275 tracked unit/e2e test files.
- Comment/code-contract sweep: 2922 hits for `MUST`, `IMPORTANT`, `SECURITY`, `contract`, `invariant`, `do not`, `never`, `required`, `requires`, `WARNING`, `TODO`, `FIXME`, and `NOTE` across docs, app source, scripts, nginx, Docker, docs, plan, and `.context/plans`.

I excluded generated build outputs, runtime uploads/data, `node_modules`, and binary review screenshots from content review. Existing unrelated modified review artifacts were left untouched. This report overwrites only `.context/reviews/document-specialist.md`.

## Confirmed Issues

### DOC16-01 - Shipped `site-config.json` can publish the demo host as a self-hosted canonical URL

Severity: High
Confidence: High
Status: Confirmed
Category: config/documentation policy mismatch

Evidence:

- `apps/web/src/site-config.json:1-11` is tracked and sets `"url": "https://gallery.atik.kr"`.
- `README.md:148` tells operators production builds require a real public URL and says only `https://example.com` and localhost placeholders are rejected by the build guard.
- `apps/web/README.md:42` gives the same policy: set `BASE_URL` or replace `src/site-config.json.url` before production build.
- `apps/web/scripts/ensure-site-config.mjs:14-20` rejects `example.com`, `www.example.com`, `localhost`, `127.0.0.1`, `::1`, and `[::1]`, but not `gallery.atik.kr`.
- `apps/web/scripts/ensure-site-config.mjs:12` uses `BASE_URL || siteConfig.url`, and `apps/web/src/lib/constants.ts:21-24` plus `apps/web/src/app/sitemap.ts:18-103` use the same fallback for canonical/sitemap/feed URLs.

Failure scenario:

A self-hosted operator clones the repo and builds/deploys without setting `BASE_URL` and without replacing the already-present tracked `apps/web/src/site-config.json`. The production guard accepts `https://gallery.atik.kr` because it is not classified as a placeholder. The new installation can emit `gallery.atik.kr` in canonical URLs, sitemap entries, feed URLs, OpenGraph fallbacks, JSON-LD, and analytics self-referrer logic. That misidentifies the self-hosted site as the demo and can pollute indexing/social metadata.

Suggested fix:

Replace the tracked `apps/web/src/site-config.json` URL with a rejected placeholder and require deployment to provide a customized copy, or add known demo hosts such as `gallery.atik.kr` to the production-build rejection list unless an explicit demo-build override is set. Update README/CLAUDE wording to distinguish the public demo link from forbidden default canonical origins.

### DOC16-02 - Public route rate-limit docs and scanner message under-describe the required early-return gate

Severity: Low
Confidence: High
Status: Confirmed
Category: lint-gate documentation drift

Evidence:

- `CLAUDE.md:598-602` says the public-route gate requires a mutating public API route to "call" a documented pre-increment helper or carry an exemption.
- `apps/web/scripts/check-public-route-rate-limit.ts:1-18` repeats that contract as "calls one of the documented rate-limit pre-increment helpers".
- The current implementation is stricter and correct: `apps/web/scripts/check-public-route-rate-limit.ts:195-196` says the helper result must dominate mutation by returning early on over-limit, and a bare helper call is not enough.
- The behavior is pinned by `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:297-308`, which fails a route that calls `preIncrementShareAttempt(...)` but ignores the result before mutating.
- The failure message at `apps/web/scripts/check-public-route-rate-limit.ts:331` still says the route neither carries an exemption nor "calls a rate-limit pre-increment helper before mutation", even for the ignored-result case.

Failure scenario:

A developer follows `CLAUDE.md` or the script header, adds a bare `preIncrement...()` call before a DB write, and expects the gate to pass. The actual gate rejects it, but the error message points them back to the already-satisfied "call before mutation" condition instead of the missing over-limit early return. That wastes review time and can encourage weakening the scanner to match the stale docs.

Suggested fix:

Update `CLAUDE.md`, the scanner header, and the `MISSING RATE LIMIT` message to state the real contract: a mutating public route must either carry a reasoned exemption or return early on an approved pre-increment/check result before any mutation. Mention accepted forms such as `if (preIncrementX(...)) return ...` and `const overLimit = preIncrementX(...); if (overLimit) return ...`.

## Likely Issues

None. The remaining candidates checked during this pass either matched HEAD or were product/scale risks already documented outside this documentation lane.

## Manual-Validation Risks

- Live production may still depend on untracked `.env.deploy`, `.env.local`, host nginx, and seeded CLIP model state. I validated the committed docs/config/scripts only, not the live host.
- The report confirms the committed build guard permits `gallery.atik.kr`; whether production/self-hosted deployments actually rely on that fallback requires checking deployed environment variables.
- External browser/platform claims in the color/HDR matrix were not revalidated against current browser support during this source-only pass.

## Verified Non-Findings

- Cycle-15 document findings are fixed at this HEAD: canvas-P3 comments now distinguish display detection from rendering capability; `BACKFILL_CONCURRENCY` is documented as default 2/max 8 and not live-pool-budget-capped; `.context/plans/README.md` no longer marks Cycle 12/Cycle 3 implementation plans as active TODO.
- `rollbackSemanticAttempt` documentation now matches the semantic route's charge-before-body posture: malformed and too-short bodies that were read remain charged.
- Root README now describes categories/sharing rather than overclaiming albums as the primary product model, and it explicitly says no Lightroom Classic plugin is bundled.
- The SEO/OG image URL documentation matches current admin settings: `seo_og_image_url` exists, is read by `getSeoSettings`, and is validated by the SEO action path.
- Nginx body-size docs match `apps/web/nginx/default.conf`: 2M default, 64K login, 250M DB restore, 216M dashboard upload, and 216M `/api/admin/lr/upload`.
- Key high-entropy CLAUDE claims still match code: `IMAGE_PIPELINE_VERSION = 7`, 9 `COLOR_IMPACTING_KEYS`, 8-character settings hash, 395-day view retention default, 10 React `cache()` data exports, 6 advisory lock names, and current NCLX transfer/matrix mappings.

## Final Missed-Issues Sweep

Final sweep rechecked canonical docs, app README, env/config examples, deploy/runbook files, migration/schema rules, package scripts, docs/superpowers, `.context` plan/review indexes, source comments, scanner comments, tests-as-contract, and operational claims for `production`, `deploy`, `BASE_URL`, `site-config`, `placeholder`, `rate-limit`, `preIncrement`, `semantic`, `clip`, `backfill`, `nginx`, `body cap`, `privacy`, `origin`, `public route`, `Lightroom`, `album`, `canvas-P3`, `color-gamut`, and related terms.

No additional confirmed documentation/code mismatch survived the evidence threshold.
