# Photographer R26 — Aggregate Review (cycle 17/100)

**Date:** 2026-05-17
**Lens:** Professional photographer + end-user workflow (delivery surface).
**Pass type:** Multi-perspective single-agent pass (parallel reviewer
fan-out not registered in this environment; perspectives applied
serially: code-reviewer, perf-reviewer, security-reviewer, critic,
verifier, tracer, document-specialist).

## Result

**NEW_FINDINGS: 0** — convergence confirmed.

## Strict scope reminder

In-scope: color/HDR/EXIF/gallery/share/topic/SEO/i18n/admin/upload/
processing/serving/perf/a11y/security/copyright/metadata/licensing/
download/embed/Lightroom-publish surfaces. Out-of-scope: any edit /
star-rating / culling / scoring / pick-flag / image-adjustment /
retouch / develop ideas.

## Convergence rationale

The cycle directive explicitly called out the recent finding pattern:
"cycles 13-16 have each surfaced only a single MED finding mostly
chasing the sized-derivative contract across new consumers. If R26
finds 0 new actionable findings AND no backlog item is cleanly scoped,
return NEW_FINDINGS:0 / COMMITS:0 honestly so convergence can fire."

R26 inventoried the remaining sized-derivative consumer surface and
verified that every consumer is now config-aware. Specifically:

### Surface inventory (sized-derivative consumers, server-rendered)

All callers grouped by call shape:

- `sizedImageFilename(filename, size, imageSizes)` (three-arg form,
  config-aware): both feed routes (root + topic) per R25-M1, and the
  internal `sizedImageUrl` helper.
- `pickFirstAvailablePhotoBuffer(origin, base, imageSizes)`: per-photo
  OG route per R24-M1 (iterates ASCENDING through configured sizes).
- `findNearestImageSize(imageSizes, target)`: home OG, per-photo
  preload, timeline, year, topic, smart-collection, shared-group
  pages — every server-rendered SEO/syndication consumer now goes
  through this helper with the LIVE `config.imageSizes`.
- `sizedImageUrl(directory, filename, size, imageSizes)`: client-side
  callers (search dropdown, image-manager admin table) pass
  `imageSizes` from props that derive from the live admin config; the
  helper internally calls `findNearestImageSize`.

### Hard-coded `_640` / `_1536` / `_2048` / `_4096` literal scan

`grep -rn "_640\|_1536\|_2048\|_4096" apps/web/src --include="*.ts(x)"`
(excluding test files) returns only:

- `components/histogram.tsx:108` — a comment explaining the API
  contract ("callers MUST pass a sized variant URL e.g. `_640.jpg`").
  Documentation only, no encoded literal in path construction.
- `lib/process-image.ts:879, 1067` — encoder-internal logging
  references describing the suffix convention. Not a path literal.
- `app/feed.xml/route.ts:49` — a comment in the R25-M1 fix explaining
  the failure mode that was closed.

No live consumer encodes a hard-coded size in path construction.

### JSON-LD `contentUrl` / `thumbnailUrl` scan

Every public structured-data emitter (`(public)/page.tsx`,
`timeline/page.tsx`, `[topic]/page.tsx`, `year/[year]/page.tsx`,
`c/[slug]/page.tsx`, `p/[id]/page.tsx`) uses the BASE
`image.filename_jpeg` (not a sized derivative) per the R21-M2 fix.
The base filename is invariant under any admin `image_sizes` change
because the encoder atomic-rename contract preserves it.

### Atom feed surface

The `<media:content>` and `<link rel="enclosure">` URLs in both feed
routes (`feed.xml/route.ts`, `[topic]/feed.xml/route.ts`) now resolve
through `findNearestImageSize(config.imageSizes, 1536)` per R25-M1.
The feed-level `<author>` (R17-M1), `<rights>` (R17-M4), conditional
GET via `Last-Modified` + `If-Modified-Since` (R18-L3 + R19-M1), and
explicit `type="text"` on RFC-4287-required elements (R18-L2) are all
in place.

The `<link rel="enclosure" length="…">` attribute is OPTIONAL per
RFC 4287 §4.2.7.2. Adding it would require a `HEAD` per entry to
discover the byte length (or schema-tracked sizes) — net cost on
every feed render is non-trivial for marginal-correctness gain and
no reader actually rejects an enclosure without `length`. Recorded
as **non-issue** (not deferred — not worth tracking).

