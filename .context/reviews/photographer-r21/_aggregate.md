# Photographer R21 — Aggregate Review (cycle 12/100)

**Date:** 2026-05-17
**Lens:** Professional photographer + end-user workflows (delivery surface).
**Pass type:** Multi-perspective single-agent pass. Task / Agent fan-out
remains unregistered in this environment (only deferred MCP tools are
available; the parallel-reviewer fan-out cannot be invoked). Apply
reviewer perspectives serially: code-reviewer, perf-reviewer,
security-reviewer, critic, verifier, test-engineer, tracer,
document-specialist, designer, architect.

## Strict scope reminder

In-scope: color/HDR/EXIF/gallery/share/topic/SEO/i18n/admin/upload/
processing/serving/perf/a11y/security/copyright/metadata/licensing/
download/embed/Lightroom-publish surfaces. Out-of-scope: any edit /
star-rating / culling / scoring / pick-flag / image-adjustment /
retouch / develop ideas.

## Coverage this pass

Surfaces touched in this R21 sweep:
- `apps/web/src/components/lightbox.tsx` (full-screen viewer — the
  marquee delivery surface for a photographer's client review).
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` (per-photo
  page JSON-LD).
- `apps/web/src/app/[locale]/(public)/page.tsx` (homepage JSON-LD).
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx`,
  `year/[year]/page.tsx`, `[topic]/page.tsx`,
  `c/[slug]/page.tsx` (storytelling pages JSON-LD).
- `apps/web/src/app/api/search/semantic/route.ts`
  + `apps/web/src/app/api/admin/db/download/route.ts`
  + `apps/web/src/app/api/admin/lr/upload/route.ts` (runtime
  declarations).

Surfaces explicitly NOT re-reviewed (closed in R10..R20 or pending a
dedicated cycle): the rest of the color/HDR pipeline, schema/migration
work (still gated on the R10 HIGH bundle), Atom feed routes,
copy-clipboard helpers, focus-trap, framer-motion plumbing.

## Findings

### R21-M1 (MEDIUM, High confidence) — Lightbox `<img>` fallback uses sized JPEG with no `onError` recovery to base filename

- **File:** `apps/web/src/components/lightbox.tsx:357,434-460`
- **Failure scenario:** The lightbox `<picture>` element computes
  `jpegSrc = imageUrl(\`/uploads/jpeg/${baseJpeg}_${jpegSize}.jpg\`)`
  where `jpegSize` is the second-largest configured image size
  (e.g. `2048` for a default 640/1536/2048/4096 set). Legacy photos
  that pre-date the sized-derivative encoder, or photos caught
  mid-backfill after an `IMAGE_PIPELINE_VERSION` bump, only have the
  base `filename_jpeg` on disk (atomic-rename contract). When the
  browser cannot decode the AVIF / WebP `<source>` rows (Safari < 16
  without WebP, very old Edge, server-side bot rendering) and falls
  through to the `<img>` `src`, that URL 404s. There is no `onError`
  handler, so the lightbox shows a broken-image glyph at full-screen.
  This is the **single most visible** delivery surface — when a
  photographer hands a client a share link and the client clicks any
  thumbnail to enlarge, this is what they see. R19-M2 and R20-M1
  already fixed the same pattern on lower-traffic surfaces
  (timeline / year / homepage masonry / shared-group masonry); the
  lightbox is the highest-priority surface to bring into parity.
- **Photographer impact:** A client-share link with one broken
  thumbnail in the masonry is recoverable (the visitor scrolls past);
  a broken lightbox image is a hard-stop on the delivery flow and
  immediately erodes the photographer's perceived quality.
- **Fix sketch:** Mirror the R19-M2 / R20-M1 pattern. Add an
  `onError` handler on the `<img>` that swaps the `src` to the base
  `filename_jpeg` once. Use a ref + a one-shot guard so the swap
  doesn't loop if even the base file is missing (true 404 on a
  deleted file). Pattern:

  ```tsx
  const triedFallbackRef = useRef(false);
  // …
  <img
      src={jpegSrc}
      onError={(e) => {
          if (triedFallbackRef.current) return;
          triedFallbackRef.current = true;
          if (image.filename_jpeg) {
              (e.currentTarget as HTMLImageElement).src =
                  imageUrl(`/uploads/jpeg/${image.filename_jpeg}`);
          }
      }}
      // … existing props
  />
  ```

  Reset the ref when `image.id` changes so the next photo gets a
  fresh attempt.
