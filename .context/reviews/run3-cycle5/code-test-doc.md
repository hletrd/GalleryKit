# Run-3 Cycle 5 — Code + Test + Doc angle (code-reviewer, test-engineer, document-specialist)

## Code quality / logic
- `app/feed.xml/route.ts`: feed media-content size resolved against LIVE `image_sizes`
  (R25-M1), updated_at-derived `<updated>` + Last-Modified + 304 conditional (R18-L3/R19-M1),
  per-entry author with feed-level fallback, `<rights>`. No logic bug.
- `app/api/og/photo/[id]/route.tsx`: OG sanitizes Unicode-format + C0 control chars, sRGB
  ICC always embedded (WI-04 honesty), rate-limited (C7-SEC-01) with rollback on every
  early return, sized-derivative fallback chain (R24-M1). No issue.
- `app/actions/public.ts`: symmetric in-memory + DB rate-limit increment/check/rollback with
  pinned bucketStart; codePoint-based length checks; structured error returns instead of
  throws. No TOCTOU or counter-drift.

## Doc-code consistency (CLAUDE.md claims spot-verified)
- IMAGE_PIPELINE_VERSION = 7 ✓ (process-image.ts)
- ETag format string ✓ (serve-upload.ts line 122)
- avif_effort default 6, wide_gamut_max_source_pixels 50_000_000 ✓ (gallery-config defaults)
- Advisory-lock names + server-scope note ✓
- Color/HDR admin-only honesty rule (is_hdr / transfer_function / matrix_coefficients) ✓
  enforced in data.ts privacy guard.
No doc-code drift found.

## Test coverage
- Existing fixture/contract tests cover: blur wiring, tag_names SQL, privacy fields,
  action-origin, api-auth, touch-target, lr-upload-hdr-gate (22 assertions),
  stripe-webhook-source, stripe-download-tokens. Coverage is dense for the hardened surfaces.
- No untested net-new behavior introduced this cycle (no code change).

## i18n
- EN/KO key parity: 812/812, zero missing either direction.
- 5 keys show ICU `plural`-in-EN vs single-form-in-KO (upload.hdrWarning,
  upload.wideGamutDownscaleWarning, search.resultsCount, serverActions.someImagesNotFound,
  timeline.photosCount). VERIFIED CORRECT: Korean has no grammatical plural; single-form
  with `{count}` interpolation is the canonical next-intl pattern. NOT a bug.

## Findings
NONE.
