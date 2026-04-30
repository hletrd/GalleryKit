# Plan 69-Deferred — Deferred Items (Cycle 23)

**Created:** 2026-04-19 (Cycle 23)
**Status:** Deferred

## Deferred Findings

### C23-03: processTopicImage temp file cleanup — not a bug
- **File+Line:** `apps/web/src/lib/process-topic-image.ts`, lines 64-80
- **Severity/Confidence:** LOW / HIGH
- **Reason for deferral:** Not a bug — the catch block handles both tempPath and outputPath cleanup correctly. The ordering is safe.
- **Exit criterion:** If a future refactor changes the function structure, re-verify cleanup paths.

### C23-04: db/page.tsx Cancel button uses t('cancel') instead of t('imageManager.cancel')
- **File+Line:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`, line 191
- **Severity/Confidence:** LOW / MEDIUM
- **Reason for deferral:** Both keys resolve to "Cancel". The db namespace is intentionally self-contained. The inconsistency is cosmetic and does not cause any functional issue.
- **Exit criterion:** If the db namespace keys are consolidated or if `db.cancel` is removed, update to use `imageManager.cancel`.

### C23-05: Search overlay ARIA structure — confirmed correct
- **File+Line:** `apps/web/src/components/search.tsx`, line 121
- **Severity/Confidence:** LOW / MEDIUM
- **Reason for deferral:** Not a bug — the ARIA structure is correct. `role="dialog"`, `aria-modal="true"`, `role="combobox"`, `aria-controls`, `role="listbox"`, `role="option"` are all properly implemented.
- **Exit criterion:** N/A — no action needed.

## Carry-Forward from Previous Cycles

All 17+2 previously deferred items from cycles 5-22 remain deferred with no change in status.
