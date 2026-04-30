# Code Reviewer — Cycle 20

## Review method
Direct deep review of all key source files: data.ts, image-queue.ts, session.ts,
validation.ts, sanitize.ts, api-auth.ts, proxy.ts, request-origin.ts, bounded-map.ts,
rate-limit.ts, auth-rate-limit.ts, content-security-policy.ts, csv-escape.ts,
db-actions.ts, schema.ts, upload-tracker-state.ts, public.ts, auth.ts, advisory-locks.ts,
safe-json-ld.ts, action-guards.ts, process-image.ts, images.ts, sharing.ts, topics.ts,
tags.ts, settings.ts, admin-users.ts, seo.ts.

## GATE STATUS (carried forward, verified)
- eslint: clean
- tsc --noEmit: clean
- build: success
- vitest: 574 tests passing (84 test files)
- lint:api-auth: OK
- lint:action-origin: OK

## Previously fixed findings (confirmed still fixed)
- C9-CR-01: viewCountRetryCount iteration-during-deletion — FIXED
- C9-CR-02: pruneRetryMaps iteration-during-deletion — FIXED
- C16-CT-01: image-queue.ts contradictory comment — FIXED
- C16-CT-02: instrumentation.ts console.log — FIXED
- C18-MED-01: searchImagesAction re-throws — FIXED
- C19-AGG-01: getImageByShareKeyCached cache caveat — DOCUMENTED
- C19-AGG-02: duplicated topic-slug regex — FIXED (replaced with isValidSlug)

## New Findings

### C20-CR-01 (Low / Medium): `updateImageMetadata` explicitly sets `updated_at: sql\`CURRENT_TIMESTAMP\`` but the schema already has `.onUpdateNow()`

- **Source**: `apps/web/src/app/actions/images.ts:754`
- **Location**: `updateImageMetadata` function, `.set({ title, description, updated_at: sql\`CURRENT_TIMESTAMP\` })`
- **Issue**: The `images` table schema already declares `updated_at: timestamp("updated_at").default(sql\`CURRENT_TIMESTAMP\`).onUpdateNow()`, which auto-updates on every row mutation. The explicit `updated_at: sql\`CURRENT_TIMESTAMP\`` in the SET clause is redundant — it does the same thing `onUpdateNow()` would do automatically. This is not a bug (the explicit set takes precedence and produces the same value), but it's misleading: a future developer might think `onUpdateNow()` is not active and add this explicit set to every mutation site, creating a maintenance burden. If the column definition ever changes (e.g., to track only specific mutation types), this explicit set would need to be audited.
- **Fix**: Remove the explicit `updated_at: sql\`CURRENT_TIMESTAMP\`` from the `.set()` call. The `onUpdateNow()` schema annotation handles it automatically. Add a code comment noting that `onUpdateNow()` covers this.
- **Confidence**: Medium

### C20-CR-02 (Low / Low): `tags.ts` `updateTag` catch block logs error without the error object

- **Source**: `apps/web/src/app/actions/tags.ts:94`
- **Location**: `catch { console.error("Failed to update tag"); }`
- **Issue**: The catch block in `updateTag` logs a string message without the actual error object. Every other catch block in the same file (`deleteTag` line 133, `addTagToImage` line 200, etc.) logs the error object as the second argument. Without the error object, operators cannot diagnose root causes from the logs.
- **Fix**: Change to `catch (e) { console.error("Failed to update tag", e); }` matching the pattern in `deleteTag` and `addTagToImage`.
- **Confidence**: Low

## Carry-forward (unchanged — existing deferred backlog)
- A17-MED-01: data.ts god module — previously deferred
- A17-MED-02: CSP style-src 'unsafe-inline' — previously deferred
- A17-MED-03: getImage parallel DB queries — previously deferred
- A17-LOW-04: permanentlyFailedIds process-local — previously deferred
- A17-LOW-08: Lightbox auto-hide UX — previously deferred
- A17-LOW-09: Photo viewer sidebar layout shift — previously deferred
