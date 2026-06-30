# Cycle 48 Critic / Photographer Product-Risk Review

Start HEAD: `9d0dc208`.

## Reviewed Inventory

- Project rules and product contract: `AGENTS.md`, `CLAUDE.md`; especially no edit/culling/scoring policy at `CLAUDE.md:271`.
- Cycle 47 baseline: `.context/reviews/cycle-47-2026-07-01/_aggregate.md`, `.context/plans/cycle-47-2026-07-01-plan.md`, `.context/plans/cycle-47-2026-07-01-deferred.md`.
- Color/HDR truthfulness: upload HDR rejection/warning at `apps/web/src/app/actions/images.ts:374`, public/admin color privacy split at `apps/web/src/lib/data.ts:368`, delivered bit-depth and SDR-HDR honesty rows at `apps/web/src/components/color-details-section.tsx:471` and `apps/web/src/components/color-details-section.tsx:532`.
- Admin published-gallery workflows: bulk metadata updates at `apps/web/src/app/actions/images.ts:1060`, failed-image retry fencing at `apps/web/src/app/actions/images.ts:1224`, gallery settings locks/revalidation at `apps/web/src/app/actions/settings.ts:68`.
- Public share reliability: share lookup rate limits and generic metadata at `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:39`, group-share selected-photo handling at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:92`, share creation/revocation guards at `apps/web/src/app/actions/sharing.ts:91`.
- Semantic-search honesty: production env gate at `apps/web/src/lib/gallery-config-shared.ts:206`, API mode gate at `apps/web/src/app/api/search/semantic/route.ts:186`, similar-photo production-only gate at `apps/web/src/app/api/search/similar/[id]/route.ts:110`, visitor disclaimers at `apps/web/src/components/search.tsx:513`.
- EXIF/metadata display: public photo metadata and JSON-LD privacy notes at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:176`, viewer EXIF/admin GPS gating at `apps/web/src/components/photo-viewer.tsx:771` and `apps/web/src/components/photo-viewer.tsx:876`.
- Feed/OG/social output: photo metadata uses per-photo OG route at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:85`, per-photo OG uses bounded derivative fetch and sRGB post-process at `apps/web/src/app/api/og/photo/[id]/route.tsx:25` and `apps/web/src/app/api/og/photo/[id]/route.tsx:82`, Atom feed escaping and media output at `apps/web/src/lib/atom-feed.ts:21` and `apps/web/src/lib/atom-feed.ts:119`.

## Findings

No real new Cycle 48 findings found.

The Cycle 47 photographer-facing fixes appear present at HEAD: the masonry card accessible label includes visible P3 status at `apps/web/src/components/home-client.tsx:310`, and the admin grid renders HDR independently of gamut at `apps/web/src/components/image-manager.tsx:535`.

## Deferred Sweep Note

I did not re-raise Cycle 47 carry-forward deferred items. `PA-42-02`, `PERF-C39-03`, `PERF-C39-04`, `TV-40-03`, `AGG-C38-07`, and `AGG-C38-08` remain documented deferrals, and I found no new evidence that changes their severity or makes them scheduled now.

## Validation

Targeted regression evidence: `npm test --workspace=apps/web -- --run src/__tests__/cycle-47-source-contracts.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/semantic-route-production.test.ts src/__tests__/gallery-config-semantic-production.test.ts src/__tests__/photo-og-metadata.test.ts src/__tests__/feed-sized-derivative.test.ts` passed: 6 files, 45 tests.

Final sweep: read-only review only; no files modified, committed, pushed, deployed, or reverted.
