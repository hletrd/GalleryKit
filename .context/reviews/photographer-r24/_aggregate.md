# Photographer R24 — Aggregate Review (cycle 15/100)

**Date:** 2026-05-17
**Lens:** Professional photographer + end-user workflow (delivery surface).
**Pass type:** Multi-perspective single-agent pass (Task/Agent fan-out
not registered in this environment; perspectives applied serially:
code-reviewer, perf-reviewer, security-reviewer, critic, verifier,
test-engineer, tracer, document-specialist, designer, architect).

## Strict scope reminder

In-scope: color/HDR/EXIF/gallery/share/topic/SEO/i18n/admin/upload/
processing/serving/perf/a11y/security/copyright/metadata/licensing/
download/embed/Lightroom-publish surfaces. Out-of-scope: any edit /
star-rating / culling / scoring / pick-flag / image-adjustment /
retouch / develop ideas.

## Coverage this pass

After R23-M1 closed the public search dropdown onError fallback, the
public `<img>` sized-derivative contract is end-to-end verified. R24
re-swept the social-embed / OG generation surface and the
`/uploads/<format>/<basename>_<size>.<ext>` derivative consumer paths
in non-`<img>` callers.

Surfaces inventoried for sized-derivative consumption:

- `apps/web/src/app/api/og/photo/[id]/route.tsx:97-110` — per-photo
  OG image generator. Loads `<basename>_<nearest>.jpg` via internal
  HTTP fetch. On 404 or byte cap, falls back to **site default OG**
  rather than to the photo itself.
