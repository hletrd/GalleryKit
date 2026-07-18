# Aggregate Review — Cycle 10/100

Date: 2026-07-18
Reviewed HEAD: `1e3646e32c116e9016982225fe54f1e55ac3d29e`

## Review coverage

The collaboration runtime exposed two child slots after the root orchestrator
and this cycle agent. Both slots were launched together and covered every
required perspective in specialist bundles:

- `review_core`: code-reviewer, perf-reviewer, security-reviewer, architect,
  debugger, and tracer.
- `review_product`: critic, verifier, test-engineer, document-specialist,
  designer, and the discovered project-specific photographer-workflow,
  product-marketer, and UI/UX-designer reviewers.

The provenance files are the fourteen reports under
`.context/reviews/run-current-cycle10/`. Each reviewer read the repository
rules, built a file inventory, examined the current implementation and newest
commit range, traced cross-file behavior, and completed a final missed-issues
sweep. The designer used the required agent-browser skill family against the
deployed public application because no local server or authenticated admin
credentials were available. No child failed.

## Executive result

Three unique current findings survived aggregation:

1. **COR-C10-01 (Medium/High, confirmed):** responsive `srcset` width
   descriptors use configured filename aliases even when the encoder clamps
   the resource to fewer actual pixels. Source-limited and WI-15-downscaled
   images are therefore advertised with false intrinsic widths, redundant
   candidates, and misleading high-DPR test evidence.
2. **DOC-C10-02 (Low/High, confirmed):** the active Cycle 9 plan and plan index
   still report signed publication/deployment as pending even though the
   commits are GPG-valid, local and remote `master` match, and the deployed
   public DOM exposes the shipped complete ladder behavior.
3. **MAINT-C10-03 (Low/High, confirmed lead finding):** the deprecated
   `getGalleryConfigUncached` alias is documented as a one-cycle bridge but is
   still exported and test-pinned hundreds of commits later despite having no
   production caller.

No new security, authorization, privacy, schema, migration, restore,
background-ownership, accessibility, i18n, or dependency finding survived
validation. Existing carry-forward findings remain governed by
`.context/plans/deferred-carry-forward.md`; none has a newly fired exit
criterion in this cycle.

## Deduplicated findings

### COR-C10-01 — Responsive candidates advertise aliases rather than delivered widths

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed correctness, performance, test, and photographer-fidelity defect**
- Cross-agent agreement: code-reviewer, perf-reviewer, architect, debugger,
  tracer, critic, verifier, test-engineer, document-specialist, designer, and
  all three project-specific reviewers.
- Regions: producer contract `apps/web/src/lib/process-image.ts:1032-1043,
  1087-1115,1212-1234`; source builder `apps/web/src/lib/image-url.ts:72-95`;
  consumers `apps/web/src/components/masonry-card.tsx:87-109`,
  `apps/web/src/components/photo-viewer.tsx:453-460`,
  `apps/web/src/app/[locale]/(public)/timeline/page.tsx:250-272`,
  `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:213-233`, and
  `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:217-236`; incomplete
  proof `apps/web/e2e/responsive-masonry.spec.ts:102-138` and
  `apps/web/src/__tests__/image-url.test.ts:110-136`.
- Evidence: the encoder computes `resizeWidth = min(processingBaseWidth,
  configuredSize)`. For later configured aliases it hard-links or copies the
  last capped render. `sizedImageSrcSet` has only filenames and configured
  aliases, so it labels every candidate `${configuredSize}w` even when the
  resource is narrower. Direct fixture inspection found the 1200 px E2E
  square's `_1536`, `_2048`, `_4096`, `_5120`, and `_7680` AVIF/WebP/JPEG
  files are all 1200 px wide. The E2E test calls `_4096` adequate without
  decoding it.
- Concrete failure: a 1200 px photo shown in a 1504 CSS-px one-item grid at
  DPR 2 is reported to Chromium as having a 4096 px candidate. Chromium picks
  it as adequate but decodes only 1200 pixels for a roughly 3008-device-pixel
  target, producing visible softness while the regression remains green.
  WI-15 can create the same mismatch when stored original width is larger than
  the processing width.
