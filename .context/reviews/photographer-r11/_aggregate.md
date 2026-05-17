# Photographer Review R11 — Aggregate Findings

**Date:** 2026-05-17
**Run:** review-plan-fix cycle 2/100
**Scope:** Fresh comprehensive review from professional photographer perspective after cycle-1 R10 partial implementation (R10-H1, R10-H3, R10-H6, R10-M3, R10-M10, R10-M13, R10-L9, R10-L17 landed).
**Premise:** Photos arrive AFTER editing. Product is a delivery surface, not an editing tool.

## AGENT FAILURES — fan-out skipped (environment constraint)

No reviewer-style subagents are registered in this environment. Both
`/Users/hletrd/.claude/agents/` and `./.claude/agents/` do not exist.
The available skill set (kf-*, codex:*, superpowers:*, etc.) does not
include `code-reviewer`, `perf-reviewer`, `security-reviewer`, `critic`,
`verifier`, `test-engineer`, `tracer`, `architect`, `debugger`,
`document-specialist`, or `designer`. Per cycle instructions: "skip any
that are not registered in this environment, but never silently drop one
that IS available." All listed agents fall into the "not registered"
bucket and are skipped.

This R11 pass is therefore conducted as a single comprehensive review by
the cycle agent, simulating the photographer + end-user-workflow lens
across color-pipeline, encoder/delivery, UI/UX, and browser/display
surfaces. The R10 aggregate remains authoritative for findings already
documented; R11 lists only NEW findings or NEW context.

## Carry-over R10 findings still un-implemented

The following R10 items remain to be addressed (per
`.context/plans/photographer-r10/README.md`). They are NOT re-opened here
— they retain their R10-IDs and stay scheduled in the R10 plan:

- **R10-C1** — Synthetic P3 round-trip test (CRITICAL, blocker for
  "verified wide-gamut" claim).
- **R10-H2** — Failed-image admin visibility (HIGH, schema migration).
- **R10-H4** — Firefox UI dismissibility (HIGH).
- **R10-H5** — Masonry gamut/HDR chip (HIGH, data layer already exposes
  `color_primaries`, just needs UI).
- **R10-M2** — Histogram P3 luminance coefficients (MED).
- **R10-M4** — `deliveredBitDepthP3` label conditional on
  `forceSrgbDerivatives` + 10-bit probe (MED).
- **R10-M5** — Percentile-based key-type classification (MED).
- **R10-M6 / R10-M7** — AVIF NCLX / WebP ICC post-encode verification (MED).
- **R10-M8** — Wide-gamut hint delivery-gamut naming (MED).
- **R10-M9** — NCLX 14/15 → `gamma24` label (MED).
- **R10-M11** — Blur+fade crossfade race (MED).
- **R10-M12** — Bottom-sheet ordering consistency (MED).
- **R10-M14** — Conditional backfill warning (MED).
- **R10-M15** — Histogram key-type tooltip wording (MED).
- **R10-L1 / R10-L3** — `image-rendering: high-quality` + `decoding="async"` polish.
- **R10-L4** — RAW upload rejection messaging.
- **R10-L7 / R10-L8** — Quality tooltips, 5K/8K size variants.
- **R10-L10** — `force_srgb_derivatives` label clarification.
- **R10-L11** — Partial-encode cleanup.
- **R10-L12** — `IMAGE_PIPELINE_VERSION` in `SW_VERSION`.
- **R10-L13** — AVIF preload for prev/next.
- **R10-L15** — Full color-details row tappable.
- **R10-L16** — `pipelineVersion` leaks in copied JSON.
- **R10-L18** — Dynamic color-details accordion label.
- **R10-L19** — Color chip in bottom-sheet peek.
- **R10-L20** — Bit depth + format chips in lightbox color pip.
- **R10-L21** — Wide-gamut hint dark-mode contrast.
- **R10-L22** — Download label "8-bit Display P3 JPEG".
- **R10-L23** — `object-cover` photographer trade-off doc.

R10-M1 (long-term per-image settings hash), R10-L2 (P3 blur), and R10-L6
(`wide_gamut_max_source_pixels` in settingsHash) remain deferred per the
R10 plan.

---

## NEW R11 Findings (fresh pass)

### Severity Summary

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 0 | — |
| HIGH | 2 | R11-H1, R11-H2 |
| MEDIUM | 4 | R11-M1, R11-M2, R11-M3, R11-M4 |
| LOW | 5 | R11-L1, R11-L2, R11-L3, R11-L4, R11-L5 |

---

### HIGH

#### R11-H1 — Service Worker per-image HEAD probe doubles request count for cached photos

