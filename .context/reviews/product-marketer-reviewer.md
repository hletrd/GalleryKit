# Product Marketer Review - Cycle 21

Date: 2026-06-30
Reviewer lane: product-marketer-reviewer
Scope: GalleryKit only. Adapted from the BurstPick product-marketer-reviewer principles to a self-hosted photographer/operator gallery: positioning, docs versus engineering claims, feature surfacing, onboarding/readme clarity, operator trust, photographer/admin value props, and product/doc mismatch grounded in source.

## Executive Summary

I found 5 issues: 1 High, 3 Medium, 1 Low. GalleryKit's engineering claims are mostly honest and unusually specific, but the public product story is still too hard for a self-hosting photographer/operator to act on. The largest GTM risk is not a false feature claim; it is that the README leads with a generic "self-hosted photo gallery" description and dense implementation proof before it names the target operator, first-run path, and launch-ready trust checklist.

Go-to-market readiness score: 6/10 for technical self-hosters; 4/10 for broader photographer adoption until the README, install path, and integration docs are made launch-oriented.

## Inventory Reviewed

- Required context: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `/Users/hletrd/.codex/agents/product-marketer-reviewer.md`.
- Public/product docs: root README, web README, `.env.local.example`, Docker Compose, semantic-search design/spec docs, existing `.context/reviews/product-marketer-reviewer.md`.
- Product surfaces: public home, empty gallery state, admin login/dashboard/settings/tokens, PWA manifest/service worker, semantic and similar search components/routes.
- Trust/ops source: gallery config resolver, upload limits, token auth, Lightroom upload route, storage abstraction quarantine, caption generator, image queue side effects, privacy/backup/admin copy.
- Final sweep: targeted `rg` over "Semantic", "CLIP", "Lightroom", "plugin", "PWA", "offline", "HDR", "storage", "not implemented", "operator-only", "stub", "placeholder", "root admin", "backup", and "self-hosted" across docs, source, and i18n.

## Findings

### PMR21-01 - README positioning is still a feature inventory, not a launch proposition

Severity: High
Confidence: High
Status: Confirmed

Evidence:
- The hero value proposition is only "A high-performance, self-hosted photo gallery built with Next.js": `README.md:5-9`.
- The first public section is a feature list led by masonry, image formats, color science, semantic search, PWA, sharing, admin, i18n, and Docker: `README.md:29-44`.
- The code's sharper product premise is buried in internal context: photos arrive after editing, and GalleryKit's job is accurate delivery of the photographer's intent with no edit/culling/scoring features: `CLAUDE.md:267-270`.
- The product also has concrete operator-trust boundaries that are not pulled into the README's top narrative: multiple root admins with no role model (`CLAUDE.md:232-235`), database-only backup limitations (`apps/web/messages/en.json:18-24`), private originals and persisted bind mounts (`CLAUDE.md:571-576`), and self-hosted semantic-search limits (`apps/web/README.md:56-66`).

Product/user failure scenario:
A photographer evaluating the repository cannot tell in the first screen whether GalleryKit is for client proofing, portfolio publishing, family archives, color-critical galleries, or a Lightroom replacement. The feature list proves engineering depth, but it does not answer "why this instead of Immich, PhotoPrism, a static portfolio, Lightroom Web, or a WordPress gallery?" That weakens conversion even when the underlying product has a defensible wedge: accurate, self-hosted photo delivery with private originals and operator-controlled sharing.

Suggested fix:
Rewrite the README opening around a specific target and outcome before the feature matrix. Example: "GalleryKit is a self-hosted gallery for photographers who want fast public delivery, accurate color, private originals, and controllable share links after editing is already done." Follow it with a "Who it is for / not for" block, a first-run success checklist, and two screenshots or share-preview examples before the implementation-heavy feature list.

### PMR21-02 - Self-hosted onboarding still punts the database bootstrap to the reader

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- Root install says "Create a MySQL database/user first" but gives no command, Docker option, privilege shape, or verification step: `README.md:91-103`.
- The app README repeats "after creating a MySQL database/user" and then starts with `npm install`: `apps/web/README.md:7-19`.
- `.env.local.example` names `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` but does not show how to create them: `apps/web/.env.local.example:1-7`.
- The shipped Docker Compose only runs the web service and uses host networking so the container can reach MySQL on `127.0.0.1`: `apps/web/docker-compose.yml:1-28`.
- The app README later clarifies that Compose assumes a host-managed MySQL instance: `apps/web/README.md:48-52`.
- `npm run init` runs migrations against whatever DB already exists; it does not create the database or user: `apps/web/scripts/init-db.ts:24-35`.

Product/user failure scenario:
A competent photographer/operator follows the README on a fresh VPS, reaches `npm run init --workspace=apps/web`, and fails on MySQL connectivity or permissions because the hardest prerequisite was left as a comment. For a self-hosted product, this is the point where users decide whether the project feels maintained and installable.

