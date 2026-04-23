# Architect — Cycle 13

## Findings

### ARCH-13-01: `gallery-config.ts` duplicates parsing logic from `gallery-config-shared.ts` [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/lib/gallery-config.ts` line 77 vs `apps/web/src/lib/gallery-config-shared.ts` lines 112-116
- **Description**: The `image_sizes` parsing in `gallery-config.ts` line 77 (`getSetting(map, 'image_sizes').split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0)`) is a hand-rolled duplicate of `parseImageSizes()` in `gallery-config-shared.ts`. The shared version sorts the result and falls back to `DEFAULT_IMAGE_SIZES` on empty/invalid input, while the config module version does neither. This violates DRY and introduces the unsorted-sizes bug (CR-13-01, DBG-13-01). The same pattern applies to all numeric parsing in `_getGalleryConfig()` — each field uses bare `Number()` without the validators that already exist in `gallery-config-shared.ts`.
- **Fix**: Import and use `parseImageSizes` for `imageSizes`. For other numeric fields, add validation against the existing `isValidSettingValue` validators with fallback to defaults.

### ARCH-13-02: Config module has no invalid-value fallback defense [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/lib/gallery-config.ts` lines 70-87
- **Description**: The `_getGalleryConfig()` function reads from the DB and applies `Number()` / `=== 'true'` / `as` casts without any validation or fallback. The design assumes that `updateGallerySettings` is the only writer and validates on write. But the DB is a shared resource — manual SQL, migration scripts, or DB restore could write invalid values. The read path should defensively validate and fall back to defaults, just like `parseImageSizes` does. This is a "trust boundary" issue: the config module trusts the DB layer too much.
- **Fix**: After parsing each field, validate against `isValidSettingValue` and fall back to the corresponding `DEFAULTS` entry if invalid.

### ARCH-13-03: `data.ts` `selectFields` / `publicSelectFields` alias is semantically misleading [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/lib/data.ts` lines 93-134
- **Description**: `publicSelectFields` is defined as `const publicSelectFields = selectFields` (line 134). They are the same reference. The comment says "It MUST be used instead of raw `selectFields` in public queries" but since they're identical, there's no enforcement mechanism — a developer could use `selectFields` in a public query and nothing would catch it. The two names exist to make intent explicit in code review, but the type system doesn't enforce the distinction. This is a defense-in-depth gap.
- **Fix**: Consider making `selectFields` private (not exported) and only exporting `publicSelectFields`. The admin-specific queries that need extra fields can import from a separate `adminSelectFields` that explicitly adds sensitive fields. This would make the privacy boundary enforceable at the module level.
