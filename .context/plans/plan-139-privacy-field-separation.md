# Plan 139: Fix Privacy Field Separation in data.ts

**Priority:** P0 (Security-critical)
**Source:** AGG-1 (6-agent consensus: code-reviewer C1/C2/C3, security-reviewer S1, verifier V1/V2/V3, critic CR1, architect A1, document-specialist DS1/DS4, test-engineer T5)

## Problem
The privacy architecture in `data.ts` is broken:
1. `publicSelectFields = selectFields` — same object reference, zero separation
2. `adminSelectFields` documented in CLAUDE.md but doesn't exist
3. Compile-time privacy guard (`_AssertNoSensitiveFields`) is structurally flawed — only triggers if ALL keys are sensitive
4. No runtime test verifies public queries omit sensitive fields

## Implementation Steps

### Step 1: Create proper `adminSelectFields` with all fields
**File:** `apps/web/src/lib/data.ts`
- Define `adminSelectFields` as a new const object that includes ALL image columns (latitude, longitude, filename_original, user_filename) for admin-only queries
- This addresses the CLAUDE.md documentation mismatch

### Step 2: Create proper `publicSelectFields` as a separate object
**File:** `apps/web/src/lib/data.ts`
- Define `publicSelectFields` independently, explicitly omitting: latitude, longitude, filename_original, user_filename
- Use spread with rest to derive from adminSelectFields: `const { latitude, longitude, filename_original, user_filename, ...publicSelectFields } = adminSelectFields;`
- This ensures adding a field to adminSelectFields does NOT automatically leak it to public queries

### Step 3: Fix the compile-time privacy guard
**File:** `apps/web/src/lib/data.ts`
Replace the flawed guard:
```typescript
// OLD (broken):
type _AssertNoSensitiveFields = _SelectFieldsKeys extends _PrivacySensitiveKeys
    ? [_SelectFieldsKeys, 'ERROR: ...'] : true;
const _privacyGuard: _AssertNoSensitiveFields = true as _AssertNoSensitiveFields;

// NEW (correct):
type _SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>;
const _privacyGuard: _SensitiveKeysInPublic extends never ? true : [_SensitiveKeysInPublic, 'ERROR: privacy-sensitive field found in publicSelectFields'] = true;
```

### Step 4: Update all public query functions to use `publicSelectFields`
No changes needed — they already use `publicSelectFields`. The fix is that `publicSelectFields` is now a separate object.

### Step 5: Add a runtime test
**File:** `apps/web/src/__tests__/privacy-fields.test.ts` (new)
- Assert `publicSelectFields` does not contain keys: latitude, longitude, filename_original, user_filename
- Assert `adminSelectFields` contains all fields including sensitive ones
- Assert `publicSelectFields !== adminSelectFields` (not same reference)

### Step 6: Update CLAUDE.md
Remove the `adminSelectFields` documentation mismatch concern — it will now exist for real.

## Deferred Items
None — all steps are implementable this cycle.

## Exit Criteria
- `publicSelectFields` is a separate object from `adminSelectFields`
- Compile-time guard catches addition of sensitive fields to `publicSelectFields`
- Runtime test passes
- All existing tests continue to pass
- ESLint and build succeed

## Implementation Status: DONE
- Step 1: adminSelectFields created with all fields including PII ✅
- Step 2: publicSelectFields derived via spread omission ✅
- Step 3: Compile-time guard fixed with Extract ✅
- Step 4: Public queries already use publicSelectFields (no change needed) ✅
- Step 5: Runtime test added (privacy-fields.test.ts) ✅
- Step 6: CLAUDE.md updated ✅
Commit: 00000008e8 fix(privacy): 🔒 enforce proper public/admin field separation in data.ts