Suggested fix:
Add a "Create MySQL database/user" subsection before `npm run init` with copy-paste MySQL commands, required privileges, and a `mysqladmin ping` or `npm run init` preflight expectation. Either add an optional local `docker compose` profile for MySQL or explicitly say "GalleryKit does not ship a MySQL container; use host MySQL or a managed MySQL service." Keep the current host-network production topology, but make the first install path unambiguous.

### PMR21-03 - Semantic search is marketed as live, but production activation is split across UI, README, and internal runbook

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- Root README markets semantic search as a live self-hosted AI feature while noting it is disabled by default and requires setup: `README.md:37`.
- The app README provides mode semantics and high-level activation steps, including direct DB mutation to set `admin_settings.semantic_search_mode='production'`: `apps/web/README.md:56-77`.
- The admin Settings UI intentionally offers only Disabled and Stub; there is no Production option: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:637-675`.
- The resolver heals a stored `production` value to `disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` is set: `apps/web/src/lib/gallery-config.ts:123-142`.
- The exact sidecar commands for seeding and backfilling are in `CLAUDE.md`, not in a user-facing semantic-search guide: `CLAUDE.md:495-545`.
- The route correctly fails closed unless mode is `stub` or `production`: `apps/web/src/app/api/search/semantic/route.ts:186-204`, and similar-photo search is production-only: `apps/web/src/app/api/search/similar/[id]/route.ts:110-126`.

Product/user failure scenario:
An operator sees "Semantic Search (AI, self-hosted, operator-enabled)" in the README, opens Settings, and can only pick Disabled or Stub. The real activation path requires model seeding, backfill, env opt-in, and a DB row update, but the exact operational runbook is split between a short app README and an AI-assistant context file. This makes a real feature feel hidden or unfinished even though the engineering gate is honest.

Suggested fix:
Promote semantic search to a dedicated public doc such as `docs/semantic-search.md`, linked directly from the README feature bullet and Settings copy. Include exact sidecar commands, the SQL update, verification queries, expected UI state, rollback steps, hardware expectations, and the bounded-scan limitation. In Settings, add a read-only "Production requires operator runbook" panel with the doc link when production is not UI-selectable.

### PMR21-04 - Upload API tokens are surfaced, but the public docs do not provide an integration contract

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- README advertises a "PAT-authenticated upload API for external clients" and clarifies no Lightroom Classic plugin is bundled: `README.md:40`.
- The Tokens UI says GalleryKit exposes the API endpoint and tokens should be used by server-side upload integrations: `apps/web/messages/en.json:815-829`.
- The actual route contract is only in source comments: `POST /api/admin/lr/upload`, multipart upload, `X-GalleryKit-Token`, `lr:upload` scope, cookie fallback for testing: `apps/web/src/app/api/admin/lr/upload/route.ts:1-19`.
- The route has important client requirements and failure modes: `Content-Length` is required, chunked transfer is rejected, per-file and total upload caps are enforced: `apps/web/src/app/api/admin/lr/upload/route.ts:85-112`.
- Token auth uses the case-insensitive `x-gallerykit-token` header and bypasses same-origin only when the route opts into a required scope: `apps/web/src/lib/api-auth.ts:15-35`, `apps/web/src/lib/api-auth.ts:50-72`.
- Token scopes are broader in the model (`lr:upload`, `lr:read`, `lr:delete`) even though the visible token flow grants upload access automatically: `apps/web/src/lib/admin-tokens.ts:24-25`, `apps/web/messages/en.json:823-829`.

Product/user failure scenario:
A developer or power-user creates a token, then has to read TypeScript to know the endpoint, header name, multipart field names, content-length requirement, error shape, response shape, limits, and whether the token can read/delete. That turns a valuable "bring your own uploader / Lightroom publish client" story into an implementation scavenger hunt.

Suggested fix:
Add `docs/upload-api.md` and link it from README and the Tokens page. Include endpoint, auth header, scopes currently usable, multipart form fields, max-size behavior, example `curl`, success/error JSON, reverse-proxy body cap note, and a clear "server API only; no bundled Lightroom plugin" statement. If `lr:read` and `lr:delete` are reserved, label them reserved or hide them from user-facing copy until routes exist.

### PMR21-05 - Auto Alt-Text is a visible admin feature even though it is explicitly a stub

Severity: Low
Confidence: High
Status: Confirmed

Evidence:
- The Settings UI exposes an Auto Alt-Text card and toggle: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:620-632`.
- The English copy is candid but still labels the feature "Auto Alt-Text"; it says local Florence-2 inference is not implemented and only basic EXIF-derived hints are created: `apps/web/messages/en.json:731-734`.
- The implementation is explicitly a stub: no Florence-2 weights or captioning runner are wired, and enabled mode produces deterministic EXIF strings like "Photo taken with Canon EOS R5": `apps/web/src/lib/caption-generator.ts:1-16`, `apps/web/src/lib/caption-generator.ts:31-62`.
- The queue writes the generated suggestion after processing when enabled: `apps/web/src/lib/image-queue.ts:678-695`.
- Bulk edit can copy the EXIF-derived suggestion into title or description: `apps/web/messages/en.json:236-242`, `apps/web/src/app/actions/images.ts:1073-1114`.

