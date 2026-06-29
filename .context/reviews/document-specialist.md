# Document-Specialist Review — Review-Plan-Fix Cycle 1 Prompt 1

**Date:** 2026-06-29
**Scope:** Documentation/code mismatch review for current repo behavior. I inventoried root/app docs, current AGENTS/CLAUDE operational guidance, package scripts, deploy/env examples, Docker/nginx/deploy scripts, CLIP docs/scripts, high-signal code comments that claim behavior, i18n user-facing copy, and current/latest document-review artifacts. Historical `.context` plans/reviews were inventoried and treated as non-authoritative unless current docs referenced them.

## Inventory Examined

- Authoritative docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Config/examples/scripts: `package.json`, `apps/web/package.json`, `.env.deploy.example`, `apps/web/.env.local.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`.
- Code sources behind doc claims: `apps/web/scripts/ensure-site-config.mjs`, `apps/web/src/lib/upload-limits.ts`, `apps/web/next.config.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/download-clip-models.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/messages/{en,ko}.json`.
- Review context: current `.context/reviews/document-specialist.md` plus recent document-specialist lineage to avoid re-reporting already-closed items.

## Findings

### DOC-C1 — CLIP production backfill command exits without work in the documented pre-enable sequence

**Severity:** HIGH  
**Confidence:** High  
**Status:** Confirmed mismatch