- Required fix: make the effective processed width a persisted pipeline/data
  contract, build candidates as `(configured alias URL, actual delivered
  width)`, deduplicate aliases resolving to the same actual width, and use the
  truthful list across all five callers. Add producer/consumer and browser
  coverage that inspects decoded pixels rather than suffixes alone.

### DOC-C10-02 — Cycle 9 terminal ledger is stale

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed documentation/workflow defect**
- Cross-agent agreement: code-reviewer, architect, tracer, critic, verifier,
  and document-specialist.
- Regions: `.context/plans/cycle-9-2026-07-18-plan.md:5,83-85,119-130` and
  `.context/plans/README.md:34-40`.
- Evidence: the plan says “signed release pending” and leaves publication and
  deploy unchecked. `git verify-commit` reports good signatures for
  `7f6fb05e`, `819f5432`, and `1e3646e3`; local and remote `master` both equal
  `1e3646e3`. The live public HTML contains the shipped six-width ladder,
  proving behavior deployment without exposing an exact production SHA.
- Concrete failure: recovery automation treats the plan index as the current
  work frontier and repeats completed publication/deployment or reports the
  release as unpublished.
- Required fix: reconcile the objectively proven signed push and observable
  deployment evidence without inventing a deployed SHA, archive Cycle 9, and
  advance the active index to Cycle 10.

### MAINT-C10-03 — Expired detached-config compatibility alias remains test-pinned

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed maintainability defect; lead aggregation finding**
- Regions: `apps/web/src/lib/gallery-config.ts:204-208,284-285` and
  `apps/web/src/__tests__/gallery-config-uncached-microcache.test.ts:26-32,
  191-197`.
- Evidence: both the API comment and deprecation annotation say
  `getGalleryConfigUncached` is retained for one cycle. Repository search
  finds no production or script caller; only the compatibility assertion
  imports it. The bridge originated in `12037508`, hundreds of commits before
  current HEAD.
- Concrete failure: a future internal caller can choose the misleading old
  name and obscure the accessor's deliberate two-second cache contract, while
  the test converts temporary compatibility debt into a permanent API
  requirement.
- Required fix: remove the unused alias, remove the assertion/import that pins
  it, and update the nearby documentation to describe the completed rename.

## Cross-agent adjudication

- COR-C10-01 is one root cause despite being reported as code, architecture,
  performance, debugger, tracing, test, documentation, UI/UX, and photographer
  findings. The highest shared severity/confidence is retained.
- The finding does not mean the encoder should upscale. Its no-enlargement
  behavior is correct; the defect is losing the actual processed width before
  constructing HTML descriptors. Passing only the original DB width would not
  cover WI-15, so the fix must preserve effective processing width.
- DOC-C10-02 is one workflow finding. Exact deployed SHA remains unobservable,
  so the ledger must record behavioral evidence rather than inventing one.
- MAINT-C10-03 was found during the lead's final repository sweep. It is not a
  security or correctness blocker, but its promised removal condition has
  unambiguously elapsed and the removal is self-contained.

## Validation evidence from Prompt 1

- Focused responsive/config tests passed: 4 files, 52 tests.
- Full app/script typecheck passed.
- The product bundle independently passed 3 focused files, 28 tests.
- All three newest commits have good GPG signatures and
  `master == origin/master` at the reviewed HEAD.
- Live browser review covered desktop/mobile, EN/KO, light/dark, search
  keyboard/focus behavior, offline fallback, network/console state, and 320 px
  reflow. Direct derivative metadata inspection established the decoded-width
  mismatch.
- These are review baselines, not substitutes for Prompt 3's complete gates.

## Deferred/revalidated items

No Cycle 10 finding is deferred. COR-C10-01 is a correctness defect and is
non-deferrable under the loop policy. DOC-C10-02 and MAINT-C10-03 are scheduled
because their fixes are bounded and immediately actionable. Existing deferred
items retain their original severity, confidence, reasons, policy constraints,
and exit criteria in the consolidated carry-forward register.

## Agent failures

None. Both available child agents returned and wrote every required and
project-specific provenance report.
