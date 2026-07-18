# Cycle 10 — architect

Reviewed HEAD: `1e3646e3` (2026-07-18)

## Inventory and architecture pass

The complete 946-file inventory was grouped into routes/actions, 116 library modules, 61 components, 370 unit tests, 16 E2E specs, 31 scripts, 34 migration/journal files, runtime/deploy configuration, and documentation/plan ledgers. I checked the major architectural registries and boundaries: schema↔reconcile↔journal, admin/public projection, setting validation↔resolution↔encoder, upload/restore/background-write fencing, advisory-lock ownership, server/client import direction, public rate limiting, data-store persistence, service-worker cache ownership, and the newest configuration/derivative changes.

## Finding ARCH-C10-01 — responsive-delivery abstraction omits a required dimension

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed architecture/correctness defect**
- Regions: producer contract `apps/web/src/lib/process-image.ts:1032-1043,1087-1115,1212-1234`; URL abstraction `apps/web/src/lib/image-url.ts:72-95`; public consumers `apps/web/src/components/masonry-card.tsx:87-109`, `apps/web/src/components/photo-viewer.tsx:453-460`, timeline/year/shared grid regions noted in CORE-C10-01.
- Evidence: `processImageFormats` owns two independent width notions: configured filename width and actual processed width (capped by source width and sometimes WI-15). Its persisted/returned public contract exposes only filenames and original dimensions. `sizedImageSrcSet` therefore reconstructs candidate metadata solely from configured suffixes and cannot satisfy the HTML rule that a `w` descriptor equal the resource's actual width.
- Concrete failure: once complete ladders were centralized in Cycle 9, every public grid adopted an abstraction that is correct only when the processed width is at least the largest configured size. Small originals and WI-15-downscaled originals violate that hidden precondition. Component-local fixes based only on original `image.width` would leave the WI-15 case unsound.
- Fix: promote effective delivered dimensions to a first-class pipeline artifact. Persist a derivative maximum width (or candidate manifest), have one shared helper derive/dedupe candidate `(configuredAlias, actualWidth)` records, and make all viewer/grid/metadata consumers use it. Lock producer↔consumer parity with an encode-and-inspect test, not source-text call-count tests alone.

## Finding ARCH-C10-02 — active-plan frontier lags committed release state

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed workflow architecture defect**
- Regions: `.context/plans/cycle-9-2026-07-18-plan.md:5,83-85,119-130`; `.context/plans/README.md:34-40`.
- Evidence: Cycle 9 is still indexed as active and says signed publication is pending, while local and remote master are identical at signed `1e3646e3`; both implementation commits also verify. Deployment must be reconciled from actual evidence, but signed push is objectively complete.
- Concrete failure: restart/recovery automation consumes the plan index as the work frontier and repeats terminal work or misreports repository state.
- Fix: reconcile Cycle 9's terminal evidence, archive it, and advance the active frontier. Keep deploy status explicit if production evidence is unavailable.

## Final drift sweep

No new mismatch was found in migration count/journal ordering rules, privacy projection guard, action/API guard coverage, setting invalidation ownership, bind-mounted persistence, or server/client module boundaries. Historical broad topology and scaling risks remain in the carry-forward register and were not reclassified without a fired exit criterion.
