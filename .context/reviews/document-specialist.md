# Cycle 12 Document-Specialist Review

**Date:** 2026-06-29
**HEAD reviewed:** `d7fd0db296817e7322bb62b346a6b2c64904cec9`
**Scope:** Document/code mismatch review only. No production code fixes were made.

## Inventory

I built the review inventory first, then checked each authoritative claim against the corresponding implementation. There is no `.context/docs/` directory in this checkout, so I treated the current governing docs plus `.context/plans/README.md` as the review-relevant `.context` documentation surface and treated historical review/plan archives as non-authoritative history unless they were needed to understand a current claim.

Reviewed authoritative docs:

- `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`.
- `.context/plans/README.md` and current `.context/plan/*.md` / `.context/plans/*.md` index surfaces.
- Deploy docs and config claims in root/app READMEs, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, and build/deploy guard scripts.
- Migration and schema docs in `AGENTS.md`, `CLAUDE.md`, `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle/*.sql`, `apps/web/scripts/init-db.ts`, and `apps/web/scripts/migrate.js`.
- Security/privacy docs and implementation in `proxy.ts`, `request-origin.ts`, `action-guards.ts`, `rate-limit.ts`, public/admin API route guards, data select fields, privacy tests, and map/feed/search surfaces.
- User-facing i18n strings in `apps/web/messages/en.json` and `apps/web/messages/ko.json`.
- Comments and test descriptions found by full-text sweeps for behavior claims (`must`, `not implemented`, `future`, `per-entry`, `X-Forwarded-Host`, `BASE_URL`, `siteConfig.url`, `onnxruntime`, privacy-sensitive fields, migration journal, and line-reference patterns).

Skipped only generated/build/vendor or historical non-authoritative files: `node_modules`, `.next`, `.git`, uploaded/resource data, gate logs, archived reviews/plans, and prior review artifacts not used as current product documentation. No source or doc fixes were implemented.

## Findings

### CONFIRMED - LOW - `uploaded_by` comments still describe public Atom per-entry attribution that the privacy contract removed

