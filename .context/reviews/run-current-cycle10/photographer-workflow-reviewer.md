# Cycle 10 Photographer Workflow Reviewer

Date: 2026-07-18 KST  
Reviewed HEAD: `1e3646e3`  
Lane: repository-specific photographer-workflow reviewer

## Definition and scope

This lane is repository-specific: `AGENTS.md` and `CLAUDE.md` explicitly require photographer-perspective audits and define the product boundary as faithful delivery of already-edited photographs with no editing, culling, or scoring features. Reviewed ingest-to-derivative fidelity, responsive delivery, color/HDR honesty, public metadata presentation, gallery/photo interaction, and the last-three-commit high-DPR claim.

## PHOTO-C10-01 — Source-limited files are advertised as larger than their decoded pixel dimensions

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed**
- Regions: encoder `apps/web/src/lib/process-image.ts:1214-1234`; source builder `apps/web/src/lib/image-url.ts:91-95`; public grid consumers including `apps/web/src/components/masonry-card.tsx:88-110`; photo viewer `apps/web/src/components/photo-viewer.tsx:453-460`; seed/browser proof `apps/web/scripts/seed-e2e.ts:79-87` and `apps/web/e2e/responsive-masonry.spec.ts:102-138`.

The encoder correctly refuses to invent pixels: for a 1200 px source, every configured output above 1200 contains 1200 actual pixels. The delivery markup then incorrectly labels those files as 1536w through 7680w. This violates the photographer-fidelity premise at the browser-selection boundary even though the encoded pixels themselves are not altered incorrectly.

Concrete failure: a finished 1200 px export is displayed as a 1504 CSS-px hero on a DPR-2 screen. Chromium selects the file labelled 4096w, but it contains 1200 pixels, so fine detail is stretched over roughly 3008 device pixels. A photographer sees avoidable softness and the test suite reports the suffix choice as success.

Fix: expose unique actual derivative widths, cap descriptors at decoded dimensions, and test decoded resources. For sources intentionally downscaled by the wide-gamut memory cap, persist the resulting derivative maximum so markup remains accurate. If sparse layouts can exceed useful source resolution, consider a product-level maximum display width in addition to the required descriptor fix.

## Photographer sweep with no further finding

No edit/culling/scoring surface was introduced. Current HDR honesty, P3 metadata gating, AVIF/WebP/JPEG format order, color-details surfaces, download availability, title/tag alt-text flow, and photo navigation did not show a new last-three-commit regression. Historical physical display/color accuracy and gain-map limitations remain documented and were not duplicated.
