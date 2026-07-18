# Cycle 10 — code-reviewer

Reviewed HEAD: `1e3646e3` (2026-07-18)

## Inventory and method

I inventoried 946 review-relevant repository files before reviewing. The main implementation surface contains 631 TS/TSX/JS/CSS files: 116 top-level library modules, 81 App Router/action files, 61 components, 370 unit-test files, 16 Playwright specs, 31 scripts, and 34 migration/journal files, plus Docker/nginx/build configuration and the committed plan/review corpus. I read `AGENTS.md` and all 770 lines of `CLAUDE.md`, inspected the three newest commits and their tests, and traced the principal cross-file flows (auth/session, actions and restore fence, upload/queue/encoder, public projections, responsive delivery, maintenance, migration/reconcile, and deploy). Repository-wide sweeps covered suppressions/TODOs, background promises/timers, mutable module state, raw SQL/process/file boundaries, route guards, and configuration-derived lists. Historical findings were used only as leads and were rechecked against current HEAD.

## Finding CORE-C10-01 — `srcset` width descriptors can overstate the bytes' real width

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed**
- Regions: `apps/web/src/lib/process-image.ts:1212-1234`; `apps/web/src/lib/image-url.ts:91-95`; consumers at `apps/web/src/components/masonry-card.tsx:87-109`, `apps/web/src/components/photo-viewer.tsx:453-460`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:250-272`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:213-233`, and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:217-236`; incomplete tests at `apps/web/src/__tests__/image-url.test.ts:110-136`.
- Evidence: the encoder computes `resizeWidth = min(processingBaseWidth, configuredSize)`. Once a configured size exceeds the processed source width, later suffixed files are hard-link/copy duplicates of the last render. `sizedImageSrcSet`, however, labels every URL with the configured suffix (`${size}w`) and has no image/processed width input. HTML `w` descriptors describe the candidate resource's intrinsic pixel width, not its filename convention.
- Concrete failure: upload a 1000 px-wide image under the default `640,1536,2048,4096,5120,7680` ladder. `_1536` through `_7680` are all 1000 px-wide bytes, but the browser is told they are 1536–7680 px wide. Candidate density and intrinsic-size calculations are based on false metadata. The newly completed grid ladders spread this contract to every public grid; the photo viewer already shared it. A wide-gamut source reduced by the 50 MP processing cap can exhibit the same mismatch even when the stored original width exceeds the configured suffix.
- Fix: make the derivative's effective pixel width an explicit encoder/data contract. Build each `srcset` from `(url, actualWidth)` pairs, deduplicate candidates with the same actual width, and label the final capped candidate with the delivered width. Because WI-15 can reduce the processing width below the stored original width, merely passing `images.width` is insufficient for all images; return/persist the processed derivative width (or an equivalent manifest) and consume it in all five callers. Add a real small-source encode test that reads output metadata and asserts every emitted `w` descriptor equals the corresponding file width.

## Finding CORE-C10-02 — Cycle 9 terminal state is stale at current HEAD

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed documentation/workflow defect**
- Regions: `.context/plans/cycle-9-2026-07-18-plan.md:5,83-85,119-130`; `.context/plans/README.md:34-40`.
- Evidence: the plan still says “signed release pending” and leaves commit/push/deploy unchecked. Current `master` and `origin/master` both equal `1e3646e3`; `git verify-commit` succeeds for the two implementation commits `7f6fb05e` and `819f5432` and the terminal review commit `1e3646e3`. The index still lists Cycle 9 as active.
- Concrete failure: a recovery agent treats the canonical plan frontier as authoritative and repeats already-finished signed publication, or reports that source is unpushed despite exact local/remote equality.
- Fix: reconcile the signed-push evidence, record deployment only from actual prior-cycle evidence (do not infer it from git), archive Cycle 9, and advance the index to Cycle 10.

## Final missed-issues sweep

I rechecked the last-three-commit diff, all `sizedImageSrcSet` call sites, the encoder loop and fallback behavior, detached-config generation/owner race test, guard-lint scopes, privacy select guard, schema/journal count, and open carry-forward exit criteria. I found no additional non-historical correctness defect with adequate evidence. The generation/owner fix at `gallery-config.ts:234-282` correctly prevents a pre-invalidation promise from publishing or disowning a newer read.
