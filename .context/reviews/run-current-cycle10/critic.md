# Cycle 10 Critic Review

Date: 2026-07-18 KST  
Reviewed HEAD: `1e3646e32c116e9016982225fe54f1e55ac3d29e`  
Lane: critic

## Coverage and method

Read `AGENTS.md` and all 770 lines of `CLAUDE.md` first. Inventoried 1,285 tracked non-review files and the committed review/plan history, then followed the repository's authoritative-history routing through the newest aggregate, Cycle 9 plan, consolidated deferred register, current source, tests, E2E fixtures, deployment config, and the complete last-three-commit range. Cross-file tracing covered configuration reads, image encoding, derivative naming, responsive source generation, all five `sizedImageSrcSet` consumers, seed data, browser selection, and release-ledger state. Historical findings were used only as leads and were rechecked at current HEAD.

Project-specific reviewer definitions found in the current review corpus: `product-marketer-reviewer` and `ui-ux-designer-reviewer`. They have separate reports in this directory.

## CRT-C10-01 — Width descriptors claim configured sizes even when the encoder deliberately wrote fewer pixels

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed** (source + fixture-byte validation + deployed DOM)
- Regions: `apps/web/src/lib/process-image.ts:1214-1234`; `apps/web/src/lib/image-url.ts:72-95`; `apps/web/src/components/masonry-card.tsx:88-110`; timeline `page.tsx:254-273`; year `page.tsx:214-233`; shared group `page.tsx:217-236`; `apps/web/src/components/photo-viewer.tsx:453-460`; `apps/web/scripts/seed-e2e.ts:79-87`; `apps/web/e2e/responsive-masonry.spec.ts:102-138`.

The encoder uses `resizeWidth = min(processingBaseWidth, configuredSize)` and duplicates the last rendered bytes for every larger configured suffix, correctly avoiding enlargement. `sizedImageSrcSet`, however, labels every filename with the configured suffix. The seeded square is 1200 px wide, yet `_1536`, `_2048`, `_4096`, `_5120`, and `_7680` are all 1200×1200 files. Direct Sharp inspection confirmed that for AVIF, WebP, and JPEG. The new browser test asserts that Chromium chooses `_4096` for a 1504 CSS-px/DPR-2 slot, but never checks decoded pixel dimensions; it therefore treats a 1200 px file advertised as `4096w` as a successful high-DPR result. The deployed site already emits all six configured descriptors.

Concrete failure: a 1200 px upload is the only item in a 1504 px-wide grid on a DPR-2 display. Chromium trusts `_4096 ... 4096w`, selects it as adequate, then decodes only 1200 physical pixels and stretches them across a 3008-device-pixel target. The Cycle 9 change appears to cure upscaling while producing visibly soft output and an invalid `srcset` width contract. Smaller originals and wide-gamut sources downscaled by the processing cap have the same class of mismatch.

Fix: make source-set construction intrinsic-width-aware. Emit only unique actual widths, label each candidate by its real encoded width, and use the first configured suffix at or above the source width as the final candidate (for 1200 px under defaults: `_640 640w, _1536 1200w`; omit later byte-identical aliases). Account for the wide-gamut processing cap, ideally by persisting or returning actual derivative dimensions rather than inferring only from original DB width. Extend unit/E2E coverage to decode the selected asset (for example `createImageBitmap(fetch(currentSrc).blob()).width`) and assert its real pixel width, not merely its suffix.

## CRT-C10-02 — The active Cycle 9 ledger still says signed push/deploy are pending

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed**
- Regions: `.context/plans/cycle-9-2026-07-18-plan.md:5,83-85,119-130`; `.context/plans/README.md:34-40`.

The active plan says “signed release pending” and leaves signed commits/push/deploy unchecked. At current HEAD all three newest commits have good GPG signatures, `master == origin/master`, and the deployed site already emits the newly introduced complete ladders, proving the source change has reached production even though an exact server SHA is not exposed.

Concrete failure: a recovery agent follows the canonical active-plan pointer and repeats a deployment or reports the release unpublished. Fix by reconciling the terminal checklist/evidence, archiving Cycle 9, and advancing the active index without claiming an unobservable deployed SHA.

## Final missed-issues sweep

Rechecked the generation/ownership fix for stale-owner publication and disowning; its owner token and generation guard cover the Cycle 9 race, including the tested A/invalidate/B/A-resolves-first order. Rechecked source fallback, CDN URL formation, custom size normalization, one/two-width lists, loading priority, archive/shared parity, and closed responsive geometry issues. No additional current defect survived validation.
