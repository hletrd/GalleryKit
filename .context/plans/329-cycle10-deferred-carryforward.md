# Plan 329 — Cycle 10: Deferred findings carry-forward

## Origin

Cycle 10 review findings that are explicitly deferred per the plan directory rules.

## AGG10-02 (partial — LOW). `isValidSlug` uses `.length` — ASCII-regex makes it safe but undocumented

- **File+line**: `apps/web/src/lib/validation.ts:23`
- **Original severity/confidence**: Low / Low
- **Reason for deferral**: The regex `/^[a-z0-9_-]+$/` restricts slugs to ASCII characters where `.length` and `countCodePoints()` always agree. The functional impact is nil. Adding a comment (Task 2 in plan-328) documents the safety, but switching to `countCodePoints()` is not required.
- **Exit criterion**: If `isValidSlug` is changed to allow non-ASCII characters, migrate to `countCodePoints()`.

## AGG10-03 (partial — LOW). `isValidTagSlug` uses `.length` — BMP-heavy in practice but undocumented

- **File+line**: `apps/web/src/lib/validation.ts:96`
- **Original severity/confidence**: Low / Low
- **Reason for deferral**: `getTagSlug()` normalizes to BMP-heavy forms where `.length` counts correctly. Supplementary characters in tag slugs are extremely rare. Adding a comment (Task 3 in plan-328) documents the safety, but switching to `countCodePoints()` is not required at personal-gallery scale.
- **Exit criterion**: If `isValidTagSlug` is changed to allow supplementary characters, or if a user reports false rejection for a valid tag slug, migrate to `countCodePoints()`.

## Carry-forward of prior deferred items

All prior deferred items from previous cycle deferred plans (plan-326 and all earlier) remain valid and deferred with no change in status.