**Docs:** `CLAUDE.md:506-527` tells operators to seed weights, run `scripts/backfill-clip-embeddings.ts --production`, then set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` and the DB row to `production`.

**Code:** `apps/web/scripts/backfill-clip-embeddings.ts:90-95` exits `0` without processing when `semantic_search_mode` is unset/disabled and `--force` is absent. The app README has the correct pre-enable command, `--production --force`, at `apps/web/README.md:68-70`.

**Failure scenario:** An operator follows `CLAUDE.md` on a default install. The backfill logs that semantic search is disabled and exits successfully with no embeddings. The operator then enables production mode; production search has weights but no matching real rows, so the search surface 503s until a corrected backfill is run.

**Concrete fix:** Change both CLIP sidecar commands/references in `CLAUDE.md:506-527` to use `scripts/backfill-clip-embeddings.ts --production --force` for the documented pre-enable flow, and explain that `--force` is only unnecessary after the DB mode has already been set to `stub` or `production`.

### DOC-C2 — `site-config.json.url` validation docs now understate build-time validation and overstate OG 404 behavior

**Severity:** MEDIUM  
**Confidence:** High  
**Status:** Confirmed mismatch

**Docs:** `CLAUDE.md:212` says both OG image routes validate `siteConfig.url` at request time and return 404 when it is missing/unparseable. `CLAUDE.md:628-632` says the `url` field has no startup/build-time validation and typos surface only as OG-card 404s.

**Code:** Production builds run `apps/web/scripts/ensure-site-config.mjs`; it reads `process.env.BASE_URL || siteConfig.url` and rejects missing, non-absolute, unsupported-protocol, or placeholder hosts at `apps/web/scripts/ensure-site-config.mjs:11-42`. Docker runs the guard before build at `apps/web/Dockerfile:71-75`, and `apps/web/package.json:10-11` runs it again in `prebuild`. The per-photo OG route returns a fallback redirect response, not 404, when `siteConfig.url` is invalid (`apps/web/src/app/api/og/photo/[id]/route.tsx:111-119`, helper status `302` at `:251-285`). The topic OG route does not use `siteConfig.url` for a background fetch at all (`apps/web/src/app/api/og/route.tsx:33-108`).

**Failure scenario:** A maintainer debugging config may trust CLAUDE and look only at runtime OG requests, missing the fact that Docker/production builds already fail when the effective base URL is bad. Conversely, someone expecting invalid per-photo OG config to produce 404 will see 302 fallbacks and chase the wrong behavior.

**Concrete fix:** Rewrite the CLAUDE OG note to distinguish: production build guard validates the effective base URL (`BASE_URL || siteConfig.url`); per-photo OG still fail-closes request-time fetch origin by redirecting to the configured fallback/root when `siteConfig.url` cannot be parsed; the topic OG route is not part of that internal photo-fetch SSRF path.

### DOC-C3 — Per-photo OG inline comment says it falls back to request origin, but code intentionally does not

**Severity:** MEDIUM  
**Confidence:** High  
**Status:** Confirmed mismatch

**Code comment:** `apps/web/src/app/api/og/photo/[id]/route.tsx:101-110` says the route pins to `siteConfig.url` and will “Fall back to the request origin” if it is unset/unparseable.

**Code reality:** The catch block at `apps/web/src/app/api/og/photo/[id]/route.tsx:112-119` explicitly avoids request-origin fallback and returns `buildFallbackResponse(...)`; the helper returns a 302 to same-origin configured OG image or `${new URL(req.url).origin}/` at `:251-285`.

**Failure scenario:** A future security fix or refactor could reintroduce the attacker-controllable request-origin fallback by following the stale comment instead of the code below it.

**Concrete fix:** Replace lines `109-110` with the actual invariant: when `siteConfig.url` is unset/unparseable, do not fetch a derivative through request origin; return the fallback response to avoid blind SSRF.

### DOC-C4 — `.env.local.example` documents the wrong `NEXT_UPLOAD_BODY_MAX_BYTES` default

**Severity:** MEDIUM  
**Confidence:** High  
**Status:** Confirmed mismatch

**Docs:** `apps/web/.env.local.example:45-47` says `NEXT_UPLOAD_BODY_MAX_BYTES` defaults to `216269172` (~206 MiB) and describes it as an individual upload body cap.

**Code:** `apps/web/src/lib/upload-limits.ts:3-6` computes the default as `max(200 MiB upload, 250 MiB restore) + 16 MiB overhead`, and `:21` applies that value to `NEXT_UPLOAD_BODY_MAX_BYTES`. The current default is `278921216` bytes (266 MiB), matching `CLAUDE.md:110`.

**Failure scenario:** An operator uncommenting the example value to “pin the default” silently lowers the framework body limit below the documented 250 MiB DB restore path plus multipart overhead. Large restores can fail at the Next.js body parser even though nginx and app restore docs say 250 MiB is allowed.

**Concrete fix:** Update `apps/web/.env.local.example:45-47` to `278921216 = 266 MiB` and describe it as the Server Action transport cap covering both 200 MiB photo uploads and 250 MiB DB restore bodies plus overhead.

### DOC-C5 — `GalleryConfig.avifEffort` comment still says 4-9 while UI/validator support 0-9

**Severity:** LOW  
**Confidence:** High  
**Status:** Confirmed mismatch

**Code comment:** `apps/web/src/lib/gallery-config.ts:83-84` documents `avifEffort` as “AVIF encoding effort (4-9)”.

**Code/user-facing reality:** The validator accepts `0-9` at `apps/web/src/lib/gallery-config-shared.ts:177-181`; the admin UI renders all ten options at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:490-497`; English and Korean help text both say `0-9` at `apps/web/messages/en.json:734-735` and `apps/web/messages/ko.json:734-735`; CLAUDE also documents `0-9` at `CLAUDE.md:314`.

**Failure scenario:** A developer using the server interface comment as the source of truth may incorrectly reject or “sanitize” valid low-effort values `0-3`, breaking the intended fast-ingest option.

**Concrete fix:** Change the comment to “AVIF encoding effort (0-9)” and keep the existing default note in `gallery-config-shared.ts`.

## Final Sweep

- Common mismatch classes checked: env default literals, CLI commands/flags, deployment file paths, Docker prune/data-safety claims, nginx body caps, health/live endpoints, semantic-search gates, upload/body-size limits, admin UI option ranges, OG fallback behavior, and security comments that claim fail-closed behavior.
- Verified non-findings: root/app README build-base-url claims match `ensure-site-config.mjs`; nginx caps match README/CLAUDE; deploy prune docs match `apps/web/deploy.sh`; semantic-search UI really exposes only Disabled/Stub; `IMAGE_PIPELINE_VERSION`, `COLOR_IMPACTING_KEYS`, and upload 200 MiB/2 GiB/100 limits match current code.
- Skipped/irrelevant: archived `.context/plans/**` and old `.context/reviews/**` are historical audit artifacts, not current operational docs, unless referenced by current docs. I did not treat stale historical findings inside those archives as present-day documentation defects.