- **Severity:** MEDIUM (highest-traffic delivery surface; broken
  thumbnails during any backfill window directly hit photographer +
  client UX).
- **Confidence:** High (same pattern as R19-M2 / R20-M1; fix is a
  proven recipe).

### R21-M2 (MEDIUM, Medium confidence) — JSON-LD `thumbnailUrl` / `thumbnail` references sized JPEG with no graceful degradation for Google Image Search

- **Files:**
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:217`
  - `apps/web/src/app/[locale]/(public)/page.tsx:95,168`
  - `apps/web/src/app/[locale]/(public)/timeline/page.tsx:93`
  - `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:83`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:196`
  - `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:123`
- **Failure scenario:** Every public SSR page emits a
  `<script type="application/ld+json">` block whose `thumbnail` /
  `thumbnailUrl` (and on the photo page, `contentUrl` too) absolute
  URL hard-codes the `_${size}.jpg` sized derivative. Googlebot Image
  follows these URLs to fetch the preview thumbnail; a 404 drops the
  photo from Google Image Search indexing during the backfill window.
  Unlike the masonry `<picture>` `<img>` fallback chain (R19-M2 /
  R20-M1), there is no in-browser opportunity to recover — the URL
  is baked into the structured-data document and consumed
  server-to-server by crawlers.
- **Photographer impact:** Reduced organic discovery via Google
  Image Search for the entire backfill window (could be hours on a
  large catalog). For a photographer whose primary acquisition
  channel is Google Image Search → gallery click-through, this is a
  direct top-of-funnel hit.
- **Fix sketch:** Two options, prefer (a):
  1. **Reorder fallback to base filename + sized via `srcset`-like
     companion field.** schema.org `ImageObject.thumbnail` accepts an
     array of URLs ranked by priority. Emit
     `thumbnailUrl: [sizedUrl, baseFilenameUrl]` so Googlebot tries
     the sized URL first and falls back to the always-present base
     filename. Verify Google's structured-data parser accepts an
     array for `thumbnailUrl` (the property is single-string per
     schema.org but the search-features docs cite `thumbnail` as
     accepting an array).
  2. **Just emit the base filename.** Trade smaller thumbnail-CDN
     bandwidth for guaranteed availability. The base JPEG is the
     largest variant, so this slightly bloats the Googlebot Image
     fetch (one-time, cached) but eliminates the 404 risk entirely.
  Choose (2) for the simpler, audit-clean change. On the photo page,
  `contentUrl` already uses the base filename; only `thumbnailUrl`
  needs the swap. On the storytelling pages, the JSON-LD
  `thumbnail` field uses the sized derivative as a SEO-bandwidth
  optimization that loses to availability.
- **Severity:** MEDIUM (SEO-discovery surface; affects organic
  acquisition during any backfill window — not visible in product
  UX but materially affects photographer's customer-acquisition
  funnel).
- **Confidence:** Medium (Google's exact handling of a thumbnail
  404 vs. a present-but-large thumbnail is undocumented at this
  granularity; the fix is purely-defensive — base filename is
  always present per encoder atomic-rename contract).

### R21-L1 (LOW, High confidence) — `/api/search/semantic`, `/api/admin/db/download`, `/api/admin/lr/upload` missing explicit `runtime = 'nodejs'`

