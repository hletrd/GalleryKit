# Cycle 9 Dependency / Runtime Review (manual fallback after context-window failure)

## Inventory
- Reviewed the clipboard/browser-API dependency surface, Next.js search UI data contract, and MySQL/Drizzle error-shape handling.
- Cross-checked the Playwright seed/runtime path for public search verification.

## Confirmed issues

### X9-01 — Clipboard helper relies solely on the modern async Clipboard API
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/lib/clipboard.ts:1-8`
- **Why it matters:** some browsers/embeds deny `navigator.clipboard.writeText()` even when a manual `execCommand('copy')` fallback would still work.
- **Suggested fix:** add the legacy fallback and keep the helper boolean contract intact.

### X9-02 — Search result metadata still omits canonical topic labels
- **Severity:** LOW
- **Confidence:** High
- **Citations:** `apps/web/src/lib/data.ts:637-726`, `apps/web/src/components/search.tsx:18-24,235-236`
- **Why it matters:** the search dialog falls back to slug-humanization, which loses intentional capitalization and non-slug labels.
- **Suggested fix:** return `topic_label` from the query and render that when available.
