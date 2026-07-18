# Cycle 10 — tracer

Reviewed HEAD: `1e3646e3` (2026-07-18)

## Inventory and traced chains

Starting from the full 946-file inventory, I traced these causal chains end to end rather than sampling call sites:

1. admin `image_sizes` validation/normalization → gallery config → upload snapshot/queue → `processImageFormats`;
2. original metadata/WI-15 cap → actual resize width → suffixed derivative files → `sizedImageSrcSet` → `<picture>` consumers;
3. settings commit → detached cache invalidation → queue/backfill detached reads;
4. admin session/PAT request → origin/scope/rate/restore fences → mutation;
5. DB image/public projection → gallery/search/share/map/OG response;
6. DB delete/restore boundaries → pending filesystem/session/background drains;
7. migration journal → reconcile → Drizzle post-condition;
8. commit/sign/push state → plan index/frontier.

## Finding TRC-C10-01 — configured width changes meaning between producer and browser

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed causal-chain break**
- Regions: configuration bounds `apps/web/src/lib/gallery-config-shared.ts:152-154,255-277`; processing `apps/web/src/lib/process-image.ts:1087-1115,1212-1234`; serialization `apps/web/src/lib/image-url.ts:91-95`; public sinks `apps/web/src/components/masonry-card.tsx:91-108`, `apps/web/src/components/photo-viewer.tsx:453-460`, timeline `:255-271`, year `:214-231`, shared group `:217-234`.
- Trace: `image_sizes` begins as desired maximum widths and filename aliases. The processor correctly clamps each render to `processingBaseWidth`; oversized later aliases intentionally reuse the capped render. At the serialization boundary, the configured alias is reinterpreted as the candidate's physical pixel width. No actual-width value crosses that boundary, so the browser receives a false `w` descriptor.
- Concrete failure: with a 1000 px source and a 1536 configured alias, producer semantics are “render at min(1000,1536), store under `_1536`”; consumer semantics become “`_1536` is 1536 physical pixels.” Both modules are locally consistent but the end-to-end invariant fails. The Cycle 9 full-ladder change increases the affected sinks from the existing viewer to all grids.
- Fix: define separate names for configured alias width and delivered pixel width, propagate the latter as data, and have one helper emit/dedupe standards-correct candidates. Test the whole trace with encoded file metadata.

## Finding TRC-C10-02 — release evidence stops before the plan frontier

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed for signed push; deployment requires evidence reconciliation**
- Regions: `.context/plans/cycle-9-2026-07-18-plan.md:5,83-85,119-130`; `.context/plans/README.md:34-40`.
- Trace: implementation commits `7f6fb05e` and `819f5432` → signed terminal review commit `1e3646e3` → local master and origin/master both `1e3646e3`; however the plan branch still ends at unchecked “commit/push/deploy” and the index remains Cycle 9 active.
- Concrete failure: a later cycle cannot distinguish “publication never happened” from “ledger was not closed” and repeats or misreports work.
- Fix: close the objectively proven signed-push steps, attach actual deploy evidence or explicitly retain deploy as unverified, archive Cycle 9, and advance the index.

## Final hypothesis sweep

I tested the alternative explanations that oversized derivatives are upscaled, omitted, or descriptors are corrected elsewhere; current source disproves all three. I also retraced detached cache ownership, settings invalidation, privacy selection, action barriers, and pending cleanup. Those chains remain intact at current HEAD, and no closed historical finding was reintroduced.
