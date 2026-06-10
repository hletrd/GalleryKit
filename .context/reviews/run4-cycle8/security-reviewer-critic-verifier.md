# Run-4 Cycle 8 — security-reviewer / critic / verifier angle

Inventory: stripGpsFromOriginal + both call sites (browser upload
`app/actions/images.ts:310`, LR PAT route `app/api/admin/lr/upload`),
empirical Sharp 0.34.5 behavior verification (two node experiments with
GPS-tagged fixtures), download route + interstitial re-audit
(`api/download/[imageId]/route.ts`, `lib/download-interstitial.ts`),
serve-upload path containment re-check, LD-JSON injection sweep
(every `dangerouslySetInnerHTML` site), public pages p/[id] + g/[key]
(rate limit, robots, PII), data.ts privacy field guards, pattern
sweeps (parseInt radix, eval/Function, redirects).

## Findings

### COR-R4C8-01 — `strip_gps_on_upload` does NOT strip GPS from the stored original; it also lossily re-encodes the photographer's original (HIGH / Confidence: High — empirically proven, twice)
`apps/web/src/lib/process-image.ts:1445-1470` (`stripGpsFromOriginal`),
called from `apps/web/src/app/actions/images.ts:310` and
`apps/web/src/app/api/admin/lr/upload/route.ts:~320` whenever the admin
enables the `strip_gps_on_upload` setting.

Two independent defects, one function:

1. **The GPS strip is inert.** The function relies on
   `sharp(filePath).withMetadata({ orientation, icc }).toFile(tmp)`
   with the docblock claim that withMetadata "keeps only the
   orientation tag (and ICC if present) while stripping GPS, camera
   serial, etc." In Sharp 0.33+/0.34.5, `withMetadata()` **keeps all
   input EXIF** (it is the keep-metadata API; the options only override
   orientation/ICC/density on top). Empirical proof (node, sharp
   0.34.5): a JPEG written with `GPSLatitude 37;33;59 N / GPSLongitude
   126;58;41 E` retains the **byte-identical GPS IFD** after the exact
   stripGpsFromOriginal sequence, plus Make/Model. Consequence: the
   privacy feature the admin explicitly enabled does nothing for the
   on-disk original — and `data/uploads/original/` is exactly what the
   paid-download route (`/api/download/[imageId]`) streams to
   customers. A wildlife / conflict-zone photographer who enabled the
   toggle leaks protected coordinates to every paying customer (the
   precise scenario the PP-BUG-3 lineage cites). The DB columns and
   derivatives are clean, so nothing in the UI reveals the leak.

2. **The "strip" silently degrades the original.** `toFile()` decodes
   and re-encodes; with no format options this means JPEG at default
   quality 80 (empirically confirmed: output is a re-encoded JPEG, not
   a byte-preserving rewrite), HEIF at default quality 50, etc. The
   paid product's deliverable — "the original" — becomes a silent
   generation-loss copy whenever the toggle is on.

   Severity per repo rules: privacy/correctness — **not deferrable**.

Fix shape (scoped, testable):
- JPEG originals (the dominant photographer export): **lossless
  byte-level GPS-IFD scrub** — walk SOI → APP1 `Exif\0\0` → TIFF
  header (II/MM) → IFD0 → locate tag 0x8825 (GPSInfo pointer) →
  zero every GPS IFD entry's value bytes (inline and offset-referenced,
  bounds-checked) → set the GPS IFD entry count to 0. Pixels and all
  other metadata stay byte-identical; no decode.
- Non-JPEG originals: re-encode WITHOUT metadata retention (sharp
  default strips EXIF), `autoOrient: true` (bakes orientation into
  pixels so no orientation tag is needed), `keepIccProfile()`, and
  explicit high-quality per-format options (png lossless; tiff lzw;
  webp/avif/heif quality >= 90) + a `console.warn` that a re-encode
  occurred. Document the trade-off in the docblock.
- Behavioral tests: GPS-tagged JPEG fixture → after strip, exif-reader
  sees no GPS tags AND decoded pixel buffer is byte-identical; PNG/WebP
  fixture → GPS gone, ICC preserved; corrupted-file path still
  best-effort no-ops.

### Re-audit of the cycle-7 paid-download interstitial — SOUND, one LOW observation
- Token never appears in the HTML body (form action omitted; query
  preserved on POST) — verified in `lib/download-interstitial.ts`.
- All interpolations escaped (`escapeHtml` covers & < > " ').
- CSP `default-src 'none'; style-src 'unsafe-inline'; form-action
  'self'; base-uri 'none'; frame-ancestors 'none'` is correct for a
  script-free page; X-Robots-Tag + meta robots both present;
  Referrer-Policy: no-referrer prevents token-bearing URL leakage.
- LOW (designer file): validation failures on GET (400/403/404/410)
  remain unlocalized `text/plain` one-liners on a customer-facing paid
  journey — taxonomy was deliberately preserved verbatim in c7; record
  as observation, not a scheduled fix.

## Verified-clean (this cycle's evidence)
- Every `dangerouslySetInnerHTML` site routes through `safeJsonLd`
  (page.tsx, [topic], c/[slug], timeline, year, p/[id] ×2).
- p/[id] JSON-LD strips Unicode bidi/invisible chars (sanitizeForOg);
  GPS excluded from public selects (compile-time `_PrivacySensitiveKeys`
  guard re-checked).
- g/[key] share lookups rate-limited once in the page body (C4-AGG-01
  contract intact); share pages remain noindex/nofollow.
- serve-upload: symlink rejection + realpath containment + dir/ext map
  unchanged and correct; 304 path emits no body.
- No eval/new Function/child_process additions; no new raw SQL.
- Download route POST: open-before-claim ordering verbatim from c7;
  handle closed on every post-open failure path (re-traced).