Product/user failure scenario:
An admin turns on "Auto Alt-Text" expecting content-aware accessibility captions and later discovers repeated camera-derived placeholders. Even with the explanatory subcopy, the feature name overpromises because "auto alt-text" now commonly means visual captioning, not EXIF templating. This is a small trust leak compared with the repo's otherwise careful honesty around HDR and semantic search.

Suggested fix:
Rename the visible feature to "EXIF Alt-Text Hints" until real caption inference ships. Keep the toggle default off, make the output examples explicit in Settings, and reserve "Auto Alt-Text" for the future Florence/model-backed implementation. Alternatively hide the setting behind an experimental/developer section.

## Product-Market Fit Assessment

GalleryKit's most defensible wedge is not "AI gallery" or "Next.js gallery." It is a self-hosted photo publishing stack for photographers who care about accurate delivery, private originals, public sharing, and operational control after editing is complete. The code supports that wedge: no edit/culling/scoring features (`CLAUDE.md:267-270`), local filesystem storage only (`CLAUDE.md:147`), operator-gated semantic search (`apps/web/README.md:68-77`), private originals plus public derivatives (`CLAUDE.md:179-185`), and explicit root-admin limitations (`CLAUDE.md:232-235`).

The first customer should be a technically capable photographer, small studio, or photo-blog operator who already has hosting comfort and wants control over presentation, metadata privacy, and sharing. Broader creator adoption needs a smoother setup story, visible screenshots/proof, and less source-code-only integration knowledge.

## Positioning Recommendation

Current public line:

> A high-performance, self-hosted photo gallery built with Next.js.

Recommended position:

> A self-hosted gallery for photographers who want fast public delivery, accurate color, private originals, and controllable sharing after editing is done.

One-sentence word-of-mouth:

> "GalleryKit is the self-hosted photo site I use when I want my edited photos to stay private at the source but look right when I share them."

Do not lead with semantic search. It is a strong advanced capability, but the durable product story is trust, color fidelity, ownership, and simple sharing.

## Current Strengths

- README and Settings avoid claiming a bundled Lightroom plugin.
- Semantic search copy names the disabled/default state, stub limitations, production gate, and bounded-scan limitation.
- HDR copy is honest that public derivatives remain SDR until HDR delivery ships.
- Storage backend docs correctly avoid presenting S3/MinIO as supported.
- Admin-user copy clearly states root-admin trust boundaries.
- Backup copy discloses that database backup does not cover original/derivative/resource files.

## Final Missed-Issue Sweep

Sweep performed:
- Re-read required context files and the custom reviewer prompt.
- Inventoried public docs, `.context` review/plan history, source routes, i18n strings, Docker/env files, and implementation files behind the main claims.
- Re-ran targeted searches for stale or risky terms: `Semantic`, `CLIP`, `Lightroom`, `plugin`, `PWA`, `offline`, `HDR`, `storage_backend`, `S3`, `MinIO`, `not implemented`, `operator-only`, `stub`, `placeholder`, `root admin`, `backup`, and `self-hosted`.
- Checked previously risky areas from the old product-marketer artifact: privacy analytics copy, site-config/demo identity, storage backend exposure, Similar Photos behavior, semantic-search honesty, upload-token copy, and public empty state.

Not filed because current code/copy is adequate:
- Storage backend is quarantined and local-only; no current public S3/MinIO claim was found.
- PWA copy says visited-image caching/offline HTML fallback and explicitly does not promise full offline gallery sync; source matches that narrow claim (`README.md:38`, `apps/web/public/sw.template.js:4-19`).
- Similar Photos correctly fails closed unless production semantic search is active; no public claim says it works in stub mode.
- Admin root-role limitations are disclosed in README and admin copy.
- Public empty state is visitor-safe and does not expose admin setup instructions.
- Backup plaintext and file-backup limitations are disclosed in README/app copy.

Review boundary:
- I did not modify product code, run tests, verify live demo behavior, or commit/push. This was a static product/content/trust review grounded in source.

## Final Verdict

Wait on a broader launch push until the README is repositioned, MySQL onboarding is made copy-pasteable, semantic-search activation is moved into public docs, and upload API documentation exists. The product itself is more coherent than the public story: GalleryKit has a real self-hosted photographer/operator wedge, but the docs still make evaluators assemble that wedge from implementation details.