**Source:** Browser/Display lens (NEW)
**Files:** `apps/web/public/sw.js:157-179`
**Confidence:** HIGH
**Impact:** The R10-H3 fix issues a synchronous `HEAD` probe before serving every cached image to compare ETags. For a masonry grid loading 30 cached thumbnails, that's 30 extra HEAD round-trips on every navigation. On a high-latency mobile network (LTE/4G with 100–200 ms RTT), this adds visible perceived latency to gallery scroll/back-button traversal even though the bytes are local. Photographers showing portfolios on phones (the primary "share with a client" use case) get slower-feeling galleries, and the saved bandwidth from cache-hit is partially offset by the doubled request volume.

A cheaper alternative: skip the HEAD probe when the cached response is fresh per its own `Cache-Control: max-age` (the server emits `immutable` for hashed derivatives, but the path doesn't include the hash — it's in the ETag). Or: rate-limit HEAD probes (one probe per 5 minutes per URL) using the existing `META_CACHE`.

**Failure scenario:** Visitor on 4G opens shared gallery → SW serves 30 cached thumbs → 30 HEAD probes inflight competing with bandwidth for the next page → first-paint of the new HTML route stalls.

**Fix:** Cache the last-probe timestamp per URL in `META_CACHE`. Skip HEAD probe if last probe was within 5 minutes AND no `versionchange` signal arrived (e.g. when the SW activate sees a new SW_VERSION, invalidate all probe timestamps).

---

#### R11-H2 — `sw.js` SW_VERSION drift uncommitted in working tree breaks cache-bust contract

**Source:** Browser/Display + Operational lens (NEW)
**Files:** `apps/web/public/sw.js:16`, `apps/web/scripts/build-sw.ts`
**Confidence:** HIGH
**Impact:** The repo's working tree currently shows `apps/web/public/sw.js` as modified (`SW_VERSION = 'ba44d5a6'`). This is the placeholder rewritten at build by `build-sw.ts`. The intended contract: the committed source uses a template literal that `build-sw.ts` rewrites at build, and the committed file's `SW_VERSION` should be a stable placeholder (or the file itself is gitignored and regenerated). Currently the committed contents leak the previous commit's hash, which becomes stale every commit and gets bumped via either (a) manual recommit, (b) accidental commit, or (c) the next CI/local build.

When the deploy step doesn't rebuild before commit (e.g. quick docs-only commit), the deployed `sw.js` retains an older `SW_VERSION` even though new image-pipeline / cache invariants shipped. Clients with the SW already active will not re-activate, leaving stale caches for any visitor with the previous SW installed.

There are two correct contracts:
1. **Source-of-truth template** (`sw.template.js`) + gitignored `sw.js` regenerated by `build-sw.ts`. The current cycle-1 commit `a905ee8c` references this template path but the rendered `sw.js` is still tracked.
2. **Commit-hash-only** placeholder + build script rewrites + post-build commit hook. Fragile.

**Failure scenario:** Cycle 2 commits ship without bumping `SW_VERSION` → field SWs do not invalidate caches → photographers using `force_srgb_derivatives=true` see no effect on cached image bytes for the cache lifetime (50 MB LRU eviction window).

**Fix:** Move `sw.js` to `sw.template.js` (committed) + add `apps/web/public/sw.js` to `.gitignore`. The dev/build step regenerates `sw.js` from the template with `SW_VERSION` = `git rev-parse --short HEAD || IMAGE_PIPELINE_VERSION || Date.now()`. Bonus: this directly addresses R10-L12 (embed `IMAGE_PIPELINE_VERSION`) since the build script can compute the version from both git hash AND pipeline version.

---

### MEDIUM

#### R11-M1 — `staleWhileRevalidateImage` HEAD probe ignores 304 semantics

**Source:** Browser/Display lens (NEW)
**Files:** `apps/web/public/sw.js:165-178`
**Confidence:** HIGH
**Impact:** The HEAD probe sends no `If-None-Match` header, so the server always returns a full 200 with current ETag rather than a 304. The probe achieves its goal (ETag comparison) but wastes the negotiated-cache hint. More importantly, when the response is 304, the `cached.headers.get('ETag')` comparison is moot — the cached entry is fresh by definition. If we send `If-None-Match: ${cachedEtag}`, a 304 means "serve cached"; a 200 means "serve network." This is the ergonomic shape and saves the second `revalidate` fetch.

**Failure scenario:** Cache-hit serves stale + revalidate path triggers a second full-body fetch even when ETag matches. Bandwidth waste.

**Fix:**
```js
const headResp = await fetch(request.url, {
  method: 'HEAD',
  headers: { 'If-None-Match': cachedEtag },
});
if (headResp.status === 304) return cached; // negotiated-fresh, no revalidate needed
if (headResp.ok) {
  const networkEtag = headResp.headers.get('ETag');
  if (networkEtag && networkEtag !== cachedEtag) {
    const fresh = await revalidate;
    if (fresh) return fresh;
  }
}
```