- **Files:**
  - `apps/web/src/app/api/search/semantic/route.ts:46`
  - `apps/web/src/app/api/admin/db/download/route.ts:11`
  - `apps/web/src/app/api/admin/lr/upload/route.ts:42`
- **Failure scenario:** Identical to R20-L2 (the
  `/api/checkout/[imageId]` finding closed last cycle). Every other
  comparable route in the repo (`/api/og`, `/api/og/photo/[id]`,
  `/api/download/[imageId]`, `/api/stripe/webhook`,
  `/api/checkout/[imageId]`) explicitly declares
  `export const runtime = 'nodejs'`. These three do not. All three
  use Node-only APIs:
  - `search/semantic` uses `db` (mysql2), `Buffer.from`, and the
    in-process rate-limit Map (relies on shared process state).
  - `admin/db/download` uses `fs`, `fs/promises`, and `path` (all
    Node-only).
  - `admin/lr/upload` uses `db`, `process-image` (Sharp =
    libvips bindings), and the in-process upload queue.
  Next.js currently defaults to the Node runtime when a route
  imports a Node-only library, so all three run on Node today. But
  this is implicit. A future Next.js default flip to Edge, or a
  bundler heuristic miss, would route them onto Edge where they
  fail at import time (mysql2 / Sharp / `fs` are not Edge-compatible).
- **Photographer impact:** Latent silent break — semantic search,
  DB backup download, and the Lightroom publish-plugin upload would
  all 500 on the first POST after a Next.js upgrade. The LR plugin
  one is particularly painful because it would break the
  photographer's primary integration path with zero in-product
  diagnostic.
- **Fix sketch:** Add `export const runtime = 'nodejs';` after the
  `dynamic` declaration (or as the only runtime line where
  `dynamic` is absent) in each of the three routes. Three-line
  change matching the convention established in R20-L2. Confirms
  the intended runtime in source so the lint:api-auth gate (or a
  future ESLint rule) can verify it.
- **Severity:** LOW (latent — only fires on a Next.js default flip,
  but the surface is fully defensive).
- **Confidence:** High (explicit convention used elsewhere in the
  same code-base for the same reason; trivially correct fix).

## Cross-perspective agreement

- **code-reviewer + verifier:** R21-M1 is a direct repeat of the
  R19-M2 / R20-M1 pattern. The lightbox is the most visible
  delivery surface that was missed in the prior sweeps — bringing
  it into parity closes the loop on the encoder atomic-rename
  contract everywhere except the lightbox.
- **perf-reviewer + tracer:** R21-L1 is a parity finding only —
  three routes whose Node-only imports work today by Next.js
  default but should declare their requirement explicitly to
  match the rest of the repo. No perf change.
- **document-specialist + architect:** R21-M2 is a defensive SEO
  hardening; the JSON-LD audit surface is correct today only
  because every photo on this deployment happens to have all
  sized derivatives. Mid-backfill on a fresh photo or after an
  `IMAGE_PIPELINE_VERSION` bump, the field becomes incorrect for
  legacy rows.

## Out-of-scope / discarded

None this cycle. No reviewer surfaced edit / star / cull / score /
adjust ideas under the review framing.

## Existing backlog (R10..R20) — re-inventoried, not re-reviewed

- R10 HIGH open: R10-C1, R10-H2, R10-H4 (full), R10-H5 — schema-
  migration / fixture-authoring scope blocked on a dedicated cycle.
- R10 MED open: R10-M2/M4/M5/M6/M7/M11/M12.
- R10 LOW open: R10-L8, R10-L19, R10-L20.
- R17 deferred: R17-L2 (per-entry `<author>` on Atom entries) —
  still blocked on `uploaded_by` column or audit-log retrofit.
- R19-L2-OG deferred: dedicated `/api/og?collection=...`
  discriminator cycle.
- R18..R20: closed in cycles 9..11.
