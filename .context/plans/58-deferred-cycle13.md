# Plan 58 — Deferred Items (Cycle 13)

**Created:** 2026-04-19 (Cycle 13)
**Status:** Deferred

## Deferred Findings

### C13-03: CSV export column headers hardcoded in English (LOW)
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts:54`
- **Original severity/confidence:** LOW / HIGH
- **Reason for deferral:** CSV exports are conventionally in English across most applications — column headers like "ID", "Filename", "Title" are standard data interchange format. Localizing them could break downstream consumers (spreadsheet macros, data pipelines) that expect English headers. The admin UI is fully localized, but CSV is a structured data format, not a UI surface. Additionally, the server action does not currently receive locale information from the client, so implementing localization would require passing locale through the action call chain.
- **Exit criterion:** If a user explicitly requests localized CSV headers, or if the CSV is used primarily for display rather than data interchange, re-open.