---

#### R11-M2 — Photo viewer `max-h-[calc(100vh-8rem)]` uses fixed `8rem` navbar guess

**Source:** UI/UX lens (NEW)
**Files:** `apps/web/src/components/photo-viewer.tsx:387`, `:413`
**Confidence:** MED
**Impact:** R10-H6 raised the cap from `80vh` to `calc(100vh-8rem)`. The `8rem` (128 px) value is a guess at navbar + toolbar height. On viewports where the navbar wraps (very narrow), the cap is wrong; on viewports where the toolbar is hidden (lightbox), the cap is unnecessarily conservative.

For the photographer's intent — let the photo fill available vertical space — `max-h` should track the actual viewport-minus-chrome height. CSS `100dvh` (dynamic viewport height) handles mobile address-bar collapse properly; `calc(100dvh - var(--app-toolbar-height, 8rem))` would adapt if the toolbar height is published as a CSS custom property.

**Failure scenario:** Tablet landscape with collapsed sidebar shows extra empty space below photo because the cap assumes a fatter toolbar than is rendered.

**Fix:** Replace `100vh` with `100dvh`. Add a CSS custom property `--photo-chrome-height` defaulting to `8rem` and overridable per-layout. Photo viewer uses `max-h-[calc(100dvh-var(--photo-chrome-height,8rem))]`.

---

#### R11-M3 — `histogram-worker.js` still hard-codes BT.709 luminance (R10-M2 carryover, but specifically the worker has no signal channel)

**Source:** Color Pipeline lens (NEW evidence)
**Files:** `apps/web/public/histogram-worker.js:25`, `apps/web/src/components/histogram.tsx:184-223`
**Confidence:** HIGH
**Impact:** Confirms R10-M2 is still open. The worker receives `{ requestId, imageData, width, height }` with NO color-space hint. To fix R10-M2 cleanly, `computeHistogramAsync` must pass the canvas color space (or just `isP3`) into the worker's message, and the worker branches the luminance formula. Implementation note for the plan: this requires touching both the JS worker AND the message-shape on the TS side, plus a fixture test.

**Fix:** Already planned in R10-M2. Implementation hand-off note: pass `colorSpace: 'display-p3' | 'srgb'` in the worker message; branch luminance coefficients accordingly. ~10 lines.

---

#### R11-M4 — `force_srgb_derivatives` admin setting affects encoder behavior but its label/hint omits AVIF behavior asymmetry

**Source:** Admin UX lens (NEW)
**Files:** `apps/web/messages/en.json:695-696`, `apps/web/src/components/settings-client.tsx` (rendering surface)
**Confidence:** HIGH
**Impact:** The current hint says "AVIF variants always carry their original gamut." This is correct but reads as parenthetical. A photographer flipping `force_srgb_derivatives=true` from the admin UI may believe the AVIF derivative is ALSO converted, leading them to backfill expecting all-sRGB output. They get mixed P3-AVIF + sRGB-WebP/JPEG and assume backfill is broken.

This overlaps R10-L10 (rename label) but adds a concrete recommendation: the LABEL itself should call out the asymmetry, not the hint. e.g. "Force sRGB on WebP/JPEG only (AVIF stays wide-gamut)".

**Fix:** Change label to `Force sRGB on WebP/JPEG only`; keep the existing hint as confirmation. Bundle with R10-L10.

---

### LOW

#### R11-L1 — `IMAGE_PIPELINE_VERSION = 6` is referenced in `serve-upload.ts` ETag but not bumped on cycle-1 R10-H1 / R10-M3 fixes

**Source:** Encoder lens (NEW)
**Files:** `apps/web/src/lib/process-image.ts:1` (search for `IMAGE_PIPELINE_VERSION`), `apps/web/src/lib/serve-upload.ts:110`
**Confidence:** HIGH
**Impact:** Cycle 1 shipped R10-H1 (WI-15 ICC preservation), R10-M3 (target-gamut chroma), R10-L9 (sRGB blur) — three changes that alter byte output for wide-gamut sources. The ETag should change for affected images, but `IMAGE_PIPELINE_VERSION` was NOT bumped from 6 → 7. The settings-hash component of the ETag will only flip if a color setting changes; the `mtimeMs`/`size` components flip when the file changes on disk; the version component is global and pegged at 6.

Result: backfill is required to actually re-encode affected images, but until backfill runs, browsers see the SAME ETag for stale bytes. This is the very ETag-staleness window R10-M1 documented.

**Fix:** Bump `IMAGE_PIPELINE_VERSION = 7` whenever encoder output bytes change. Cycle-1 should have included the bump. The R10 plan can capture this as a process item: "every encoder change requires a `IMAGE_PIPELINE_VERSION` bump."

