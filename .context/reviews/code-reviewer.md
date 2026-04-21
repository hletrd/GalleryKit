# Cycle 6 Code Reviewer Notes

## Inventory
- Server restore/export actions: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`
- Error shell + root metadata flow: `apps/web/src/app/global-error.tsx`, `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/lib/data.ts`
- Supporting tests: `apps/web/src/__tests__/restore-maintenance.test.ts`

## Findings

### C6-01 — Restore streaming does not handle child-stdin failures
- **Severity:** HIGH
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:362-416`
- **Problem:** `runRestore()` pipes the uploaded SQL file into `mysql` but only listens for `readStream`, `restore`, and `restore.stderr` events. It never listens for `restore.stdin` errors.
- **Failure scenario:** if `mysql` exits early (for example on malformed SQL, broken connection, or a killed child process), Node can emit `EPIPE` / destroyed-stream errors on `restore.stdin`. Without a handler, the action can fail with an unstructured stream error instead of returning the existing `restoreExitedWithCode` / `restoreFailed` response path.
- **Suggested fix:** attach an explicit `restore.stdin` error handler before piping, treat broken-pipe style errors as non-fatal because the child `close` event carries the real exit code, and fail cleanly for other stdin errors.

### C6-02 — The fatal error shell still bypasses the live SEO brand source
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/app/global-error.tsx:1-3,45-52`, `apps/web/src/app/[locale]/layout.tsx:15-48,75-109`, `apps/web/src/lib/data.ts:770-790`
- **Problem:** normal pages derive gallery branding from `getSeoSettings()`, but the fatal shell still renders `site-config.json` directly.
- **Failure scenario:** after an admin updates the live SEO title/nav title, public pages and the manifest reflect the new brand while a fatal render error still shows the stale static title.
- **Suggested fix:** pass the live brand across the server/client boundary (for example via root-layout data attributes) and let `global-error.tsx` read that before falling back to `site-config.json`.
