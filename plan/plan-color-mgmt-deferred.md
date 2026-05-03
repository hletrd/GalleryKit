# Plan — Color-management deferred items

Companion to the color-management implementation chain. Every finding from
the deep review at `.context/reviews/color-mgmt/_aggregate.md` is either
implemented in PRs 1–8 or recorded here with severity preserved, file+line
citation, concrete reason for deferral, and an exit criterion.

None of the deferred items are security/correctness/data-loss findings.
All are polish or defense-in-depth that does not block color correctness.

## Deferred Items

### CM-LOW-2 — Document topic image ICC strip intent
- **Source:** `.context/reviews/color-mgmt/security-reviewer.md` L-4
- **File:** `apps/web/src/lib/process-topic-image.ts:68-72`
- **Original severity:** Low
- **Reason for deferral:** topic banner thumbnails are 512×512 cover-cropped
  WebP at quality 90; visitor surfaces never present them at a size where
  ICC fidelity matters. The reviewer's suggested `.withIccProfile('srgb')`
  one-liner is a follow-up for the next time process-topic-image is
  touched, not a blocker today.
- **Severity preserved:** Low.
- **Exit criterion:** at next process-topic-image refactor (e.g. P3-aware
  topic banners or admin-tunable topic image sizes).

### CM-LOW-4 — `@media print` block for masonry grid
- **Source:** `.context/reviews/color-mgmt/designer.md` Finding 8
- **File:** `apps/web/src/app/[locale]/globals.css` (absent)
- **Original severity:** Low
- **Reason for deferral:** photo galleries on the web are overwhelmingly
  consumed on screen; a print stylesheet is polish, not blocking color
  correctness. Adding it requires deciding whether to print the title-card
  metadata, the photographer's copyright, etc. — a UX call worth doing
  alongside a paid-print delivery feature.
- **Severity preserved:** Low.
- **Exit criterion:** when the gallery ships a paid-print delivery surface
  or an admin-requested print mode.

### CM-LOW-6 — Skeleton shimmer color theme-aware
- **Source:** `.context/reviews/color-mgmt/designer.md` Finding 10
- **File:** `apps/web/src/app/[locale]/globals.css:124-133`
- **Original severity:** Low
- **Reason for deferral:** the hardcoded `rgba(255,255,255,0.06)` is
  imperceptible against the white light-mode background (correct intent)
  and visible-but-dim against the dark/oled backgrounds (acceptable). The
  shimmer is decoration, not signal — a future visual-quality pass with
  a designer's eye is the right place to revisit.
- **Severity preserved:** Low.
- **Exit criterion:** at next design-system token refresh.

### CM-LOW-7 — `prefers-reduced-transparency` guard
- **Source:** `.context/reviews/color-mgmt/designer.md` Finding 12
- **File:** `apps/web/src/app/[locale]/globals.css` (absent)
- **Original severity:** Low
- **Reason for deferral:** Safari supports the media query but no
  Chromium/Firefox does today (mid-2026); rolling it out without
  cross-browser parity makes the resulting accessibility story fragmented.
  The current `backdrop-filter: blur(12px)` is auto-disabled by Safari's
  UA stylesheet when the system preference is on, so the highest-impact
  surface (toolbar) is already covered.
- **Severity preserved:** Low.
- **Exit criterion:** when Chrome/Firefox ship `prefers-reduced-transparency`
  or when an a11y audit cycle requires it explicitly.

### CM-LOW-8 — Hostile-ICC bounds tests
- **Source:** `.context/reviews/color-mgmt/test-engineer.md` Finding 7
- **File:** `apps/web/src/lib/process-image.ts:333-390` parser
- **Original severity:** Low
- **Reason for deferral:** the parser already has Math.min caps on tag
  count (100), record count (100), per-record string length (1024), plus
  an outer try/catch. The pre-existing `process-image-metadata.test.ts`
  exercises mluc/desc happy paths. Adding hostile-input boundary tests
  for `tagCount=0xFFFFFFFF`, `dataOffset` past EOF, `length=132` boundary
  is purely belt-and-braces — no exploitability and no
  business-functional impact today.
- **Severity preserved:** Low.
- **Exit criterion:** when the ICC parser is next touched (e.g. for
  CMYK input handling or v4 ICC tag parsing).

### CM-LOW-12 — EXIF Date branch dead-but-buggy code
- **Source:** `.context/reviews/color-mgmt/security-reviewer.md` L-1
- **File:** `apps/web/src/lib/process-image.ts:121-163` (`parseExifDateTime`)
- **Original severity:** Low
- **Reason for deferral:** `exif-reader@2.0.3` returns strings for
  DateTimeOriginal in practice, so the `Date`/numeric branches at lines
  142-158 are dead. The reviewer flagged latent risk if exif-reader
  changes its return type — but pinning the dep at `^2.0.3` (current
  package.json) keeps the type stable until a deliberate upgrade. The
  branch is structurally correct for `Date.toISOString()` today; only
  the TZ-interpretation comment is misleading.
- **Severity preserved:** Low.
- **Exit criterion:** when bumping `exif-reader` to a major version that
  could change return shape.

### CM-MED-1 — 10-bit AVIF on prebuilt Sharp
- **Source:** `.context/reviews/color-mgmt/perf-reviewer.md` P1
- **File:** `apps/web/src/lib/process-image.ts:600` (post-PR6)
- **Original severity:** Medium
- **Reason for deferral:** the PR6 implementation gates `bitdepth: 10` on
  `!sharp.versions.heif`, which is `false` on the prebuilt binaries the
  repo currently uses. So the wide-gamut 10-bit codepath is wired but
  inactive. Activating it requires switching to a custom-built libvips
  with high-bitdepth HEIF support, which is a deployment-side change
  rather than a code change. The fallback to 8-bit is correct.
- **Severity preserved:** Medium (gated; on-disk bytes still improved
  by the other PR6 changes).
- **Exit criterion:** when the deployment switches to a custom Sharp
  build with `versions.heif` unset (e.g. via `sharp` from-source build
  in the production Docker image).

### CM-LOW-2 ditto — Picture/source ordering for fallback
- **Source:** `.context/reviews/color-mgmt/code-reviewer.md` MEDIUM-1
- **File:** `apps/web/src/components/photo-viewer.tsx:374-397`
- **Original severity:** Medium-flagged but downgraded to Low post-PR4
- **Reason for deferral:** the original Medium severity was contingent
  on the AVIF-color-correctness bug (CM-CRIT-1). With PR4 + PR6 landed,
  AVIF output is colorimetrically correct, so AVIF-first source ordering
  is the right call. No fallback needed.
- **Severity preserved:** Low (post-PR4 context).
- **Exit criterion:** if AVIF output ever regresses (the lock-in tests
  in PR1+PR4 should catch this) — not actionable today.
