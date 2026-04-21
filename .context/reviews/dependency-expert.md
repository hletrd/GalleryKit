# Cycle 6 Dependency Expert Notes

## Findings

### C6-01 — The `child_process` + stream boundary for restore lacks explicit writable error handling
- **Severity:** HIGH
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:362-416`
- **Runtime risk:** when piping a file into `mysql`, the writable side (`restore.stdin`) is part of the child-process contract and can fail independently of the process object. The current code handles the process but not that writable boundary.
- **Suggested fix:** treat stdin failures as a first-class part of the restore lifecycle and classify benign broken-pipe cases separately from real I/O failures.