- `apps/web/src/app/[locale]/(public)/page.tsx:95` — homepage
  Next.js `<meta property="og:image">` URL points at
  `<basename>_<nearest>.jpg`. If that derivative 404s, social embed
  shows no image.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:178-198` —
  prev/next `<link rel=preload as=image>` for adjacent photos.
  Sized-derivative URL. 404 quietly fails the prefetch; the actual
  viewer falls back via R22-M1 onError swap. **Acceptable** (perf
  loss only; no visible failure).
- All public `<img>` / `<picture>` surfaces — re-verified contract
  closure from R20..R23 cycles.

## Findings

### R24-M1 (MEDIUM, High confidence) — Per-photo OG route falls back to site default when target sized derivative is missing, even though smaller derivatives may be available

- **File:** `apps/web/src/app/api/og/photo/[id]/route.tsx:97-121`
- **Failure scenario:** The `/api/og/photo/[id]` route picks one
  target size (`findNearestImageSize(config.imageSizes, 1536)`)
  and tries to fetch the matching JPEG derivative. If that fetch
  fails with `!photoRes.ok` (404 — derivative not on disk because:
  (a) photo was uploaded BEFORE admin added that size, OR (b)
  pipeline_version was bumped and backfill hasn't run on this photo
  yet, OR (c) a previous encode failed mid-fan-out for that
  particular size) — the route falls back to the **site OG default**
  rather than retrying with one of the OTHER configured sizes that
  IS on disk.

  Concrete production trigger: admin reconfigures `image_sizes` from
  `[640, 1536, 2048, 4096]` to `[640, 2048, 4096]` (drops 1536). Now
  `findNearestImageSize(sizes, 1536)` returns 2048. For all photos
  encoded before the change, `_1536.jpg` is on disk but `_2048.jpg`
  may or may not be (depending on backfill). Mid-backfill window: OG
  fetcher targets 2048, sees 404, falls back to site default.
  Photographer shares a photo link to Twitter/Slack, expecting the
  photo card; gets the site logo. The photo URL itself works fine
  (viewer page renders) — only the social embed is degraded.

- **Photographer impact:** Social embeds are the primary delivery
  surface for one-link shares (DMs, Slack, link previews in
  documents). A site-default OG instead of the actual photo
  silently degrades the share for every photo whose target size is
  missing — without any operator-visible signal until someone
  notices a Twitter card looks wrong. The photographer brand
  invariant is "the photo IS the share card".

- **Fix sketch:** Iterate the configured `imageSizes` array in
  ascending order; pick the first size whose fetch returns 200 AND
  whose buffer fits under `OG_PHOTO_MAX_BYTES` (1 MB). Bias toward
  smaller sizes (they're more likely to fit under the byte cap and
  the OG canvas is 1200×630 — anything ≥ 1024 px is sufficient).
  Only after exhausting all configured sizes, fall back to the
  site-default OG. Keep the existing 10 s `AbortSignal.timeout`
  bound per attempt, and keep the existing rate-limit / max-bytes
  semantics.

  Implementation: extract `tryFetchPhotoBuffer(origin, baseFilename,
  size)` returning `Buffer | null`; in the GET handler loop over
  sorted sizes; short-circuit on the first success. Add a unit test
  fixture that simulates the 404-then-200 fallback chain.

- **Severity:** MEDIUM (public surface; degrades EVERY share for an
  affected photo until backfill completes; photographer brand impact
  on social media; same severity class as R21-M1 / R22-M1 / R23-M1
  fallback closures).
- **Confidence:** High (well-understood failure mode; encoder
  contract documents the configured-size guarantee; smaller
  derivatives are strictly more available than larger ones in
  practice).

## Cross-perspective agreement

- **code-reviewer + verifier:** R24-M1 closes the last
  sized-derivative-only consumer on a public delivery surface (the
  OG photo route). After this fix, every public surface that consumes
  `_<size>` derivatives either (a) carries a `<picture>` browser-side
  fallback, (b) onError-swaps to base JPEG, OR (c) iterates the
  configured size list with a degraded-fallback chain.
- **perf-reviewer:** Worst case is N fetches in a row before falling
  back to site default. N is bounded by the configured size list
  (default 4, admin-cap 8). Each fetch is rate-limited internally,
  hits local Nginx, and the byte cap rejects oversized payloads
  before buffering. The happy path (target size exists) is
  unchanged — first iteration succeeds and the loop exits.
- **security-reviewer:** No new attack surface. The internal fetch
  origin / path construction is unchanged; the new iteration
  variable is the configured-size from gallery config (admin-
  controlled, validated integer set).
- **architect:** Iterating ascending matches the OG canvas semantics
  — anything ≥ 1024 px renders cleanly at 1200×630, so the smallest
  configured size that exists wins on perf as well as availability.
- **document-specialist:** The fix carries a comment referencing the
  R21-M1 / R22-M1 / R23-M1 lineage and the encoder atomic-rename
  contract. Honest about why we don't fall back to the base
  filename: base JPEG is the largest configured size copied
  (encoder contract) and frequently exceeds the 1 MB OG byte cap.

## Out-of-scope / discarded

None this cycle. No reviewer surfaced edit/star/cull/score/adjust
ideas under the review framing.

## Existing backlog (R10..R23) — re-inventoried, not re-reviewed

- R10 HIGH open: R10-C1, R10-H2, R10-H4 (full), R10-H5 — schema-
  migration / fixture-authoring scope, blocked on a dedicated cycle.
- R10 MED open: R10-M2/M4/M5/M6/M7/M11/M12.
- R10 LOW open: R10-L8, R10-L19, R10-L20.
- R17 deferred: R17-L2 (per-entry Atom `<author>`) — still blocked
  on `uploaded_by` schema column or audit-log retrofit.
- R19-L2-OG deferred: dedicated `/api/og?collection=...`
  discriminator cycle.
- R11..R16, R18..R23: closed.

## Why R24 returned only one finding

The encoder-contract / fallback sweep has now reached the
non-`<img>` consumers. After cycles 11..14 closed every public
`<img>` / `<picture>` sized-derivative surface, R24 found the only
remaining sized-derivative-only consumer is the per-photo OG route.
Once R24-M1 lands, the public delivery surface is end-to-end
contract-safe for both browser-side fallback AND server-side OG
generation.
