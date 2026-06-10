# Run-4 Cycle 8 — document-specialist angle

Inventory: CLAUDE.md contract claims vs code (image pipeline section,
color/HDR section, tunables table), stripGpsFromOriginal docblock vs
Sharp 0.34.5 documented behavior, R13-H1 / R21-M1 / R22-M1 comment
claims vs verified browser behavior, README spot-checks on the c7
download workflow rewrite.

## Findings

### DOC-R4C8-09 — CLAUDE.md default image-sizes drift (LOW / High)
CLAUDE.md line ~211: "configurable sizes each (default: 640, 1536,
2048, 4096; admin-configurable up to 8 sizes)". Actual default in
`apps/web/src/lib/gallery-config-shared.ts:90` is
`[640, 1536, 2048, 4096, 5120, 7680]` (6 sizes). Fix the doc in the
same cycle as the code fixes.

### Doc-claims invalidated by this cycle's verified findings (folded into their parent fixes)
- `stripGpsFromOriginal` docblock (process-image.ts:1425-1444) claims
  Sharp's `withMetadata({ orientation })` "keeps only the orientation
  tag (and ICC if present) while stripping GPS, camera serial, etc." —
  contradicted by Sharp's own docs (withMetadata = keep input metadata)
  and by the empirical GPS-retention proof (COR-R4C8-01). The docblock
  must be rewritten as part of the fix, including the re-encode
  trade-off for non-JPEG formats.
- photo-viewer.tsx R13-H1 comment (lines ~302-309) claims AVIF-capable
  browsers "skip the WebP/JPEG tags because their `<picture>` will pick
  AVIF from the in-DOM `<source>` chain" — preload `type` gates MIME
  support only; Chromium fetches every supported-format preload
  (PERF-R4C8-03 evidence). Comment must be corrected with the fix.
- lightbox.tsx R21-M1 / photo-viewer.tsx R22-M1 comments claim the
  onError src-swap serves legacy photos "cleanly" — disproven
  (COR-R4C8-05); comments must describe the source-removal mechanism
  after the fix.
- CLAUDE.md "10-bit AVIF … falls back to 8-bit per-image on
  encode-time rejection" — currently unsatisfiable (COR-R4C8-06);
  becomes true once `bitdepth: 8` is explicit.

### Verified-accurate this cycle
- README "Manual download distribution" (c7 rewrite) matches the
  shipped GET-interstitial/POST-claim behavior.
- CLAUDE.md advisory-lock inventory matches `lib/advisory-locks.ts`
  usage sites; backfill section matches both entry points.
- Color/HDR decision matrix table matches `resolveAvifIccProfile` /
  `resolveColorPipelineDecision` branch-for-branch, including the
  NCLX-only signals parameter.
- Touch-target policy text matches the audit fixture behavior
  (normalizer + KNOWN_VIOLATIONS semantics).
