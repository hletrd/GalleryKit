# Verifier Review — Cycle 1, Prompt 1

**Scope:** repo-wide correctness review from the verifier specialty

**Method:** built an inventory first, inspected the behavior-bearing app/actions/lib/routes/components/tests/docs, traced cross-file interactions, and finished with a final missed-issues sweep focused on config validation, image delivery, public routes, and admin-facing write paths.

**Verification:** read-only code and docs inspection across the repository; no code changes were made in this review pass.

## Confirmed Issues

### [HIGH] `image_sizes` accepts non-integer values, which produces invalid responsive image descriptors and inconsistent derivative naming
- **File / region:** `apps/web/src/lib/gallery-config-shared.ts:85-104`, with downstream consumers in `apps/web/src/lib/process-image.ts:390-395`, `apps/web/src/lib/image-url.ts:43-47`, `apps/web/src/components/photo-viewer.tsx:219-229`, and the admin UI at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:141-149`
- **Status:** Confirmed
- **Confidence:** High
- **Why this is a problem:** `normalizeConfiguredImageSizes()` only checks that each parsed value is finite, positive, and under 10,000. It does **not** require integers. That means values like `640.5`, `1e-1`, or `1536.25` are accepted and stored as the canonical `image_sizes` setting. The rest of the pipeline assumes these are discrete pixel widths: the processor names derivatives as `${name}_${size}${ext}`, and the UI builds `srcset` width descriptors from the same numbers. Width descriptors in `srcset` are expected to be integer widths, so a decimal size produces an invalid or at-best nonconforming responsive image list.
- **Concrete failure scenario:** An admin saves `image_sizes=640.5,1536` through the settings page. The save succeeds because the server validator accepts it, even though the client-side field pattern suggests whole numbers only. New uploads then generate derivative filenames and `srcset` entries using the fractional width. Browsers can reject the `srcset` candidate list or ignore the fractional width descriptor, which means the gallery falls back to the single `src` candidate instead of serving the intended responsive image set. The same bad value also propagates into OG and photo-viewer URL selection, so the inconsistency is visible across public pages.
- **Suggested fix:** Enforce `Number.isInteger(value)` in `normalizeConfiguredImageSizes()` and keep the server validator aligned with the admin field’s integer-only pattern. Add a regression test that rejects decimal and scientific-notation widths that are not whole numbers.
- **Evidence note:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:148` already advertises integer-only input via `pattern="[0-9]+(\s*,\s*[0-9]+)*"`, but the server-side validator does not enforce the same contract.

## Likely Issues
- No additional likely issues were confirmed after the final sweep.

## Risks Requiring Manual Validation
- The repository has several intentional ceilings and fallback behaviors, but after a full repo pass I did not find another evidence-backed correctness bug beyond the image-size validation mismatch above.

## Missed-Issues Sweep
I rechecked the remaining high-risk surfaces for validation mismatches, image delivery paths, admin write actions, origin checks, and public route rendering. I did not find another confirmed correctness issue that met the evidence bar for this review.

## Recommendation
**REQUEST CHANGES**
