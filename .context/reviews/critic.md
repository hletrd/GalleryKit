# Cycle 6 Critic Notes

## Findings

### C6-02 — The app still has a split source of truth for gallery branding under failure
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/app/global-error.tsx:45-52`, `apps/web/src/app/[locale]/layout.tsx:15-48,75-109`, `apps/web/src/lib/data.ts:770-790`
- The healthy path uses DB-backed SEO settings, but the fatal shell still reads a file constant. That creates a configuration split exactly where consistency matters most during incidents.
- Suggested fix: carry the live brand through the root layout so the error shell can reuse it without introducing a new DB dependency inside the client-only boundary.

### C6-03 — The new failure-path contracts still lack dedicated regression tests
- **Severity:** LOW
- **Confidence:** High
- **Citations:** `apps/web/src/__tests__/restore-maintenance.test.ts:1-43`, absence of any error-shell helper or restore-stream tests in `apps/web/src/__tests__/`
- The repo has no focused tests for restore stdin error classification or fatal-shell brand derivation, so both can regress silently.
