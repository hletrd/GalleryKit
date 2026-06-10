# Security / Critic / Verifier angle — Run-4 Cycle 9

Inventory: independent regression review of all 7 R4C8 fix commits
(6117168a, 848bc593, e94346a0, 7afd8522, 01a58f00, 00fcd542 + SW
refreshes), with the brand-new 515-line binary parser
`lib/gps-exif-strip.ts` as the priority target (fresh binary-parsing
code on a privacy-critical path); both upload call sites
(`actions/images.ts`, `api/admin/lr/upload/route.ts`); the public map
GPS surface (`(public)/map/page.tsx` + `publicMapSelectFields` +
`map_visible` JOIN contract); `data-timeline.ts` privacy mirror;
extension allowlist routing in `process-image.ts`
(`getSafeExtension` → `stripGpsFromOriginal` tier dispatch); guarded
JSON.parse sweep (admin-tokens / smart-collections / semantic route —
all guarded); Math.random sweep (none outside tests); i18n message
parity (826/826 keys, ICU plural diffs are correct Korean usage).
ONE empirical experiment executed (node --experimental-strip-types
harness constructing a synthetic ExtendedXMP JPEG) that converted a
hypothesis into a proven defect.

## SEC-R4C9-01 — GPS in ExtendedXMP-only JPEG survives the scrub (CONFIRMED, empirical)

**Severity MED-HIGH / Confidence High (empirically proven).**

`apps/web/src/lib/gps-exif-strip.ts:230-244` — the JPEG segment loop
tests ONLY standard-XMP APP1 segments (`XMP_APP1_SIGNATURE`) against
`XMP_GPS_TOKEN`. ExtendedXMP APP1 segments
(`http://ns.adobe.com/xmp/extension/`) are dropped only when the
STANDARD packet matched (`dropXmp` already true). When the standard
packet carries just the `xmpNote:HasExtendedXMP` GUID pointer and the
GPS properties live in the extension overflow (the documented purpose
of ExtendedXMP — packets > 64 KB, e.g. Google Pixel GPano + GPS,
Adobe panorama exports), the scrub returns `{ stripped: false }` and
the original keeps its coordinates.

Empirical proof (this cycle): synthetic JPEG with std-XMP
(`HasExtendedXMP` only) + ext-XMP (`exif:GPSLatitude`/`GPSLongitude`)
→ `stripGpsFromJpegBuffer` returned `stripped: false`, output still
contains `GPSLatitude`.

Failure scenario: admin enables `strip_gps_on_upload`; photographer
uploads a Pixel/photosphere JPEG whose XMP overflowed; DB lat/long are
nulled (so the gallery looks clean and `exif-reader` never sees XMP
GPS) but the stored original — the exact bytes the paid-download
endpoint streams — retains the protected location. This is the same
threat model as R4C8 COR-R4C8-01, residual gap.

Fix: also match `XMP_EXT_APP1_SIGNATURE` segment payloads against
`XMP_GPS_TOKEN` (and, for boundary robustness, test the concatenated
extension payloads after stripping each chunk's 40-byte
GUID/length/offset header per XMP Part 3) → set `dropXmp`; the
existing drop pass already removes std+ext segments together. Add a
behavioral regression test.

## SEC-R4C9-02 — verified sound (no finding)

- Both upload paths null DB lat/long and call `stripGpsFromOriginal`
  AFTER `extractExifForDb` (images.ts:302→310; lr route:310→326) — a
  tier-2 metadata-stripping re-encode can never erase capture
  date/camera fields before DB extraction. Parity confirmed.
- Every `ALLOWED_EXTENSIONS` member has a strip strategy: jpg/jpeg/
  tif/tiff/heic/heif/avif/webp → lossless scrub; png → pixel-lossless
  re-encode tier; gif/bmp → documented no-op (no EXIF carriage). RAW
  rejected at `getSafeExtension`.
- TIFF/IFD walker bounds: `inBounds` covers every read/write; IFD
  chain bounded (MAX_IFD_CHAIN=8, visited-set cycle guard,
  MAX_IFD_ENTRIES=1024); unknown TIFF type ids → structural-anomaly
  null → safe re-encode fallback. ISOBMFF walk mirrors the bounded
  color-detection walker (depth 5, 64-bit size guard, itemCount ≤
  4096, extents ≤ 64, construction_method ≠ 0 → conservative null).
  Multi-extent Exif items mis-parse → null → safe fallback (privacy
  preserved via tier 2). No OOB write paths found.
- Atomic tmp-write (0600) + rename on both tiers; tmp unlinked on
  error.
- Public map page GPS exposure is the documented per-topic
  `map_visible` opt-in enforced at query level (inner JOIN), with its
  own compile-time guard. Not a leak.
- `gosu node` privilege drop + UV_THREADPOOL_SIZE cap in
  entrypoint.sh: sound.

## Critic notes

- The R4C8 GPS-strip test suite proves the JPEG/AVIF/WebP/TIFF happy
  paths with REAL files (good) but every XMP fixture puts GPS in the
  standard packet — the suite structurally could not have caught
  SEC-R4C9-01. See test-engineer angle.
- `XMP_GPS_TOKEN` deliberately excludes non-coordinate GPS tags
  (GPSImgDirection / GPSSpeed / GPSDateStamp). Acceptable: those do
  not reveal location. `GPSAreaInformation` (place names) is rare
  enough to leave out; noted, not scheduled.

## Verifier evidence log

- vitest baseline on clean tree: 1729/1729 PASS (181 files).
- typecheck baseline: PASS.
- ExtendedXMP experiment: documented above (reproducible inline
  harness; converted to a committed regression test in the fix).
