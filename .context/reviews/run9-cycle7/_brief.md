# Run-9 Cycle-7 reviewer brief (HEAD feb63faa)

Repo: GalleryKit (Next.js 16 photo gallery). Read project CLAUDE.md first.

## Prior context (do NOT re-file as new without NEW decisive evidence)
Already adjudicated — do NOT re-file: MED-R7C2-01 (REFUTED), REJ-R7C3-01 (DISPROVED), NCLX matrix/transfer pin class (COMPLETE), ARCH-R7C2-01+TE-R7C2-02 (CLOSED-OBSOLETE), all run-9 FIXED items (CR-R9C2-01, TE-R9C3-01, DES-R9C3-01, DES-R9C4-01, CR-R9C5-01 restore allowlist, CR-R9C6-01 upload 6-settings). `affectedRows` optional-chaining REFUTED repeatedly. 3 binary-parser FPs (color-detection colr, gps-exif ILOC, gain-map/icc-extractor) re-refuted each cycle — each flagged read HAS a preceding bounds check.
DEFERRED-with-exit-criteria (do not re-file unless criterion met): DES-R9C3-02, DEF-C11-01, POL-R9C5-01, DEF-R9C6-01, DEF-R9C6-02, R7C1-CR-01..04, OBS-R7C2-02..06, TE-R7C2-03/04/05.

## HIGH-BAR directive
COMMIT only for a genuine correctness/security/data-loss/perf DEFECT, real product-runtime bug, broken gate, or false doc-claim. Marginal POLISH → DEFERRAL with exit criterion. A truthful NEW_FINDINGS:0 / COMMITS:0 is the success condition — do NOT manufacture work. Label every finding DEFECT vs POLISH and confidence High/Medium/Low, with exact file:line + concrete failure scenario + fix.

## SPECIAL FOCUS (lead has a preliminary finding — confirm/refute independently)
Cycle-6 fixed CR-R9C6-01 by extending `ImageProcessingJob` (apps/web/src/lib/image-queue.ts) with 6 settings (forceSrgbDerivatives, wideGamutJpegChroma, avifEffort, sdrJpegChroma, wideGamutMaxSourcePixels, autoAltTextEnabled) and wiring them from uploadConfig in the BROWSER upload (apps/web/src/app/actions/images.ts:440). VERIFY EVERY OTHER enqueue/processing entry point forwards the same 6 or correctly falls back:
- LR PAT upload route: apps/web/src/app/api/admin/lr/upload/route.ts:420
- admin backfill runner: apps/web/src/lib/admin-backfill-runner.ts:499
- sidecar backfill: apps/web/scripts/backfill-color-pipeline.ts:203
- bootstrap: apps/web/src/lib/image-queue.ts:674
- retry paths: image-queue.ts:290/:510 (re-enqueue same job), images.ts:1139 (retryFailedImage)
The handler gate is `if (!quality && !imageSizes)` at image-queue.ts:~337. If a path supplies quality but NOT the 6, the 6 are silently ignored. Lead's preliminary read: LR route at :420 supplies quality+imageSizes but NOT the 6 → same defect as CR-R9C6-01 on the Lightroom publish path. Confirm or refute with file:line.

## Output
Write to .context/reviews/run9-cycle7/<agent-name>.md. Cite file:line, DEFECT vs POLISH, confidence, failure scenario, fix.
