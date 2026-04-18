# Plan 28: Upload, Restore, and Sharing Safety — R8

**Priority:** HIGH
**Estimated effort:** 3-4 hours
**Sources:** Comprehensive audit 2026-04-18 findings #2, #3, #4, #5 and likely risk C
**Status:** COMPLETE

---

## Scope
- Upload replacement safety
- Replacement validation / original-file preservation
- Share creation gating for processed assets
- Restore scanner false-positive avoidance
- Shared-group view-count durability on shutdown (if safe to land)

## Planned items
1. Replace filename-based implicit overwrite behavior with an explicit safe path
2. Prevent failed replacements from deleting the previous original prematurely
3. Block public share creation for unprocessed images
4. Make restore scanning ignore dangerous keywords inside quoted SQL data
5. Flush buffered shared-group view counts on shutdown if implementation is low-risk

## Ralph progress
- 2026-04-18: Plan created from the full audit.
- 2026-04-18: Completed the data-safety/sharing pass:
  - removed implicit filename-based replacement from uploads
  - eliminated the unsafe pre-validation original-file deletion path
  - blocked photo/group share creation for unprocessed images
  - extracted restore scanning so quoted SQL literals no longer trigger false positives
  - flush buffered shared-group view counts during shutdown
- 2026-04-18: Final verification passed (`lint`, `test`, `tsc`, `build`) and architect review approved the plan scope.