**Files/regions:** `CLAUDE.md:171`, `apps/web/src/lib/data.ts:833-845`, `apps/web/src/app/feed.xml/route.ts:76-82`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:87-93`, `apps/web/src/app/actions/images.ts:435-438`, `apps/web/src/app/api/admin/lr/upload/route.ts:416-422`, `apps/web/src/__tests__/privacy-fields.test.ts:28-30`

**Confidence:** High

**Evidence:** `CLAUDE.md:171` says `uploaded_by` is admin-only and public Atom currently uses the feed-level author until a safe public display-name field exists. The data helper enforces that by selecting `author_name: sql<string | null>\`NULL\`` and documenting that every entry falls back to the feed-level author (`apps/web/src/lib/data.ts:833-845`). Both feed routes now carry the same privacy invariant (`apps/web/src/app/feed.xml/route.ts:76-82`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:87-93`). However, the browser upload path still says recording `uploaded_by` lets "per-entry Atom `<author>`" attribute the upload and that "the public feed renders a JOIN-derived display name" (`apps/web/src/app/actions/images.ts:435-438`). The Lightroom upload path similarly says a missing `uploaded_by` makes public Atom per-entry author attribution dead (`apps/web/src/app/api/admin/lr/upload/route.ts:416-422`). The privacy test fixture also says per-entry Atom author uses a JOIN-derived display name in `getImagesForFeed` (`apps/web/src/__tests__/privacy-fields.test.ts:28-30`).

**Failure scenario:** A future maintainer follows the upload-path comments rather than the data-layer privacy contract and reintroduces an admin-user join or expects Lightroom/browser upload attribution to appear in public feeds. That can either leak admin identifiers through unauthenticated `feed.xml` endpoints or send someone debugging a nonexistent attribution feature.

**Suggested fix:** Rewrite the stale comments to say `uploaded_by` is retained for admin audit/ownership only; public Atom entries intentionally use the feed-level author until a separate public display-name field exists. Keep the route/data comments as the source of truth.

### CONFIRMED - LOW - Florence caption-generator comments say `onnxruntime-node` still needs to be added, but it is already installed for CLIP

**Files/regions:** `apps/web/src/lib/caption-generator.ts:4-17`, `apps/web/package.json:28-29`, `package-lock.json:1038-1047`, `package-lock.json:8638-8643`, `apps/web/README.md:58-60`, `CLAUDE.md:540`

**Confidence:** High

**Evidence:** The caption generator stub says the full Florence path is deferred because `onnxruntime-node` adds native binaries, claims the stub keeps the binary footprint zero, and lists "`onnxruntime-node` is added as a dependency" as a future prerequisite (`apps/web/src/lib/caption-generator.ts:4-17`). Current semantic-search code already ships `@huggingface/transformers` as a production dependency (`apps/web/package.json:28-29`), and the lockfile shows `@huggingface/transformers` depends on `onnxruntime-node@1.21.0` (`package-lock.json:1038-1047`, `package-lock.json:8638-8643`). The app README and CLAUDE.md explicitly document that the CPU binding ships inside the npm tarball and needs no Dockerfile step (`apps/web/README.md:58-60`, `CLAUDE.md:540`).

**Failure scenario:** A future implementer treats the caption comment as current and spends time adding a duplicate native dependency, changing Dockerfile install behavior, or deferring Florence work under the false assumption that the runtime binding is absent. That is low runtime risk but high maintenance noise around native dependencies.

**Suggested fix:** Update `caption-generator.ts` to say the Florence implementation is still deferred because the Florence weights/download/operator flow and inference integration are not implemented. Remove the claim that `onnxruntime-node` still needs to be added or that the current binary footprint is zero.

### CONFIRMED - LOW - CLAUDE base-URL prose overstates `siteConfig.url` and `BASE_URL` matching requirements

**Files/regions:** `CLAUDE.md:214`, `CLAUDE.md:633-636`, `apps/web/src/lib/constants.ts:21-24`, `apps/web/scripts/ensure-site-config.mjs:11-40`, `apps/web/src/__tests__/ensure-site-config.test.ts:69-76`, `apps/web/src/app/api/og/photo/[id]/route.tsx:103-120`, `apps/web/src/lib/data.ts:1736-1740`, `README.md:147-148`, `apps/web/README.md:42`

**Confidence:** High

**Evidence:** CLAUDE says per-photo OG internal derivative fetches are pinned to trusted `siteConfig.url` (`CLAUDE.md:214`) and the deployment checklist says `site-config.json.url` "must match `BASE_URL` env var" (`CLAUDE.md:633-636`). Current code centralizes `BASE_URL` as `process.env.BASE_URL || siteConfig.url` (`apps/web/src/lib/constants.ts:21-24`), the build guard validates that effective value (`apps/web/scripts/ensure-site-config.mjs:11-40`), and the test suite explicitly accepts `BASE_URL` overriding a placeholder `site-config` URL (`apps/web/src/__tests__/ensure-site-config.test.ts:69-76`). The per-photo OG route comments and code now use the trusted effective canonical origin, not raw `siteConfig.url` (`apps/web/src/app/api/og/photo/[id]/route.tsx:103-120`). SEO settings also use `process.env.BASE_URL || siteConfig.url` (`apps/web/src/lib/data.ts:1736-1740`). The root and app READMEs match the code by saying to set a real `BASE_URL` or replace `site-config.json.url` (`README.md:147-148`, `apps/web/README.md:42`).

**Failure scenario:** An operator or future maintainer following only CLAUDE can believe the app requires `siteConfig.url` and `BASE_URL` to be identical, even though the tested code supports `BASE_URL` as an override. Conversely, a future "docs-alignment" patch could incorrectly tighten the guard and break the supported override path.

**Suggested fix:** Update CLAUDE to use one contract consistently: either document `BASE_URL || siteConfig.url` as the canonical value everywhere, or deliberately change code/tests to enforce exact matching. The current implementation evidence favors updating CLAUDE.

### CONFIRMED - LOW - Privacy test comment points at an obsolete `data.ts` line range

**Files/regions:** `apps/web/src/__tests__/privacy-fields.test.ts:71-85`, `apps/web/src/lib/data.ts:459-477`

**Confidence:** High

**Evidence:** The symmetric privacy-guard test comment says the existing `_privacyGuard` is at `data.ts:198-200` (`apps/web/src/__tests__/privacy-fields.test.ts:80`). The guard is now at `apps/web/src/lib/data.ts:459-477`.

**Failure scenario:** This does not change test behavior, but it sends future reviewers to the wrong region when auditing a privacy-sensitive field addition. The prompt explicitly includes test descriptions and comments that claim behavior; stale line references are low-cost drift that tends to compound in this repo.

**Suggested fix:** Replace the hard-coded line range with a symbol reference such as "`_privacyGuard` in `apps/web/src/lib/data.ts`" or update the current line reference.

### RISK - LOW - Shipped nginx catch-all does not set `X-Forwarded-Host` even though docs require proxies to overwrite it

**Files/regions:** `README.md:153`, `apps/web/README.md:48`, `apps/web/nginx/default.conf:56-160`, `apps/web/nginx/default.conf:185-195`, `apps/web/src/lib/request-origin.ts:55-68`

**Confidence:** Medium

**Evidence:** The root README and app README both say the trusted proxy must overwrite `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` (`README.md:153`, `apps/web/README.md:48`). Most specific nginx locations do set `X-Forwarded-Host` (`apps/web/nginx/default.conf:56-160`), but the catch-all `location /` sets `Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto` without `X-Forwarded-Host` (`apps/web/nginx/default.conf:185-195`). Current same-origin calculation falls back from trusted `x-forwarded-host` to `host` (`apps/web/src/lib/request-origin.ts:55-68`), so I did not confirm a live break in the shipped topology.

**Failure scenario:** The shipped config contradicts the docs for all catch-all routes, including public same-origin-gated endpoints routed through `location /`. Today the Host fallback appears to preserve behavior, but a future request-origin refactor or a custom proxy copied from the docs/config split could rely solely on `X-Forwarded-Host` and fail same-origin validation or use an unexpected host.

**Suggested fix:** Either add `proxy_set_header X-Forwarded-Host $host;` to the catch-all location to match the docs, or narrow the docs to say the app accepts trusted `X-Forwarded-Host` when present and falls back to `Host` when the proxy overwrites that header correctly.

## Aligned Areas Rechecked

- Admin initialization: `apps/web/scripts/init-db.ts:24-30` calls `migrate.js`, and `migrate.js:787-827` seeds the admin user after migrations. The app README's "migrations, then seed admin" script description is accurate.
- Migration runbook: journal/postcondition docs match `migrate.js` per-entry baselining and missing-hash assertion.
- Privacy field guard: `publicSelectFields`, `publicMapSelectFields`, `_PrivacySensitiveKeys`, and `SENSITIVE_KEYS` are aligned for the current admin-only columns.
- Service worker freshness comments: current CLAUDE text and SW/template comments now correctly narrow the `revalidate = 0` claim to dynamic gallery/photo pages; the static privacy page is not a mismatch.
- Feed route comments: root and topic feed routes now correctly say `author_name` is `NULL` and entries fall back to the feed-level author.
- i18n strings: auto-alt text strings in English and Korean correctly describe EXIF-derived placeholders and state that Florence inference is not implemented.
- Semantic search docs: production/stub gating, scan/top-k env caps, model-version honesty gate, offline weights, and same-origin/rate-limit posture match the inspected code.
- Deploy/body limits: Docker bind mounts, prune-after-up policy, health/live route behavior, nginx body-size caps, and app upload caps are aligned with the current docs.

## Final Sweep

Final sweeps covered commonly missed issue classes: stale "future dependency" comments, stale line-number comments, user-facing i18n honesty, deploy helper assumptions, nginx header/body-limit claims, migration journal monotonicity/runbook claims, same-origin/proxy trust docs, public privacy select fields, public map GPS exception, Atom feed author privacy, service-worker offline-cache rationale, and semantic-search production activation.

Skipped files were limited to generated/build/vendor data and historical artifacts that are not current authoritative documentation: `node_modules`, `.next`, `.git`, uploaded/resource data, gate logs, archived reviews/plans, and prior cycle review files beyond confirming the target file was being replaced for cycle 12.

## Validation Evidence

- Read-only review commands over authoritative docs, implementation files, i18n files, migration metadata, and comment/test-description sweeps.
- `git status --short` was clean before writing this report.
- No lint/typecheck/build/test suite was run because this was a review-only task and no production source code was changed.
