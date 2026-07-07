# GalleryKit Product Marketer Reviewer — Cycle 5 Prompt 1

Date: 2026-07-07
Custom reviewer prompt consulted: `/Users/hletrd/.codex/agents/product-marketer-reviewer.md`.

Note: the local custom prompt targets another product, so I used its discipline of code-verified positioning, claims, trust, and launch-readiness review, adapted to GalleryKit.

## Inventory

Reviewed product-facing claims and their source evidence:

- `README.md` feature list and setup/config sections.
- `apps/web/README.md` environment notes.
- `CLAUDE.md` authoritative architecture/product caveats for semantic search, PWA, smart collections, admin scope, color/HDR, deploy topology.
- Source routes/actions behind marketed surfaces: smart collections, service worker, search, admin nav.
- Existing tests for accessibility, i18n, focus, public flows, and PWA/source contracts.

## Confirmed Issues

### PM-C5-01 — PWA "visited image caching" claim is too broad for CDN deployments

Evidence:

- `README.md:43` advertises visited image caching plus offline HTML fallback.
- `README.md:146-163` and `apps/web/README.md:49-51` explain `IMAGE_BASE_URL` as a CDN/prefix option.
- `CLAUDE.md:433` states CDN-origin derivatives are opaque and deliberately not cached by the SW.
- `apps/web/public/sw.template.js:323-334` only caches `networkResponse.ok` image responses.

Concrete market failure scenario:

A buyer/operator evaluates GalleryKit as a self-hosted portfolio with CDN-backed assets and expects PWA visited-photo offline resilience. In that topology, the claim does not hold for images, which can damage trust more than omitting the claim would.

Suggested fix:

Change public copy to: installable PWA with same-origin visited-image caching and offline HTML fallback; CDN-origin derivatives are network-only unless proxied same-origin. Keep the "not a full offline gallery sync" sentence.

Confidence: High.

### PM-C5-02 — Smart collections are code-real but not product-operable

Evidence:

- `CLAUDE.md:162` says no admin UI/API surface invokes smart-collection mutations and direct DB INSERT is the current authoring path.
- Source confirms actions exist (`apps/web/src/app/actions/collections.ts:16-150`) and public rendering exists (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-164`).
- Admin nav has no collections entry (`apps/web/src/components/admin-nav.tsx:15-25`).

Concrete market failure scenario:

Marketing or docs describe dynamic galleries as an admin capability. A photographer/admin tries to create one after install, finds no UI, and concludes the product is unfinished or requires database work for normal publishing.

Suggested fix:

Do not market smart-collection authoring until an admin workflow ships. If included in roadmap copy, call it "internal/public read side exists; admin authoring is planned" rather than implying it is usable today.

Confidence: High.

## Likely Issues

### PM-C5-03 — Semantic search positioning is currently accurate but fragile

Evidence:

- `README.md:42` correctly says semantic search is self-hosted, operator-enabled, disabled by default, requires setup, and is not a vector index.
- `CLAUDE.md:160` reinforces that the repo proves gates/runbook, not live production status.

Concrete failure scenario:

Short-form copy outside these docs drops the operator-enabled/setup caveat and turns the feature into "AI search included" for fresh installs. That would set wrong expectations and invite support requests around model weights/backfill.

Suggested fix:

Keep the current wording discipline in all public surfaces: "operator-enabled semantic search" and "requires model weights and backfill." Treat production activation claims as deploy-specific, not repo-default.

Confidence: Medium.

## Manual-Validation Risks

### PM-C5-M01 — Product quality claims need a fresh live UX/performance pass before external launch copy

Evidence:

- Code/test coverage is strong for focus and i18n, but this lane did not run live browser automation or Core Web Vitals.
- The strongest differentiators are visual fidelity, color/HDR handling, and photo browsing performance; those are user-perceived surfaces.

Risk scenario:

Docs accurately describe the engineering, but an external visitor judges the product on first photo paint, mobile browsing feel, and fullscreen/detail interactions.

Suggested validation:

Before launch/marketing updates, run a live pass on representative mobile and desktop devices for home, topic, photo detail, search, and share flows. Capture code-backed fixes for any LCP/CLS/INP or interaction regressions.

Confidence: Medium.

## Final Sweep

Checked for over-claims around editing/culling/scoring, AI/semantic search, Lightroom integration, PWA/offline behavior, smart collections, color/HDR, admin scope, self-hosting/deploy assumptions, i18n, and privacy/trust. Current README correctly says GalleryKit is not an editor/culler/scoring tool and that semantic search is operator-enabled; the main copy risk is the PWA/CDN caveat.
