# Project-specific reviewers — cycle 4 provenance

Review target: `01d39653`, 2026-07-18 KST. Review only.

## Reviewer discovery and inventory

The repository itself requires a **photographer/color-and-HDR fidelity reviewer**: `AGENTS.md` says uploads are already edited and the product must deliver photographer intent without edit/culling/scoring features; `CLAUDE.md` documents the color/HDR pipeline and points to the photographer audit lineage. I therefore reviewed that project-specific perspective independently. No other project-specific reviewer was discovered that was not already represented by the required core lanes or by this photographer/color role.

The review covered all public photo surfaces and delivery paths, `process-image.ts`, color detection/primaries/decisions, ICC extraction/chromaticity, gain-map detection, display capability, settings hash and cache validators, grid/viewer/lightbox/picture components, metadata presentation, derivative URL/srcset policy, gallery configuration, schema fields, backfill/queue flows, privacy projection guards, photographer audit history, and every Cycle 3-to-HEAD change.

## New photographer/color/HDR findings

No new project-specific defect was confirmed. The reviewed changes do not edit pixels, metadata classification, ICC/NCLX/gain-map interpretation, derivative encoding, settings hashes, or color-capability selection. Reducing explicit masonry priority to the first invariant card changes request scheduling only; it does not select, score, crop, recolor, or otherwise alter the delivered photograph. The tag/nav disclosure changes preserve public photo content and labels.

## Revalidated project-specific boundary

### PROJ-C4-R1 — Reserved HDR filename support remains intentionally unwired

- Severity: **Informational**
- Confidence: **High**
- Status: **Confirmed documented boundary; not a defect and not new**
- Regions: `apps/web/src/lib/hdr-filenames.ts`; `CLAUDE.md` key-file table and WI-09 readiness guidance; `.context/plans/wi09-readiness.md`

The helper reserves `_hdr.avif` naming but public components do not claim a dedicated HDR derivative exists. This avoids falsely advertising HDR delivery before WI-09 ships.

Concrete failure if the boundary were violated: UI or markup could advertise a nonexistent HDR asset, producing broken requests or misrepresenting photographer intent.

Suggested fix: none now. Keep the helper quarantined until the explicit WI-09 implementation includes encoder, storage, projection, cache, fallback, and browser validation work.

## Final project-specific sweep

The closing sweep checked that no new edit/culling/scoring behavior appeared, public projections still exclude administrative/private color fields as required, wide-gamut presentation remains capability-gated, fallback paths retain the same photograph, and recent priority changes do not change derivative identity. No further photographer/color/HDR issue survived validation.