### Sitemap

`app/sitemap.ts` references no image URLs (only `/p/${id}` page URLs).
Image-asset selection is out of scope for sitemap.

### Download / entitlements / Stripe

`/api/download/[imageId]` serves `filename_original` (the source upload)
under entitlement gating. Not subject to sized-derivative drift; the
file either exists or it doesn't, and the queue marks `processed=true`
only after the source is durably staged.

### OG image route

`/api/og/photo/[id]` and the site-default OG image both flow through
config-driven helpers (`pickFirstAvailablePhotoBuffer` /
`findNearestImageSize(config.imageSizes, …)`).

### Lightroom publish surface

`/api/admin/lr/upload` accepts source uploads (treated as ordinary
admin uploads) and never references sized derivatives. PATs in
`admin_tokens` gate the route; the upload path then funnels through
the same `uploadImages()` action that the admin UI uses.

## Findings

**None.**

## Cross-perspective agreement on convergence

- **code-reviewer:** Every sized-derivative consumer in the server-
  rendered surface is config-aware after R25-M1. No remaining
  candidates with the R21-M1..R25-M1 defect shape.
- **perf-reviewer:** No new performance opportunities identified.
  Feed cache headers, OG byte caps, image queue concurrency, and DB
  index coverage are all tuned. The `revalidate = 0` on the public
  surface remains the documented honest trade-off (per CLAUDE.md
  "Reintroduce ISR only with an explicit invalidation/freshness
  plan").
- **security-reviewer:** No new security findings. Rate limits, CSRF
  via `requireSameOriginAdmin`, withAdminAuth wrapper, advisory locks,
  Unicode-bidi/zero-width sanitization, MIME-validated blur data
  URLs, and HMAC-signed sessions form a coherent defense surface.
- **critic:** The remaining R10 backlog items are real but require
  schema/migration work (R10-H2, R10-H5, R17-L2 `uploaded_by` column;
  R10-C1 fixture authoring; etc.) that needs a dedicated cycle rather
  than the per-cycle micro-fix shape of cycles 11..25. Not actionable
  this cycle.
- **verifier:** All cycle 11..25 fix targets are present in the code
  with their planned comments and test fixtures. No regression visible.
- **tracer:** The end-to-end "admin reconfigures `image_sizes` → photo
  delivery surface stays correct" trace runs cleanly from admin UI
  through `getGalleryConfig` → `config.imageSizes` → every consumer.
- **document-specialist:** CLAUDE.md cycle history accurately tracks
  R3..R25; this cycle adds R26 to the convergence checkpoint.

## Out-of-scope / discarded

None this cycle. No reviewer surfaced edit / star / cull / score /
adjust ideas under the review framing.

## Existing backlog (R10..R25) — re-inventoried, not re-reviewed

- R10 HIGH open: R10-C1, R10-H2, R10-H4 (full), R10-H5 — schema-
  migration / fixture-authoring scope, blocked on a dedicated cycle.
- R10 MED open: R10-M2/M4/M5/M6/M7/M11/M12.
- R10 LOW open: R10-L8, R10-L19, R10-L20.
- R17 deferred: R17-L2 (per-entry Atom `<author>`) — still blocked
  on `uploaded_by` schema column or audit-log retrofit.
- R19-L2-OG deferred: dedicated `/api/og?collection=...`
  discriminator cycle.
- R11..R16, R18..R25: closed.

**Exit criterion for the still-open HIGH/MED carryovers:** dedicated
cycle that bundles schema-migration work (R10-H2 + R10-H5 + R17-L2)
and a fixture-authoring cycle for R10-C1 / R11-L4. The per-cycle
micro-fix loop has reached its productive limit; the next productive
unit of work is a schema-migration cycle.

## Why R26 returned zero findings

After R25-M1 closed the last unaddressed sized-derivative consumer
(the feed routes), there are no further consumers of the same defect
class. The cycle-13..16 finding pattern was a sweep of one
architectural defect class across N consumers; that sweep is now
exhausted. Continuing to chase micro-findings under the same lens
would manufacture work rather than reflect honest review.

The remaining backlog is schema/migration work that explicitly needs
a different cycle shape (not micro-fix-per-cycle), so the convergence
return is honest: no new findings AND no backlog item cleanly scoped
for the per-cycle micro-fix flow.