**Recommendation:** Add a unit-test fixture that locks `IMAGE_PIPELINE_VERSION` to a value referenced in a doc comment; reviewer for any process-image.ts PR must update both.

---

#### R11-L2 — Histogram canvas `2d` context option object created on every call

**Source:** Perf lens (NEW)
**Files:** `apps/web/src/components/histogram.tsx:203-207`
**Confidence:** LOW
**Impact:** Trivial allocation, but the same options object is recomputed for every histogram redraw. Memoizing would save microseconds on slideshow / fast-nav.

**Fix:** Hoist the option object construction outside the function and gate on the `(isWideGamut, supportsP3)` pair.

---

#### R11-L3 — `image-rendering` CSS hint missing on lightbox (R10-L1 carryover scope clarification)

**Source:** UI/UX lens (NEW evidence)
**Files:** `apps/web/src/components/lightbox.tsx` (img element class), `apps/web/src/app/[locale]/globals.css`
**Confidence:** MED
**Impact:** R10-L1 calls out the photo viewer image; the lightbox `<img>` also benefits from `image-rendering: high-quality`. Bundle into R10-L1 implementation but list both surfaces.

**Fix:** Add a single `.photo-viewer-image, .lightbox-image { image-rendering: high-quality; }` rule in `globals.css`. The class is already on the photo viewer; add `lightbox-image` to the lightbox `<img>`.

---

#### R11-L4 — `_aggregate.md` for R10 marks R10-H1 / R10-H3 / R10-H6 / R10-M3 / R10-M10 / R10-M13 / R10-L9 / R10-L17 implemented, but no fixture test was added for R10-H1's ICC-preservation contract

**Source:** Test/Verifier lens (NEW)
**Files:** `apps/web/src/__tests__/process-image-color-roundtrip.test.ts` (existing), `apps/web/src/lib/process-image.ts:776-796` (WI-15 path)
**Confidence:** HIGH
**Impact:** The R10-H1 fix added `.keepIccProfile()` to the WI-15 downscale intermediate. If a future refactor changes the intermediate format from TIFF to PNG/WebP (which strip ICC by default), the fix silently regresses. There's no test that drives a wide-gamut source through the WI-15 path (50 MP+) and asserts ICC survives.

A defensive test could:
1. Synthesize a fake metadata response saying `width=10000, height=10000` (100 MP).
2. Run a small actual file through `processImageFormats` with `wideGamutMaxSourcePixels=1_000_000` (forces the WI-15 path).
3. Assert the temp intermediate has an ICC profile attached.

**Fix:** Add a Vitest fixture that exercises the WI-15 path with a tiny `wideGamutMaxSourcePixels` setting and a small wide-gamut TIFF source. Verify downstream output ICC matches source ICC.

---

#### R11-L5 — `photographer-r10/_aggregate.md` "R9 Closure" table is informational, not a guard

**Source:** Process lens (NEW)
**Files:** `.context/reviews/photographer-r10/_aggregate.md:373-393`
**Confidence:** LOW
**Impact:** The closure table is a snapshot. Future cycles may unintentionally regress an R9 finding (e.g., re-introducing `(color-gamut: p3)` MQ alongside `data-display-gamut`) without anyone noticing. A small test suite asserting closures would prevent this.

**Fix (deferrable):** A "closure-guard" test file (`apps/web/src/__tests__/closure-guard.test.ts`) listing each closed finding ID and the file+pattern that, if changed, indicates regression. Low effort, high leverage.

---

## Cross-cycle agreement

- R11-H1 + R11-M1 cluster around the SW HEAD-probe shape introduced in cycle 1.
- R11-H2 + R11-L1 + R10-L12 cluster around SW_VERSION + IMAGE_PIPELINE_VERSION cache-bust contract.
- R11-M3 confirms R10-M2 (no implementation gap surprises).
- R11-M4 refines R10-L10.

## Verdict

- 0 CRITICAL new; 2 HIGH new; 4 MED new; 5 LOW new.
- Cycle 2 should prioritize **R11-H2** (SW_VERSION drift contract) and **R11-L1** (`IMAGE_PIPELINE_VERSION` bump for cycle-1 encoder changes) because they directly determine whether cycle-1's work actually reaches user browsers.
- **R11-H1** + **R11-M1** revisit the SW HEAD-probe shape introduced in cycle 1: the fix shipped, but inefficiency and missing 304 semantics warrant a follow-up.
- Carry-over R10 work should continue in parallel (R10-H4, R10-H5, R10-M2, R10-L bundle) per R10 plan priority.

*Aggregate compiled by single-agent R11 pass (no fan-out agents available).*
