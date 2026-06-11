# Test-engineer — Run-4 Cycle 10

Angle: coverage gaps behind the two proven defects + regression-pin posture.

## Baseline
Clean-tree `npm test --workspace=apps/web`: **1739 passed (181 files)**.
EN/KO message parity 826/826. typecheck PASS (verified via build gate in
PROMPT 3).

## TEST-R4C10-01 — GPS-strip suite has zero post-EOI trailer fixtures (folds into SEC-R4C10-01)
`src/__tests__/strip-gps-from-original.test.ts` is the only GPS-strip suite.
Every JPEG fixture is a SINGLE image — the GPS lives in the primary EXIF or
the primary's std/ext XMP. There is no fixture with a second full
`FFD8…FFD9` after the primary EOI, so the suite is structurally blind to the
motion-photo / MPF leak. The defect was provable only by constructing the
adversarial two-image buffer (done in-context; SURVIVED→LEAK confirmed).
Required new tests:
1. Proven-failing-before: primary-GPS + trailer-GPS JPEG → after fix, the
   stored bytes contain NO surviving GPS (function returns `null`, caller
   re-encodes).
2. Trailer-without-GPS JPEG still handled safely (routes to re-encode; no
   crash; primary deliverable intact).
3. Single-image JPEG (no trailer) unchanged — still lossless tier-1.

## TEST-R4C10-02 — no test deletes an admin with audit history (folds into COR-R4C10-01)
No fixture exercises `deleteAdminUser` against an admin that has an
`audit_log` row. A behavioral test (insert admin + audit row, delete admin,
assert success and that the audit row survives with `user_id = NULL`) would
have caught the FK-1451 break. Add it alongside the fix.

## Re-verified pins intact
- `privacy-fields.test.ts` now pins `timelineSelectFieldKeys` (c9). Good.
- `sw-template-contract.test.ts` pins the lazy-revalidate source contract.
- `strip-gps-from-original.test.ts` (c9) added ext-XMP cases.
- `process-image-blur-wiring` / `images-action-blur-wiring` / `data-tag-names-sql`
  fixture pins all green.
