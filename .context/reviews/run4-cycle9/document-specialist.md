# Document-specialist angle — Run-4 Cycle 9

Inventory: sw.template.js header + inline strategy comments vs
implemented behavior; serve-upload cache-header contract vs SW
assumptions; gps-exif-strip module docblock vs implementation;
process-image `stripGpsFromOriginal` docblock vs tiers; CLAUDE.md
upload-flow/security sections vs current code; data-timeline header
contract ("matches publicSelectFields") vs data.ts; i18n catalogs
(en/ko key parity 826/826 — ICU plural-form asymmetry is correct
Korean, NOT drift).

## DOC-R4C9-05 — sw.template.js documents a 304 short-circuit that does not exist

**Severity LOW (doc) / MED when paired with the behavior / Confidence
High.** Lines 171-175: "A 304 short-circuits the revalidate body
fetch entirely." The revalidate fetch is created — and therefore
dispatched — at line 149, before the ETag probe. Nothing aborts it on
304. Either the comment or the code must change; PERF-R4C9-02
(perf angle) schedules the CODE change (lazy revalidate), which makes
the comment true. Folds into that fix.

## DOC checked-OK

- `gps-exif-strip.ts` header accurately describes supported
  containers, the zero-fill semantics, and the null-on-anomaly
  contract — EXCEPT the implicit claim "GPS-bearing XMP APP1 segments
  dropped" (line 19), which is true only for standard-packet GPS
  today; SEC-R4C9-01's fix makes the sentence fully true. No separate
  doc task.
- `stripGpsFromOriginal` docblock (process-image.ts:1445-1485)
  matches the two-tier implementation, including the HEIC
  no-HEVC-encoder loud-failure path and the gif/bmp no-op rationale.
- CLAUDE.md upload-flow sections current after 00fcd542 (image-sizes
  list + GPS-strip contract); no drift found this cycle.
- `data-timeline.ts` "matches publicSelectFields" claim is currently
  TRUE field-for-field (verified key-by-key against data.ts) — the
  gap is enforcement, not accuracy (test-engineer TEST-R4C9-04).
- build-sw.ts comment about pipeline-version-stamped SW_VERSION
  matches behavior; the repo's refresh-commit convention keeps the
  committed sw.js in sync per deploy.
- on-this-day-widget R20-M2 comment accurately explains the base-JPEG
  choice; PERF-R4C9-03 supersedes the constraint via the existing
  OptimisticImage fallback component (comment must be updated with
  the fix).
