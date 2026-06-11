# Document-specialist — Run-4 Cycle 10

Angle: doc-vs-code drift against CLAUDE.md / AGENTS.md and the GPS-strip
container-support claim.

## Inventory
- CLAUDE.md GPS-strip + privacy sections, `lib/gps-exif-strip.ts` header
  docblock, `admin-users.ts` delete contract, schema FK comments.

## DOC-R4C10-01 — gps-exif-strip docblock overstates JPEG coverage (folds into SEC-R4C10-01)
`lib/gps-exif-strip.ts` header (lines 18-26) lists JPEG support as "APP1 Exif
segment; GPS-bearing XMP APP1 segments dropped …" with no mention that the
walker stops at the first EOI and does NOT inspect post-EOI trailers. A
reader trusts the module strips GPS from "JPEG" full-stop. The c9 ExtendedXMP
note was added to this same block. The doc must state the post-EOI-trailer
handling (re-encode fallback) once SEC-R4C10-01 lands, so the contract
matches the code.

## DOC-R4C10-02 — admin-delete contract understates the failure mode (folds into COR-R4C10-01)
CLAUDE.md Security → Middleware Auth Guard: "Last admin deletion prevented to
avoid lockout." Accurate for the last-admin guard, but silent on the fact
that — pre-fix — NO admin with audit history could be deleted at all. After
the fix lands, no doc change is strictly required (the feature simply works),
but the `deleteAdminUser` code comment should record the audit-detach step so
a future refactor doesn't drop it and reintroduce the FK-1451 break.

## Re-verified accurate (no drift)
- IMAGE_PIPELINE_VERSION = 7 matches `process-image.ts`.
- Default image sizes (640, 1536, 2048, 4096) match `gallery-config-shared`.
- `uploaded_by` FK `ON DELETE SET NULL` documented and matches schema:94 —
  this is the precedent the COR-R4C10-01 fix mirrors at the app layer.
- SW strategies docblock matches `sw.template.js` after the c9 lazy-revalidate
  edit (DOC-R4C9-05 closed).
- Advisory-lock catalogue matches the `lib/advisory-locks.ts` constants.
