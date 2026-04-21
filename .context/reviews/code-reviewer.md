# Code Review — Cycle 5 Manual Fallback

_This file was written as a manual fallback after two Codex child-agent review attempts timed out without producing trustworthy artifacts._

## Inventory
- Admin DB tooling: `apps/web/src/app/[locale]/admin/db-actions.ts`, DB admin page
- Mutating server actions: `apps/web/src/app/actions/*.ts`
- Restore/queue/runtime glue: `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/data.ts`
- Runtime branding shell: `apps/web/src/app/global-error.tsx`, `apps/web/src/app/[locale]/layout.tsx`

## Confirmed issues

### C5-01 — Restore maintenance still leaves conflicting writes alive
- **Severity:** HIGH
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:235-279`, `apps/web/src/app/actions/images.ts:81-88,180-227`, `apps/web/src/app/actions/admin-users.ts:67-69`, `apps/web/src/app/actions/settings.ts:35-37`, `apps/web/src/app/actions/seo.ts:49-51`, `apps/web/src/app/actions/sharing.ts:61-63`, `apps/web/src/app/actions/tags.ts:42-44`, `apps/web/src/app/actions/topics.ts:33-35,104-106`, `apps/web/src/app/actions/auth.ts:68-70,251-255`
- **Problem:** `restoreDatabase()` flips a process-local maintenance flag, flushes view counts, and quiesces the queue, but almost every other mutating server action keeps running normally. Even `uploadImages()` only checks `isRestoreMaintenanceActive()` once at the start; the function can still save originals and insert DB rows after the restore window opens if it was already in flight.
- **Failure scenario:** an admin starts a restore while another admin is editing tags/settings or while an upload request is already inside `saveOriginalAndGetMetadata()`. The restore replays an older DB snapshot while those writes continue landing, leaving mixed post-restore state that no longer matches the dump.
- **Suggested fix:** add a reusable restore-maintenance guard for all conflicting admin/auth mutations and re-check `uploadImages()` at the write boundary, not only at request start.

### C5-02 — The restore-size contract is still split between a 250 MB action limit and a 2 GiB server-action ingress limit
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:227-230,282-290`, `apps/web/next.config.ts:96-101`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:57-79,158-166`
- **Problem:** the code comment says the restore limit is aligned with the framework boundary, but it is not. Next.js accepts request bodies up to `NEXT_UPLOAD_BODY_SIZE_LIMIT` (default 2 GiB) for all server actions, while the restore action rejects files over 250 MB only after the request already reached the action. The admin UI also gives no max-size hint or client-side preflight rejection.
- **Failure scenario:** an operator selects a 900 MB dump. The browser sends it, Next parses it, and only then does the action return `fileTooLarge`, burning bandwidth and parse cost for an unsupported restore.
- **Suggested fix:** share the 250 MB limit with the UI immediately, and longer-term move restore off the general server-action body-size budget or enforce a stricter ingress boundary specific to restore traffic.

### C5-03 — Fatal error branding still bypasses the live SEO/settings source of truth
- **Severity:** LOW
- **Confidence:** Medium
- **Citations:** `apps/web/src/app/global-error.tsx:1-3,45-52`, `apps/web/src/app/[locale]/layout.tsx:15-48`
- **Problem:** normal metadata/branding flows now come from `getSeoSettings()`, but `global-error.tsx` still hardcodes `site-config.json` branding.
- **Failure scenario:** an admin updates the gallery title/nav title in SEO settings. Regular pages show the new name, but any fatal app-shell error page still shows the old static brand, which undermines product consistency.
- **Suggested fix:** either intentionally document the fatal-shell fallback as file-backed or add a safe runtime path that keeps the fatal shell aligned with the live brand.
