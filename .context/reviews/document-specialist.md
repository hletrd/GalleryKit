# GalleryKit Document Specialist Review — Cycle 5 Prompt 1

Date: 2026-07-07
Lane: document-specialist
Mode: read-only source/docs review, except this artifact.

## Inventory

Authoritative and public documentation examined:

- `AGENTS.md` and `CLAUDE.md`
- `.context/plans/README.md`, current cycle plan/deferred registers, recent review artifacts
- `README.md`
- `apps/web/README.md`
- Deploy/config references: `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`
- Source used to verify doc claims: `apps/web/src/instrumentation.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/public/sw.template.js`, `apps/web/src/app/actions/collections.ts`, public smart-collection route, `apps/web/src/components/admin-nav.tsx`, message catalogs and i18n tests.

I did not run build, tests, dev server, or browser automation because this review prompt only permits writes to the five review artifacts. Findings below are document/source backed.

## Confirmed Issues

### DOC-C5-01 — Public PWA documentation omits the same-origin-only image-cache condition

Evidence:

- `README.md:43` says the PWA has "a service worker for visited image caching and an offline HTML fallback".
- `README.md:146-163` documents optional `IMAGE_BASE_URL=https://cdn.example.com` and says the value must be set before build, but does not connect that setting to the PWA image-cache limitation.
- `apps/web/README.md:49-51` likewise documents `IMAGE_BASE_URL` as an optional CDN origin/path prefix and says to leave it unset for local/self-hosted uploads, but does not mention SW cache behavior.
- `CLAUDE.md:427-434` is more precise: the image strategy caches same-origin 200 responses only, and cross-origin CDN derivatives are opaque and deliberately not cached.
- Source confirms the authoritative doc: `apps/web/public/sw.template.js:323-334` returns non-OK network responses without `imageCache.put(...)`; opaque CDN fetches have status `0`.

Concrete failure scenario:

An operator follows the README, configures a cross-origin CDN using `IMAGE_BASE_URL`, and later relies on "visited image caching" for offline or poor-network gallery use. The HTML fallback may still be available, but the photo derivatives will not have been cached by the SW under that topology.

Suggested fix:

Amend `README.md` PWA and `IMAGE_BASE_URL` sections, plus `apps/web/README.md:49-51`, to say visited image caching applies to same-origin derivative responses. Point advanced operators to the CLAUDE.md C4-25 note for CDN choices: same-origin proxy, or accept network-only CDN derivatives.

Confidence: High.

### DOC-C5-02 — Smart-collection operability is documented only in CLAUDE.md, while source exposes hardened actions and a public route

Evidence:

- `CLAUDE.md:162` correctly states that `smart_collections` rows exist, `/c/[slug]` renders public smart collections, hardened create/update/delete actions exist, but no admin UI/API surface invokes them yet and rows are authored by direct DB INSERT.
- `apps/web/src/app/actions/collections.ts:16-69`, `apps/web/src/app/actions/collections.ts:71-123`, and `apps/web/src/app/actions/collections.ts:125-150` expose create/update/delete server actions with admin/origin/restore-fence guards.
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-164` implements the public read route.
- `apps/web/src/components/admin-nav.tsx:15-25` lists admin destinations but has no Collections entry.

Concrete failure scenario:

A future contributor or operator sees the collection route/actions and treats smart collections as a shipped admin feature, then cannot create or manage them from the UI. That can lead to hand-authored JSON predicate rows, support burden, or docs that overstate feature readiness.

Suggested fix:

Keep CLAUDE.md's warning as the authoritative contract and avoid mentioning smart-collection authoring in public-facing docs until the admin UI ships. If the feature is promoted, add docs for the exact admin workflow and validation semantics in the same change as the UI.

Confidence: High.

## Likely Issues

### DOC-C5-03 — Lifecycle ownership docs still point readers at `image-queue.ts` for non-image retention work

Evidence:

- `CLAUDE.md:159` describes anonymous analytics retention and says the hourly background GC in `image-queue.ts` runs `purgeOldViewEvents()`.
- `apps/web/src/lib/image-queue.ts:1244-1274` confirms that is currently true, but the current carry-forward register schedules extraction of maintenance scheduling to instrumentation.

Concrete failure scenario:

After the planned extraction, maintainers may update code but miss this architectural paragraph, leaving future readers looking in `image-queue.ts` for retention scheduling that has moved.

Suggested fix:

When ARCH-C5-01/C4-17 is implemented, update `CLAUDE.md:159` and the Service Worker/PWA or lifecycle sections to name the new maintenance scheduler module and its instrumentation owner.

Confidence: Medium. This is a pending-doc-sync risk tied to a planned code change, not a current mismatch.

## Manual-Validation Risks

### DOC-C5-M01 — Public marketing claims around semantic search still require deployed-host verification

Evidence:

- `README.md:42` is appropriately cautious: semantic search is operator-enabled, disabled by default, and requires model weights/backfill/env opt-in.
- `CLAUDE.md:160` is even more explicit that the repo proves gates/runbook, not current live production row count.

Risk scenario:

If product copy outside the repo shortens this to "AI search included" without the operator-enabled caveat, fresh-install expectations will be wrong.

Suggested validation/fix:

Keep public copy in the current cautious shape unless a deployment artifact proves production mode, weight seed, and embedding backfill status.

Confidence: Medium.

## Final Sweep

Checked docs for env var defaults, build-time/runtime config distinctions, deploy helper paths, schema/migration journal guidance, service-worker generated-source contract, smart-collection status, i18n parity, and privacy/security wording. Aside from the confirmed PWA/CDN caveat and smart-collection operability boundary, no additional doc/code mismatches were found in the examined file groups.
