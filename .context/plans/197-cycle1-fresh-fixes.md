# Plan 197 — Cycle 1 Fresh Fixes (Updated)

**Source:** Cycle 1 Fresh Aggregate Review (`_aggregate.md`)
**Status:** IN PROGRESS

## Fix 1: `sortedSizes` dead code in process-image.ts [CR1-01]
- Replace `sizes` with `sortedSizes` in the `for` loop (line 383)
- Replace `sizes[sizes.length - 1]` with `sortedSizes[sortedSizes.length - 1]` (line 410)
- This ensures the base-filename always uses the largest size regardless of admin config order

## Fix 2: Privacy guard TS2322 — remove `original_format`/`original_file_size` from publicSelectFields [CR1-02]
- Remove `original_format: sql\`NULL\`` and `original_file_size: sql\`NULL\`` from `publicSelectFields`
- These fields are already omitted from `publicSelectFieldCore` via destructuring, so adding them back as NULL is both a type error and a privacy leak (field names visible in API schema)
- The `_PrivacySensitiveKeys` guard correctly catches this; the fix is to remove the NULL columns

## Fix 3: Remove `/i` flag from data.ts slug regexes [CR1-03, CR1-05]
- `getImageCount` line 259: `/^[a-z0-9_-]+$/i` → `/^[a-z0-9_-]+$/`
- `buildImageConditions` line 296: `/^[a-z0-9_-]+$/i` → `/^[a-z0-9_-]+$/`
- `getTopicBySlug` line 615: `/^[a-z0-9_-]+$/i` → `/^[a-z0-9_-]+$/`
- These must match `isValidSlug` which now enforces lowercase

## Fix 4: Add `CREATE TABLE` to dangerous SQL patterns [CR1-04]
- Add `/\bCREATE\s+TABLE\b/i` to `DANGEROUS_SQL_PATTERNS` in `sql-restore-scan.ts`
- Prevents malicious SQL dumps from creating arbitrary tables
